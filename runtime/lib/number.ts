// Number de TypeScript como librería del runtime (no es un builtin):
//
//   import Number, { parseInt, parseFloat, toFixed } from "estatic:number";
//   Number.isInteger(x), Number.MAX_SAFE_INTEGER, parseInt("ff", 16)
//   toFixed(x, 2), toPrecision(x, 3), toExponential(x), toString(x, 16)
//
// Los métodos de number (x.toFixed(2)...) son funciones que reciben el
// número. El redondeo decimal exacto y toString(radix) están en C++
// (runtime/lib/numeric.hpp); el resto en Estatic.

@include("runtime/lib/numeric.hpp")
@cpp_native("ets_numeric::fixed") function fixedText(x: number, digits: number): string;
@cpp_native("ets_numeric::exponential") function exponentialText(x: number, digits: number, given: boolean): string;
@cpp_native("ets_numeric::precision") function precisionText(x: number, digits: number): string;
@cpp_native("ets_numeric::radixString") function radixText(x: number, radix: number): string;
@cpp_native("ets_numeric::parseDecimal") function parseDecimal(text: string): number;
@cpp_native("ets_numeric::infinity") function infinity(): number;
@cpp_native("ets_numeric::nan") function nan(): number;
@cpp_native("ets_numeric::maxValue") function maxValue(): number;
@cpp_native("ets_numeric::minValue") function minValue(): number;
@cpp_native("ets_numeric::trunc") function trunc(x: number): number;
@cpp_native("ets_numeric::abs") function abs(x: number): number;

export const NaN: number = nan();
export const Infinity: number = infinity();

// x.toFixed(digits = 0), x.toExponential(digits?), x.toPrecision(precision?)
// y x.toString(radix = 10). Fuera de rango terminan con el RangeError de JS.
export function toFixed(x: number, digits?: number): string { return fixedText(x, digits ?? 0); }
export function toExponential(x: number, digits?: number): string { return exponentialText(x, digits ?? 0, digits !== undefined); }
export function toPrecision(x: number, precision?: number): string { return precision === undefined ? toString(x) : precisionText(x, precision); }
export function toString(x: number, radix?: number): string { return radixText(x, radix ?? 10); }

// isNaN / isFinite (para number, igual que Number.isNaN / Number.isFinite).
export function isNaN(x: number): boolean { return x != x; }
export function isFinite(x: number): boolean { return x == x && x != Infinity && x != -Infinity; }
export function isInteger(x: number): boolean { return isFinite(x) && trunc(x) == x; }
export function isSafeInteger(x: number): boolean { return isInteger(x) && abs(x) <= 9007199254740991; }

// Espacio en blanco de JavaScript (los de un byte): tab, LF, VT, FF, CR, espacio.
function whitespace(c: string): boolean {
  const code: number = c.charCodeAt(0);
  return code == 32 || (code >= 9 && code <= 13);
}
function digitValue(c: string): number {
  const code: number = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 122) return code - 87;
  if (code >= 65 && code <= 90) return code - 55;
  return 99;
}

// parseFloat: el prefijo más largo que sea un literal decimal (o Infinity).
export function parseFloat(text: string): number {
  let at: number = 0;
  while (at < text.length && whitespace(text.charAt(at))) at = at + 1;
  const start: number = at;
  if (at < text.length && (text.charAt(at) == "+" || text.charAt(at) == "-")) at = at + 1;
  if (text.startsWith("Infinity", at)) return text.charAt(start) == "-" ? -Infinity : Infinity;
  let digits: number = 0;
  while (at < text.length && digitValue(text.charAt(at)) < 10) { at = at + 1; digits = digits + 1; }
  if (at < text.length && text.charAt(at) == ".") {
    at = at + 1;
    while (at < text.length && digitValue(text.charAt(at)) < 10) { at = at + 1; digits = digits + 1; }
  }
  if (digits == 0) return NaN;
  if (at < text.length && (text.charAt(at) == "e" || text.charAt(at) == "E")) {
    let end: number = at + 1;
    if (end < text.length && (text.charAt(end) == "+" || text.charAt(end) == "-")) end = end + 1;
    let exponent: number = 0;
    while (end < text.length && digitValue(text.charAt(end)) < 10) { end = end + 1; exponent = exponent + 1; }
    if (exponent > 0) at = end;
  }
  return parseDecimal(text.slice(start, at));
}

// parseInt(text, radix?): como JavaScript, incluido el prefijo 0x.
export function parseInt(text: string, radix?: number): number {
  let at: number = 0;
  while (at < text.length && whitespace(text.charAt(at))) at = at + 1;
  let negativeSign: boolean = false;
  if (at < text.length && (text.charAt(at) == "+" || text.charAt(at) == "-")) { negativeSign = text.charAt(at) == "-"; at = at + 1; }
  let base: number = radix === undefined ? 0 : trunc(radix);
  if (base != base) base = 0;
  let stripPrefix: boolean = true;
  if (base != 0) {
    if (base < 2 || base > 36) return NaN;
    if (base != 16) stripPrefix = false;
  } else base = 10;
  if (stripPrefix && at + 1 < text.length && text.charAt(at) == "0" && (text.charAt(at + 1) == "x" || text.charAt(at + 1) == "X")) { at = at + 2; base = 16; }
  const start: number = at;
  while (at < text.length && digitValue(text.charAt(at)) < base) at = at + 1;
  if (at == start) return NaN;
  let result: number = 0;
  // En base 10 el valor exacto lo da el parser decimal; en otras bases se acumula.
  if (base == 10) result = parseDecimal(text.slice(start, at));
  else for (let k: number = start; k < at; k = k + 1) result = result * base + digitValue(text.charAt(k));
  return negativeSign ? -result : result;
}

// Export por defecto: el objeto Number de TypeScript.
export default class Number {
  static EPSILON: number = 2.220446049250313e-16;
  static MAX_SAFE_INTEGER: number = 9007199254740991;
  static MIN_SAFE_INTEGER: number = -9007199254740991;
  static MAX_VALUE: number = maxValue();
  static MIN_VALUE: number = minValue();
  static POSITIVE_INFINITY: number = Infinity;
  static NEGATIVE_INFINITY: number = -Infinity;
  static NaN: number = NaN;
  static isNaN(x: number): boolean { return isNaN(x); }
  static isFinite(x: number): boolean { return isFinite(x); }
  static isInteger(x: number): boolean { return isInteger(x); }
  static isSafeInteger(x: number): boolean { return isSafeInteger(x); }
  static parseFloat(text: string): number { return parseFloat(text); }
  static parseInt(text: string, radix?: number): number { return parseInt(text, radix); }
}
