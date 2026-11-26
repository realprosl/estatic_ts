#pragma once

#include "runtime/ets_api.hpp"

#include "runtime/ets_net.hpp"
#include <openssl/ssl.h>
#include <memory>
#include <string>

namespace ets {

ETS_API std::string tlsError(const std::string& operation);

struct TlsContextState {
    explicit TlsContextState(SSL_CTX* value) : context(value) {}
    ~TlsContextState() { if (context) ::SSL_CTX_free(context); }
    SSL_CTX* context = nullptr;
};

class TlsContext {
public:
    TlsContext() = default;
    explicit TlsContext(SSL_CTX* context) : state_(std::make_shared<TlsContextState>(context)) {}
    bool valid() const noexcept { return state_ && state_->context; }
    SSL_CTX* native() const noexcept { return valid() ? state_->context : nullptr; }
private:
    std::shared_ptr<TlsContextState> state_;
};

struct TlsConnectionState {
    TlsConnectionState(SSL* value, TcpConnection socket) : ssl(value), connection(std::move(socket)) {}
    ~TlsConnectionState() { if (ssl) ::SSL_free(ssl); }
    SSL* ssl = nullptr;
    TcpConnection connection;
};

class TlsConnection {
public:
    TlsConnection() = default;
    TlsConnection(SSL* ssl, TcpConnection connection) : state_(std::make_shared<TlsConnectionState>(ssl, std::move(connection))) {}
    bool valid() const noexcept { return state_ && state_->ssl && state_->connection.valid(); }
    SSL* native() const noexcept { return valid() ? state_->ssl : nullptr; }
    int fd() const noexcept { return valid() ? state_->connection.fd() : -1; }
    void close() const noexcept {
        if (!valid()) return;
        ::SSL_shutdown(state_->ssl);
        state_->connection.close();
    }
private:
    std::shared_ptr<TlsConnectionState> state_;
};

ETS_API Result<TlsContext> createTlsServer(const std::string& certificatePath, const std::string& privateKeyPath);

ETS_API Task<Result<TlsConnection>> acceptTls(TcpListener listener, TlsContext context, double timeoutMilliseconds, CancellationToken token);

ETS_API Task<Result<std::string>> readTls(TlsConnection connection, double requestedBytes, double timeoutMilliseconds, CancellationToken token);

ETS_API Task<Result<double>> writeTls(TlsConnection connection, std::string data, double timeoutMilliseconds, CancellationToken token);

inline void closeTls(const TlsConnection& connection) noexcept { connection.close(); }

} // namespace ets

using ets::acceptTls;
using ets::closeTls;
using ets::createTlsServer;
using ets::readTls;
using ets::writeTls;

#if !defined(ETS_RUNTIME_PRECOMPILED)
#include "runtime/ets_tls.cpp"
#include "runtime/ets_tls_async.cpp"
#endif
