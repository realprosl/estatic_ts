import type { LiteralExpression } from "../ast/nodes.ts";

export type Integer64Type = "i64" | "u64";
export const I64_MIN = -(1n << 63n);
export const I64_MAX = (1n << 63n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;

/** Read the token, never the rounded JS approximation, for integer literals. */
export function exactIntegerLiteral(node: LiteralExpression): bigint | undefined {
  if (node.exactInteger !== undefined) return BigInt(node.exactInteger);
  const raw = node.raw?.replace(/_/g, "");
  if (raw && /^(?:[0-9]+|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)$/.test(raw)) return BigInt(raw);
  if (typeof node.value === "number" && Number.isSafeInteger(node.value)) return BigInt(node.value);
  return undefined;
}
