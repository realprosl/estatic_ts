// A per-source bridge. No filesystem access, module resolution or shared state.
import { tokenizeExpanded, LexerToken, LexerDiagnostic, LexerResult } from "../lexer/lexer";
import { ParserToken, ParseResult, parseTokens, formatAst } from "../parser/parser";

export class SourceDiagnostic {
  phase: string; message: string; file: string; token: ParserToken;
  constructor(phase: string, message: string, file: string, token: ParserToken) {
    this.phase = phase; this.message = message; this.file = file; this.token = token;
  }
}
export class SourceResult {
  file: string; tokens: ParserToken[]; ast: ParseResult;
  diagnostics: SourceDiagnostic[]; parsed: boolean; success: boolean;
  constructor(file: string, tokens: ParserToken[], ast: ParseResult, diagnostics: SourceDiagnostic[], parsed: boolean) {
    this.file = file; this.tokens = tokens; this.ast = ast; this.diagnostics = diagnostics;
    this.parsed = parsed; this.success = diagnostics.length == 0;
  }
}
function parserToken(token: LexerToken): ParserToken {
  return new ParserToken(token.kind, token.lexeme, token.offset, token.line, token.column,
    token.endOffset, token.endLine, token.endColumn);
}
function errorToken(diagnostic: LexerDiagnostic): ParserToken {
  return new ParserToken("error", "", diagnostic.offset, diagnostic.line, diagnostic.column,
    diagnostic.endOffset, diagnostic.endLine, diagnostic.endColumn);
}
export function parseSource(source: string, file: string = "<input>"): SourceResult {
  const lexical: LexerResult = tokenizeExpanded(source);
  let tokens: ParserToken[] = [];
  for (const token of lexical.tokens) tokens.push(parserToken(token));
  let diagnostics: SourceDiagnostic[] = [];
  for (const diagnostic of lexical.diagnostics) diagnostics.push(new SourceDiagnostic("lexer", diagnostic.message, file, errorToken(diagnostic)));
  const parsed: boolean = diagnostics.length == 0;
  let ast: ParseResult = new ParseResult(-1, [], []);
  if (parsed) {
    ast = parseTokens(tokens);
    for (const diagnostic of ast.diagnostics) diagnostics.push(new SourceDiagnostic("parser", diagnostic.message, file, diagnostic.token));
  }
  return new SourceResult(file, tokens, ast, diagnostics, parsed);
}

// Observable demo output; callers can use parseSource without JSON serialization.
export function quoteSource(text: string): string {
  let result: string = "\""; const hex: string = "0123456789abcdef";
  for (let i: number = 0; i < text.length; i = i + 1) {
    const c: string = text.charAt(i); const code: number = text.charCodeAt(i);
    if (c == "\"") result = result + "\\\"";
    else if (c == "\\") result = result + "\\\\";
    else if (code < 32) result = result + "\\u00" + hex.charAt(Math.floor(code / 16)) + hex.charAt(code % 16);
    else result = result + c;
  }
  return result + "\"";
}
function positionSource(offset: number, line: number, column: number): string {
  return "{\"offset\":" + numberToString(offset) + ",\"line\":" + numberToString(line) + ",\"column\":" + numberToString(column) + "}";
}
function spanSource(token: ParserToken): string {
  return "{\"start\":" + positionSource(token.offset, token.line, token.column)
    + ",\"end\":" + positionSource(token.endOffset, token.endLine, token.endColumn) + "}";
}
export function formatSource(result: SourceResult): string {
  let output: string[] = ["{\"file\":" + quoteSource(result.file) + ",\"parsed\":" + (result.parsed ? "true" : "false")
    + ",\"success\":" + (result.success ? "true" : "false") + ",\"tokens\":["];
  let separator: string = "";
  for (const token of result.tokens) {
    output.push(separator + "{\"kind\":" + quoteSource(token.kind) + ",\"lexeme\":" + quoteSource(token.lexeme) + ",\"span\":" + spanSource(token) + "}");
    separator = ",";
  }
  output.push("],\"ast\":" + formatAst(result.ast) + ",\"diagnostics\":["); separator = "";
  for (const diagnostic of result.diagnostics) {
    output.push(separator + "{\"file\":" + quoteSource(diagnostic.file) + ",\"phase\":" + quoteSource(diagnostic.phase)
      + ",\"message\":" + quoteSource(diagnostic.message) + ",\"span\":" + spanSource(diagnostic.token) + "}");
    separator = ",";
  }
  output.push("]}"); return output.join("");
}
export function inspectSource(source: string, file: string = "<input>"): string {
  const result: SourceResult = parseSource(source, file);
  return formatSource(result);
}
