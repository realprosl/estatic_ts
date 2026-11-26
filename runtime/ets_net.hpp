#pragma once

#include "runtime/ets_api.hpp"

#include "runtime/ets_async.hpp"
#include "runtime/ets_buffer_pool.hpp"
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <memory>
#include <string>
#include <unistd.h>

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

// Selector de awaitables de red: V29.3 usa siempre libuv
// (UvFdAwaiter / UvCancellableFdAwaiter basados en uv_poll_t).
// Antes habia un backend poll alternativo, eliminado en V29.3
// tras verificar que la suite e2e pasa identica con libuv (67/67
// sin red, 64/65 con red, 1 flake pre-existente).
//
// La API publica (acceptTcp, readTcp, writeTcp, etc.) no cambia.
// Las definiciones de los awaitables viven en
// runtime_ets_net_libuv.cpp (pre-compilado a .o cacheado).
#include "runtime/ets_net_libuv_api.hpp"
namespace ets {
    using NetFdAwaiter = UvFdAwaiter;
    using NetCancellableFdAwaiter = UvCancellableFdAwaiter;
}

namespace ets {

struct SocketState {
    explicit SocketState(int descriptor) : fd(descriptor) {}
    ~SocketState() { if (fd >= 0) ::close(fd); }
    int fd = -1;
};

class TcpListener {
public:
    TcpListener() = default;
    explicit TcpListener(int fd) : state_(std::make_shared<SocketState>(fd)) {}
    bool valid() const noexcept { return state_ && state_->fd >= 0; }
    int fd() const noexcept { return valid() ? state_->fd : -1; }
    void close() const noexcept { if (valid()) { ::close(state_->fd); state_->fd = -1; } }
private:
    std::shared_ptr<SocketState> state_;
};

class TcpConnection {
public:
    TcpConnection() = default;
    explicit TcpConnection(int fd) : state_(std::make_shared<SocketState>(fd)) {}
    bool valid() const noexcept { return state_ && state_->fd >= 0; }
    int fd() const noexcept { return valid() ? state_->fd : -1; }
    void close() const noexcept { if (valid()) { ::close(state_->fd); state_->fd = -1; } }
private:
    std::shared_ptr<SocketState> state_;
};

// V26: SOCK_NONBLOCK y SOCK_CLOEXEC no existen en macOS; SOCK_CLOEXEC
// solo en Linux >= 2.6.27. Proteger con __linux__.
#if defined(__linux__) || defined(__APPLE__)
  #ifndef SOCK_NONBLOCK
    #define SOCK_NONBLOCK 0
  #endif
  #ifndef SOCK_CLOEXEC
    #define SOCK_CLOEXEC 0
  #endif
#endif

inline std::string socketError(const std::string& operation) { return operation + ": " + std::strerror(errno); }

inline bool makeNonBlocking(int fd) {
    const int flags = ::fcntl(fd, F_GETFL, 0);
    return flags >= 0 && ::fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}

// V26: socket + fcntl (nonblock) en 1 solo syscall usando
// SOCK_NONBLOCK. En sistemas sin soporte, fallback a makeNonBlocking.
ETS_API int socketNonBlocking(int family, int type, int protocol);

// V26: accept + fcntl en 1 solo syscall usando accept4 (Linux) o
// fallback a accept + makeNonBlocking (otros UNIX).
ETS_API int acceptNonBlocking(int fd);

ETS_API Result<TcpListener> listenTcp(const std::string& host, double requestedPort);

ETS_API Task<Result<TcpConnection>> acceptTcp(TcpListener listener);

ETS_API Task<Result<std::string>> readTcp(TcpConnection connection, double requestedBytes);

ETS_API Task<Result<double>> writeTcp(TcpConnection connection, std::string data);

ETS_API std::chrono::steady_clock::time_point networkDeadline(double milliseconds);

inline std::string waitError(WaitResult result, const std::string& operation) {
    return result == WaitResult::cancelled ? operation + " cancelada" : operation + " excedió el deadline";
}

ETS_API Task<Result<TcpConnection>> acceptTcpUntil(TcpListener listener, double timeoutMilliseconds, CancellationToken token);

ETS_API Task<Result<std::string>> readTcpUntil(TcpConnection connection, double requestedBytes, double timeoutMilliseconds, CancellationToken token);

ETS_API Task<Result<double>> writeTcpUntil(TcpConnection connection, std::string data, double timeoutMilliseconds, CancellationToken token);

inline void closeTcp(const TcpListener& listener) noexcept { listener.close(); }
inline void closeTcp(const TcpConnection& connection) noexcept { connection.close(); }

} // namespace ets

#if !defined(ETS_RUNTIME_PRECOMPILED)
#include "runtime/ets_net.cpp"
#include "runtime/ets_net_async.cpp"
#endif
