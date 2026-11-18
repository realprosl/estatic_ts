// Soporte en C++ de estatic:regexp sobre std::regex (gramática ECMAScript).
// Un RegExp de Estatic guarda source y flags; el regex compilado vive en una
// caché por (source, flags). Los métodos de string que reciben un RegExp
// (replace, match, split...) son sobrecargas de ets::string_* que leen esos dos
// campos con ets_fields.
#pragma once
#include <cstdio>
#include <cstdlib>
#include <map>
#include <regex>
#include <string>
#include <utility>
#include <vector>
#include "runtime/ets_optional.hpp"

namespace ets_regexp {

[[noreturn]] inline void syntaxError(const std::string& message) {
    std::fputs(("SyntaxError: " + message + "\n").c_str(), stderr);
    std::exit(1);
}

// Flags admitidos: g (global), i, m, y (sticky). s, u, v y d no los tiene std::regex.
inline const std::regex& compiled(const std::string& source, const std::string& flags) {
    static std::map<std::pair<std::string, std::string>, std::regex> cache;
    auto key = std::make_pair(source, flags);
    auto found = cache.find(key);
    if (found != cache.end()) return found->second;
    auto options = std::regex::ECMAScript;
    for (char flag : flags) {
        if (flag == 'i') options |= std::regex::icase;
        else if (flag == 'm') options |= std::regex::multiline;
        else if (flag != 'g' && flag != 'y') syntaxError(std::string("Invalid regular expression flags: el flag '") + flag + "' no está soportado (std::regex)");
    }
    // El runtime se compila sin excepciones: un patrón que std::regex no acepta
    // termina el programa (abort de la biblioteca estándar).
    return cache.emplace(key, std::regex(source, options)).first->second;
}

inline bool has(const std::string& flags, char flag) { return flags.find(flag) != std::string::npos; }

// Desde la posición from: [inicio, fin] del match y de cada grupo (-1 si el
// grupo no participa); vacío si no hay match. Con sticky el match tiene que
// empezar justo en from.
inline std::vector<double> execAt(const std::string& source, const std::string& flags, const std::string& text, double from) {
    std::vector<double> result;
    if (from < 0 || from > static_cast<double>(text.size())) return result;
    const auto& regex = compiled(source, flags);
    std::smatch match;
    auto start = text.begin() + static_cast<std::ptrdiff_t>(from);
    auto options = has(flags, 'y') ? std::regex_constants::match_continuous : std::regex_constants::match_default;
    if (from > 0) options |= std::regex_constants::match_prev_avail;
    if (!std::regex_search(start, text.end(), match, regex, options)) return result;
    for (std::size_t group = 0; group < match.size(); ++group) {
        if (!match[group].matched) { result.push_back(-1); result.push_back(-1); continue; }
        result.push_back(static_cast<double>(match[group].first - text.begin()));
        result.push_back(static_cast<double>(match[group].second - text.begin()));
    }
    return result;
}

template<class R> std::pair<std::string, std::string> parts(const R& regexp) {
    std::string source, flags;
    regexp.ets_fields([&](const char* name, const auto& field) {
        if constexpr (requires { std::string(field.get()); }) {
            if (std::string(name) == "source") source = field.get();
            if (std::string(name) == "flags") flags = field.get();
        }
    });
    return {source, flags};
}
template<class R> concept Pattern = requires(const R& value) { value.ets_fields([](const char*, const auto&) {}); };

}  // namespace ets_regexp

namespace ets {

// "texto".replace(/re/g, "x"): $&, $1, $$... como en JavaScript.
template<ets_regexp::Pattern R>
std::string string_replace(const std::string& value, const R& regexp, const std::string& replacement) {
    auto [source, flags] = ets_regexp::parts(regexp);
    auto options = ets_regexp::has(flags, 'g') ? std::regex_constants::format_default : std::regex_constants::format_first_only;
    return std::regex_replace(value, ets_regexp::compiled(source, flags), replacement, options);
}
template<ets_regexp::Pattern R>
std::string string_replaceAll(const std::string& value, const R& regexp, const std::string& replacement) {
    auto [source, flags] = ets_regexp::parts(regexp);
    if (!ets_regexp::has(flags, 'g')) { std::fputs("TypeError: replaceAll must be called with a global RegExp\n", stderr); std::exit(1); }
    return std::regex_replace(value, ets_regexp::compiled(source, flags), replacement);
}
// match: sin g, el match y sus grupos ("" si un grupo no participa); con g,
// todos los matches. Vacío (undefined) si no hay ninguno.
template<ets_regexp::Pattern R>
ets::Optional<std::vector<std::string>> string_match(const std::string& value, const R& regexp) {
    auto [source, flags] = ets_regexp::parts(regexp);
    const auto& regex = ets_regexp::compiled(source, flags);
    std::vector<std::string> result;
    if (ets_regexp::has(flags, 'g')) {
        for (auto it = std::sregex_iterator(value.begin(), value.end(), regex); it != std::sregex_iterator(); ++it) result.push_back((*it)[0].str());
    } else {
        std::smatch match;
        if (std::regex_search(value, match, regex)) for (std::size_t group = 0; group < match.size(); ++group) result.push_back(match[group].matched ? match[group].str() : std::string());
    }
    if (result.empty()) return ets::Optional<std::vector<std::string>>();
    return ets::Optional<std::vector<std::string>>(std::move(result));
}
template<ets_regexp::Pattern R>
std::vector<std::vector<std::string>> string_matchAll(const std::string& value, const R& regexp) {
    auto [source, flags] = ets_regexp::parts(regexp);
    if (!ets_regexp::has(flags, 'g')) { std::fputs("TypeError: matchAll must be called with a global RegExp\n", stderr); std::exit(1); }
    std::vector<std::vector<std::string>> result;
    const auto& regex = ets_regexp::compiled(source, flags);
    for (auto it = std::sregex_iterator(value.begin(), value.end(), regex); it != std::sregex_iterator(); ++it) {
        std::vector<std::string> groups;
        for (std::size_t group = 0; group < it->size(); ++group) groups.push_back((*it)[group].matched ? (*it)[group].str() : std::string());
        result.push_back(std::move(groups));
    }
    return result;
}
template<ets_regexp::Pattern R>
double string_search(const std::string& value, const R& regexp) {
    auto [source, flags] = ets_regexp::parts(regexp);
    std::smatch match;
    if (!std::regex_search(value, match, ets_regexp::compiled(source, flags))) return -1;
    return static_cast<double>(match.position(0));
}
// split como JavaScript: los trozos entre matches, también el vacío del final;
// un match vacío al principio o al final no corta.
template<ets_regexp::Pattern R>
std::vector<std::string> string_split(const std::string& value, const R& regexp) {
    auto [source, flags] = ets_regexp::parts(regexp);
    const auto& regex = ets_regexp::compiled(source, flags);
    std::vector<std::string> result;
    if (value.empty()) { if (!std::regex_match(value, regex)) result.push_back(value); return result; }
    std::size_t last = 0;
    for (auto it = std::sregex_iterator(value.begin(), value.end(), regex); it != std::sregex_iterator(); ++it) {
        const std::size_t at = static_cast<std::size_t>(it->position(0)), size = static_cast<std::size_t>(it->length(0));
        if (size == 0 && (at == 0 || at >= value.size())) continue;
        result.push_back(value.substr(last, at - last)); last = at + size;
    }
    result.push_back(value.substr(last));
    return result;
}

}  // namespace ets
