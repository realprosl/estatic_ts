// Implementación de runtime/ets_net_sync.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_net_sync.hpp"
#include <arpa/inet.h>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <netinet/in.h>
#include <string>
#include <sys/socket.h>
#include <sys/types.h>
#include <thread>
#include <unistd.h>
namespace ets::net_sync {

ETS_API int tcpListenSync(const std::string& host, double port) {
    const int server_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) return -1;
    int opt = 1;
    ::setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<uint16_t>(port));
    if (host == "0.0.0.0" || host.empty()) {
        address.sin_addr.s_addr = htonl(INADDR_ANY);
    } else if (::inet_pton(AF_INET, host.c_str(), &address.sin_addr) <= 0) {
        ::close(server_fd);
        return -1;
    }
    if (::bind(server_fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
        ::close(server_fd);
        return -1;
    }
    if (::listen(server_fd, 1) < 0) {
        ::close(server_fd);
        return -1;
    }
    return server_fd;
}

ETS_API int tcpAcceptSync(int listener_fd) {
    sockaddr_in address{};
    socklen_t addrlen = sizeof(address);
    const int client_fd = ::accept(listener_fd, reinterpret_cast<sockaddr*>(&address), &addrlen);
    return client_fd;
}

ETS_API int tcpConnectSync(const std::string& host, double port) {
    const int sock_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (sock_fd < 0) return -1;
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<uint16_t>(port));
    if (::inet_pton(AF_INET, host.c_str(), &address.sin_addr) <= 0) {
        ::close(sock_fd);
        return -1;
    }
    if (::connect(sock_fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
        ::close(sock_fd);
        return -1;
    }
    return sock_fd;
}

ETS_API std::string tcpReadSync(int fd, double max_bytes) {
    std::string buffer(static_cast<std::size_t>(max_bytes), '\0');
    const ssize_t received = ets::net_sync::posix::rawRead(fd, buffer.data(), buffer.size());
    if (received <= 0) return std::string();
    buffer.resize(static_cast<std::size_t>(received));
    return buffer;
}

ETS_API bool tcpWriteSync(int fd, const std::string& data) {
    std::size_t written = 0;
    while (written < data.size()) {
        const ssize_t sent = ets::net_sync::posix::rawWrite(fd, const_cast<char*>(data.data()) + written, data.size() - written);
        if (sent > 0) { written += static_cast<std::size_t>(sent); continue; }
        if (sent < 0 && errno == EINTR) continue;
        return false;
    }
    return true;
}
} // namespace ets::net_sync

ETS_API std::string etsNetSyncEcho(const std::string& host, double port, const std::string& request, double max_bytes) {
    const int server_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) return std::string();
    int opt = 1;
    ::setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<uint16_t>(port));
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    if (::bind(server_fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) { ::close(server_fd); return std::string(); }
    if (::listen(server_fd, 1) < 0) { ::close(server_fd); return std::string(); }

    std::thread server_thread([server_fd, max_bytes]() {
        sockaddr_in client_addr{};
        socklen_t addrlen = sizeof(client_addr);
        const int client_fd = ::accept(server_fd, reinterpret_cast<sockaddr*>(&client_addr), &addrlen);
        if (client_fd < 0) { ::close(server_fd); return; }
        // Lee request (lo descarta) y responde "world".
        char buf[256];
        ets::net_sync::posix::rawRead(client_fd, buf, sizeof(buf));
        const std::string response = "world";
        ets::net_sync::posix::rawWrite(client_fd, response.data(), response.size());
        ::close(client_fd);
        ::close(server_fd);
    });
    server_thread.detach();

    // Cliente: conecta y envía request.
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    const int client_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (client_fd < 0) return std::string();
    sockaddr_in server_addr{};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(static_cast<uint16_t>(port));
    ::inet_pton(AF_INET, host.c_str(), &server_addr.sin_addr);
    if (::connect(client_fd, reinterpret_cast<sockaddr*>(&server_addr), sizeof(server_addr)) < 0) { ::close(client_fd); return std::string(); }
    ets::net_sync::posix::rawWrite(client_fd, request.data(), request.size());
    std::string response(static_cast<std::size_t>(max_bytes), '\0');
    const ssize_t received = ets::net_sync::posix::rawRead(client_fd, response.data(), response.size());
    ::close(client_fd);
    if (received <= 0) return std::string();
    response.resize(static_cast<std::size_t>(received));
    return response;
}

ETS_API std::string etsNetSyncLarge(const std::string& host, double port, double payload_bytes) {
    const int server_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) return std::string();
    int opt = 1;
    ::setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<uint16_t>(port));
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    if (::bind(server_fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) { ::close(server_fd); return std::string(); }
    if (::listen(server_fd, 1) < 0) { ::close(server_fd); return std::string(); }

    std::thread server_thread([server_fd, payload_bytes]() {
        sockaddr_in client_addr{};
        socklen_t addrlen = sizeof(client_addr);
        const int client_fd = ::accept(server_fd, reinterpret_cast<sockaddr*>(&client_addr), &addrlen);
        if (client_fd < 0) { ::close(server_fd); return; }
        // Lee request (lo descarta) y responde con N bytes 'A'.
        char buf[256];
        ets::net_sync::posix::rawRead(client_fd, buf, sizeof(buf));
        const std::size_t n = static_cast<std::size_t>(payload_bytes);
        std::string response(n, 'A');
        ets::net_sync::posix::rawWrite(client_fd, response.data(), response.size());
        ::close(client_fd);
        ::close(server_fd);
    });
    server_thread.detach();

    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    const int client_fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (client_fd < 0) return std::string();
    sockaddr_in server_addr{};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(static_cast<uint16_t>(port));
    ::inet_pton(AF_INET, host.c_str(), &server_addr.sin_addr);
    if (::connect(client_fd, reinterpret_cast<sockaddr*>(&server_addr), sizeof(server_addr)) < 0) { ::close(client_fd); return std::string(); }
    const std::string ping = "ping";
    ets::net_sync::posix::rawWrite(client_fd, ping.data(), ping.size());

    // Lee hasta payload_bytes.
    const std::size_t target = static_cast<std::size_t>(payload_bytes);
    std::string response;
    response.reserve(target);
    while (response.size() < target) {
        char buf[8192];
        const ssize_t received = ets::net_sync::posix::rawRead(client_fd, buf, std::min(sizeof(buf), target - response.size()));
        if (received <= 0) break;
        response.append(buf, static_cast<std::size_t>(received));
    }
    ::close(client_fd);
    return response;
}
