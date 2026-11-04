// IR-only C++ names. Keep Stage0's structural TypeName/ResolvedType parser in src/.
// Scalar shapes are validated by IrCppGenerator; runtime shapes use named types.
const primitiveCpp: Readonly<Record<string, string>> = {
  number: "double", string: "std::string", boolean: "bool", void: "void",
  i8: "int8_t", i16: "int16_t", i32: "int32_t", i64: "int64_t",
  u8: "uint8_t", u16: "uint16_t", u32: "uint32_t", u64: "uint64_t",
  f32: "float", f64: "double",
};
const etsRuntimeTypes = new Set([
  "TcpListener", "TcpConnection", "TlsContext", "TlsConnection",
  "CancellationSource", "CancellationToken", "FileReader", "Server",
  "Timer", "FsWatcher", "FsEvent",
]);
export function irCppNamedType(name: string): string {
  if (Object.hasOwn(primitiveCpp, name)) return primitiveCpp[name];
  if (name === "Console") return "::ets_console";
  if (name === "Request") return "ets::HttpRequest";
  if (name === "Response") return "ets::HttpResponse";
  if (name === "HttpClientResponse") return "ets::HttpClientResponse";
  if (name === "JsonValue") return "ets_json::Value";
  if (name === "Regex") return "ets::ets_regex";
  if (etsRuntimeTypes.has(name)) return `ets::${name}`;
  return name;
}
