import type { Expression } from "../ast/nodes.ts";
import { binaryNumericType, numericTypeOf, promoteUnary, isFloat, type NumericType } from "../types/numeric-semantics.ts";
import { DiagnosticError } from "../core/diagnostic.ts";

function fail(node: Expression, code: string, message: string): never {
  throw new DiagnosticError([{
    phase: "semantic", code, message: `comptime: ${message}`,
    span: { start: { ...node.span.start }, end: { ...node.span.end } },
    hint: "comprueba los tipos numéricos, sus promociones y el rango de destino",
  }]);
}

function operand(value: unknown, node: Expression): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(node, "COMPTIME_INTEGER_PRECISION", "el operando i64/u64 no puede representarse exactamente en el evaluador actual");
  }
  return BigInt(value);
}

function result(value: bigint, type: NumericType, node: Expression): number | bigint {
  const bits = type.endsWith("64") ? 64 : 32;
  if (type.startsWith("u")) value = BigInt.asUintN(bits, value);
  else if (value < -(1n << BigInt(bits - 1)) || value > (1n << BigInt(bits - 1)) - 1n) {
    fail(node, "COMPTIME_INTEGER_OVERFLOW", `overflow de ${type} durante la evaluación`);
  }
  return bits === 64 ? value : Number(value);
}

export function floatValue(value: unknown, type: NumericType, node: Expression): number {
  if (typeof value !== "number" && typeof value !== "bigint") fail(node, "COMPTIME_FLOAT_CAST", "la conversión flotante requiere un número");
  let converted: number;
  if (type === "f32" && typeof value === "bigint") {
    // Round directly to binary32. Going through Number first double-rounds
    // 64-bit integers immediately above a float32 midpoint.
    const magnitude = value < 0n ? -value : value;
    const shift = magnitude.toString(2).length - 24;
    if (shift > 0) {
      let significand = magnitude >> BigInt(shift);
      const remainder = magnitude - (significand << BigInt(shift));
      const half = 1n << BigInt(shift - 1);
      if (remainder > half || (remainder === half && (significand & 1n) !== 0n)) significand++;
      converted = (value < 0n ? -1 : 1) * Number(significand) * 2 ** shift;
    } else converted = Math.fround(Number(value));
  } else converted = type === "f32" ? Math.fround(Number(value)) : Number(value);
  if (Number.isFinite(Number(value)) && !Number.isFinite(converted)) fail(node, "COMPTIME_FLOAT_RANGE", `resultado no finito en ${type}`);
  return converted;
}

/** undefined deja la operación al camino existente de number/floats.
 * Se activa con tipos semánticos numéricos; no infiere tipos desde valores.
 */
export function evalInteger64Binary(op: string, left: unknown, right: unknown, node: Expression): number | bigint | boolean | undefined {
  if (!["+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>", "==", "!=", "===", "!==", "<", ">", "<=", ">="].includes(op)) return undefined;
  if (typeof left === "string" || typeof right === "string") return undefined;
  const type = binaryNumericType(node, op);
  if (!type) return undefined;
  if (isFloat(type)) {
    // Preserve the legacy number-only path, including its diagnostics.
    if (type === "number" && typeof left === "number" && typeof right === "number") return undefined;
    const a = floatValue(left, type, node), b = floatValue(right, type, node);
    if (op === "==" || op === "===") return a === b;
    if (op === "!=" || op === "!==") return a !== b;
    if (op === "<") return a < b;
    if (op === ">") return a > b;
    if (op === "<=") return a <= b;
    if (op === ">=") return a >= b;
    if ((op === "/" || op === "%") && b === 0) fail(node, "COMPTIME_FLOAT_DIVISION_ZERO", "division por cero");
    const value = op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : op === "/" ? a / b : op === "%" ? a % b : undefined;
    if (value !== undefined && !Number.isFinite(value)) fail(node, "COMPTIME_FLOAT_RANGE", `resultado no finito en ${type}`);
    return value === undefined ? undefined : floatValue(value, type, node);
  }
  const leftValue = operand(left, node); const rightValue = operand(right, node);
  const bits = type.endsWith("64") ? 64 : 32;
  const a = type.startsWith("u") ? BigInt.asUintN(bits, leftValue) : leftValue;
  // Shift counts are promoted independently, never converted to the LHS type.
  const b = type.startsWith("u") && op !== "<<" && op !== ">>" ? BigInt.asUintN(bits, rightValue) : rightValue;
  if (op === "==" || op === "===") return a === b;
  if (op === "!=" || op === "!==") return a !== b;
  if (op === "<") return a < b;
  if (op === ">") return a > b;
  if (op === "<=") return a <= b;
  if (op === ">=") return a >= b;
  if ((op === "/" || op === "%") && b === 0n) fail(node, "COMPTIME_INTEGER_DIVISION_ZERO", "division por cero en una operación entera");
  if ((op === "<<" || op === ">>") && (b < 0n || b >= BigInt(bits))) fail(node, "COMPTIME_INTEGER_SHIFT", `el desplazamiento ${type} debe estar entre 0 y ${bits - 1}`);
  if ((op === "/" || op === "%") && !type.startsWith("u") && a === -(1n << BigInt(bits - 1)) && b === -1n) {
    fail(node, "COMPTIME_INTEGER_OVERFLOW", `overflow de ${type} durante la división`);
  }
  let value: bigint;
  switch (op) {
    case "+": value = a + b; break;
    case "-": value = a - b; break;
    case "*": value = a * b; break;
    case "/": value = a / b; break;
    case "%": value = a % b; break;
    case "&": value = a & b; break;
    case "|": value = a | b; break;
    case "^": value = a ^ b; break;
    case "<<": value = type.startsWith("u") ? BigInt.asUintN(bits, a << b) : BigInt.asIntN(bits, a << b); break;
    case ">>": value = a >> b; break;
    default: return undefined;
  }
  return result(value, type, node);
}

export function evalInteger64Unary(op: string, value: unknown, node: Expression): number | bigint | undefined {
  if (!["+", "-", "~"].includes(op)) return undefined;
  const operandType = node.kind === "UnaryExpression" ? numericTypeOf(node.operand) : undefined;
  if (!operandType) return undefined;
  const type = promoteUnary(operandType);
  if (isFloat(type)) {
    if (op === "~" || type === "number") return undefined;
    const a = floatValue(value, type, node);
    return floatValue(op === "-" ? -a : a, type, node);
  }
  const a = operand(value, node);
  return result(op === "~" ? ~a : op === "-" ? -a : a, type, node);
}
