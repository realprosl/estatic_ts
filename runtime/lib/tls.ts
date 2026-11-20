// Servidor TLS como librería del runtime (#292), con promesas en vez de eventos:
//
//   import tls from "estatic:tls";
//   const server = tls.createServer({ cert: "cert.pem", key: "key.pem" });  // Result<TlsServer, Error>
//   const ok = server.value().listen(8443, "127.0.0.1");                    // Result<boolean, Error>
//   const socket = await server.value().accept();                          // Result<TlsSocket, Error>
//   const datos = await socket.value().read(); await socket.value().write("hola");
//
// OpenSSL sobre el bucle de eventos (runtime/ets_tls.hpp). Las esperas tienen
// un plazo en milisegundos (por defecto, sin límite práctico).

@include("runtime/lib/tls.hpp")
import { Error, BaseError } from "../prelude/error";

@cpp_native("ets_tls_lib::context") function nativeContext(certificate: string, key: string): Result<TlsContext, string>;
@cpp_native("ets_tls_lib::listen") function nativeListen(port: number, host: string): Result<TcpListener, string>;
@cpp_native("ets_tls_lib::accept") function nativeAccept(listener: TcpListener, context: TlsContext, timeout: number): Promise<Result<TlsConnection, string>>;
@cpp_native("ets_tls_lib::read") function nativeRead(connection: TlsConnection, bytes: number, timeout: number): Promise<Result<string, string>>;
@cpp_native("ets_tls_lib::write") function nativeWrite(connection: TlsConnection, data: string, timeout: number): Promise<Result<number, string>>;
@cpp_native("ets_tls_lib::close") function nativeClose(connection: TlsConnection): void;
@cpp_native("ets_tls_lib::closeListener") function nativeCloseListener(listener: TcpListener): void;

// Sin límite práctico (unos 115 días).
const forever: number = 10000000000;

export interface TlsOptions { cert: string; key: string }

// (Los métodos async de clase aún no existen en el dialecto, #297: los métodos
// devuelven la promesa de una función async del módulo.)
async function socketRead(connection: TlsConnection, maxBytes: number, timeout: number): Promise<Result<string, Error>> {
  const r: Result<string, string> = await nativeRead(connection, maxBytes, timeout);
  if (r.isOk()) return resultOk<string, Error>(r.value());
  return resultErr<string, Error>(new BaseError(r.error()));
}
async function socketWrite(connection: TlsConnection, data: string, timeout: number): Promise<Result<number, Error>> {
  const r: Result<number, string> = await nativeWrite(connection, data, timeout);
  if (r.isOk()) return resultOk<number, Error>(r.value());
  return resultErr<number, Error>(new BaseError(r.error()));
}
async function serverAccept(listener: TcpListener, context: TlsContext, timeout: number): Promise<Result<TlsSocket, Error>> {
  const r: Result<TlsConnection, string> = await nativeAccept(listener, context, timeout);
  if (r.isOk()) return resultOk<TlsSocket, Error>(new TlsSocket(r.value()));
  return resultErr<TlsSocket, Error>(new BaseError(r.error()));
}

async function notListening(): Promise<Result<TlsSocket, Error>> { return resultErr<TlsSocket, Error>(new BaseError("El servidor TLS no está escuchando: llama a listen() antes")); }

export class TlsSocket {
  connection: TlsConnection;
  constructor(connection: TlsConnection) { this.connection = connection; }
  read(maxBytes: number = 65536, timeout: number = forever): Promise<Result<string, Error>> { return socketRead(this.connection, maxBytes, timeout); }
  write(data: string, timeout: number = forever): Promise<Result<number, Error>> { return socketWrite(this.connection, data, timeout); }
  end(): void { nativeClose(this.connection); }
}

export class TlsServer {
  context: TlsContext;
  listener: Optional<TcpListener>;
  constructor(context: TlsContext) { this.context = context; this.listener = undefined; }
  listen(port: number, host: string = "0.0.0.0"): Result<boolean, Error> {
    const r: Result<TcpListener, string> = nativeListen(port, host);
    if (!r.isOk()) return resultErr<boolean, Error>(new BaseError(r.error()));
    this.listener = r.value(); return resultOk<boolean, Error>(true);
  }
  accept(timeout: number = forever): Promise<Result<TlsSocket, Error>> {
    if (this.listener === undefined) return notListening();
    return serverAccept(this.listener, this.context, timeout);
  }
  close(): void { if (this.listener !== undefined) nativeCloseListener(this.listener); }
}

export function createServer(options: TlsOptions): Result<TlsServer, Error> {
  const r: Result<TlsContext, string> = nativeContext(options.cert, options.key);
  if (r.isOk()) return resultOk<TlsServer, Error>(new TlsServer(r.value()));
  return resultErr<TlsServer, Error>(new BaseError(r.error()));
}

export default class tls {
  static createServer(options: TlsOptions): Result<TlsServer, Error> { return createServer(options); }
}
