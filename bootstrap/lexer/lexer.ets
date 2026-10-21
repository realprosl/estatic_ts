// Bootstrap step 1. Standalone lexer: no parser, checker, AST or imports.
// Internal indices are UTF-8 bytes; public offsets/columns are UTF-16 units.

export class LexerToken {
  kind: string;
  lexeme: string;
  offset: number;
  line: number;
  column: number;
  endOffset: number;
  endLine: number;
  endColumn: number;
  constructor(kind: string, lexeme: string, offset: number, line: number, column: number,
              endOffset: number, endLine: number, endColumn: number) {
    this.kind = kind; this.lexeme = lexeme;
    this.offset = offset; this.line = line; this.column = column;
    this.endOffset = endOffset; this.endLine = endLine; this.endColumn = endColumn;
  }
}

export class LexerDiagnostic {
  message: string;
  offset: number;
  line: number;
  column: number;
  endOffset: number;
  endLine: number;
  endColumn: number;
  constructor(message: string, offset: number, line: number, column: number,
              endOffset: number, endLine: number, endColumn: number) {
    this.message = message; this.offset = offset; this.line = line; this.column = column;
    this.endOffset = endOffset; this.endLine = endLine; this.endColumn = endColumn;
  }
}

export class LexerResult {
  tokens: LexerToken[];
  diagnostics: LexerDiagnostic[];
  constructor(tokens: LexerToken[], diagnostics: LexerDiagnostic[]) {
    this.tokens = tokens; this.diagnostics = diagnostics;
  }
}

