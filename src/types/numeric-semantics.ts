import type { Expression } from "../ast/nodes.ts";

export type NumericType = "number" | "f32" | "f64" | "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "i64" | "u64";
const numeric = new Set<string>(["number", "f32", "f64", "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64"]);
export function isNumericName(type: string | undefined): type is NumericType { return !!type && numeric.has(type); }
export function numericTypeOf(node: Expression): NumericType | undefined {
  return node.resolvedType?.kind === "primitive" && isNumericName(node.resolvedType.name) ? node.resolvedType.name : undefined;
}
export function isFloat(type: NumericType): boolean { return type === "number" || type === "f32" || type === "f64"; }
export function promoteUnary(type: NumericType): NumericType {
  return ["i8", "u8", "i16", "u16"].includes(type) ? "i32" : type;
}
/** C++20 usual arithmetic conversions, with a 32-bit int and 64-bit i64/u64.
 * number remains the dialect's double; its bitwise path retains legacy rules.
 */
export function promoteBinary(left: string | undefined, right: string | undefined, op: string): NumericType | undefined {
  if (!isNumericName(left) || !isNumericName(right)) return undefined;
  if (["&", "|", "^", "<<", ">>"].includes(op) && (isFloat(left) || isFloat(right))) return undefined;
  if (op === "<<" || op === ">>") return promoteUnary(left);
  if (left === "number" || right === "number") return "number";
  if (left === "f64" || right === "f64") return "f64";
  if (left === "f32" || right === "f32") return "f32";
  const a = promoteUnary(left), b = promoteUnary(right);
  if (a === b) return a;
  if (a === "u64" || b === "u64") return "u64";
  if (a === "i64" || b === "i64") return "i64";
  return "u32";
}
export function binaryNumericType(node: Expression, op: string): NumericType | undefined {
  if (node.kind === "BinaryExpression") return promoteBinary(numericTypeOf(node.left), numericTypeOf(node.right), op);
  if (node.kind === "CompoundAssignmentExpression") return promoteBinary(numericTypeOf(node.target), numericTypeOf(node.value), op);
  return undefined;
}
