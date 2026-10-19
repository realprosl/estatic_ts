import type { ResolvedType } from "../types/type-system.ts";
import type { Expression } from "../ast/nodes.ts";
import { DiagnosticError } from "../core/diagnostic.ts";

const widths = { i8: 8, u8: 8, i16: 16, u16: 16, i32: 32, u32: 32, i64: 64, u64: 64 } as const;
export type IntegerCastType = keyof typeof widths;

export function isIntegerCast(type: string): type is IntegerCastType {
  return Object.hasOwn(widths, type);
}

/** Integral casts follow C++20 modulo conversion. Float conversions instead
 * require the truncated value to fit, since C++ does not define wrapping there.
 */
export function evalIntegerCast(value: unknown, type: IntegerCastType, node: Expression, sourceType?: ResolvedType): number | bigint {
  const bits = widths[type];
  const signed = type.startsWith("i");
  const fail = (code: string, message: string): never => {
    throw new DiagnosticError([{
      phase: "semantic", code, message: `comptime: ${message}`,
      span: { start: { ...node.span.start }, end: { ...node.span.end } },
      hint: "usa un valor numérico representable por el tipo de destino",
    }]);
  };
  let integer: bigint;
  const source = sourceType ?? (node.kind === "CallExpression" ? node.args[0]?.resolvedType : undefined);
  const fromFloat = source?.kind === "primitive" && ["number", "f32", "f64"].includes(source.name);
  if (typeof value === "bigint") integer = value;
  else if (typeof value === "number" && Number.isFinite(value)) {
    if (!fromFloat && !Number.isSafeInteger(Math.trunc(value))) {
      fail("COMPTIME_INTEGER_PRECISION", "la conversión entera perdería precisión");
    }
    integer = BigInt(Math.trunc(value));
  } else return fail("COMPTIME_INTEGER_CAST", "la conversión entera necesita un número finito");
  if (fromFloat) {
    const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
    const max = (1n << BigInt(signed ? bits - 1 : bits)) - 1n;
    if (integer < min || integer > max) {
      fail("COMPTIME_INTEGER_CAST_RANGE", `conversión flotante fuera del rango de ${type}`);
    }
  }
  const converted = signed ? BigInt.asIntN(bits, integer) : BigInt.asUintN(bits, integer);
  return bits === 64 ? converted : Number(converted);
}