export class Lexer {
  source: string;
  byteOffset: number;
  offset: number;
  line: number;
  column: number;
  depth: number;
  tokens: LexerToken[];
  diagnostics: LexerDiagnostic[];
  constructor(source: string) {
    this.source = source; this.byteOffset = 0; this.offset = 0;
    this.line = 1; this.column = 1; this.depth = 0;
    this.tokens = []; this.diagnostics = [];
  }
  peek(ahead: number): string {
    if (this.byteOffset + ahead >= this.source.length) return "";
    return this.source.charAt(this.byteOffset + ahead);
  }
  atEnd(): boolean { return this.byteOffset >= this.source.length; }
  identifierStart(c: string): boolean {
    return c != "" && "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_".includes(c, 0);
  }
  digit(c: string): boolean { return c != "" && "0123456789".includes(c, 0); }
  identifierPart(c: string): boolean { return this.identifierStart(c) || this.digit(c); }
  keywordKind(word: string): string {
    if (word == "number" || word == "string" || word == "boolean" || word == "void" || word == "type") return "type";
    const words: string[] = ["let", "const", "function", "interface", "class", "new", "return", "if", "else",
      "while", "for", "break", "continue", "extends", "export", "true", "false", "out", "async", "await", "using",
      "satisfies", "as", "enum", "switch", "case", "default", "of", "in", "delete", "instanceof", "typeof",
      "readonly", "union", "import", "private", "public", "protected", "static"];
    if (words.includes(word)) return word;
    return "identifier";
  }
  whitespace(): boolean {
    let code: number = this.source.charCodeAt(this.byteOffset);
    if (code >= 194 && code <= 223) {
      code = (code - 192) * 64 + this.source.charCodeAt(this.byteOffset + 1) - 128;
    } else if (code >= 224 && code <= 239) {
      code = (code - 224) * 4096 + (this.source.charCodeAt(this.byteOffset + 1) - 128) * 64
        + this.source.charCodeAt(this.byteOffset + 2) - 128;
    }
    return (code >= 9 && code <= 13) || code == 32 || code == 160 || code == 5760
      || (code >= 8192 && code <= 8202) || code == 8232 || code == 8233 || code == 8239
      || code == 8287 || code == 12288 || code == 65279;
  }
  advance(): string {
    if (this.byteOffset >= this.source.length) return "";
    const byte: number = this.source.charCodeAt(this.byteOffset);
    let width: number = 1;
    let units: number = 1;
    if (byte >= 240 && byte <= 244) { width = 4; units = 2; }
    else if (byte >= 224 && byte <= 239) width = 3;
    else if (byte >= 194 && byte <= 223) width = 2;
    const c: string = this.source.slice(this.byteOffset, this.byteOffset + width);
    this.byteOffset = this.byteOffset + width;
    this.offset = this.offset + units;
    if (c == "\n") { this.line = this.line + 1; this.column = 1; }
    else this.column = this.column + units;
    return c;
  }
  emit(kind: string, lexeme: string, offset: number, line: number, column: number): void {
    this.tokens.push(new LexerToken(kind, lexeme, offset, line, column, this.offset, this.line, this.column));
  }
  error(message: string, offset: number, line: number, column: number): void {
    this.diagnostics.push(new LexerDiagnostic(message, offset, line, column, this.offset, this.line, this.column));
  }
  trivia(): void {
    let newlines: number = 0;
    let scanning: boolean = true;
    while (scanning) {
      const c: string = this.peek(0);
      if (this.whitespace()) {
        if (c == "\n") newlines = newlines + 1;
        this.advance();
      } else if (c == "/" && this.peek(1) == "/") {
        while (!this.atEnd() && this.peek(0) != "\n") this.advance();
      } else if (c == "/" && this.peek(1) == "*") {
        const offset: number = this.offset; const line: number = this.line; const column: number = this.column;
        this.advance(); this.advance();
        while (!this.atEnd() && !(this.peek(0) == "*" && this.peek(1) == "/")) {
          if (this.peek(0) == "\n") newlines = newlines + 1;
          this.advance();
        }
        if (!this.atEnd()) { this.advance(); this.advance(); }
        else this.error("Comentario sin cerrar", offset, line, column);
      } else scanning = false;
    }
    // Like the host lexer, only parentheses/brackets suppress newlines.
    const next: string = this.peek(0);
    if (newlines > 0 && this.depth == 0 && !(next != "" && ".([+-*/%=?:<>!&|^~".includes(next, 0))) {
      this.emit("newline", "\n", this.offset, this.line, this.column);
    }
  }
  identifier(offset: number, line: number, column: number): void {
    const start: number = this.byteOffset;
    while (this.identifierPart(this.peek(0))) this.advance();
    const value: string = this.source.slice(start, this.byteOffset);
    this.emit(this.keywordKind(value), value, offset, line, column);
  }
  scanNumber(offset: number, line: number, column: number): void {
    const start: number = this.byteOffset;
    const prefix: string = this.peek(1);
    if (this.peek(0) == "0" && prefix != "" && "xXoObB".includes(prefix, 0)) {
      this.advance(); this.advance();
      let charset: string = "01_";
      if (prefix == "x" || prefix == "X") charset = "0123456789abcdefABCDEF_";
      else if (prefix == "o" || prefix == "O") charset = "01234567_";
      while (this.peek(0) != "" && charset.includes(this.peek(0), 0)) this.advance();
    } else {
      while (this.digit(this.peek(0)) || this.peek(0) == "_") this.advance();
      if (this.peek(0) == "." && this.digit(this.peek(1))) {
        this.advance();
        while (this.digit(this.peek(0)) || this.peek(0) == "_") this.advance();
      }
    }
    this.emit("number", this.source.slice(start, this.byteOffset), offset, line, column);
  }
  scanString(offset: number, line: number, column: number): void {
    const quote: string = this.advance();
    let value: string = "";
    while (!this.atEnd() && this.peek(0) != quote && this.peek(0) != "\n") {
      if (this.peek(0) == "\\") {
        this.advance();
        const escaped: string = this.advance();
        if (escaped == "n") value = value + "\n";
        else if (escaped == "t") value = value + "\t";
        else if (escaped == "r") value = value + "\r";
        else value = value + escaped;
      } else value = value + this.advance();
    }
    if (this.peek(0) != quote) { this.error("Cadena sin cerrar", offset, line, column); return; }
    this.advance(); this.emit("string", value, offset, line, column);
  }
  templateFailure(message: string, offset: number, line: number, column: number): void {
    while (!this.atEnd()) this.advance();
    this.error(message, offset, line, column);
  }
  templateString(): boolean {
    const quote: string = this.advance();
    while (!this.atEnd() && this.peek(0) != quote && this.peek(0) != "\n") {
      if (this.peek(0) == "\\") {
        this.advance(); if (this.peek(0) == "\n") return false;
      }
      if (!this.atEnd()) this.advance();
    }
    if (this.peek(0) != quote) return false;
    this.advance(); return true;
  }
  scanTemplate(offset: number, line: number, column: number): void {
    this.advance(); const begin: number = this.byteOffset;
    // 0 = template text; positive values = interpolation brace depth.
    // An explicit stack avoids recursion and shields strings and comments.
    let frames: number[] = [0];
    while (!this.atEnd()) {
      const top: number = frames.length - 1; const depth: number = frames[top];
      const c: string = this.peek(0); const next: string = this.peek(1);
      if (depth == 0) {
        if (c == "\\") { this.advance(); if (!this.atEnd()) this.advance(); }
        else if (c == "`") {
          const end: number = this.byteOffset; this.advance(); frames.pop();
          if (frames.length == 0) { this.emit("template", this.source.slice(begin, end), offset, line, column); return; }
        } else if (c == "$" && next == "{") {
          if (frames.length >= 128) { this.templateFailure("Límite de anidamiento de templates (128)", offset, line, column); return; }
          frames.push(1); this.advance(); this.advance();
        } else this.advance();
      } else if (c == "\"" || c == "'") {
        if (!this.templateString()) { this.templateFailure("Cadena sin cerrar en interpolación", offset, line, column); return; }
      } else if (c == "/" && next == "/") {
        while (!this.atEnd() && this.peek(0) != "\n") this.advance();
      } else if (c == "/" && next == "*") {
        this.advance(); this.advance();
        while (!this.atEnd() && !(this.peek(0) == "*" && this.peek(1) == "/")) this.advance();
        if (this.atEnd()) { this.templateFailure("Comentario sin cerrar en interpolación", offset, line, column); return; }
        this.advance(); this.advance();
      } else if (c == "`") {
        if (frames.length >= 128) { this.templateFailure("Límite de anidamiento de templates (128)", offset, line, column); return; }
        frames.push(0); this.advance();
      } else {
        if (c == "{") frames[top] = depth + 1;
        if (c == "}") { frames[top] = depth - 1; if (frames[top] == 0) frames.pop(); }
        this.advance();
      }
    }
    this.error(frames[frames.length - 1] > 0 ? "Interpolación sin cerrar" : "Template sin cerrar", offset, line, column);
  }
  symbol(offset: number, line: number, column: number): void {
    const three: string = this.peek(0) + this.peek(1) + this.peek(2);
    if (three == "..." || three == "**=" || three == "<<=" || three == ">>=") {
      this.advance(); this.advance(); this.advance(); this.emit(three, three, offset, line, column); return;
    }
    const two: string = this.peek(0) + this.peek(1);
    const doubles: string[] = ["==", "!=", "<=", ">=", "&&", "||", "=>", "??", "?.", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];
    if (doubles.includes(two)) {
      this.advance(); this.advance(); this.emit(two, two, offset, line, column); return;
    }
    const one: string = this.advance();
    if ("(){}[],;:.-+*/%=<>!?|&^~@".includes(one, 0)) {
      this.emit(one, one, offset, line, column);
      if (one == "(" || one == "[") this.depth = this.depth + 1;
      else if ((one == ")" || one == "]") && this.depth > 0) this.depth = this.depth - 1;
    } else this.error("Carácter inesperado '" + one + "'", offset, line, column);
  }
  tokenize(): LexerResult {
    while (!this.atEnd()) {
      this.trivia();
      if (!this.atEnd()) {
        const offset: number = this.offset; const line: number = this.line; const column: number = this.column;
        const c: string = this.peek(0);
        if (this.identifierStart(c)) this.identifier(offset, line, column);
        else if (this.digit(c)) this.scanNumber(offset, line, column);
        else if (c == "\"" || c == "'") this.scanString(offset, line, column);
        else if (c == "`") this.scanTemplate(offset, line, column);
        else this.symbol(offset, line, column);
      }
    }
    this.emit("eof", "", this.offset, this.line, this.column);
    return new LexerResult(this.tokens, this.diagnostics);
  }
}

