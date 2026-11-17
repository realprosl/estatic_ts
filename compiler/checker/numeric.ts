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
  // Un literal con exponente (1e3) se trata como double, no como entero exacto.
  if (radix == 10 && (raw.indexOf("e",0) >= 0 || raw.indexOf("E",0) >= 0)) return "";
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
// Enteros grandes sin signo en límbs de 24 bits (little-endian): todas las
// operaciones son exactas en double. Sirven para convertir literales con
// redondeo correcto (al par más cercano), como hace JavaScript.
const LIMB: number = 16777216;
function bigMulAdd(value: number[], factor: number, addend: number): void {
  let carry: number = addend;
  for (let at: number = 0; at < value.length; at = at + 1) {
    const product: number = value[at] * factor + carry;
    carry = Math.floor(product / LIMB); value[at] = product - carry * LIMB;
  }
  while (carry > 0) { const next: number = Math.floor(carry / LIMB); value.push(carry - next * LIMB); carry = next; }
}
function bigShift(value: number[], bits: number): void {
  let left: number = bits; let limbs: number = 0;
  while (left >= 24) { limbs = limbs + 1; left = left - 24; }
  if (limbs > 0) {
    const size: number = value.length;
    for (let k: number = 0; k < limbs; k = k + 1) value.push(0);
    for (let at: number = size - 1; at >= 0; at = at - 1) { value[at + limbs] = value[at]; value[at] = 0; }
  }
  if (left > 0) bigMulAdd(value, Math.pow(2, left), 0);
}
function bigTrim(value: number[]): void { while (value.length > 0 && value[value.length - 1] == 0) value.pop(); }
function bigBits(value: number[]): number {
  bigTrim(value); if (value.length == 0) return 0;
  let top: number = value[value.length - 1]; let bits: number = (value.length - 1) * 24;
  while (top >= 1) { top = Math.floor(top / 2); bits = bits + 1; }
  return bits;
}
function bigCompare(a: number[], b: number[]): number {
  bigTrim(a); bigTrim(b);
  if (a.length != b.length) { if (a.length < b.length) return -1; return 1; }
  for (let at: number = a.length - 1; at >= 0; at = at - 1) if (a[at] != b[at]) { if (a[at] < b[at]) return -1; return 1; }
  return 0;
}
function bigSubtract(a: number[], b: number[]): void {
  let borrow: number = 0;
  for (let at: number = 0; at < a.length; at = at + 1) {
    let next: number = a[at] - borrow; if (at < b.length) next = next - b[at];
    if (next < 0) { next = next + LIMB; borrow = 1; } else borrow = 0;
    a[at] = next;
  }
  bigTrim(a);
}
function bigCopy(value: number[]): number[] { let result: number[] = []; for (const limb of value) result.push(limb); return result; }
// Double más cercano a numerator / denominator (ambos > 0); empate al par.
function bigQuotient(numerator: number[], denominator: number[]): number {
  let a: number[] = bigCopy(numerator); let b: number[] = bigCopy(denominator);
  // a·2^shift / b queda en [2^54, 2^56): 55-56 bits de cociente.
  const shift: number = 55 + bigBits(b) - bigBits(a);
  if (shift > 0) bigShift(a, shift); else if (shift < 0) bigShift(b, -shift);
  let multiples: number[][] = []; let current: number[] = bigCopy(b);
  for (let bit: number = 0; bit <= 56; bit = bit + 1) { multiples.push(bigCopy(current)); bigMulAdd(current, 2, 0); }
  // Bits del cociente (un double no guarda enteros de más de 53 bits).
  let quotient: boolean[] = []; let bits: number = 0;
  for (let bit: number = 0; bit <= 56; bit = bit + 1) quotient.push(false);
  for (let bit: number = 56; bit >= 0; bit = bit - 1) {
    if (bigCompare(a, multiples[bit]) >= 0) { bigSubtract(a, multiples[bit]); quotient[bit] = true; if (bits == 0) bits = bit + 1; }
  }
  let sticky: boolean = bigBits(a) > 0;
  let drop: number = bits - 53;
  // Subnormales: el bit menos significativo no baja de 2^-1074.
  if (drop - shift < -1074) drop = -1074 + shift;
  let mantissa: number = 0;
  for (let bit: number = 56; bit >= 0; bit = bit - 1) {
    if (bit >= drop) { mantissa = mantissa * 2; if (quotient[bit]) mantissa = mantissa + 1; }
    else if (bit < drop - 1 && quotient[bit]) sticky = true;
  }
  const halfBit: boolean = drop >= 1 && drop - 1 <= 56 && quotient[drop - 1];
  if (halfBit && (sticky || mantissa % 2 == 1)) mantissa = mantissa + 1;
  return mantissa * Math.pow(2, drop - shift);
}
export function nativeNumericLiteral(raw: string): NativeNumericLiteral {
  let radix: number = 10; let start: number = 0;
  if (raw.charAt(0) == "0") {
    const prefix: string = raw.charAt(1);
    if (prefix == "x" || prefix == "X") { radix = 16; start = 2; }
    if (prefix == "b" || prefix == "B") { radix = 2; start = 2; }
    if (prefix == "o" || prefix == "O") { radix = 8; start = 2; }
  }
  let digits: number[] = []; let point: boolean = false; let count: number = 0; let decimals: number = 0; let exponent: number = 0;
  let at: number = start;
  while (at < raw.length) {
    const c: string = raw.charAt(at);
    if (c == "_") {
      const before: number = numericDigit(raw.charAt(at - 1)); const after: number = numericDigit(raw.charAt(at + 1));
      if (at == start || before < 0 || before >= radix || after < 0 || after >= radix) return new NativeNumericLiteral(0,false);
    } else if (c == "." && radix == 10 && !point) {
      if (at == start || numericDigit(raw.charAt(at - 1)) < 0 || numericDigit(raw.charAt(at + 1)) < 0) return new NativeNumericLiteral(0,false);
      point = true;
    } else if ((c == "e" || c == "E") && radix == 10 && count > 0) {
      // Exponente decimal: 1e21, 2.5e-3.
      let next: number = at + 1; let negative: boolean = false;
      if (raw.charAt(next) == "+" || raw.charAt(next) == "-") { negative = raw.charAt(next) == "-"; next = next + 1; }
      let expDigits: number = 0;
      while (next < raw.length) {
        const d: number = numericDigit(raw.charAt(next));
        if (raw.charAt(next) != "_") { if (d < 0 || d > 9) return new NativeNumericLiteral(0,false); if (exponent < 100000) exponent = exponent * 10 + d; expDigits = expDigits + 1; }
        next = next + 1;
      }
      if (expDigits == 0) return new NativeNumericLiteral(0,false);
      if (negative) exponent = -exponent;
      at = raw.length;
    } else {
      const digit: number = numericDigit(c);
      if (digit < 0 || digit >= radix) return new NativeNumericLiteral(0,false);
      digits.push(digit); count = count + 1;
      if (point) decimals = decimals + 1;
    }
    at = at + 1;
  }
  if (count == 0) return new NativeNumericLiteral(0,false);
  let numerator: number[] = [];
  for (const digit of digits) bigMulAdd(numerator, radix, digit);
  if (bigBits(numerator) == 0) return new NativeNumericLiteral(0,true);
  const scale: number = exponent - decimals;
  // Un exponente desmesurado ya es infinito (no válido) o cero.
  if (scale > 400) return new NativeNumericLiteral(0,false);
  if (scale < -400 - digits.length) return new NativeNumericLiteral(0,true);
  let denominator: number[] = [1];
  if (scale > 0) for (let k: number = 0; k < scale; k = k + 1) bigMulAdd(numerator, 10, 0);
  else for (let k: number = 0; k < -scale; k = k + 1) bigMulAdd(denominator, 10, 0);
  const value: number = bigQuotient(numerator, denominator);
  // Infinity - Infinity es NaN: rechaza un literal que desborda.
  return new NativeNumericLiteral(value, value - value == 0);
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
