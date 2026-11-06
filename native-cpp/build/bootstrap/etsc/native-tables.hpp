#pragma once
namespace estc {
inline const std::map<S,S> nativeTypes{{"number","double"},{"string","std::string"},{"boolean","bool"},{"void","void"},{"i8","int8_t"},{"u8","uint8_t"},{"i16","int16_t"},{"u16","uint16_t"},{"i32","int32_t"},{"u32","uint32_t"},{"i64","int64_t"},{"u64","uint64_t"},{"f32","float"},{"f64","double"},{"Console","::ets_console"},{"JsonValue","ets_json::Value"},{"Regex","ets::ets_regex"},{"FileReader","ets::FileReader"},{"TcpListener","ets::TcpListener"},{"TcpConnection","ets::TcpConnection"},{"TlsContext","ets::TlsContext"},{"TlsConnection","ets::TlsConnection"},{"CancellationSource","ets::CancellationSource"},{"CancellationToken","ets::CancellationToken"},{"FsWatcher","ets::FsWatcher"},{"FsEvent","ets::FsEvent"}};
inline const std::map<S,S> fileCalls{{"fileRead","etsFsRead"},{"fileWrite","etsFsWrite"},{"fileAppend","etsFsAppend"},{"fileCopy","etsFsCopy"},{"fileMove","etsFsMove"},{"fileRemove","etsFsRemove"}};
inline const std::map<S,S> regexCalls{{"regex","::ets::regex"}};
inline const std::map<S,S> netCalls{{"tcpListen","etsNetListen"},{"tcpAccept","etsNetAccept"},{"tcpConnect","etsNetConnect"},{"tcpRead","etsNetRead"},{"tcpWrite","etsNetWrite"},{"tcpClose","etsNetClose"}};
inline const std::map<S,S> asyncRuntimeCalls{{"spawn","ets::spawn"},{"sleep","ets::sleep"},{"cancel","ets::cancel"},{"cancellationToken","ets::cancellationToken"},{"createCancellation","ets::createCancellation"},{"isCancelled","ets::isCancelled"},{"ioUringAvailable","ets::ioUringAvailable"},{"resolveDns","ets::resolveDns"}};
inline const std::map<S,S> networkCalls{{"listenTcp","ets::listenTcp"},{"acceptTcp","ets::acceptTcp"},{"acceptTcpUntil","ets::acceptTcpUntil"},{"readTcp","ets::readTcp"},{"readTcpUntil","ets::readTcpUntil"},{"writeTcp","ets::writeTcp"},{"writeTcpUntil","ets::writeTcpUntil"},{"closeTcp","ets::closeTcp"},{"createTlsServer","ets::createTlsServer"},{"acceptTls","ets::acceptTls"},{"readTls","ets::readTls"},{"writeTls","ets::writeTls"},{"closeTls","ets::closeTls"}};
inline const std::set<S> globalCalls{"normalizePath","compilerRoot","resolveImportPath","pathDirectory","resolveProjectPath","argument","argumentCount","exitProcess","length","numberToString","jsonIsNull","jsonIsString","jsonIsNumber","jsonIsBool","jsonIsArray","jsonIsObject","jsonArrayLength","jsonArrayGet","jsonObjectGet","jsonObjectKeys","jsonAsString","jsonAsNumber","jsonAsBool","jsonEscape","fileExists","readFile","writeFile","appendFile","copyFile","moveFile","removeFile","readFileAsync","writeFileAsync","appendFileAsync","copyFileAsync","moveFileAsync","removeFileAsync","fileExistsAsync","fail","hasError","clearError"};
inline const std::set<S> asyncCalls{"sleep","delay","spawn","cancel","cancellationToken","createCancellation","isCancelled","taskResolve","promiseAll","promiseRace","all","race","timeout","retry"};
inline const std::set<S> stringMethods{"charAt","charCodeAt","indexOf","lastIndexOf","includes","startsWith","endsWith","slice","substring","substr","split","trim","trimStart","trimEnd","toUpperCase","toLowerCase","repeat","padStart","padEnd","replace","replaceAll","localeCompare","toString"};
inline const std::set<S> terminalMethods{"write","writeLine","flush","isTTY","supportsAnsi","columns","rows","color","background","style","reset","clear","clearLine","moveTo","moveBy","hideCursor","showCursor"};
inline const std::set<S> objectMethods0{"floor","ceil","round","abs","sqrt","pow","min","max","random"};
inline const std::set<S> objectMethods1{"now","utc"};
inline const std::set<S> objectMethods2{"parse","stringify","parseValue","stringifyBool","stringifyNumber","stringifyValue"};
inline const std::set<S> objectMethods3{"dirname","basename","extname","join","resolve","normalize","isAbsolute"};
inline const std::set<S> objectMethods4{"readFile","writeFile","appendFile","copyFile","rename","unlink","readFileSync","writeFileSync","appendFileSync","copyFileSync","renameSync","unlinkSync","existsSync"};
inline const std::set<S> objectMethods5{"cwd","exit","argv","argc"};
inline const std::set<S> objectMethods6{"log","info","debug","trace","warn","error"};
inline const std::map<S,std::set<S>> objectMethods{{"!Math",objectMethods0},{"!Date",objectMethods1},{"!JSON",objectMethods2},{"!path",objectMethods3},{"!fs",objectMethods4},{"!process",objectMethods5},{"Console",objectMethods6}};
inline const std::set<S> backend_libuv{"resolveDns","listenTcp","acceptTcp","acceptTcpUntil","readTcp","readTcpUntil","writeTcp","writeTcpUntil","closeTcp"};
inline const std::set<S> backend_curl{};
inline const std::set<S> backend_tls{"createTlsServer","acceptTls","readTls","writeTls","closeTls"};
inline const std::set<S> backend_ioUring{};
}