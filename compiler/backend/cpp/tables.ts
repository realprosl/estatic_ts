// C++ target ABI spellings. No compiler implementation is delegated to C++.
export function cppType(name:string):string {
if(name=="number")return "double";
if(name=="string")return "std::string";
if(name=="boolean")return "bool";
if(name=="void")return "void";
if(name=="i8")return "int8_t";
if(name=="u8")return "uint8_t";
if(name=="i16")return "int16_t";
if(name=="u16")return "uint16_t";
if(name=="i32")return "int32_t";
if(name=="u32")return "uint32_t";
if(name=="i64")return "int64_t";
if(name=="u64")return "uint64_t";
if(name=="f32")return "float";
if(name=="f64")return "double";
if(name=="Console")return "::ets_console";
if(name=="JsonValue")return "ets_json::Value";
if(name=="Regex")return "ets::ets_regex";
if(name=="FileReader")return "ets::FileReader";
if(name=="TcpListener")return "ets::TcpListener";
if(name=="TcpConnection")return "ets::TcpConnection";
if(name=="TlsContext")return "ets::TlsContext";
if(name=="TlsConnection")return "ets::TlsConnection";
if(name=="CancellationSource")return "ets::CancellationSource";
if(name=="ProcessReadable")return "ets::ProcessReadable";
if(name=="ProcessWritable")return "ets::ProcessWritable";
if(name=="ChildProcess")return "ets::ChildProcess";
if(name=="CancellationToken")return "ets::CancellationToken";
if(name=="FsWatcher")return "ets::FsWatcher";
if(name=="FsEvent")return "ets::FsEvent";
return "";
}
export function regexCallee(name:string):string {
if(name=="regex")return "::ets::regex";
return "";
}
export function asyncCallee(name:string):string {
if(name=="spawn")return "ets::spawn";
if(name=="sleep")return "ets::sleep";
if(name=="cancel")return "ets::cancel";
if(name=="cancellationToken")return "ets::cancellationToken";
if(name=="createCancellation")return "ets::createCancellation";
if(name=="isCancelled")return "ets::isCancelled";
return "";
}
export function globalCalls(name:string):boolean{return ["compilerRoot","resolveImportPath","resolveProjectPath","numberToString"].includes(name);}
export function asyncCalls(name:string):boolean{return ["sleep","delay","spawn","cancel","cancellationToken","createCancellation","isCancelled","taskResolve","promiseAll","promiseRace","all","race","timeout","retry"].includes(name);}
export function stringMethods(name:string):boolean{return ["charAt","charCodeAt","indexOf","lastIndexOf","includes","startsWith","endsWith","slice","substring","substr","split","trim","trimStart","trimEnd","toUpperCase","toLowerCase","repeat","padStart","padEnd","replace","replaceAll","match","matchAll","search","localeCompare","toString","at","codePointAt","concat","trimLeft","trimRight"].includes(name);}
export function terminalMethods(name:string):boolean{return ["write","writeLine","flush","isTTY","supportsAnsi","columns","rows","color","background","style","reset","clear","clearLine","moveTo","moveBy","hideCursor","showCursor"].includes(name);}
export function objectMethod(base:string,method:string):boolean {
if(base=="!Math")return ["floor", "ceil", "round", "abs", "sqrt", "pow", "min", "max", "random"].includes(method);
if(base=="!Date")return ["now", "utc"].includes(method);
if(base=="!String")return ["fromCharCode", "fromCodePoint"].includes(method);
if(base=="!Array")return ["isArray", "from", "of"].includes(method);
if(base=="!Object")return ["keys", "values", "entries"].includes(method);
if(base=="!Promise")return ["all", "race", "any", "allSettled", "resolve"].includes(method);
if(base=="!JSON")return ["parse", "stringify", "parseValue", "stringifyBool", "stringifyNumber", "stringifyValue"].includes(method);
if(base=="!path")return ["dirname", "basename", "extname", "join", "resolve", "normalize", "isAbsolute"].includes(method);
if(base=="!process")return ["cwd", "exit"].includes(method);
if(base=="Console")return ["log", "info", "debug", "trace", "warn", "error"].includes(method);
return false;}
