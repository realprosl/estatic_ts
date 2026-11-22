// Servidor HTTP ligero (cpp-httplib, una cabecera) como librería del runtime (#292):
//
//   import http, { param } from "estatic:http";
//   const server = http.createServer();
//   server.get("/users/:id", (req: Request, res: Response): void => { res.status(200).send("hola " + param(req, "id")); });
//   server.listen("127.0.0.1", 8080);
//   const r = await http.fetch("http://...");   // el cliente, también en estatic:fetch
//
// Para mucho tráfico, el mismo código con import ... from "estatic:http/drogon".
// Cada programa enlaza solo el servidor que importa.

@include("runtime/lib/http.hpp")
import fetchUrl, { RequestInit, Response as FetchResponse } from "./fetch";
import { Error } from "../prelude/error";

@cpp_native("ets_http_lib::createServer") function nativeCreateServer(): Server;
@cpp_native("ets_http_lib::param") function nativeParam(request: Request, name: string): string;
@cpp_native("ets_http_lib::query") function nativeQuery(request: Request, name: string): string;
@cpp_native("ets_http_lib::header") function nativeHeader(request: Request, name: string): string;

// Un servidor nuevo; se configura con server.get/post/put/patch/delete(ruta,
// (req: Request, res: Response): void => …) y se arranca con server.listen.
export function createServer(): Server { return nativeCreateServer(); }
// Parámetro de la ruta (/users/:id), de la query (?q=) o cabecera de la petición.
export function param(request: Request, name: string): string { return nativeParam(request, name); }
export function query(request: Request, name: string): string { return nativeQuery(request, name); }
export function header(request: Request, name: string): string { return nativeHeader(request, name); }

@cpp_native("ets::httpClientGetAsync") function nativeGet(url: string): Promise<Result<HttpClientResponse, string>>;
@cpp_native("ets::httpClientPostAsync") function nativePost(url: string, body: string, contentType: string): Promise<Result<HttpClientResponse, string>>;

// Los nombres del antiguo builtin http (express/server y el cliente get/post).
export function express(): Server { return nativeCreateServer(); }
export function server(): Server { return nativeCreateServer(); }
export function get(url: string): Promise<Result<HttpClientResponse, string>> { return nativeGet(url); }
export function post(url: string, body: string, contentType: string = "text/plain"): Promise<Result<HttpClientResponse, string>> { return nativePost(url, body, contentType); }

export function fetch(url: string, init?: RequestInit): Promise<Result<FetchResponse, Error>> { return fetchUrl(url, init); }

export default class http {
  static createServer(): Server { return createServer(); }
  static param(request: Request, name: string): string { return param(request, name); }
  static query(request: Request, name: string): string { return query(request, name); }
  static header(request: Request, name: string): string { return header(request, name); }
  static express(): Server { return express(); }
  static server(): Server { return server(); }
  static get(url: string): Promise<Result<HttpClientResponse, string>> { return get(url); }
  static post(url: string, body: string, contentType: string = "text/plain"): Promise<Result<HttpClientResponse, string>> { return post(url, body, contentType); }
  static fetch(url: string, init?: RequestInit): Promise<Result<FetchResponse, Error>> { return fetchUrl(url, init); }
}
