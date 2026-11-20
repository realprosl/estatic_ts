// JSON de TypeScript como librería del runtime (no es un builtin):
//
//   import JSON from "estatic:json";
//   JSON.stringify(valor), JSON.stringify(valor, undefined, 2)
//   const r = JSON.parse<Usuario>(texto);     // Result<Usuario, Error>
//   const v = JSON.parse(texto);              // Result<JsonValue, Error>
//
// Sin excepciones: un texto que no es JSON, o que no encaja con el tipo pedido,
// da un Result con un SyntaxError. La serialización y la lectura recorren los
// tipos en C++ (runtime/lib/json.hpp); las clases, por los nombres de sus campos.

@include("runtime/lib/json.hpp")
import { Error, SyntaxError } from "../prelude/error";
@cpp_native("ets_jsonlib::stringify") function stringifyNative<T>(value: T, spaces: number, text: string): string;
@cpp_native("ets_jsonlib::decode") function decode<T>(text: string): Result<T, string>;

// JSON.stringify(valor, replacer?, space?): space es un número de espacios
// (hasta 10) o un texto de sangría. El replacer no se admite todavía.
export function stringify<T>(value: T, replacer?: string[], space?: number | string): string {
  if (space === undefined) return stringifyNative<T>(value, 0, "");
  if (typeof space == "number") return stringifyNative<T>(value, space, "");
  return stringifyNative<T>(value, 0, space);
}

// JSON.parse<T>(texto): sin T devuelve el valor dinámico (JsonValue).
export function parse<T = JsonValue>(text: string): Result<T, Error> {
  const decoded: Result<T, string> = decode<T>(text);
  if (decoded.isOk()) return resultOk<T, Error>(decoded.value());
  return resultErr<T, Error>(new SyntaxError(decoded.error()));
}

// ── Acceso a un JsonValue ──────────────────────────────────────────────────
// La API que el runtime exponía como builtin (jsonObjectGet, jsonAsString…):
// leer un valor ya parseado. `estatic:json` la absorbe (decisión de #292),
// para que el compilador deje de depender de esos builtins al migrar a los
// imports. Mismas firmas que tenían, así que la migración es un renombrado.
//
//   import { objectGet, asString } from "estatic:json";
//   const v = JSON.parse(texto).value();
//   if (isObject(v)) print(asString(objectGet(v, "nombre")));

@cpp_native("jsonObjectGet") function nativeObjectGet(value: JsonValue, key: string): JsonValue;
@cpp_native("jsonObjectKeys") function nativeObjectKeys(value: JsonValue): string[];
@cpp_native("jsonArrayGet") function nativeArrayGet(value: JsonValue, index: number): JsonValue;
@cpp_native("jsonArrayLength") function nativeArrayLength(value: JsonValue): number;
@cpp_native("jsonAsString") function nativeAsString(value: JsonValue): string;
@cpp_native("jsonAsNumber") function nativeAsNumber(value: JsonValue): number;
@cpp_native("jsonAsBool") function nativeAsBool(value: JsonValue): boolean;
@cpp_native("jsonIsObject") function nativeIsObject(value: JsonValue): boolean;
@cpp_native("jsonIsArray") function nativeIsArray(value: JsonValue): boolean;
@cpp_native("jsonIsString") function nativeIsString(value: JsonValue): boolean;
@cpp_native("jsonIsNumber") function nativeIsNumber(value: JsonValue): boolean;
@cpp_native("jsonIsBool") function nativeIsBool(value: JsonValue): boolean;
@cpp_native("jsonIsNull") function nativeIsNull(value: JsonValue): boolean;
@cpp_native("jsonEscape") function nativeEscape(text: string): string;

/** El valor de `key` en un objeto; un valor vacío si no está o no es objeto. */
export function objectGet(value: JsonValue, key: string): JsonValue { return nativeObjectGet(value, key); }
/** Las claves de un objeto, en orden de inserción. */
export function objectKeys(value: JsonValue): string[] { return nativeObjectKeys(value); }
/** El elemento `index` de un array; un valor vacío si no existe. */
export function arrayGet(value: JsonValue, index: number): JsonValue { return nativeArrayGet(value, index); }
/** Cuántos elementos tiene un array (0 si no es un array). */
export function arrayLength(value: JsonValue): number { return nativeArrayLength(value); }
/** El texto de un valor de tipo string ("" si no lo es). */
export function asString(value: JsonValue): string { return nativeAsString(value); }
/** El número de un valor de tipo number (0 si no lo es). */
export function asNumber(value: JsonValue): number { return nativeAsNumber(value); }
/** El booleano de un valor de tipo boolean (false si no lo es). */
export function asBool(value: JsonValue): boolean { return nativeAsBool(value); }
/** ¿El valor es un objeto? */
export function isObject(value: JsonValue): boolean { return nativeIsObject(value); }
/** ¿El valor es un array? */
export function isArray(value: JsonValue): boolean { return nativeIsArray(value); }
/** ¿El valor es un string? */
export function isString(value: JsonValue): boolean { return nativeIsString(value); }
/** ¿El valor es un number? */
export function isNumber(value: JsonValue): boolean { return nativeIsNumber(value); }
/** ¿El valor es un boolean? */
export function isBool(value: JsonValue): boolean { return nativeIsBool(value); }
/** ¿El valor es null? */
export function isNull(value: JsonValue): boolean { return nativeIsNull(value); }
/** Escapa un texto para escribirlo dentro de un JSON. */
export function escape(text: string): string { return nativeEscape(text); }

export default class JSON {
  static stringify<T>(value: T, replacer?: string[], space?: number | string): string { return stringify<T>(value, replacer, space); }
  static parse<T = JsonValue>(text: string): Result<T, Error> { return parse<T>(text); }
}
