// Lexical adapter for the isolated parser. No AST construction or TS Parser use.
import { Lexer } from "../../src/lexer/lexer.ts";
import { scanTemplate, templatePositions } from "../../src/lexer/template.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import type { Token } from "../../src/lexer/token.ts";
import type { Position } from "../../src/core/span.ts";

export type ParserInputToken = { kind: string; lexeme: string; span: Token["span"] };

export function prepareParserTokens(tokens: readonly ParserInputToken[], nesting = 0): ParserInputToken[] {
  return tokens.flatMap(token => {
    if (token.kind !== "template") return [token];
    if (nesting >= 128) return [{ ...token, kind: "template-error", lexeme: "Límite de anidamiento de templates (128)" }];
    const text = "`" + token.lexeme + "`", scan = scanTemplate(text);
    if (scan.error || scan.end !== text.length) return [{ ...token, kind: "template-error", lexeme: scan.error ?? "Token template crudo inválido" }];
    const positions = templatePositions(text, token.span.start);
    const make = (kind: string, lexeme: string, start: number, end: number): ParserInputToken =>
      ({ kind, lexeme, span: { start: positions[start], end: positions[end] } });
    const output: ParserInputToken[] = [make("template-start", "`", 0, 1)];
    for (let index = 0; index < scan.parts.length; index++) {
      const part = scan.parts[index]; output.push(make("template-text", text.slice(part.start, part.end), part.start, part.end));
      const expression = scan.expressions[index]; if (!expression) continue;
      output.push(make("interpolation-start", "${", expression.start - 2, expression.start));
      const base = positions[expression.start];
      const rebase = (p: Position): Position => ({ offset: base.offset + p.offset, line: base.line + p.line - 1, column: p.line === 1 ? base.column + p.column - 1 : p.column });
      let inner: Token[];
      try { inner = new Lexer(text.slice(expression.start, expression.end)).tokenize(); }
      catch (error) {
        if (!(error instanceof DiagnosticError)) throw error;
        throw new DiagnosticError(error.diagnostics.map(d => ({ ...d, span: { ...d.span, start: rebase(d.span.start), end: rebase(d.span.end) } })));
      }
      const relocated = inner.filter(item => item.kind !== "eof").map(item =>
        ({ ...item, span: { ...item.span, start: rebase(item.span.start), end: rebase(item.span.end) } }));
      for (const item of prepareParserTokens(relocated, nesting + 1)) output.push(item);
      output.push(make("interpolation-end", "}", expression.end, expression.end + 1));
    }
    output.push(make("template-end", "`", text.length - 1, text.length));
    return output;
  });
}
