// Numeric token validation for the native checker. The lexer intentionally
// preserves raw tokens; it does not certify separators, digits or finiteness.
// Exact i64/u64 values need a separate representation and remain unsupported.
export class NativeNumericLiteral {
  value: number; valid: boolean;
  constructor(value: number, valid: boolean) { this.value = value; this.valid = valid; }
}
function numericDigit(c: string): number {
  if (c == "") return -1;
  const index: number = "0123456789abcdefABCDEF".indexOf(c,0);
  return index >= 16 ? index - 6 : index;
}
export function nativeNumericLiteral(raw: string): NativeNumericLiteral {
  let radix: number = 10; let start: number = 0;
  if (raw.charAt(0) == "0") {
    const prefix: string = raw.charAt(1);
    if (prefix == "x" || prefix == "X") { radix = 16; start = 2; }
    if (prefix == "b" || prefix == "B") { radix = 2; start = 2; }
    if (prefix == "o" || prefix == "O") { radix = 8; start = 2; }
  }
  let value: number = 0; let fraction: number = 1; let point: boolean = false; let count: number = 0;
  for (let at: number = start; at < raw.length; at = at + 1) {
    const c: string = raw.charAt(at);
    if (c == "_") {
      const before: number = numericDigit(raw.charAt(at - 1)); const after: number = numericDigit(raw.charAt(at + 1));
      if (at == start || before < 0 || before >= radix || after < 0 || after >= radix) return new NativeNumericLiteral(0,false);
    } else if (c == "." && radix == 10 && !point) {
      if (at == start || numericDigit(raw.charAt(at - 1)) < 0 || numericDigit(raw.charAt(at + 1)) < 0) return new NativeNumericLiteral(0,false);
      point = true;
    } else {
      const digit: number = numericDigit(c);
      if (digit < 0 || digit >= radix) return new NativeNumericLiteral(0,false);
      if (point) { fraction = fraction / 10; value = value + digit * fraction; }
      else value = value * radix + digit;
      count = count + 1;
    }
  }
  // Infinity - Infinity is NaN. This needs no runtime-specific parsing helper
  // or exception path and also rejects an overflowed unannotated number.
  return new NativeNumericLiteral(value,count > 0 && value - value == 0);
}
export function nativeUnaryPromotion(text: string): string {
  return ["i8","u8","i16","u16"].includes(text) ? "i32" : text;
}
export function nativeBinaryPromotion(left: string, right: string, op: string): string {
  // The dialect's number bitwise path is legacy and remains number, also
  // when it occurs on the right of a shift (stage-0 promoteBinary fallback).
  if (left == "number" || right == "number") return "number";
  if (op == "<<" || op == ">>") return nativeUnaryPromotion(left);
  if (left == "f64" || right == "f64") return "f64";
  if (left == "f32" || right == "f32") return "f32";
  const a: string = nativeUnaryPromotion(left); const b: string = nativeUnaryPromotion(right);
  if (a == b) return a;
  if (a == "u64" || b == "u64") return "u64";
  if (a == "i64" || b == "i64") return "i64";
  return "u32";
}
