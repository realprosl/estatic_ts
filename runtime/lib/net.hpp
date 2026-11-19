// Soporte en C++ de estatic:net (#292): reutiliza runtime/ets_net.hpp
// (listen/accept/read/write con el bucle de eventos) y añade connect async.
#pragma once
#include <cerrno>
#include <cmath>
#include <netdb.h>
#include <string>
#include <sys/socket.h>
#include "runtime/ets_net.hpp"

namespace ets_net_lib {

inline ets::Result<ets::TcpListener> listen(double port, std::string host) { return ets::listenTcp(host, port); }
inline ets::Task<ets::Result<ets::TcpConnection>> accept(ets::TcpListener listener) { return ets::acceptTcp(std::move(listener)); }
inline ets::Task<ets::Result<std::string>> read(ets::TcpConnection connection, double bytes) { return ets::readTcp(std::move(connection), bytes); }
inline ets::Task<ets::Result<double>> write(ets::TcpConnection connection, std::string data) { return ets::writeTcp(std::move(connection), std::move(data)); }
inline void closeListener(ets::TcpListener listener) { ets::closeTcp(listener); }
inline void closeConnection(ets::TcpConnection connection) { ets::closeTcp(connection); }

// connect async: socket no bloqueante, connect y espera a poder escribir.
inline ets::Task<ets::Result<ets::TcpConnection>> connect(double requestedPort, std::string host) {
    using R = ets::Result<ets::TcpConnection>;
    if (requestedPort < 1 || requestedPort > 65535 || std::floor(requestedPort) != requestedPort) co_return R::failure("El puerto TCP debe ser un entero entre 1 y 65535");
    addrinfo hints{}; hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM;
    addrinfo* addresses = nullptr;
    const std::string port = std::to_string(static_cast<unsigned short>(requestedPort));
    const int lookup = ::getaddrinfo(host.c_str(), port.c_str(), &hints, &addresses);
    if (lookup != 0) co_return R::failure(std::string("No se puede resolver la dirección: ") + ::gai_strerror(lookup));
    std::string last = "No se puede conectar";
    for (addrinfo* address = addresses; address; address = address->ai_next) {
        const int fd = ets::socketNonBlocking(address->ai_family, address->ai_socktype, address->ai_protocol);
        if (fd < 0) continue;
        if (::connect(fd, address->ai_addr, address->ai_addrlen) == 0) { ::freeaddrinfo(addresses); co_return R::success(ets::TcpConnection{fd}); }
        if (errno == EINPROGRESS) {
            co_await ets::NetFdAwaiter{fd, POLLOUT};
            int error = 0; socklen_t length = sizeof(error);
            if (::getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length) == 0 && error == 0) { ::freeaddrinfo(addresses); co_return R::success(ets::TcpConnection{fd}); }
            errno = error;
        }
        last = ets::socketError("No se puede conectar");
        ::close(fd);
    }
    ::freeaddrinfo(addresses);
    co_return R::failure(last);
}

}  // namespace ets_net_lib
