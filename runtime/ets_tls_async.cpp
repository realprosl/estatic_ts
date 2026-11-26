// Corrutinas de runtime/ets_tls.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_tls.hpp"
#include "runtime/ets_net.hpp"
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <memory>
#include <string>
namespace ets {

ETS_API Task<Result<TlsConnection>> acceptTls(TcpListener listener, TlsContext context, double timeoutMilliseconds, CancellationToken token) {
    const auto accepted = co_await acceptTcpUntil(listener, timeoutMilliseconds, token);
    if (!accepted.isOk()) co_return Result<TlsConnection>::failure(accepted.error());
    TcpConnection connection = accepted.value();
    SSL* ssl = ::SSL_new(context.native());
    if (!ssl) co_return Result<TlsConnection>::failure(tlsError("No se puede crear la sesión TLS"));
    ::SSL_set_fd(ssl, connection.fd());
    ::SSL_set_accept_state(ssl);
    const auto deadline = networkDeadline(timeoutMilliseconds);
    for (;;) {
        const int status = ::SSL_accept(ssl);
        if (status == 1) co_return Result<TlsConnection>::success(TlsConnection{ssl, std::move(connection)});
        const int error = ::SSL_get_error(ssl, status);
        if (error != SSL_ERROR_WANT_READ && error != SSL_ERROR_WANT_WRITE) {
            const auto message = tlsError("Handshake TLS fallido"); ::SSL_free(ssl); co_return Result<TlsConnection>::failure(message);
        }
        const short events = error == SSL_ERROR_WANT_READ ? POLLIN : POLLOUT;
        const auto waited = co_await NetCancellableFdAwaiter{connection.fd(), events, deadline, token};
        if (waited != WaitResult::ready) {
            const auto message = waitError(waited, "Handshake TLS"); ::SSL_free(ssl); co_return Result<TlsConnection>::failure(message);
        }
    }
}

ETS_API Task<Result<std::string>> readTls(TlsConnection connection, double requestedBytes, double timeoutMilliseconds, CancellationToken token) {
    if (!connection.valid()) co_return Result<std::string>::failure("Conexión TLS cerrada");
    std::size_t size = requestedBytes <= 0 ? 1 : static_cast<std::size_t>(requestedBytes);
    if (size > 1024 * 1024) size = 1024 * 1024;
    std::string buffer(size, '\0');
    const auto deadline = networkDeadline(timeoutMilliseconds);
    for (;;) {
        const int received = ::SSL_read(connection.native(), buffer.data(), static_cast<int>(buffer.size()));
        if (received > 0) { buffer.resize(static_cast<std::size_t>(received)); co_return Result<std::string>::success(std::move(buffer)); }
        const int error = ::SSL_get_error(connection.native(), received);
        if (error == SSL_ERROR_ZERO_RETURN) { buffer.clear(); co_return Result<std::string>::success(std::move(buffer)); }
        if (error != SSL_ERROR_WANT_READ && error != SSL_ERROR_WANT_WRITE) co_return Result<std::string>::failure(tlsError("Lectura TLS fallida"));
        const short events = static_cast<short>(error == SSL_ERROR_WANT_READ ? POLLIN : POLLOUT);
        const auto waited = co_await NetCancellableFdAwaiter{connection.fd(), events, deadline, token};
        if (waited != WaitResult::ready) co_return Result<std::string>::failure(waitError(waited, "Lectura TLS"));
    }
}

ETS_API Task<Result<double>> writeTls(TlsConnection connection, std::string data, double timeoutMilliseconds, CancellationToken token) {
    if (!connection.valid()) co_return Result<double>::failure("Conexión TLS cerrada");
    std::size_t offset = 0;
    const auto deadline = networkDeadline(timeoutMilliseconds);
    while (offset < data.size()) {
        const int written = ::SSL_write(connection.native(), data.data() + offset, static_cast<int>(data.size() - offset));
        if (written > 0) { offset += static_cast<std::size_t>(written); continue; }
        const int error = ::SSL_get_error(connection.native(), written);
        if (error != SSL_ERROR_WANT_READ && error != SSL_ERROR_WANT_WRITE) co_return Result<double>::failure(tlsError("Escritura TLS fallida"));
        const short events = static_cast<short>(error == SSL_ERROR_WANT_READ ? POLLIN : POLLOUT);
        const auto waited = co_await NetCancellableFdAwaiter{connection.fd(), events, deadline, token};
        if (waited != WaitResult::ready) co_return Result<double>::failure(waitError(waited, "Escritura TLS"));
    }
    co_return Result<double>::success(static_cast<double>(offset));
}
} // namespace ets
