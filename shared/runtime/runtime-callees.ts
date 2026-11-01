// Shared runtime spellings for both AST and ets-ir-2 C++ backends.
export const fileCalleeMap: Record<string, string> = {
          fileRead:   "etsFsRead",
          fileWrite:  "etsFsWrite",
          fileAppend: "etsFsAppend",
          fileCopy:   "etsFsCopy",
          fileMove:   "etsFsMove",
          fileRemove: "etsFsRemove",
        };
export const regexCalleeMap: Record<string, string> = {
          regex: "::ets::regex",
        };
export const netCalleeMap: Record<string, string> = {
          tcpListen:  "etsNetListen",
          tcpAccept:  "etsNetAccept",
          tcpConnect: "etsNetConnect",
          tcpRead:    "etsNetRead",
          tcpWrite:   "etsNetWrite",
          tcpClose:   "etsNetClose",
        };
export const asyncCalleeMap: Record<string, string> = {
          spawn:               "ets::spawn",
          sleep:               "ets::sleep",
          cancel:              "ets::cancel",
          cancellationToken:   "ets::cancellationToken",
          createCancellation:  "ets::createCancellation",
          isCancelled:         "ets::isCancelled",
          ioUringAvailable:    "ets::ioUringAvailable",
          // V30.4: DNS async sobre uv_getaddrinfo. La funcion toma
          // un host (string) y devuelve Task<string> (= Promise<string>
          // en el dialecto). Definida en runtime/ets_dns.hpp.
          resolveDns:          "ets::resolveDns",
        };
export const etsNetworkCalleeMap: Record<string, string> = {
          listenTcp:      "ets::listenTcp",
          acceptTcp:      "ets::acceptTcp",
          acceptTcpUntil: "ets::acceptTcpUntil",
          readTcp:        "ets::readTcp",
          readTcpUntil:   "ets::readTcpUntil",
          writeTcp:       "ets::writeTcp",
          writeTcpUntil:  "ets::writeTcpUntil",
          closeTcp:       "ets::closeTcp",
          createTlsServer:"ets::createTlsServer",
          acceptTls:      "ets::acceptTls",
          readTls:        "ets::readTls",
          writeTls:       "ets::writeTls",
          closeTls:       "ets::closeTls",
        };
export const resultCalleeMap: Record<string, string> = {
          ok:  "ets::ok",
          err: "ets::err",
        };
