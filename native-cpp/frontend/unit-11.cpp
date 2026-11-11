// Generated module. Do not edit.
#include "estatic_common.hpp"

double bindingChild(AstNode node, EdgeRole role) {
    for (const auto& edge : node.edges) {
        if ((edge.role == role)) {
            return edge.node;
        }
    }
    return (-1.0);
}

bool isBindingMember(std::string kind) {
    return ((((((kind == std::string("ClassField")) || (kind == std::string("ClassMethod"))) || (kind == std::string("InterfaceField"))) || (kind == std::string("InterfaceMethod"))) || (kind == std::string("EnumMember"))) || (kind == std::string("UnionVariantBinding")));
}

bool callableBinding(std::string kind) {
    return ((((kind == std::string("FunctionDeclaration")) || (kind == std::string("ArrowFunctionExpression"))) || (kind == std::string("ClassMethod"))) || (kind == std::string("InterfaceMethod")));
}

BindingResult bindProject(ModuleGraph graph) {
    Binder binder = Binder{}.constructor(graph);
    return binder.bind();
}

std::vector<std::string> bindingBuiltinValues() {
    std::vector<std::string> names = std::vector<std::string>{std::string("i8"), std::string("u8"), std::string("i16"), std::string("u16"), std::string("i32"), std::string("u32"), std::string("i64"), std::string("u64"), std::string("f32"), std::string("f64"), std::string("optionalIsPresent"), std::string("optionalValueOr"), std::string("optionalOrElse"), std::string("resultOk"), std::string("resultErr"), std::string("resultIsOk"), std::string("resultValueOr"), std::string("Date"), std::string("FileReader"), std::string("JSON"), std::string("Map"), std::string("Math"), std::string("Optional"), std::string("Promise"), std::string("Result"), std::string("Server"), std::string("Set"), std::string("__noExtend"), std::string("__noThrow"), std::string("acceptTcp"), std::string("acceptTcpUntil"), std::string("acceptTls"), std::string("all"), std::string("appendFile"), std::string("appendFileAsync"), std::string("appendFileUntil"), std::string("argument"), std::string("argumentCount"), std::string("asyncIoUringRead"), std::string("asyncIoUringWrite"), std::string("cancel"), std::string("cancelTimer"), std::string("cancellationToken"), std::string("charAt"), std::string("child_process"), std::string("clearError"), std::string("closeTcp"), std::string("closeTls"), std::string("compileCpp"), std::string("compilerRoot"), std::string("comptime"), std::string("console"), std::string("constRef"), std::string("copyFile"), std::string("copyFileAsync"), std::string("copyFileUntil"), std::string("createCancellation"), std::string("createTlsServer"), std::string("ensureParentDirectory"), std::string("err"), std::string("estaticAstRecords"), std::string("estaticTypedAstJson"), std::string("estaticTypedAstRecords"), std::string("exitProcess"), std::string("fail"), std::string("fileAppend"), std::string("fileCopy"), std::string("fileExists"), std::string("fileExistsAsync"), std::string("fileMove"), std::string("fileRead"), std::string("fileRemove"), std::string("fileWrite"), std::string("fs"), std::string("hasError"), std::string("http"), std::string("indexOf"), std::string("ioUringAvailable"), std::string("ioUringRead"), std::string("ioUringWrite"), std::string("isCancelled"), std::string("jsonArrayGet"), std::string("jsonArrayLength"), std::string("jsonAsBool"), std::string("jsonAsNumber"), std::string("jsonAsString"), std::string("jsonEscape"), std::string("jsonIsArray"), std::string("jsonIsBool"), std::string("jsonIsNull"), std::string("jsonIsNumber"), std::string("jsonIsObject"), std::string("jsonIsString"), std::string("jsonObjectGet"), std::string("length"), std::string("lineAt"), std::string("lineCount"), std::string("listenTcp"), std::string("match"), std::string("move"), std::string("moveFile"), std::string("moveFileAsync"), std::string("moveFileUntil"), std::string("normalizePath"), std::string("numberToString"), std::string("ok"), std::string("openFileReader"), std::string("optionalNone"), std::string("optionalSome"), std::string("otherwise"), std::string("path"), std::string("pathDirectory"), std::string("print"), std::string("printError"), std::string("process"), std::string("promiseAll"), std::string("promiseRace"), std::string("race"), std::string("readFile"), std::string("readFileAsync"), std::string("readFileUntil"), std::string("readTcp"), std::string("readTcpUntil"), std::string("readTls"), std::string("ref"), std::string("removeFile"), std::string("removeFileAsync"), std::string("removeFileUntil"), std::string("resolveDns"), std::string("resolveImportPath"), std::string("resolveProjectPath"), std::string("retry"), std::string("setInterval"), std::string("setTimeout"), std::string("sleep"), std::string("spawn"), std::string("startsWith"), std::string("stopLoop"), std::string("substring"), std::string("syntaxTreeJson"), std::string("syntaxTreeRecords"), std::string("tcpAccept"), std::string("tcpClose"), std::string("tcpConnect"), std::string("tcpListen"), std::string("tcpRead"), std::string("tcpWrite"), std::string("timeout"), std::string("trim"), std::string("unwatchFs"), std::string("validateSyntax"), std::string("watchFs"), std::string("when"), std::string("whenType"), std::string("write"), std::string("writeError"), std::string("writeFile"), std::string("writeFileAsync"), std::string("writeFileUntil"), std::string("writeTcp"), std::string("writeTcpUntil"), std::string("writeTls")};
    for (const auto& name : nativeBuiltinNames()) {
        if ((!ets_includes_vec<std::string>(names, name))) {
            ets_push_vec<std::string>(names, name);
        }
    }
    return names;
}

std::vector<std::string> bindingBuiltinTypes() {
    std::vector<std::string> names = std::vector<std::string>{std::string("Array"), std::string("ArrayLike"), std::string("CancellationSource"), std::string("CancellationToken"), std::string("Console"), std::string("Error"), std::string("FileReader"), std::string("FsEvent"), std::string("FsWatcher"), std::string("HttpClientResponse"), std::string("JsonValue"), std::string("Map"), std::string("MatchCase"), std::string("MatchCaseResult"), std::string("MatchDefaultCase"), std::string("MatchResult"), std::string("MatchTypeCase"), std::string("MatchValueCase"), std::string("NonThrowable"), std::string("Optional"), std::string("Phantom"), std::string("Promise"), std::string("Request"), std::string("Response"), std::string("Result"), std::string("Sealed"), std::string("Server"), std::string("Set"), std::string("StringInstance"), std::string("TcpConnection"), std::string("TcpListener"), std::string("Timer"), std::string("TlsConnection"), std::string("TlsContext"), std::string("boolean"), std::string("constPtr"), std::string("constRef"), std::string("f32"), std::string("f64"), std::string("i16"), std::string("i32"), std::string("i64"), std::string("i8"), std::string("number"), std::string("ptr"), std::string("readonly"), std::string("ref"), std::string("string"), std::string("u16"), std::string("u32"), std::string("u64"), std::string("u8"), std::string("void")};
    for (const auto& name : nativeBuiltinTypes()) {
        if ((!ets_includes_vec<std::string>(names, name))) {
            ets_push_vec<std::string>(names, name);
        }
    }
    return names;
}

void ets_init_bootstrap_binder_binder_a5e8f8bc() {
}
