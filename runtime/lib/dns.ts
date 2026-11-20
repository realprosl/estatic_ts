// dns de Node como librería del runtime (#292):
//
//   import dns from "estatic:dns";
//   const ip = await dns.lookup("localhost");   // Result<string, Error>: "127.0.0.1"
//
// Binding a resolveDns del runtime (getaddrinfo en el pool de libuv). Devuelve
// la primera dirección IPv4.

@include("runtime/lib/dns.hpp")
import { Error, BaseError } from "../prelude/error";

@cpp_native("ets_dns_lib::lookup") function nativeLookup(host: string): Promise<string>;

export async function lookup(host: string): Promise<Result<string, Error>> {
  const address: string = await nativeLookup(host);
  if (address == "") return resultErr<string, Error>(new BaseError("ENOTFOUND: no se pudo resolver '" + host + "'"));
  return resultOk<string, Error>(address);
}

export default class dns {
  static lookup(host: string): Promise<Result<string, Error>> { return lookup(host); }
}
