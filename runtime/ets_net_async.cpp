// Corrutinas de runtime/ets_net.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_net.hpp"
#include "runtime/ets_async.hpp"
#include "runtime/ets_buffer_pool.hpp"
#include <cerrno>
#include <cmath>
#include <cstring>
#include <fcntl.h>
#include <memory>
#include <netdb.h>
#include <poll.h>
#include <string>
#include <sys/socket.h>
#include <unistd.h>
#include "runtime/ets_net_libuv_api.hpp"
namespace ets {

ETS_API Task<Result<TcpConnection>> acceptTcp(TcpListener listener) {
    if (!listener.valid()) co_return Result<TcpConnection>::failure("Listener TCP cerrado");
    for (;;) {
        // V26: acceptNonBlocking = accept + O_NONBLOCK en 1 syscall.
        const int client = acceptNonBlocking(listener.fd());
        if (client >= 0) co_return Result<TcpConnection>::success(TcpConnection{client});
        if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) co_return Result<TcpConnection>::failure(socketError("Error aceptando conexión"));
        if (errno == EINTR) continue;
        co_await NetFdAwaiter{listener.fd(), POLLIN};
    }
}

ETS_API Task<Result<std::string>> readTcp(TcpConnection connection, double requestedBytes) {
    if (!connection.valid()) co_return Result<std::string>::failure("Conexión TCP cerrada");
    std::size_t size = requestedBytes <= 0 ? 1 : static_cast<std::size_t>(requestedBytes);
    if (size > 1024 * 1024) size = 1024 * 1024;
    // V26: buffer pool reutilizable en vez de alocar fresh cada vez.
    // NOTA: capacity >= size, y recv escribe hasta `capacity` bytes. El
    // resultado final es un std::string del tamano exacto leido; el
    // buffer del pool se devuelve al pool (no se transfiere al caller,
    // porque el caller recibe por valor y debe poder mantener el string
    // tras la siguiente llamada a readTcp).
    std::string buffer = ets::BufferPool::instance().acquire(size);
    const std::size_t capacity = buffer.capacity();
    for (;;) {
        const ssize_t received = ::recv(connection.fd(), buffer.data(), capacity, 0);
        if (received >= 0) {
            std::string result(received, '\0');
            std::memcpy(result.data(), buffer.data(), static_cast<std::size_t>(received));
            ets::BufferPool::instance().release(std::move(buffer));
            co_return Result<std::string>::success(std::move(result));
        }
        if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
            ets::BufferPool::instance().release(std::move(buffer));
            co_return Result<std::string>::failure(socketError("Error leyendo conexión"));
        }
        if (errno == EINTR) continue;
        co_await NetFdAwaiter{connection.fd(), POLLIN};
    }
}

ETS_API Task<Result<double>> writeTcp(TcpConnection connection, std::string data) {
    if (!connection.valid()) co_return Result<double>::failure("Conexión TCP cerrada");
    std::size_t written = 0;
    while (written < data.size()) {
        const ssize_t sent = ::send(connection.fd(), data.data() + written, data.size() - written, MSG_NOSIGNAL);
        if (sent > 0) { written += static_cast<std::size_t>(sent); continue; }
        if (sent < 0 && errno == EINTR) continue;
        if (sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) { co_await NetFdAwaiter{connection.fd(), POLLOUT}; continue; }
        co_return Result<double>::failure(socketError("Error escribiendo conexión"));
    }
    co_return Result<double>::success(static_cast<double>(written));
}

ETS_API Task<Result<TcpConnection>> acceptTcpUntil(TcpListener listener, double timeoutMilliseconds, CancellationToken token) {
    if (!listener.valid()) co_return Result<TcpConnection>::failure("Listener TCP cerrado");
    const auto deadline = networkDeadline(timeoutMilliseconds);
    for (;;) {
        // V26: acceptNonBlocking = accept + O_NONBLOCK en 1 syscall.
        const int client = acceptNonBlocking(listener.fd());
        if (client >= 0) co_return Result<TcpConnection>::success(TcpConnection{client});
        if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) co_return Result<TcpConnection>::failure(socketError("Error aceptando conexión"));
        if (errno == EINTR) continue;
        const auto waited = co_await NetCancellableFdAwaiter{listener.fd(), POLLIN, deadline, token};
        if (waited != WaitResult::ready) co_return Result<TcpConnection>::failure(waitError(waited, "Accept TCP"));
    }
}

ETS_API Task<Result<std::string>> readTcpUntil(TcpConnection connection, double requestedBytes, double timeoutMilliseconds, CancellationToken token) {
    if (!connection.valid()) co_return Result<std::string>::failure("Conexión TCP cerrada");
    std::size_t size = requestedBytes <= 0 ? 1 : static_cast<std::size_t>(requestedBytes);
    if (size > 1024 * 1024) size = 1024 * 1024;
    std::string buffer(size, '\0');
    const auto deadline = networkDeadline(timeoutMilliseconds);
    for (;;) {
        const ssize_t received = ::recv(connection.fd(), buffer.data(), buffer.size(), 0);
        if (received >= 0) { buffer.resize(static_cast<std::size_t>(received)); co_return Result<std::string>::success(std::move(buffer)); }
        if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) co_return Result<std::string>::failure(socketError("Error leyendo conexión"));
        if (errno == EINTR) continue;
        const auto waited = co_await NetCancellableFdAwaiter{connection.fd(), POLLIN, deadline, token};
        if (waited != WaitResult::ready) co_return Result<std::string>::failure(waitError(waited, "Lectura TCP"));
    }
}

ETS_API Task<Result<double>> writeTcpUntil(TcpConnection connection, std::string data, double timeoutMilliseconds, CancellationToken token) {
    if (!connection.valid()) co_return Result<double>::failure("Conexión TCP cerrada");
    std::size_t written = 0;
    const auto deadline = networkDeadline(timeoutMilliseconds);
    while (written < data.size()) {
        const ssize_t sent = ::send(connection.fd(), data.data() + written, data.size() - written, MSG_NOSIGNAL);
        if (sent > 0) { written += static_cast<std::size_t>(sent); continue; }
        if (sent < 0 && errno == EINTR) continue;
        if (sent < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            const auto waited = co_await NetCancellableFdAwaiter{connection.fd(), POLLOUT, deadline, token};
            if (waited != WaitResult::ready) co_return Result<double>::failure(waitError(waited, "Escritura TCP"));
            continue;
        }
        co_return Result<double>::failure(socketError("Error escribiendo conexión"));
    }
    co_return Result<double>::success(static_cast<double>(written));
}
} // namespace ets
