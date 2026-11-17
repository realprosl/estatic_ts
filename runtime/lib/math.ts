// Math de TypeScript como librería del runtime (no es un builtin):
//
//   import Math from "estatic:math";            Math.floor(x), Math.PI
//   import { floor, PI } from "estatic:math";   floor(x), PI
//
// Mismas firmas y resultados que en JavaScript. Las funciones de <cmath> se
// enlazan con @cpp_native; el resto está escrito en Estatic.

@include("runtime/lib/numeric.hpp")
@cpp_native("ets_numeric::floor") export function floor(x: number): number;
@cpp_native("ets_numeric::ceil") export function ceil(x: number): number;
@cpp_native("ets_numeric::trunc") export function trunc(x: number): number;
@cpp_native("ets_numeric::abs") export function abs(x: number): number;
@cpp_native("ets_numeric::sqrt") export function sqrt(x: number): number;
@cpp_native("ets_numeric::cbrt") export function cbrt(x: number): number;
@cpp_native("ets_numeric::exp") export function exp(x: number): number;
@cpp_native("ets_numeric::expm1") export function expm1(x: number): number;
@cpp_native("ets_numeric::log") export function log(x: number): number;
@cpp_native("ets_numeric::log2") export function log2(x: number): number;
@cpp_native("ets_numeric::log10") export function log10(x: number): number;
@cpp_native("ets_numeric::log1p") export function log1p(x: number): number;
@cpp_native("ets_numeric::sin") export function sin(x: number): number;
@cpp_native("ets_numeric::cos") export function cos(x: number): number;
@cpp_native("ets_numeric::tan") export function tan(x: number): number;
@cpp_native("ets_numeric::asin") export function asin(x: number): number;
@cpp_native("ets_numeric::acos") export function acos(x: number): number;
@cpp_native("ets_numeric::atan") export function atan(x: number): number;
@cpp_native("ets_numeric::atan2") export function atan2(y: number, x: number): number;
@cpp_native("ets_numeric::sinh") export function sinh(x: number): number;
@cpp_native("ets_numeric::cosh") export function cosh(x: number): number;
@cpp_native("ets_numeric::tanh") export function tanh(x: number): number;
@cpp_native("ets_numeric::asinh") export function asinh(x: number): number;
@cpp_native("ets_numeric::acosh") export function acosh(x: number): number;
@cpp_native("ets_numeric::atanh") export function atanh(x: number): number;
@cpp_native("ets_numeric::fround") export function fround(x: number): number;
@cpp_native("ets_numeric::clz32") export function clz32(x: number): number;
@cpp_native("ets_numeric::imul") export function imul(a: number, b: number): number;
@cpp_native("ets_numeric::random") export function random(): number;
@cpp_native("ets_numeric::signbit") function negative(x: number): boolean;
@cpp_native("ets_numeric::pow") function cpow(x: number, y: number): number;
@cpp_native("ets_numeric::hypot2") function hypot2(x: number, y: number): number;
@cpp_native("ets_numeric::infinity") function infinity(): number;
@cpp_native("ets_numeric::nan") function nan(): number;
const Infinity: number = infinity();
const NaN: number = nan();

export const E: number = 2.718281828459045;
export const LN10: number = 2.302585092994046;
export const LN2: number = 0.6931471805599453;
export const LOG10E: number = 0.4342944819032518;
export const LOG2E: number = 1.4426950408889634;
export const PI: number = 3.141592653589793;
export const SQRT1_2: number = 0.7071067811865476;
export const SQRT2: number = 1.4142135623730951;

// round: el entero más cercano; en el empate, hacia +infinito (-2.5 -> -2).
// Conserva -0 como JavaScript (Math.round(-0.4) es -0).
export function round(x: number): number {
  if (x != x || x == Infinity || x == -Infinity) return x;
  const below: number = floor(x);
  const result: number = x - below >= 0.5 ? below + 1 : below;
  if (result == 0 && (x < 0 || negative(x))) return -0;
  return result;
}

