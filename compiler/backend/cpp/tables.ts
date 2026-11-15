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
export function fileCallee(name:string):string {
if(name=="fileRead")return "etsFsRead";
if(name=="fileWrite")return "etsFsWrite";
if(name=="fileAppend")return "etsFsAppend";
if(name=="fileCopy")return "etsFsCopy";
if(name=="fileMove")return "etsFsMove";
if(name=="fileRemove")return "etsFsRemove";
return "";
}
export function regexCallee(name:string):string {
if(name=="regex")return "::ets::regex";
return "";
}
export function netCallee(name:string):string {
if(name=="tcpListen")return "etsNetListen";
if(name=="tcpAccept")return "etsNetAccept";
if(name=="tcpConnect")return "etsNetConnect";
if(name=="tcpRead")return "etsNetRead";
if(name=="tcpWrite")return "etsNetWrite";
if(name=="tcpClose")return "etsNetClose";
return "";
}
export function asyncCallee(name:string):string {
if(name=="spawn")return "ets::spawn";
if(name=="sleep")return "ets::sleep";
if(name=="cancel")return "ets::cancel";
if(name=="cancellationToken")return "ets::cancellationToken";
if(name=="createCancellation")return "ets::createCancellation";
if(name=="isCancelled")return "ets::isCancelled";
if(name=="ioUringAvailable")return "ets::ioUringAvailable";
if(name=="resolveDns")return "ets::resolveDns";
return "";
}
export function networkCallee(name:string):string {
if(name=="listenTcp")return "ets::listenTcp";
if(name=="acceptTcp")return "ets::acceptTcp";
if(name=="acceptTcpUntil")return "ets::acceptTcpUntil";
if(name=="readTcp")return "ets::readTcp";
if(name=="readTcpUntil")return "ets::readTcpUntil";
if(name=="writeTcp")return "ets::writeTcp";
if(name=="writeTcpUntil")return "ets::writeTcpUntil";
if(name=="closeTcp")return "ets::closeTcp";
if(name=="createTlsServer")return "ets::createTlsServer";
if(name=="acceptTls")return "ets::acceptTls";
if(name=="readTls")return "ets::readTls";
if(name=="writeTls")return "ets::writeTls";
if(name=="closeTls")return "ets::closeTls";
return "";
}
export function globalCalls(name:string):boolean{return ["normalizePath","compilerRoot","resolveImportPath","pathDirectory","resolveProjectPath","argument","argumentCount","exitProcess","length","numberToString","jsonIsNull","jsonIsString","jsonIsNumber","jsonIsBool","jsonIsArray","jsonIsObject","jsonArrayLength","jsonArrayGet","jsonObjectGet","jsonObjectKeys","jsonAsString","jsonAsNumber","jsonAsBool","jsonEscape","fileExists","readFile","writeFile","appendFile","copyFile","moveFile","removeFile","readFileAsync","writeFileAsync","appendFileAsync","copyFileAsync","moveFileAsync","removeFileAsync","fileExistsAsync","fail","hasError","clearError"].includes(name);}
export function asyncCalls(name:string):boolean{return ["sleep","delay","spawn","cancel","cancellationToken","createCancellation","isCancelled","taskResolve","promiseAll","promiseRace","all","race","timeout","retry"].includes(name);}
export function stringMethods(name:string):boolean{return ["charAt","charCodeAt","indexOf","lastIndexOf","includes","startsWith","endsWith","slice","substring","substr","split","trim","trimStart","trimEnd","toUpperCase","toLowerCase","repeat","padStart","padEnd","replace","replaceAll","localeCompare","toString"].includes(name);}
export function terminalMethods(name:string):boolean{return ["write","writeLine","flush","isTTY","supportsAnsi","columns","rows","color","background","style","reset","clear","clearLine","moveTo","moveBy","hideCursor","showCursor"].includes(name);}
export function backend_libuv(name:string):boolean{return ["resolveDns","listenTcp","acceptTcp","acceptTcpUntil","readTcp","readTcpUntil","writeTcp","writeTcpUntil","closeTcp"].includes(name);}
export function backend_curl(name:string):boolean{return false;}
export function backend_tls(name:string):boolean{return ["createTlsServer","acceptTls","readTls","writeTls","closeTls"].includes(name);}
export function backend_ioUring(name:string):boolean{return false;}
export function objectMethod(base:string,method:string):boolean {
if(base=="!Math")return ["floor", "ceil", "round", "abs", "sqrt", "pow", "min", "max", "random"].includes(method);
if(base=="!Date")return ["now", "utc"].includes(method);
if(base=="!JSON")return ["parse", "stringify", "parseValue", "stringifyBool", "stringifyNumber", "stringifyValue"].includes(method);
if(base=="!path")return ["dirname", "basename", "extname", "join", "resolve", "normalize", "isAbsolute"].includes(method);
if(base=="!fs")return ["readFile", "writeFile", "appendFile", "copyFile", "rename", "unlink", "readFileSync", "writeFileSync", "appendFileSync", "copyFileSync", "renameSync", "unlinkSync", "existsSync"].includes(method);
if(base=="!process")return ["cwd", "exit"].includes(method);
if(base=="Console")return ["log", "info", "debug", "trace", "warn", "error"].includes(method);
return false;}
