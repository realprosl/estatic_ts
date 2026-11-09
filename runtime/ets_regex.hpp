// V30.25: regex literals y operaciones (test/match/replace).
// Envuelve `std::regex` (C++11) en un struct opaco `ets_regex`.
//
// Uso desde el dialecto:
//
//   const r: Regex = regex("\\d+")
//   r.test("a1b2")         // true
//   r.match("a1b2")        // ["1", "2"]
//   r.replace("a1b2", "X") // "aXbX"
//
// El struct es move-only y lightweight (envuelve `std::regex`).
// Comparar dos `ets_regex` con `operator==` compara los patterns y flags.
//
// El runtime de los programas generados se compila con `-fno-exceptions`, y
// en ese modo libstdc++ convierte un `std::regex_error` en `abort()`. Como el
// dialecto expone `regex(...)` al usuario, un patron invalido tumbaria el
// programa sin diagnostico. La construccion del `std::regex` se delega en
// `ets_regex_compile.cpp`, un TU aparte compilado con `-fexceptions` que
// captura el error y lo devuelve como texto.

#pragma once

#include <optional>
#include <regex>
#include <string>
#include <vector>

namespace ets {

// Implementado en `runtime/ets_regex_compile.cpp`, compilado con
// `-fexceptions`. Devuelve `std::nullopt` si el patron no es valido.
std::optional<std::regex> compile_regex(const std::string& pattern, std::regex::flag_type flags, std::string* error);

struct ets_regex {
    std::regex re;
    std::string pattern;
    std::string flags;
    // Mensaje de error cuando el patron no es valido. Vacio si es valido.
    std::string error;
    bool valid = true;

    ets_regex() = default;
    ets_regex(std::string p, std::string f) : pattern(std::move(p)), flags(std::move(f)) {
        std::string failure;
        std::optional<std::regex> compiled = compile_regex(pattern, parse_flags(flags), &failure);
        if (!compiled) { valid = false; error = failure; return; }
        re = std::move(*compiled);
    }

    static std::regex::flag_type parse_flags(const std::string& f) {
        std::regex::flag_type out = std::regex::ECMAScript;
        for (char c : f) {
            if (c == 'i') out |= std::regex::icase;
            else if (c == 'm') out |= std::regex::multiline;
            // ECMAScript es el default; no soportamos 'g' (en C++ match es
            // greedy por defecto) ni 's' (ECMAScript no distingue . de \n).
        }
        return out;
    }

    // El patron no es valido: las operaciones devuelven un resultado vacio
    // en lugar de propagar un `std::regex_error`.
    bool isValid() const { return valid; }
    // Diagnostico del error de compilacion del patron, o cadena vacia.
    const std::string& errorMessage() const { return error; }

    // V30.25: `test(s)` devuelve true si el pattern matchea en `s`.
    bool test(const std::string& s) const {
        if (!valid) return false;
        return std::regex_search(s, re);
    }

    // V30.25: `match(s)` devuelve TODOS los matches no solapados en `s`.
    // Si no hay matches, devuelve un vector vacio. Cada elemento del
    // vector es el texto del match completo (no los grupos de captura).
    std::vector<std::string> match(const std::string& s) const {
        std::vector<std::string> out;
        if (!valid) return out;
        auto begin = std::sregex_iterator(s.begin(), s.end(), re);
        auto end = std::sregex_iterator();
        for (auto it = begin; it != end; ++it) {
            out.push_back((*it)[0].str());
        }
        return out;
    }

    // V30.25: `replace(s, repl)` reemplaza el primer match por `repl`.
    // Soporta los back-references clasicos: `$0` (match completo) y
    // `$1`..`$9` (grupo 1..9). Implementacion manual para evitar
    // diferencias entre implementaciones de `std::regex_replace`.
    std::string replace(const std::string& s, const std::string& repl) const {
        if (!valid) return s;
        std::smatch m;
        if (!std::regex_search(s, m, re)) return s;
        std::string out;
        out.reserve(s.size() + repl.size());
        size_t pos = 0;
        size_t match_start = static_cast<size_t>(m.position(0));
        size_t match_len = static_cast<size_t>(m.length(0));
        out.append(s, pos, match_start - pos);
        // Expandir back-references en `repl`.
        for (size_t i = 0; i < repl.size(); ++i) {
            if (repl[i] == '$' && i + 1 < repl.size()) {
                char next = repl[i + 1];
                if (next >= '0' && next <= '9') {
                    size_t group = next - '0';
                    if (group < m.size()) {
                        out.append(m[group].str());
                        ++i;
                        continue;
                    }
                }
            }
            out.push_back(repl[i]);
        }
        pos = match_start + match_len;
        out.append(s, pos, std::string::npos);
        return out;
    }

    // Dos regex son iguales si comparten patron y flags.
    bool operator==(const ets_regex& other) const {
        return pattern == other.pattern && flags == other.flags;
    }
    bool operator!=(const ets_regex& other) const { return !(*this == other); }
};

// Constructor: `regex(pattern)` y `regex(pattern, flags)`.
inline ets_regex regex(const std::string& pattern) {
    return ets_regex(pattern, std::string());
}
inline ets_regex regex(const std::string& pattern, const std::string& flags) {
    return ets_regex(pattern, flags);
}

}  // namespace ets
