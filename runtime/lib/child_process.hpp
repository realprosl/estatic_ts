// Soporte en C++ de estatic:child_process (#292): spawn async del runtime
// (runtime/ets_child_process.hpp, libuv) y spawnSync/execSync con POSIX.
#pragma once
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <string>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>
#include "runtime/ets_child_process.hpp"

namespace ets_child_process_lib {

// El runtime declara un write() global (print sin salto) que tapa al de POSIX.
inline ssize_t (*const posixWrite)(int, const void*, std::size_t) = ::write;
inline ssize_t (*const posixRead)(int, void*, std::size_t) = ::read;

inline ets::ChildProcess spawn(std::string command, std::vector<std::string> args) { return ets::child_process.spawn(command, args); }

// Resultado de spawnSync en un vector plano: [status, stdout, stderr, error].
// status es el código de salida (128 + señal si murió por una señal) o -1 si
// no se pudo lanzar; error explica por qué.
inline std::vector<std::string> spawnSync(std::string command, std::vector<std::string> args, std::string input) {
    int in[2], out[2], err[2];
    if (::pipe(in) != 0 || ::pipe(out) != 0 || ::pipe(err) != 0) return {"-1", "", "", std::string("pipe: ") + std::strerror(errno)};
    int launch[2];
    if (::pipe(launch) != 0) return {"-1", "", "", std::string("pipe: ") + std::strerror(errno)};
    ::fcntl(launch[1], F_SETFD, FD_CLOEXEC);
    const pid_t child = ::fork();
    if (child < 0) return {"-1", "", "", std::string("fork: ") + std::strerror(errno)};
    if (child == 0) {
        ::dup2(in[0], 0); ::dup2(out[1], 1); ::dup2(err[1], 2);
        ::close(in[0]); ::close(in[1]); ::close(out[0]); ::close(out[1]); ::close(err[0]); ::close(err[1]); ::close(launch[0]);
        std::vector<char*> argv; argv.push_back(command.data());
        for (auto& arg : args) argv.push_back(arg.data());
        argv.push_back(nullptr);
        ::execvp(command.c_str(), argv.data());
        const int code = errno; (void)!posixWrite(launch[1], &code, sizeof(code)); ::_exit(127);
    }
    ::close(in[0]); ::close(out[1]); ::close(err[1]); ::close(launch[1]);
    int launchError = 0;
    const bool failed = posixRead(launch[0], &launchError, sizeof(launchError)) == static_cast<ssize_t>(sizeof(launchError));
    ::close(launch[0]);
    ::signal(SIGPIPE, SIG_IGN);
    std::size_t written = 0; if (input.empty()) { ::close(in[1]); in[1] = -1; }
    std::string stdoutText, stderrText; char buffer[65536];
    bool outOpen = true, errOpen = true;
    while (outOpen || errOpen || in[1] >= 0) {
        pollfd fds[3]; int count = 0; int outAt = -1, errAt = -1, inAt = -1;
        if (outOpen) { fds[count] = {out[0], POLLIN, 0}; outAt = count++; }
        if (errOpen) { fds[count] = {err[0], POLLIN, 0}; errAt = count++; }
        if (in[1] >= 0) { fds[count] = {in[1], POLLOUT, 0}; inAt = count++; }
        if (::poll(fds, count, -1) < 0) { if (errno == EINTR) continue; break; }
        if (inAt >= 0 && fds[inAt].revents) {
            const ssize_t sent = posixWrite(in[1], input.data() + written, input.size() - written);
            if (sent > 0) written += static_cast<std::size_t>(sent);
            if (sent < 0 || written >= input.size()) { ::close(in[1]); in[1] = -1; }
        }
        if (outAt >= 0 && fds[outAt].revents) { const ssize_t got = posixRead(out[0], buffer, sizeof(buffer)); if (got > 0) stdoutText.append(buffer, static_cast<std::size_t>(got)); else outOpen = false; }
        if (errAt >= 0 && fds[errAt].revents) { const ssize_t got = posixRead(err[0], buffer, sizeof(buffer)); if (got > 0) stderrText.append(buffer, static_cast<std::size_t>(got)); else errOpen = false; }
    }
    ::close(out[0]); ::close(err[0]); if (in[1] >= 0) ::close(in[1]);
    int status = 0; while (::waitpid(child, &status, 0) < 0 && errno == EINTR) {}
    if (failed) return {"-1", "", "", "spawn " + command + ": " + std::strerror(launchError)};
    const int code = WIFEXITED(status) ? WEXITSTATUS(status) : WIFSIGNALED(status) ? 128 + WTERMSIG(status) : -1;
    return {std::to_string(code), stdoutText, stderrText, ""};
}

}  // namespace ets_child_process_lib
