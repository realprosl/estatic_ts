// Host-only transport. The public ETS parser API still receives Token[].
import { Buffer } from "node:buffer";
import type { Token } from "../../src/lexer/token.ts";

export function transportTokens(tokens: readonly Token[]): string[] {
  return ["--tokens", ...tokens.map(token => [token.kind, token.lexeme,
    String(token.span.start.offset), String(token.span.start.line), String(token.span.start.column),
    String(token.span.end.offset), String(token.span.end.line), String(token.span.end.column),
  ].map(field => `${Buffer.byteLength(field, "utf8")}:${field}`).join(""))];
}
