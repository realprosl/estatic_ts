// fetch de la web como librería del runtime (#292):
//
//   import fetch from "estatic:fetch";
//   const r = await fetch("https://ejemplo.com/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
//   if (r.isOk()) { const res = r.value(); res.status; res.ok; res.headers.get("content-type"); await res.text(); }
//
// Sin excepciones: un fallo de red devuelve Result<Response, Error> con el
// error (un 404 es una respuesta con ok = false, como en la web). Usa libcurl
// en el pool de bloqueo del bucle de eventos (runtime/lib/fetch.hpp).

@include("runtime/lib/fetch.hpp")
import { Error, BaseError } from "../prelude/error";

@cpp_native("ets_fetch_lib::request") function nativeRequest(method: string, url: string, names: string[], values: string[], body: string): Promise<Result<HttpClientResponse, string>>;
@cpp_native("ets_fetch_lib::status") function nativeStatus(response: HttpClientResponse): number;
@cpp_native("ets_fetch_lib::body") function nativeBody(response: HttpClientResponse): string;
@cpp_native("ets_fetch_lib::headerNames") function nativeHeaderNames(response: HttpClientResponse): string[];
@cpp_native("ets_fetch_lib::headerValues") function nativeHeaderValues(response: HttpClientResponse): string[];

export interface RequestInit { method?: string; headers?: Record<string, string>; body?: string }

// Las cabeceras de la respuesta; get/has no distinguen mayúsculas.
export class Headers {
  names: string[]; values: string[];
  constructor(names: string[], values: string[]) { this.names = names; this.values = values; }
  get(name: string): string | undefined {
    const wanted: string = name.toLowerCase();
    for (let at = 0; at < this.names.length; at++) if (this.names[at].toLowerCase() == wanted) return this.values[at];
    return undefined;
  }
  has(name: string): boolean { return this.get(name) !== undefined; }
}

async function bodyText(body: string): Promise<string> { return body; }

export class Response {
  status: number; ok: boolean; url: string; headers: Headers; body: string;
  constructor(url: string, status: number, headers: Headers, body: string) { this.url = url; this.status = status; this.ok = status >= 200 && status <= 299; this.headers = headers; this.body = body; }
  text(): Promise<string> { return bodyText(this.body); }
}

export default async function fetch(url: string, init?: RequestInit): Promise<Result<Response, Error>> {
  let method: string = "GET"; let body: string = ""; let names: string[] = []; let values: string[] = [];
  if (init !== undefined) {
    const options: RequestInit = init;
    method = (options.method ?? "GET").toUpperCase(); body = options.body ?? "";
    const headers: Record<string, string> | undefined = options.headers;
    if (headers !== undefined) { const given: Record<string, string> = headers; for (const [name, value] of Object.entries(given)) { names.push(name); values.push(value); } }
  }
  const r: Result<HttpClientResponse, string> = await nativeRequest(method, url, names, values, body);
  if (!r.isOk()) return resultErr<Response, Error>(new BaseError(r.error()));
  const raw: HttpClientResponse = r.value();
  return resultOk<Response, Error>(new Response(url, nativeStatus(raw), new Headers(nativeHeaderNames(raw), nativeHeaderValues(raw)), nativeBody(raw)));
}

