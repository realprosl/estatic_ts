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
// Ruta absoluta y normalizada (lexical): la que usaba el builtin
// `normalizePath`. Distinto de `path.normalize` de Node, que no hace
// absoluta la ruta.
inline std::string normalizePath(const std::string& path) {
    std::error_code error;
    const auto absolute = std::filesystem::absolute(std::filesystem::path(path), error);
    return (error ? std::filesystem::path(path) : absolute).lexically_normal().string();
}
// El directorio de la ruta, normalizada.
inline std::string pathDirectory(const std::string& path) {
    return std::filesystem::path(normalizePath(path)).parent_path().string();
}
}  // namespace ets_path_lib
