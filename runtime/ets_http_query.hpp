#pragma once

#include <string>
#include <string_view>

namespace ets::detail {

// Lookup sin cache ni asignaciones intermedias. Conserva la semantica del
// parser Drogon: claves vacias ignoradas, ultimo duplicado gana, sin URL-decode.
// El resultado es una copia independiente de la vida de la query original.
inline std::string rawQueryValue(std::string_view query, std::string_view name) {
    if (name.empty()) return {};
    std::string_view result;
    while (!query.empty()) {
        const auto end = query.find('&');
        const auto field = query.substr(0, end);
        const auto separator = field.find('=');
        if (field.substr(0, separator) == name) {
            result = separator == std::string_view::npos
                ? std::string_view{} : field.substr(separator + 1);
        }
        if (end == std::string_view::npos) break;
        query.remove_prefix(end + 1);
    }
    return std::string(result);
}

}  // namespace ets::detail
