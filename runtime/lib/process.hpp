// Soporte en C++ de estatic:process (#292): reutiliza el runtime de siempre
// (ets_core.hpp para argv, ets_child_process.hpp para stdin/stdout/stderr).
#pragma once
#include <cstdlib>
#include <filesystem>
#include <string>
#include <vector>
#include <unistd.h>
#include "runtime/ets_core.hpp"
#include "runtime/ets_map.hpp"
#include "runtime/ets_child_process.hpp"

extern char** environ;

namespace ets_process_lib {

inline std::vector<std::string> argv() { return ets::processArgv(); }
inline double argc() { return ets::processArgc(); }
inline std::string cwd() {
    std::error_code error;
    const auto current = std::filesystem::current_path(error);
    return error ? std::string(".") : current.string();
}
inline void exit(double code) { exitProcess(code); }
inline double pid() { return static_cast<double>(::getpid()); }
inline std::string platform() {
#if defined(__APPLE__)
    return "darwin";
#elif defined(_WIN32)
    return "win32";
#else
    return "linux";
#endif
}
// process.env: las variables de entorno en el orden en que las da el sistema.
inline ets::Map<std::string, std::string> env() {
    ets::Map<std::string, std::string> result;
    for (char** item = environ; item != nullptr && *item != nullptr; ++item) {
        const std::string entry(*item);
        const auto equals = entry.find('=');
        if (equals != std::string::npos) result.set(entry.substr(0, equals), entry.substr(equals + 1));
    }
    return result;
}
inline ets::ProcessReadable stdinStream() { return ets::processStdio.stdin.stream(); }
inline ets::ProcessWritable stdoutStream() { return ets::processStdio.stdout.stream(); }
inline ets::ProcessWritable stderrStream() { return ets::processStdio.stderr.stream(); }

}  // namespace ets_process_lib
