// Implementación de runtime/ets_core.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_core.hpp"
#include <cstddef>
#include <cstdlib>
#include <filesystem>
#include <sstream>
#include <string>
#include <type_traits>
#include <variant>
#include <vector>
#include "ets_string.hpp"  // para string_size y detail::append_to (usados por ets::concat)

ETS_API bool ensureParentDirectory(const std::string& path, std::string& error) noexcept {
    std::error_code status;
    const auto parent = std::filesystem::path(path).parent_path();
    if (!parent.empty()) std::filesystem::create_directories(parent, status);
    if (status) { error = "No se puede crear el directorio de salida: " + status.message(); return false; }
    return true;
}
namespace ets {

ETS_API std::vector<std::string> processArgv() {
    std::vector<std::string> result;
    if (ets_argc <= 0 || ets_argv == nullptr) return result;
    std::error_code error;
    auto program = std::filesystem::absolute(ets_argv[0], error);
    const std::string path = error ? std::string(ets_argv[0]) : program.lexically_normal().string();
    result.reserve(static_cast<std::size_t>(ets_argc) + 1);
    result.push_back(path);
    result.push_back(path);
    for (int index = 1; index < ets_argc; ++index) result.emplace_back(ets_argv[index]);
    return result;
}
} // namespace ets
