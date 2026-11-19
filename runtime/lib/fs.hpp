// Soporte en C++ de estatic:fs (#292): reutiliza runtime/ets_file.hpp (lecturas
// y escrituras síncronas y async) y añade lo de directorios con std::filesystem.
#pragma once
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>
#include "runtime/ets_file.hpp"

namespace ets_fs_lib {
namespace fsys = std::filesystem;

inline ets::Result<std::string> readFileSync(const std::string& path) { return ::readFile(path); }
inline ets::Result<bool> writeFileSync(const std::string& path, const std::string& data) { return ::writeFile(path, data); }
inline ets::Result<bool> appendFileSync(const std::string& path, const std::string& data) { return ::appendFile(path, data); }
inline ets::Result<bool> copyFileSync(const std::string& from, const std::string& to) { return ::copyFile(from, to); }
inline ets::Result<bool> renameSync(const std::string& from, const std::string& to) { return ::moveFile(from, to); }
inline ets::Result<bool> unlinkSync(const std::string& path) { return ::removeFile(path); }
// Como en Node: true también para directorios.
inline bool existsSync(const std::string& path) { std::error_code error; return fsys::exists(path, error); }

inline ets::Task<ets::Result<std::string>> readFile(std::string path) { return ::readFileAsync(std::move(path)); }
inline ets::Task<ets::Result<bool>> writeFile(std::string path, std::string data) { return ::writeFileAsync(std::move(path), std::move(data)); }
inline ets::Task<ets::Result<bool>> appendFile(std::string path, std::string data) { return ::appendFileAsync(std::move(path), std::move(data)); }
inline ets::Task<ets::Result<bool>> copyFile(std::string from, std::string to) { return ::copyFileAsync(std::move(from), std::move(to)); }
inline ets::Task<ets::Result<bool>> rename(std::string from, std::string to) { return ::moveFileAsync(std::move(from), std::move(to)); }
inline ets::Task<ets::Result<bool>> unlink(std::string path) { return ::removeFileAsync(std::move(path)); }

inline std::string failure(const char* operation, const std::string& path, const std::error_code& error) {
    return std::string(operation) + " '" + path + "': " + error.message();
}
inline ets::Result<bool> mkdirSync(const std::string& path, bool recursive) {
    std::error_code error;
    if (recursive) fsys::create_directories(path, error); else fsys::create_directory(path, error);
    if (error) return ets::err<bool>(failure("mkdir", path, error));
    return ets::ok(true);
}
inline ets::Result<std::vector<std::string>> readdirSync(const std::string& path) {
    std::error_code error; std::vector<std::string> names;
    for (fsys::directory_iterator it(path, error), end; !error && it != end; it.increment(error)) names.push_back(it->path().filename().string());
    if (error) return ets::err<std::vector<std::string>>(failure("readdir", path, error));
    std::sort(names.begin(), names.end());
    return ets::ok(std::move(names));
}
inline ets::Result<bool> rmSync(const std::string& path, bool recursive) {
    std::error_code error;
    if (recursive) fsys::remove_all(path, error); else fsys::remove(path, error);
    if (error) return ets::err<bool>(failure("rm", path, error));
    return ets::ok(true);
}
// statSync: [tipo (0 no existe, 1 fichero, 2 directorio, 3 otro), tamaño, mtime en ms].
inline std::vector<double> stat(const std::string& path) {
    std::error_code error; const auto status = fsys::status(path, error);
    if (error || !fsys::exists(status)) return {0, 0, 0};
    const double kind = fsys::is_regular_file(status) ? 1 : fsys::is_directory(status) ? 2 : 3;
    std::error_code sizeError; const auto size = kind == 1 ? fsys::file_size(path, sizeError) : 0;
    std::error_code timeError; const auto written = fsys::last_write_time(path, timeError);
    double mtime = 0;
    if (!timeError) {
        const auto system = std::chrono::time_point_cast<std::chrono::milliseconds>(written - fsys::file_time_type::clock::now() + std::chrono::system_clock::now());
        mtime = static_cast<double>(system.time_since_epoch().count());
    }
    return {kind, sizeError ? 0.0 : static_cast<double>(size), mtime};
}
}  // namespace ets_fs_lib
