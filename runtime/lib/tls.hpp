// Soporte en C++ de estatic:tls (#292): servidor TLS de runtime/ets_tls.hpp
// (OpenSSL sobre el bucle de eventos). Las esperas sin límite usan un plazo
// muy largo; la cancelación es la de un token vacío.
#pragma once
#include <string>
#include "runtime/ets_tls.hpp"

namespace ets_tls_lib {
inline ets::Result<ets::TlsContext> context(std::string certificate, std::string key) { return ets::createTlsServer(certificate, key); }
inline ets::Task<ets::Result<ets::TlsConnection>> accept(ets::TcpListener listener, ets::TlsContext context, double timeout) {
    return ets::acceptTls(std::move(listener), std::move(context), timeout, ets::CancellationToken{});
}
inline ets::Task<ets::Result<std::string>> read(ets::TlsConnection connection, double bytes, double timeout) {
    return ets::readTls(std::move(connection), bytes, timeout, ets::CancellationToken{});
}
inline ets::Task<ets::Result<double>> write(ets::TlsConnection connection, std::string data, double timeout) {
    return ets::writeTls(std::move(connection), std::move(data), timeout, ets::CancellationToken{});
}
inline void close(ets::TlsConnection connection) { ets::closeTls(connection); }
inline void closeListener(ets::TcpListener listener) { ets::closeTcp(listener); }
inline ets::Result<ets::TcpListener> listen(double port, std::string host) { return ets::listenTcp(host, port); }
}  // namespace ets_tls_lib
