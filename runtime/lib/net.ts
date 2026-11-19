// net de Node como librería del runtime (#292), con promesas en vez de eventos:
//
//   import net from "estatic:net";
//   const server = net.listen(8080);                 // Result<Server, Error>
//   const socket = await server.value().accept();    // Result<Socket, Error>
//   const client = await net.connect(8080, "127.0.0.1");
//   await socket.write("hola"); const datos = await socket.read();
//
// Sin excepciones: Result<T, Error>. Bindings al runtime de siempre
// (runtime/ets_net.hpp) más connect async (runtime/lib/net.hpp).

@include("runtime/lib/net.hpp")
import { Error, BaseError } from "../prelude/error";

@cpp_native("ets_net_lib::listen") function nativeListen(port: number, host: string): Result<TcpListener, string>;
@cpp_native("ets_net_lib::accept") function nativeAccept(listener: TcpListener): Promise<Result<TcpConnection, string>>;
@cpp_native("ets_net_lib::connect") function nativeConnect(port: number, host: string): Promise<Result<TcpConnection, string>>;
@cpp_native("ets_net_lib::read") function nativeRead(connection: TcpConnection, bytes: number): Promise<Result<string, string>>;
@cpp_native("ets_net_lib::write") function nativeWrite(connection: TcpConnection, data: string): Promise<Result<number, string>>;
@cpp_native("ets_net_lib::closeListener") function nativeCloseListener(listener: TcpListener): void;
@cpp_native("ets_net_lib::closeConnection") function nativeCloseConnection(connection: TcpConnection): void;

// (Los métodos async de clase aún no existen en el dialecto: los métodos
// devuelven la promesa de una función async del módulo.)
async function socketRead(connection: TcpConnection, maxBytes: number): Promise<Result<string, Error>> {
  const r: Result<string, string> = await nativeRead(connection, maxBytes);
  if (r.isOk()) return resultOk<string, Error>(r.value());
  return resultErr<string, Error>(new BaseError(r.error()));
}
async function socketWrite(connection: TcpConnection, data: string): Promise<Result<number, Error>> {
  const r: Result<number, string> = await nativeWrite(connection, data);
  if (r.isOk()) return resultOk<number, Error>(r.value());
  return resultErr<number, Error>(new BaseError(r.error()));
}
async function serverAccept(listener: TcpListener): Promise<Result<Socket, Error>> {
  const r: Result<TcpConnection, string> = await nativeAccept(listener);
  if (r.isOk()) return resultOk<Socket, Error>(new Socket(r.value()));
  return resultErr<Socket, Error>(new BaseError(r.error()));
}

export class Socket {
  connection: TcpConnection;
  constructor(connection: TcpConnection) { this.connection = connection; }
  // Lee lo que haya llegado (hasta maxBytes); "" cuando el otro lado cierra.
  read(maxBytes: number = 65536): Promise<Result<string, Error>> { return socketRead(this.connection, maxBytes); }
  // Escribe todo el texto; devuelve los bytes escritos.
  write(data: string): Promise<Result<number, Error>> { return socketWrite(this.connection, data); }
  end(): void { nativeCloseConnection(this.connection); }
}

export class Server {
  listener: TcpListener;
  constructor(listener: TcpListener) { this.listener = listener; }
  accept(): Promise<Result<Socket, Error>> { return serverAccept(this.listener); }
  close(): void { nativeCloseListener(this.listener); }
}

export function listen(port: number, host: string = "0.0.0.0"): Result<Server, Error> {
  const r: Result<TcpListener, string> = nativeListen(port, host);
  if (r.isOk()) return resultOk<Server, Error>(new Server(r.value()));
  return resultErr<Server, Error>(new BaseError(r.error()));
}

export async function connect(port: number, host: string = "127.0.0.1"): Promise<Result<Socket, Error>> {
  const r: Result<TcpConnection, string> = await nativeConnect(port, host);
  if (r.isOk()) return resultOk<Socket, Error>(new Socket(r.value()));
  return resultErr<Socket, Error>(new BaseError(r.error()));
}

export default class net {
  static listen(port: number, host: string = "0.0.0.0"): Result<Server, Error> { return listen(port, host); }
  static connect(port: number, host: string = "127.0.0.1"): Promise<Result<Socket, Error>> { return connect(port, host); }
}
