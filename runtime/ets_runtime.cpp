// Implementación de runtime/ets_runtime.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se compila
// aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_runtime.hpp"
#include "ets_map.hpp"
#include <cstddef>
#include <cstdlib>
#include <cctype>
#include <charconv>
#include <filesystem>
#include <iostream>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>
#if defined(__APPLE__)
#include <cerrno>
#include <clocale>
#include <xlocale.h>
#endif
#include "runtime/ets_core.hpp"
#include "runtime/ets_io.hpp"
#include "runtime/ets_string.hpp"
#include "runtime/ets_optional.hpp"
#include "runtime/ets_unq.hpp"
#include "runtime/ets_rc.hpp"
#if defined(__APPLE__)
#else
#endif

ETS_API ets_json_value jsonArrayGet(const ets_json_value& v, std::size_t index) {
    if (!v.isArray() || index >= std::get<ets_json_value::Array>(v.storage).size()) return ets_json_value();
    return std::get<ets_json_value::Array>(v.storage)[index];
}

ETS_API ets_json_value jsonObjectGet(const ets_json_value& v, const std::string& key) {
    if (!v.isObject()) return ets_json_value();
    const auto& object = std::get<ets_json_value::Object>(v.storage);
    auto it = object.find(key);
    return it != object.end() ? it->second : ets_json_value();
}

ETS_API std::vector<std::string> jsonObjectKeys(const ets_json_value& v) {
    std::vector<std::string> keys;
    if (!v.isObject()) return keys;
    for (const auto& [k, _] : std::get<ets_json_value::Object>(v.storage)) keys.push_back(k);
    return keys;
}

ETS_API std::string jsonEscape(const std::string& value) {
    std::string output;
    output.reserve(value.size());
    constexpr char hex[] = "0123456789abcdef";
    for (const unsigned char character : value) {
        switch (character) {
            case '"': output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\b': output += "\\b"; break;
            case '\f': output += "\\f"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if (character < 0x20) {
                    output += "\\u00";
                    output += hex[(character >> 4) & 0x0f];
                    output += hex[character & 0x0f];
                } else output += static_cast<char>(character);
        }
    }
    return output;
}

ETS_API std::string normalizePath(const std::string& path) {
    std::error_code error;
    const auto absolute = std::filesystem::absolute(std::filesystem::path(path), error);
    return (error ? std::filesystem::path(path) : absolute).lexically_normal().string();
}

ETS_API std::string compilerRoot() {
    std::filesystem::path runtimeHeader(__FILE__);
    if (runtimeHeader.is_relative()) runtimeHeader = std::filesystem::absolute(runtimeHeader);
    return runtimeHeader.parent_path().parent_path().lexically_normal().string();
}

ETS_API std::string resolveImportPath(const std::string& importer, const std::string& specifier) {
    std::filesystem::path requested(specifier);
    if (requested.is_relative()) requested = std::filesystem::path(importer).parent_path() / requested;
    if (!requested.has_extension()) {
        std::filesystem::path typescript = requested; typescript += ".ts";
        std::error_code status;
        if (std::filesystem::is_regular_file(typescript, status) && !status) requested = std::move(typescript);
        else { requested += ".ets"; }
    }
    return normalizePath(requested.string());
}

ETS_API std::string resolveProjectPath(const std::string& configFile, const std::string& value) {
    const std::filesystem::path requested(value);
    return normalizePath((requested.is_absolute() ? requested : std::filesystem::path(configFile).parent_path() / requested).string());
}

ETS_API std::string pathDirectory(const std::string& path) {
    return std::filesystem::path(normalizePath(path)).parent_path().string();
}
