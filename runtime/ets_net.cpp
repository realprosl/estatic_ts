// Implementación de runtime/ets_net.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
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

ETS_API int socketNonBlocking(int family, int type, int protocol) {
#if defined(__linux__)
    return ::socket(family, type | SOCK_NONBLOCK | SOCK_CLOEXEC, protocol);
#else
    const int fd = ::socket(family, type, protocol);
    if (fd >= 0 && !makeNonBlocking(fd)) { ::close(fd); return -1; }
    return fd;
#endif
}

ETS_API int acceptNonBlocking(int fd) {
#if defined(__linux__)
    return ::accept4(fd, nullptr, nullptr, SOCK_NONBLOCK | SOCK_CLOEXEC);
#else
    const int client = ::accept(fd, nullptr, nullptr);
    if (client >= 0 && !makeNonBlocking(client)) { ::close(client); return -1; }
    return client;
#endif
}

ETS_API Result<TcpListener> listenTcp(const std::string& host, double requestedPort) {
    if (requestedPort < 1 || requestedPort > 65535 || std::floor(requestedPort) != requestedPort) return Result<TcpListener>::failure("El puerto TCP debe ser un entero entre 1 y 65535");
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_flags = AI_PASSIVE;
    addrinfo* addresses = nullptr;
    const std::string port = std::to_string(static_cast<unsigned short>(requestedPort));
    const char* node = host.empty() || host == "0.0.0.0" ? nullptr : host.c_str();
    const int lookup = ::getaddrinfo(node, port.c_str(), &hints, &addresses);
    if (lookup != 0) return Result<TcpListener>::failure(std::string("No se puede resolver la dirección: ") + ::gai_strerror(lookup));
    int listener = -1;
    for (addrinfo* address = addresses; address; address = address->ai_next) {
        // V26: socketNonBlocking = socket + SOCK_NONBLOCK en 1 syscall.
        listener = socketNonBlocking(address->ai_family, address->ai_socktype, address->ai_protocol);
        if (listener < 0) continue;
        int reuse = 1;
        ::setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
        if (::bind(listener, address->ai_addr, address->ai_addrlen) == 0 && ::listen(listener, SOMAXCONN) == 0) break;
        ::close(listener);
        listener = -1;
    }
    ::freeaddrinfo(addresses);
    if (listener < 0) return Result<TcpListener>::failure(socketError("No se puede abrir el listener TCP"));
    return Result<TcpListener>::success(TcpListener{listener});
}

ETS_API std::chrono::steady_clock::time_point networkDeadline(double milliseconds) {
    const auto duration = std::chrono::milliseconds(static_cast<long long>(milliseconds < 0 ? 0 : milliseconds));
    return std::chrono::steady_clock::now() + duration;
}
} // namespace ets
