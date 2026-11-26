#pragma once

#include "runtime/ets_api.hpp"

// Wrappers síncronos sobre POSIX sockets para los tests E2E de networking
// (Issue #14). Viven en runtime/ets_net_sync.hpp porque el runtime principal
// `ets_net.hpp` usa corutinas + Task<Result<T>> que no encajan en los tests
// E2E síncronos.
//
// Estos wrappers NO son parte del dialecto del usuario — son una capa
// auxiliar para que los tests E2E puedan ejercitar comunicación cliente-
// servidor sin tener que manejar el event loop async.
//
// API:
//   tcpListenSync(host: string, port: number) -> number    (fd del listener, -1 en error)
//   tcpAcceptSync(listenerFd: number) -> number            (fd del cliente, -1 en error)
//   tcpConnectSync(host: string, port: number) -> number   (fd del socket, -1 en error)
//   tcpReadSync(fd: number, maxBytes: number) -> string    ("" en error/disconnect)
//   tcpWriteSync(fd: number, data: string) -> boolean      (true en éxito)
//   tcpCloseSync(fd: number) -> void
//
// Issue V1: cuando tagged unions estén disponibles, los wrappers arriba se
// reemplazan por `Result<TcpConn, NetError>` para reportar errores de forma
// estructurada.

#include <cerrno>
#include <cstring>
#include <string>
#include <sys/types.h>
#include <unistd.h>

// El runtime global define `inline void write(...)` que oculta `::write` de
// unistd.h en todo el translation unit. Para evitarlo usamos punteros a
// función que se inicializan en runtime y llaman directamente a la API POSIX.
namespace ets::net_sync {

namespace posix {
    inline ssize_t (&rawWrite)(int, const void*, size_t) = ::write;
    inline ssize_t (&rawRead)(int, void*, size_t) = ::read;
} // namespace posix

ETS_API int tcpListenSync(const std::string& host, double port);

ETS_API int tcpAcceptSync(int listener_fd);

ETS_API int tcpConnectSync(const std::string& host, double port);

ETS_API std::string tcpReadSync(int fd, double max_bytes);

ETS_API bool tcpWriteSync(int fd, const std::string& data);

inline void tcpCloseSync(int fd) { if (fd >= 0) ::close(fd); }

} // namespace ets::net_sync

// Wrappers globales (sin namespace) para que el dialecto los vea directamente.
// Mapeo del dialecto: tcpListen → etsNetListen, etc.
inline int etsNetListen(const std::string& host, double port) { return ets::net_sync::tcpListenSync(host, port); }
inline int etsNetAccept(int listener_fd) { return ets::net_sync::tcpAcceptSync(listener_fd); }
inline int etsNetConnect(const std::string& host, double port) { return ets::net_sync::tcpConnectSync(host, port); }
inline std::string etsNetRead(int fd, double max_bytes) { return ets::net_sync::tcpReadSync(fd, max_bytes); }
inline bool etsNetWrite(int fd, const std::string& data) { return ets::net_sync::tcpWriteSync(fd, data); }
inline void etsNetClose(int fd) { ets::net_sync::tcpCloseSync(fd); }

// Helper de alto nivel para tests E2E: cliente + servidor en el mismo proceso.
// 1. Lanza un thread que escucha en (host, port), acepta UNA conexión, lee
//    hasta max_bytes, escribe "world", cierra.
// 2. Desde el hilo principal se conecta, envía `request`, lee la respuesta.
// 3. Devuelve la respuesta del servidor.
//
// En V1 (tagged unions) este helper se reemplaza por una API más rica.
ETS_API std::string etsNetSyncEcho(const std::string& host, double port, const std::string& request, double max_bytes);

// Variante de etsNetSyncEcho para mensajes grandes. El server responde con
// una cadena de `payload_bytes` bytes (rellenada con 'A'). El cliente la lee
// completa y la devuelve.
ETS_API std::string etsNetSyncLarge(const std::string& host, double port, double payload_bytes);

#if !defined(ETS_RUNTIME_PRECOMPILED)
#include "runtime/ets_net_sync.cpp"
#endif
