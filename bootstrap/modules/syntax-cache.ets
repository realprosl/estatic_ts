import { ParserToken, AstNode, AstAttribute, AstEdge, ParseResult } from "../parser/parser";
import { SourceResult, parseSource } from "../frontend/frontend";
import { contentHash, readSnapshot, publishRecord, syntaxIdentity } from "./platform";

// Length-prefixed UTF-8 byte fields. Hydration owns fresh arrays/classes on every hit.
export function field(text: string): string { return numberToString(text.length) + ":" + text; }
export function integer(value: number): string { return field(numberToString(value)); }
class Reader {
  text: string; at: number; valid: boolean;
  constructor(text: string) { this.text = text; this.at = 0; this.valid = true; }
  take(): string {
    let size: number = 0; let digits: number = 0;
    while ((this.at) < this.text.length && this.text.charAt(this.at) != ":") {
      const digit: number = this.text.charCodeAt(this.at) - 48; this.at = this.at + 1;
      if (digit < 0 || digit > 9 || digits >= 10) { this.valid = false; return ""; }
      size = size * 10 + digit; digits = digits + 1;
    }
    if (digits == 0 || this.at >= this.text.length || size > this.text.length - this.at - 1) { this.valid = false; return ""; }
    this.at = this.at + 1; const result: string = this.text.slice(this.at, this.at + size); this.at = this.at + size; return result;
  }
  natural(): number {
    const text: string = this.take(); let value: number = 0;
    if (text.length == 0 || text.length > 10) this.valid = false;
    for (let i: number = 0; i < text.length; i = i + 1) {
      const digit: number = text.charCodeAt(i) - 48;
      if (digit < 0 || digit > 9) this.valid = false;
      value = value * 10 + digit;
    }
    if (value > 2147483647) this.valid = false;
    return this.valid ? value : 0;
  }
  count(): number {
    const value: number = this.natural();
    if (value > 1000000 || value > this.text.length - this.at) { this.valid = false; return 0; }
    return value;
  }
  done(): boolean { return this.valid && this.at == this.text.length; }
}
function encodeToken(token: ParserToken): string {
  return field(token.kind) + field(token.lexeme) + integer(token.offset) + integer(token.line) + integer(token.column)
    + integer(token.endOffset) + integer(token.endLine) + integer(token.endColumn);
}
function decodeToken(out reader: Reader, length: number): ParserToken {
  const kind: string = reader.take(); const lexeme: string = reader.take();
  const offset: number = reader.natural(); const line: number = reader.natural(); const column: number = reader.natural();
  const endOffset: number = reader.natural(); const endLine: number = reader.natural(); const endColumn: number = reader.natural();
  if (kind == "" || endOffset < offset || endOffset > length || line < 1 || column < 1 || endLine < line || endColumn < 1) reader.valid = false;
  if (endLine == line && endColumn - column != endOffset - offset) reader.valid = false;
  if (endLine > line && endOffset - offset < endLine - line) reader.valid = false;
  return new ParserToken(kind, lexeme, offset, line, column, endOffset, endLine, endColumn);
}
export function encodeSyntax(result: SourceResult): string {
  let parts: string[] = [integer(result.tokens.length)];
  for (const token of result.tokens) parts.push(encodeToken(token));
  parts.push(integer(result.ast.root) + integer(result.ast.nodes.length));
  for (const node of result.ast.nodes) {
    parts.push(field(node.kind) + encodeToken(node.start) + encodeToken(node.end) + integer(node.attributes.length));
    for (const attribute of node.attributes) parts.push(field(attribute.name) + field(attribute.value));
    parts.push(integer(node.edges.length));
    for (const edge of node.edges) parts.push(field(edge.role) + integer(edge.node));
  }
  return parts.join("");
}
function emptySyntax(file: string): SourceResult { return new SourceResult(file, [], new ParseResult(-1, [], []), [], false); }
export function decodeSyntax(text: string, file: string, length: number): SourceResult {
  let reader: Reader = new Reader(text); let tokens: ParserToken[] = []; let nodes: AstNode[] = [];
  const tokenCount: number = reader.count();
  for (let i: number = 0; i < tokenCount && reader.valid; i = i + 1) {
    const token: ParserToken = decodeToken(reader, length);
    if (i > 0 && (token.offset) < tokens[i - 1].endOffset) reader.valid = false;
    if (i + 1 < tokenCount && token.kind == "eof") reader.valid = false;
    tokens.push(token);
  }
  if (tokens.length == 0) reader.valid = false;
  else {
    const last: ParserToken = tokens[tokens.length - 1];
    if (last.kind != "eof" || last.offset != length || last.endOffset != length) reader.valid = false;
  }
  const root: number = reader.natural(); const count: number = reader.count();
  for (let i: number = 0; i < count && reader.valid; i = i + 1) {
    const kind: string = reader.take(); const start: ParserToken = decodeToken(reader, length); const end: ParserToken = decodeToken(reader, length);
    if (kind == "" || (end.endOffset) < start.offset) reader.valid = false;
    let node: AstNode = new AstNode(kind, start, end); const attributes: number = reader.count();
    for (let a: number = 0; a < attributes && reader.valid; a = a + 1) {
      const name: string = reader.take(); const value: string = reader.take();
      node.attributes.push(new AstAttribute(name, value));
    }
    const edges: number = reader.count();
    for (let e: number = 0; e < edges && reader.valid; e = e + 1) {
      const role: string = reader.take(); const index: number = reader.natural();
      if (role == "" || index >= count || index == i) reader.valid = false;
      node.edges.push(new AstEdge(role, index));
    }
    nodes.push(node);
  }
  if (!reader.done() || root >= nodes.length) return emptySyntax(file);
  if (nodes[root].kind != "Program") return emptySyntax(file);
  // The parser allocates parents before or after children. Validate acyclicity
  // iteratively, including unattached nodes, before returning any cached arena.
  let states: number[] = []; for (const node of nodes) states.push(0);
  for (let i: number = 0; i < nodes.length; i = i + 1) {
    if (states[i] != 0) continue;
    let stack: number[] = [i]; let cursors: number[] = [0]; states[i] = 1;
    while (stack.length > 0) {
      const top: number = stack.length - 1; const index: number = stack[top]; const cursor: number = cursors[top];
      if (cursor >= nodes[index].edges.length) { states[index] = 2; stack.pop(); cursors.pop(); }
      else {
        cursors[top] = cursor + 1; const child: number = nodes[index].edges[cursor].node;
        if (states[child] == 1) return emptySyntax(file);
        if (states[child] == 0) { states[child] = 1; stack.push(child); cursors.push(0); }
      }
    }
  }
  return new SourceResult(file, tokens, new ParseResult(root, nodes, []), [], true);
}
// ETS strings count UTF-8 bytes; parser spans count UTF-16 code units.
// Match Lexer.advance without tokenizing or decoding the syntax again.
export function sourceUnits(text: string): number {
  let at: number = 0; let units: number = 0;
  while (at < text.length) {
    const byte: number = text.charCodeAt(at); let width: number = 1; let count: number = 1;
    if (byte >= 240 && byte <= 244) { width = 4; count = 2; }
    else if (byte >= 224 && byte <= 239) width = 3;
    else if (byte >= 194 && byte <= 223) width = 2;
    at = at + width; units = units + count;
  }
  return units;
}
export class FileRecord {
  file: string; hash: string; metadata: string; syntax: string; dependencies: string[];
  constructor(file: string, hash: string, metadata: string, syntax: string) {
    this.file = file; this.hash = hash; this.metadata = metadata; this.syntax = syntax; this.dependencies = [];
  }
}
export class CachedSource {
  result: SourceResult; record: FileRecord; reused: boolean;
  constructor(result: SourceResult, record: FileRecord, reused: boolean) { this.result = result; this.record = record; this.reused = reused; }
}
export class SyntaxCache {
  directory: string; identity: string; records: FileRecord[]; hits: number; misses: number; writes: number;
  constructor(directory: string = "", optionsKey: string = "") {
    this.directory = directory; this.identity = "ets-syntax-1:" + syntaxIdentity() + ":" + optionsKey;
    this.records = []; this.hits = 0; this.misses = 0; this.writes = 0;
  }
  resetStats(): void { this.hits = 0; this.misses = 0; this.writes = 0; }
  recordPath(file: string): string { return this.directory + "/" + contentHash(file) + ".record"; }
  envelope(record: FileRecord): string {
    let body: string[] = [field(this.identity), field(record.file), field(record.hash), field(record.metadata), field(record.syntax), integer(record.dependencies.length)];
    for (const dependency of record.dependencies) body.push(field(dependency));
    // Future interface/C++/object artifacts are deliberately absent, not valid hits.
    const text: string = body.join(""); return field(contentHash(text)) + text;
  }
  readRecord(text: string, file: string, hash: string): FileRecord {
    let reader: Reader = new Reader(text); const checksum: string = reader.take();
    if (!reader.valid || checksum != contentHash(text.slice(reader.at, text.length))) return new FileRecord(file, "", "", "");
    const identity: string = reader.take(); const storedFile: string = reader.take(); const storedHash: string = reader.take();
    const metadata: string = reader.take(); const syntax: string = reader.take(); const count: number = reader.count();
    let record: FileRecord = new FileRecord(file, storedHash, metadata, syntax);
    for (let i: number = 0; i < count && reader.valid; i = i + 1) record.dependencies.push(reader.take());
    if (!reader.done() || identity != this.identity || file != storedFile || storedHash != hash) record.hash = "";
    return record;
  }
  getOrParseModule(file: string, source: string, metadata: string): CachedSource {
    // Always verify exact bytes, even when size/mtime/ctime are unchanged.
    const hash: string = contentHash(source); let record: FileRecord = new FileRecord(file, "", "", "");
    for (const existing of this.records) { if (existing.file == file && existing.hash == hash) record = existing; }
    if (record.hash == "" && this.directory != "") {
      const snapshot: string[] = readSnapshot(this.recordPath(file));
      if (snapshot[1] == "") record = this.readRecord(snapshot[0], file, hash);
    }
    if (record.hash == hash) {
      const restored: SourceResult = decodeSyntax(record.syntax, file, sourceUnits(source));
      if (restored.parsed) {
        this.hits = this.hits + 1; record.metadata = metadata; return new CachedSource(restored, record, true);
      }
    }
    const result: SourceResult = parseSource(source, file); this.misses = this.misses + 1;
    record = new FileRecord(file, hash, metadata, result.success ? encodeSyntax(result) : "");
    return new CachedSource(result, record, false);
  }
  save(record: FileRecord): void {
    if (record.syntax == "") return;
    let found: boolean = false;
    for (let i: number = 0; i < this.records.length; i = i + 1) {
      if (this.records[i].file == record.file) { this.records[i] = record; found = true; break; }
    }
    if (!found) this.records.push(record);
    if (this.directory == "") return;
    const text: string = this.envelope(record); const previous: string[] = readSnapshot(this.recordPath(record.file));
    if (previous[1] == "" && previous[0] == text) return;
    if (publishRecord(this.recordPath(record.file), text)) this.writes = this.writes + 1;
  }
}
