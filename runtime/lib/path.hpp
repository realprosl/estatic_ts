// Soporte en C++ de estatic:path: solo el directorio actual (para resolve).
#pragma once
#include <filesystem>
#include <string>

namespace ets_path_lib {
inline std::string cwd() {
    std::error_code error;
    const auto current = std::filesystem::current_path(error);
    return error ? std::string(".") : current.string();
}
}  // namespace ets_path_lib