// sign: -1, 1, ±0 o NaN.
export function sign(x: number): number {
  if (x != x || x == 0) return x;
  return x > 0 ? 1 : -1;
}

// pow: como C salvo que 1 ** NaN y (±1) ** ±Infinity son NaN en JavaScript.
export function pow(x: number, y: number): number {
  if (y != y) return NaN;
  if ((x == 1 || x == -1) && (y == Infinity || y == -Infinity)) return NaN;
  return cpow(x, y);
}

// min / max: NaN si alguno es NaN; -0 es menor que +0; sin argumentos,
// Infinity y -Infinity.
export function min(...values: number[]): number { return minOf(values); }
export function max(...values: number[]): number { return maxOf(values); }
function minOf(values: number[]): number {
  let result: number = Infinity;
  for (const value of values) {
    if (value != value) return NaN;
    if (value < result || (value == 0 && result == 0 && negative(value))) result = value;
  }
  return result;
}
function maxOf(values: number[]): number {
  let result: number = -Infinity;
  for (const value of values) {
    if (value != value) return NaN;
    if (value > result || (value == 0 && result == 0 && !negative(value))) result = value;
  }
  return result;
}

// hypot: raíz de la suma de cuadrados, sin desbordar; Infinity gana a NaN.
export function hypot(...values: number[]): number { return hypotOf(values); }
function hypotOf(values: number[]): number {
  let result: number = 0; let nan: boolean = false;
  for (const value of values) {
    if (value == Infinity || value == -Infinity) return Infinity;
    if (value != value) nan = true; else result = hypot2(result, value);
  }
  return nan ? NaN : result;
}

// Export por defecto: el objeto Math de TypeScript.
export default class Math {
  static E: number = E;
  static LN10: number = LN10;
  static LN2: number = LN2;
  static LOG10E: number = LOG10E;
  static LOG2E: number = LOG2E;
  static PI: number = PI;
  static SQRT1_2: number = SQRT1_2;
  static SQRT2: number = SQRT2;
  static abs(x: number): number { return abs(x); }
  static acos(x: number): number { return acos(x); }
  static acosh(x: number): number { return acosh(x); }
  static asin(x: number): number { return asin(x); }
  static asinh(x: number): number { return asinh(x); }
  static atan(x: number): number { return atan(x); }
  static atan2(y: number, x: number): number { return atan2(y, x); }
  static atanh(x: number): number { return atanh(x); }
  static cbrt(x: number): number { return cbrt(x); }
  static ceil(x: number): number { return ceil(x); }
  static clz32(x: number): number { return clz32(x); }
  static cos(x: number): number { return cos(x); }
  static cosh(x: number): number { return cosh(x); }
  static exp(x: number): number { return exp(x); }
  static expm1(x: number): number { return expm1(x); }
  static floor(x: number): number { return floor(x); }
  static fround(x: number): number { return fround(x); }
  static hypot(...values: number[]): number { return hypotOf(values); }
  static imul(a: number, b: number): number { return imul(a, b); }
  static log(x: number): number { return log(x); }
  static log10(x: number): number { return log10(x); }
  static log1p(x: number): number { return log1p(x); }
  static log2(x: number): number { return log2(x); }
  static max(...values: number[]): number { return maxOf(values); }
  static min(...values: number[]): number { return minOf(values); }
  static pow(x: number, y: number): number { return pow(x, y); }
  static random(): number { return random(); }
  static round(x: number): number { return round(x); }
  static sign(x: number): number { return sign(x); }
  static sin(x: number): number { return sin(x); }
  static sinh(x: number): number { return sinh(x); }
  static sqrt(x: number): number { return sqrt(x); }
  static tan(x: number): number { return tan(x); }
  static tanh(x: number): number { return tanh(x); }
  static trunc(x: number): number { return trunc(x); }
}
