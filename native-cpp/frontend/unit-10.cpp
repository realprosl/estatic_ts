// Generated module. Do not edit.
#include "estatic_common.hpp"

std::vector<std::string> nativeBuiltinSignatures(std::string key) {
    if ((key == std::string("!Date.now"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("!Date.utc"))) {
        return std::vector<std::string>{std::string("(number,number,number)=>number")};
    }
    if ((key == std::string("!fs.appendFile"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("!fs.appendFileSync"))) {
        return std::vector<std::string>{std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("!fs.copyFile"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("!fs.copyFileSync"))) {
        return std::vector<std::string>{std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("!fs.existsSync"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("!fs.readFile"))) {
        return std::vector<std::string>{std::string("(string)=>Promise<Result<string,string>>")};
    }
    if ((key == std::string("!fs.readFileSync"))) {
        return std::vector<std::string>{std::string("(string)=>Result<string,string>")};
    }
    if ((key == std::string("!fs.rename"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("!fs.renameSync"))) {
        return std::vector<std::string>{std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("!fs.unlink"))) {
        return std::vector<std::string>{std::string("(string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("!fs.unlinkSync"))) {
        return std::vector<std::string>{std::string("(string)=>Result<boolean,string>")};
    }
    if ((key == std::string("!fs.writeFile"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("!fs.writeFileSync"))) {
        return std::vector<std::string>{std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("!http.createServer"))) {
        return std::vector<std::string>{std::string("()=>Server")};
    }
    if ((key == std::string("!http.express"))) {
        return std::vector<std::string>{std::string("()=>Server")};
    }
    if ((key == std::string("!http.get"))) {
        return std::vector<std::string>{std::string("(string)=>Promise<Result<HttpClientResponse,string>>")};
    }
    if ((key == std::string("!http.header"))) {
        return std::vector<std::string>{std::string("(Request,string)=>string")};
    }
    if ((key == std::string("!http.param"))) {
        return std::vector<std::string>{std::string("(Request,string)=>string")};
    }
    if ((key == std::string("!http.post"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<HttpClientResponse,string>>"), std::string("(string,string,string)=>Promise<Result<HttpClientResponse,string>>")};
    }
    if ((key == std::string("!http.query"))) {
        return std::vector<std::string>{std::string("(Request,string)=>string")};
    }
    if ((key == std::string("!http.server"))) {
        return std::vector<std::string>{std::string("()=>Server")};
    }
    if ((key == std::string("!JSON.parse"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("!JSON.parseValue"))) {
        return std::vector<std::string>{std::string("(string)=>JsonValue")};
    }
    if ((key == std::string("!JSON.stringify"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("!JSON.stringifyBool"))) {
        return std::vector<std::string>{std::string("(boolean)=>string")};
    }
    if ((key == std::string("!JSON.stringifyNumber"))) {
        return std::vector<std::string>{std::string("(number)=>string")};
    }
    if ((key == std::string("!JSON.stringifyValue"))) {
        return std::vector<std::string>{std::string("(JsonValue)=>string")};
    }
    if ((key == std::string("!Math.abs"))) {
        return std::vector<std::string>{std::string("(number)=>number")};
    }
    if ((key == std::string("!Math.ceil"))) {
        return std::vector<std::string>{std::string("(number)=>number")};
    }
    if ((key == std::string("!Math.floor"))) {
        return std::vector<std::string>{std::string("(number)=>number")};
    }
    if ((key == std::string("!Math.max"))) {
        return std::vector<std::string>{std::string("(number,number)=>number")};
    }
    if ((key == std::string("!Math.min"))) {
        return std::vector<std::string>{std::string("(number,number)=>number")};
    }
    if ((key == std::string("!Math.pow"))) {
        return std::vector<std::string>{std::string("(number,number)=>number")};
    }
    if ((key == std::string("!Math.random"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("!Math.round"))) {
        return std::vector<std::string>{std::string("(number)=>number")};
    }
    if ((key == std::string("!Math.sqrt"))) {
        return std::vector<std::string>{std::string("(number)=>number")};
    }
    if ((key == std::string("!path.basename"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("!path.dirname"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("!path.extname"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("!path.isAbsolute"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("!path.join"))) {
        return std::vector<std::string>{std::string("(string[])=>string")};
    }
    if ((key == std::string("!path.normalize"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("!path.resolve"))) {
        return std::vector<std::string>{std::string("(string[])=>string")};
    }
    if ((key == std::string("!process.argc"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("!process.argv"))) {
        return std::vector<std::string>{std::string("()=>string[]")};
    }
    if ((key == std::string("!process.cwd"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("!process.exit"))) {
        return std::vector<std::string>{std::string("(number)=>void")};
    }
    if ((key == std::string("acceptTcp"))) {
        return std::vector<std::string>{std::string("(TcpListener)=>Promise<Result<TcpConnection,string>>")};
    }
    if ((key == std::string("acceptTcpUntil"))) {
        return std::vector<std::string>{std::string("(TcpListener,number,CancellationToken)=>Promise<Result<TcpConnection,string>>")};
    }
    if ((key == std::string("acceptTls"))) {
        return std::vector<std::string>{std::string("(TcpListener,TlsContext,number,CancellationToken)=>Promise<Result<TlsConnection,string>>")};
    }
    if ((key == std::string("appendFile"))) {
        return std::vector<std::string>{std::string("(string,string,ref<string>)=>boolean"), std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("appendFileAsync"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("appendFileUntil"))) {
        return std::vector<std::string>{std::string("(string,string,number,CancellationToken)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("argument"))) {
        return std::vector<std::string>{std::string("(number)=>string")};
    }
    if ((key == std::string("argumentCount"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("asyncIoUringRead"))) {
        return std::vector<std::string>{std::string("(string)=>Promise<Result<string,string>>")};
    }
    if ((key == std::string("asyncIoUringWrite"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("cancel"))) {
        return std::vector<std::string>{std::string("(CancellationSource)=>void")};
    }
    if ((key == std::string("cancellationToken"))) {
        return std::vector<std::string>{std::string("(CancellationSource)=>CancellationToken")};
    }
    if ((key == std::string("cancelTimer"))) {
        return std::vector<std::string>{std::string("(Timer)=>void")};
    }
    if ((key == std::string("charAt"))) {
        return std::vector<std::string>{std::string("(string,number)=>string")};
    }
    if ((key == std::string("clearError"))) {
        return std::vector<std::string>{std::string("(ref<string>)=>void")};
    }
    if ((key == std::string("closeTcp"))) {
        return std::vector<std::string>{std::string("(TcpListener)=>void"), std::string("(TcpConnection)=>void")};
    }
    if ((key == std::string("closeTls"))) {
        return std::vector<std::string>{std::string("(TlsConnection)=>void")};
    }
    if ((key == std::string("compileCpp"))) {
        return std::vector<std::string>{std::string("(string,string,string,string,string,ref<string>)=>boolean")};
    }
    if ((key == std::string("compilerRoot"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("Console.background"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("Console.clear"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("Console.clearLine"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("Console.color"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("Console.columns"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("Console.flush"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("Console.hideCursor"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("Console.isTTY"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("Console.moveBy"))) {
        return std::vector<std::string>{std::string("(number,number)=>boolean")};
    }
    if ((key == std::string("Console.moveTo"))) {
        return std::vector<std::string>{std::string("(number,number)=>boolean")};
    }
    if ((key == std::string("Console.reset"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("Console.rows"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("Console.showCursor"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("Console.style"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("Console.supportsAnsi"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("Console.write"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("Console.writeLine"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("copyFile"))) {
        return std::vector<std::string>{std::string("(string,string,ref<string>)=>boolean"), std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("copyFileAsync"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("copyFileUntil"))) {
        return std::vector<std::string>{std::string("(string,string,number,CancellationToken)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("createCancellation"))) {
        return std::vector<std::string>{std::string("()=>CancellationSource")};
    }
    if ((key == std::string("createTlsServer"))) {
        return std::vector<std::string>{std::string("(string,string)=>Result<TlsContext,string>")};
    }
    if ((key == std::string("ensureParentDirectory"))) {
        return std::vector<std::string>{std::string("(string,ref<string>)=>boolean")};
    }
    if ((key == std::string("estaticAstRecords"))) {
        return std::vector<std::string>{std::string("(string,ref<string>,ref<string>)=>boolean")};
    }
    if ((key == std::string("estaticTypedAstJson"))) {
        return std::vector<std::string>{std::string("(string,ref<string>,ref<string>)=>boolean")};
    }
    if ((key == std::string("estaticTypedAstRecords"))) {
        return std::vector<std::string>{std::string("(string,ref<string>,ref<string>)=>boolean")};
    }
    if ((key == std::string("etsNetSyncEcho"))) {
        return std::vector<std::string>{std::string("(string,number,string,number)=>string")};
    }
    if ((key == std::string("etsNetSyncLarge"))) {
        return std::vector<std::string>{std::string("(string,number,number)=>string")};
    }
    if ((key == std::string("exitProcess"))) {
        return std::vector<std::string>{std::string("(number)=>void")};
    }
    if ((key == std::string("fail"))) {
        return std::vector<std::string>{std::string("(string,ref<string>)=>boolean")};
    }
    if ((key == std::string("fileAppend"))) {
        return std::vector<std::string>{std::string("(string,string)=>boolean")};
    }
    if ((key == std::string("fileCopy"))) {
        return std::vector<std::string>{std::string("(string,string)=>boolean")};
    }
    if ((key == std::string("fileExists"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("fileExistsAsync"))) {
        return std::vector<std::string>{std::string("(string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("fileMove"))) {
        return std::vector<std::string>{std::string("(string,string)=>boolean")};
    }
    if ((key == std::string("fileRead"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("FileReader.close"))) {
        return std::vector<std::string>{std::string("()=>void")};
    }
    if ((key == std::string("FileReader.eof"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("FileReader.peek"))) {
        return std::vector<std::string>{std::string("(number)=>string")};
    }
    if ((key == std::string("FileReader.peekChar"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("FileReader.read"))) {
        return std::vector<std::string>{std::string("(number)=>string")};
    }
    if ((key == std::string("FileReader.readChar"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("FileReader.readLine"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("fileRemove"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("fileWrite"))) {
        return std::vector<std::string>{std::string("(string,string)=>boolean")};
    }
    if ((key == std::string("FsEvent.flags"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("FsEvent.path"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("FsWatcher.valid"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("hasError"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("HttpClientResponse.body"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("HttpClientResponse.header"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("HttpClientResponse.status"))) {
        return std::vector<std::string>{std::string("()=>number")};
    }
    if ((key == std::string("indexOf"))) {
        return std::vector<std::string>{std::string("(string,string,number)=>number")};
    }
    if ((key == std::string("ioUringAvailable"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("ioUringRead"))) {
        return std::vector<std::string>{std::string("(string)=>Result<string,string>")};
    }
    if ((key == std::string("ioUringWrite"))) {
        return std::vector<std::string>{std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("isCancelled"))) {
        return std::vector<std::string>{std::string("(CancellationToken)=>boolean")};
    }
    if ((key == std::string("jsonEscape"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("length"))) {
        return std::vector<std::string>{std::string("(string)=>number")};
    }
    if ((key == std::string("lineAt"))) {
        return std::vector<std::string>{std::string("(string,number)=>string")};
    }
    if ((key == std::string("lineCount"))) {
        return std::vector<std::string>{std::string("(string)=>number")};
    }
    if ((key == std::string("listenTcp"))) {
        return std::vector<std::string>{std::string("(string,number)=>Result<TcpListener,string>")};
    }
    if ((key == std::string("moveFile"))) {
        return std::vector<std::string>{std::string("(string,string,ref<string>)=>boolean"), std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("moveFileAsync"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("moveFileUntil"))) {
        return std::vector<std::string>{std::string("(string,string,number,CancellationToken)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("normalizePath"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("numberToString"))) {
        return std::vector<std::string>{std::string("(number)=>string")};
    }
    if ((key == std::string("openFileReader"))) {
        return std::vector<std::string>{std::string("(string)=>FileReader")};
    }
    if ((key == std::string("pathDirectory"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("print"))) {
        return std::vector<std::string>{std::string("()=>void")};
    }
    if ((key == std::string("printError"))) {
        return std::vector<std::string>{std::string("()=>void")};
    }
    if ((key == std::string("readFile"))) {
        return std::vector<std::string>{std::string("(string,ref<string>,ref<string>)=>boolean"), std::string("(string)=>Result<string,string>")};
    }
    if ((key == std::string("readFileAsync"))) {
        return std::vector<std::string>{std::string("(string)=>Promise<Result<string,string>>")};
    }
    if ((key == std::string("readFileUntil"))) {
        return std::vector<std::string>{std::string("(string,number,CancellationToken)=>Promise<Result<string,string>>")};
    }
    if ((key == std::string("readTcp"))) {
        return std::vector<std::string>{std::string("(TcpConnection,number)=>Promise<Result<string,string>>")};
    }
    if ((key == std::string("readTcpUntil"))) {
        return std::vector<std::string>{std::string("(TcpConnection,number,number,CancellationToken)=>Promise<Result<string,string>>")};
    }
    if ((key == std::string("readTls"))) {
        return std::vector<std::string>{std::string("(TlsConnection,number,number,CancellationToken)=>Promise<Result<string,string>>")};
    }
    if ((key == std::string("removeFile"))) {
        return std::vector<std::string>{std::string("(string,ref<string>)=>boolean"), std::string("(string)=>Result<boolean,string>")};
    }
    if ((key == std::string("removeFileAsync"))) {
        return std::vector<std::string>{std::string("(string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("removeFileUntil"))) {
        return std::vector<std::string>{std::string("(string,number,CancellationToken)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("Request.body"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("Request.method"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("Request.path"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("Request.rawQuery"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("resolveDns"))) {
        return std::vector<std::string>{std::string("(string)=>Promise<string>")};
    }
    if ((key == std::string("resolveImportPath"))) {
        return std::vector<std::string>{std::string("(string,string)=>string")};
    }
    if ((key == std::string("resolveProjectPath"))) {
        return std::vector<std::string>{std::string("(string,string)=>string")};
    }
    if ((key == std::string("Response.header"))) {
        return std::vector<std::string>{std::string("(string,string)=>Response")};
    }
    if ((key == std::string("Response.json"))) {
        return std::vector<std::string>{std::string("(string)=>Response")};
    }
    if ((key == std::string("Response.send"))) {
        return std::vector<std::string>{std::string("(string)=>Response")};
    }
    if ((key == std::string("Response.status"))) {
        return std::vector<std::string>{std::string("(number)=>Response")};
    }
    if ((key == std::string("Server.delete"))) {
        return std::vector<std::string>{std::string("(string,(Request,Response)=>void)=>void")};
    }
    if ((key == std::string("Server.get"))) {
        return std::vector<std::string>{std::string("(string,(Request,Response)=>void)=>void")};
    }
    if ((key == std::string("Server.listen"))) {
        return std::vector<std::string>{std::string("(number)=>void"), std::string("(string,number)=>void")};
    }
    if ((key == std::string("Server.patch"))) {
        return std::vector<std::string>{std::string("(string,(Request,Response)=>void)=>void")};
    }
    if ((key == std::string("Server.post"))) {
        return std::vector<std::string>{std::string("(string,(Request,Response)=>void)=>void")};
    }
    if ((key == std::string("Server.put"))) {
        return std::vector<std::string>{std::string("(string,(Request,Response)=>void)=>void")};
    }
    if ((key == std::string("setInterval"))) {
        return std::vector<std::string>{std::string("(()=>void,number)=>Timer")};
    }
    if ((key == std::string("setTimeout"))) {
        return std::vector<std::string>{std::string("(()=>void,number)=>Timer")};
    }
    if ((key == std::string("sleep"))) {
        return std::vector<std::string>{std::string("(number)=>Promise<void>")};
    }
    if ((key == std::string("spawn"))) {
        return std::vector<std::string>{std::string("(Promise<void>)=>void")};
    }
    if ((key == std::string("startsWith"))) {
        return std::vector<std::string>{std::string("(string,string)=>boolean")};
    }
    if ((key == std::string("stopLoop"))) {
        return std::vector<std::string>{std::string("()=>void")};
    }
    if ((key == std::string("string.charAt"))) {
        return std::vector<std::string>{std::string("(number)=>string")};
    }
    if ((key == std::string("string.charCodeAt"))) {
        return std::vector<std::string>{std::string("(number)=>number")};
    }
    if ((key == std::string("string.endsWith"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("string.includes"))) {
        return std::vector<std::string>{std::string("(string,number)=>boolean"), std::string("(string)=>boolean")};
    }
    if ((key == std::string("string.indexOf"))) {
        return std::vector<std::string>{std::string("(string,number)=>number")};
    }
    if ((key == std::string("string.lastIndexOf"))) {
        return std::vector<std::string>{std::string("(string)=>number")};
    }
    if ((key == std::string("string.localeCompare"))) {
        return std::vector<std::string>{std::string("(string)=>number")};
    }
    if ((key == std::string("string.padEnd"))) {
        return std::vector<std::string>{std::string("(number,string)=>string")};
    }
    if ((key == std::string("string.padStart"))) {
        return std::vector<std::string>{std::string("(number,string)=>string")};
    }
    if ((key == std::string("string.repeat"))) {
        return std::vector<std::string>{std::string("(number)=>string")};
    }
    if ((key == std::string("string.replace"))) {
        return std::vector<std::string>{std::string("(string,string)=>string")};
    }
    if ((key == std::string("string.replaceAll"))) {
        return std::vector<std::string>{std::string("(string,string)=>string")};
    }
    if ((key == std::string("string.slice"))) {
        return std::vector<std::string>{std::string("(number,number)=>string")};
    }
    if ((key == std::string("string.split"))) {
        return std::vector<std::string>{std::string("(string)=>string[]")};
    }
    if ((key == std::string("string.startsWith"))) {
        return std::vector<std::string>{std::string("(string)=>boolean")};
    }
    if ((key == std::string("string.substr"))) {
        return std::vector<std::string>{std::string("(number,number)=>string")};
    }
    if ((key == std::string("string.substring"))) {
        return std::vector<std::string>{std::string("(number,number)=>string")};
    }
    if ((key == std::string("string.toLowerCase"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("string.toString"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("string.toUpperCase"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("string.trim"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("string.trimEnd"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("string.trimStart"))) {
        return std::vector<std::string>{std::string("()=>string")};
    }
    if ((key == std::string("substring"))) {
        return std::vector<std::string>{std::string("(string,number,number)=>string")};
    }
    if ((key == std::string("syntaxTreeJson"))) {
        return std::vector<std::string>{std::string("(string,ref<string>,ref<string>)=>boolean")};
    }
    if ((key == std::string("syntaxTreeRecords"))) {
        return std::vector<std::string>{std::string("(string,ref<string>,ref<string>)=>boolean")};
    }
    if ((key == std::string("tcpAccept"))) {
        return std::vector<std::string>{std::string("(number)=>number")};
    }
    if ((key == std::string("tcpClose"))) {
        return std::vector<std::string>{std::string("(number)=>void")};
    }
    if ((key == std::string("tcpConnect"))) {
        return std::vector<std::string>{std::string("(string,number)=>number")};
    }
    if ((key == std::string("tcpListen"))) {
        return std::vector<std::string>{std::string("(string,number)=>number")};
    }
    if ((key == std::string("tcpRead"))) {
        return std::vector<std::string>{std::string("(number,number)=>string")};
    }
    if ((key == std::string("tcpWrite"))) {
        return std::vector<std::string>{std::string("(number,string)=>boolean")};
    }
    if ((key == std::string("Timer.valid"))) {
        return std::vector<std::string>{std::string("()=>boolean")};
    }
    if ((key == std::string("trim"))) {
        return std::vector<std::string>{std::string("(string)=>string")};
    }
    if ((key == std::string("unwatchFs"))) {
        return std::vector<std::string>{std::string("(FsWatcher)=>void")};
    }
    if ((key == std::string("validateSyntax"))) {
        return std::vector<std::string>{std::string("(string,ref<string>)=>boolean")};
    }
    if ((key == std::string("watchFs"))) {
        return std::vector<std::string>{std::string("(string,(FsEvent)=>void,boolean)=>FsWatcher")};
    }
    if ((key == std::string("write"))) {
        return std::vector<std::string>{std::string("()=>void")};
    }
    if ((key == std::string("writeError"))) {
        return std::vector<std::string>{std::string("()=>void")};
    }
    if ((key == std::string("writeFile"))) {
        return std::vector<std::string>{std::string("(string,string,ref<string>)=>boolean"), std::string("(string,string)=>Result<boolean,string>")};
    }
    if ((key == std::string("writeFileAsync"))) {
        return std::vector<std::string>{std::string("(string,string)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("writeFileUntil"))) {
        return std::vector<std::string>{std::string("(string,string,number,CancellationToken)=>Promise<Result<boolean,string>>")};
    }
    if ((key == std::string("writeTcp"))) {
        return std::vector<std::string>{std::string("(TcpConnection,string)=>Promise<Result<number,string>>")};
    }
    if ((key == std::string("writeTcpUntil"))) {
        return std::vector<std::string>{std::string("(TcpConnection,string,number,CancellationToken)=>Promise<Result<number,string>>")};
    }
    if ((key == std::string("writeTls"))) {
        return std::vector<std::string>{std::string("(TlsConnection,string,number,CancellationToken)=>Promise<Result<number,string>>")};
    }
    return std::vector<std::string>();
}

std::vector<std::string> nativeBuiltinNames() {
    return std::vector<std::string>{std::string("acceptTcp"), std::string("acceptTcpUntil"), std::string("acceptTls"), std::string("appendFile"), std::string("appendFileAsync"), std::string("appendFileUntil"), std::string("argument"), std::string("argumentCount"), std::string("asyncIoUringRead"), std::string("asyncIoUringWrite"), std::string("cancel"), std::string("cancelTimer"), std::string("cancellationToken"), std::string("charAt"), std::string("clearError"), std::string("closeTcp"), std::string("closeTls"), std::string("compileCpp"), std::string("compilerRoot"), std::string("comptime"), std::string("copyFile"), std::string("copyFileAsync"), std::string("copyFileUntil"), std::string("createCancellation"), std::string("createTlsServer"), std::string("ensureParentDirectory"), std::string("err"), std::string("estaticAstRecords"), std::string("estaticTypedAstJson"), std::string("estaticTypedAstRecords"), std::string("etsNetSyncEcho"), std::string("etsNetSyncLarge"), std::string("exitProcess"), std::string("fail"), std::string("fileAppend"), std::string("fileCopy"), std::string("fileExists"), std::string("fileExistsAsync"), std::string("fileMove"), std::string("fileRead"), std::string("fileRemove"), std::string("fileWrite"), std::string("hasError"), std::string("indexOf"), std::string("ioUringAvailable"), std::string("ioUringRead"), std::string("ioUringWrite"), std::string("isCancelled"), std::string("jsonEscape"), std::string("length"), std::string("lineAt"), std::string("lineCount"), std::string("listenTcp"), std::string("moveFile"), std::string("moveFileAsync"), std::string("moveFileUntil"), std::string("normalizePath"), std::string("numberToString"), std::string("ok"), std::string("openFileReader"), std::string("optionalAndThen"), std::string("optionalMap"), std::string("pathDirectory"), std::string("print"), std::string("printError"), std::string("promiseAll"), std::string("promiseRace"), std::string("readFile"), std::string("readFileAsync"), std::string("readFileUntil"), std::string("readTcp"), std::string("readTcpUntil"), std::string("readTls"), std::string("removeFile"), std::string("removeFileAsync"), std::string("removeFileUntil"), std::string("resolveDns"), std::string("resolveImportPath"), std::string("resolveProjectPath"), std::string("retry"), std::string("setInterval"), std::string("setTimeout"), std::string("sleep"), std::string("spawn"), std::string("startsWith"), std::string("stopLoop"), std::string("substring"), std::string("syntaxTreeJson"), std::string("syntaxTreeRecords"), std::string("tcpAccept"), std::string("tcpClose"), std::string("tcpConnect"), std::string("tcpListen"), std::string("tcpRead"), std::string("tcpWrite"), std::string("timeout"), std::string("trim"), std::string("unwatchFs"), std::string("validateSyntax"), std::string("watchFs"), std::string("write"), std::string("writeError"), std::string("writeFile"), std::string("writeFileAsync"), std::string("writeFileUntil"), std::string("writeTcp"), std::string("writeTcpUntil"), std::string("writeTls")};
}

std::vector<std::string> nativeBuiltinTypes() {
    return std::vector<std::string>{std::string("FsEvent"), std::string("FsWatcher"), std::string("HttpClientResponse"), std::string("Promise"), std::string("Request"), std::string("Response"), std::string("Server"), std::string("Timer")};
}

void ets_init_bootstrap_frontend_builtins_4364c337() {
}
