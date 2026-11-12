// Numeric token validation for the native checker. The lexer intentionally
// preserves raw tokens; it does not certify separators, digits or finiteness.
// Exact integers use decimal strings, independently of the approximate value.
export class NativeNumericLiteral {
  value: number; valid: boolean;
  constructor(value: number, valid: boolean) { this.value = value; this.valid = valid; }
}
function numericDigit(c: string): number {
  if (c == "") return -1;
  const index: number = "0123456789abcdefABCDEF".indexOf(c,0);
  return index >= 16 ? index - 6 : index;
}
function decimalAppend(text: string, radix: number, digit: number): string {
  let result: string = ""; let carry: number = digit;
  for (let at: number = text.length - 1; at >= 0; at = at - 1) {
    const value: number = (text.charCodeAt(at) - 48) * radix + carry;
    result = "0123456789".charAt(value % 10) + result; carry = Math.floor(value / 10);
  }
  while (carry > 0) { result = "0123456789".charAt(carry % 10) + result; carry = Math.floor(carry / 10); }
  let at: number = 0; while (at + 1 < result.length && result.charAt(at) == "0") at = at + 1;
  return result.slice(at,result.length);
}
export function nativeIntegerText(raw: string): string {
  // Check separators and source grammar first; never recover an integer from
  // a double that may already have rounded away its low bits.
  if (!nativeNumericLiteral(raw).valid) return "";
  let radix: number = 10; let at: number = 0;
  const prefix: string = raw.charAt(1);
  if (raw.charAt(0) == "0") {
    if (prefix == "x" || prefix == "X") { radix = 16; at = 2; }
    else if (prefix == "b" || prefix == "B") { radix = 2; at = 2; }
    else if (prefix == "o" || prefix == "O") { radix = 8; at = 2; }
  }
  let value: string = "0"; let fraction: boolean = false;
  for (; at < raw.length; at = at + 1) {
    const c: string = raw.charAt(at); if (c == "_") continue;
    if (c == ".") fraction = true;
    else if (fraction) { if (c != "0") return ""; }
    else value = decimalAppend(value,radix,numericDigit(c));
  } return value;
}
export function nativeInteger64(raw: string, negative: boolean, expected: string): string {
  const magnitude: string = nativeIntegerText(raw); if (magnitude == "") return "";
  const limit: string = expected == "u64" ? "18446744073709551615" : negative ? "9223372036854775808" : "9223372036854775807";
  if (negative && expected == "u64" && magnitude != "0") return "";
  if (magnitude.length > limit.length || (magnitude.length == limit.length && magnitude.localeCompare(limit) > 0)) return "";
  return negative && magnitude != "0" ? "-" + magnitude : magnitude;
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
