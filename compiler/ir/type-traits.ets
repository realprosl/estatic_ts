import { nativeNumericLiteral } from "../checker/numeric";
// Language widths, not target size/alignment or ABI layout.
export function irNumericWidth(text: string): number {
  if (text == "i8" || text == "u8") return 8;
  if (text == "i16" || text == "u16") return 16;
  if (text == "i32" || text == "u32" || text == "f32") return 32;
  if (text == "i64" || text == "u64" || text == "f64" || text == "number") return 64;
  return 0;
}
export function irNumericKind(text: string): string {
  if (["i8","u8","i16","u16","i32","u32","i64","u64"].includes(text)) return "integer";
  if (["number","f32","f64"].includes(text)) return "float";
  return "none";
}
export function irNumericSigned(text: string): boolean { return ["i8","i16","i32","i64","number","f32","f64"].includes(text); }

// Materialized floating values can use exponent spelling even though source tokens do not.
export function irNumericConstant(raw: string, floating: boolean): boolean {
  if (nativeNumericLiteral(raw).valid) return true;
  if (!floating || raw.startsWith("0x") || raw.startsWith("0X")) return false;
  let split: number = -1;
  for (let at: number = 0; at < raw.length; at = at+1) if (raw.charAt(at) == "e" || raw.charAt(at) == "E") { if (split >= 0) return false; split = at; }
  if (split <= 0) return false;
  const mantissa = nativeNumericLiteral(raw.slice(0,split)); if (!mantissa.valid) return false;
  let at: number = split+1; let negative: boolean = false;
  if (raw.charAt(at) == "+" || raw.charAt(at) == "-") { negative = raw.charAt(at) == "-"; at = at+1; }
  if (at >= raw.length) return false;
  let exponent: number = 0;
  for (; at < raw.length; at = at+1) { const digit: number = raw.charCodeAt(at)-48; if (digit < 0 || digit > 9) return false; exponent = exponent*10+digit; if (exponent > 324) return false; }
  const value: number = mantissa.value*Math.pow(10,negative ? -exponent : exponent); return value-value == 0;
}
