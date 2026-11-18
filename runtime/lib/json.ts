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

export default class JSON {
  static stringify<T>(value: T, replacer?: string[], space?: number | string): string { return stringify<T>(value, replacer, space); }
  static parse<T = JsonValue>(text: string): Result<T, Error> { return parse<T>(text); }
}