export function tokenize(source: string): LexerResult {
  let lexer: Lexer = new Lexer(source);
  return lexer.tokenize();
}

function jsonQuote(text: string): string {
  let result: string = "\"";
  const hex: string = "0123456789abcdef";
  for (let i: number = 0; i < text.length; i = i + 1) {
    const c: string = text.charAt(i);
    const code: number = text.charCodeAt(i);
    if (c == "\"") result = result + "\\\"";
    else if (c == "\\") result = result + "\\\\";
    else if (code < 32) result = result + "\\u00" + hex.charAt(Math.floor(code / 16)) + hex.charAt(code % 16);
    else result = result + c;
  }
  return result + "\"";
}
function jsonPosition(offset: number, line: number, column: number): string {
  return "{\"offset\":" + numberToString(offset) + ",\"line\":" + numberToString(line) + ",\"column\":" + numberToString(column) + "}";
}

// Test-facing function: JSON makes tokens and diagnostics inspectable without
// depending on a parser/checker or foreign C++ snippets in the bootstrap.
export function inspectTokens(source: string): string {
  const result: LexerResult = tokenize(source);
  let output: string = "{\"tokens\":[";
  let separator: string = "";
  for (const token of result.tokens) {
    output = output + separator + "{\"kind\":" + jsonQuote(token.kind) + ",\"lexeme\":" + jsonQuote(token.lexeme)
      + ",\"span\":{\"start\":" + jsonPosition(token.offset, token.line, token.column)
      + ",\"end\":" + jsonPosition(token.endOffset, token.endLine, token.endColumn) + "}}";
    separator = ",";
  }
  output = output + "],\"diagnostics\":["; separator = "";
  for (const diagnostic of result.diagnostics) {
    output = output + separator + "{\"phase\":\"lexer\",\"message\":" + jsonQuote(diagnostic.message)
      + ",\"span\":{\"start\":" + jsonPosition(diagnostic.offset, diagnostic.line, diagnostic.column)
      + ",\"end\":" + jsonPosition(diagnostic.endOffset, diagnostic.endLine, diagnostic.endColumn) + "}}";
    separator = ",";
  }
  return output + "]}";
}
