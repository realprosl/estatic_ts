// Lexical adapter for the isolated parser. No AST construction or TS Parser use.
import { Lexer } from "../../src/lexer/lexer.ts";
import type { Token } from "../../src/lexer/token.ts";
import type { Position } from "../../src/core/span.ts";

export type ParserInputToken = { kind: string; lexeme: string; span: Token["span"] };

// Strings/comments/templates shield braces inside interpolation source.
function quotedEnd(text: string, start: number, nesting: number): number {
  if (nesting >= 128) return text.length;
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === quote) return i + 1;
    if (quote === "`" && text[i] === "$" && text[i + 1] === "{") {
      const end = interpolationEnd(text, i + 2, nesting + 1);
      if (end < 0) return text.length;
      i = end;
    }
  }
  return text.length;
}
function interpolationEnd(text: string, start: number, nesting = 0): number {
  if (nesting >= 128) return -1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === "'" || c === '"' || c === "`") { i = quotedEnd(text, i, nesting + 1) - 1; continue; }
    if (c === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2); if (end < 0) return -1;
      i = end + 1; continue;
    }
    if (c === "{") depth++;
    if (c === "}") { if (depth === 0) return i; depth--; }
  }
  return -1;
}

export function prepareParserTokens(tokens: readonly ParserInputToken[], nesting = 0): ParserInputToken[] {
  return tokens.flatMap(token => {
    if (token.kind !== "template") return [token];
    if (nesting >= 128) return [{ ...token, kind: "template-error", lexeme: "Límite de anidamiento de templates (128)" }];
    const text = token.lexeme;
    // The raw lexeme excludes the two backticks. All offsets/columns are UTF-16.
    const positions: Position[] = [];
    let position = { ...token.span.start, offset: token.span.start.offset + 1, column: token.span.start.column + 1 };
    positions.push(position);
    for (const c of text.split("")) {
      position = { offset: position.offset + 1, line: position.line + (c === "\n" ? 1 : 0), column: c === "\n" ? 1 : position.column + 1 };
      positions.push(position);
    }
    const make = (kind: string, lexeme: string, start: number, end: number): ParserInputToken =>
      ({ kind, lexeme, span: { start: positions[start], end: positions[end] } });
    const output: ParserInputToken[] = [{ kind: "template-start", lexeme: "`", span: { start: token.span.start, end: positions[0] } }];
    let part = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\\") { i++; continue; }
      if (text[i] !== "$" || text[i + 1] !== "{") continue;
      output.push(make("template-text", text.slice(part, i), part, i));
      output.push(make("interpolation-start", "${", i, i + 2));
      const end = interpolationEnd(text, i + 2);
      if (end < 0) {
        output.push(make("template-error", "Interpolación sin cerrar", i, text.length));
        return output;
      }
      const base = positions[i + 2];
      const rebase = (p: Position): Position => ({ offset: base.offset + p.offset, line: base.line + p.line - 1, column: p.line === 1 ? base.column + p.column - 1 : p.column });
      const inner = new Lexer(text.slice(i + 2, end)).tokenize().filter(item => item.kind !== "eof").map(item =>
        ({ ...item, span: { start: rebase(item.span.start), end: rebase(item.span.end) } }));
      for (const item of prepareParserTokens(inner, nesting + 1)) output.push(item);
      output.push(make("interpolation-end", "}", end, end + 1));
      i = end; part = end + 1;
    }
    output.push(make("template-text", text.slice(part), part, text.length));
    output.push({ kind: "template-end", lexeme: "`", span: { start: positions[text.length], end: token.span.end } });
    return output;
  });
}
