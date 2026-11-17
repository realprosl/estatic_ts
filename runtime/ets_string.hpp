#pragma once

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <ostream>
#include <limits>
#include "ets_optional.hpp"
#include <type_traits>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <sstream>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>

// String API byte-level estilo TypeScript. std::string es UTF-8 bytes; todas
// las operaciones trabajan sobre bytes. charCodeAt = byte 0-255, charAt =
// string de 1 byte. Coherente con el resto del runtime (no se asume UTF-16).

namespace ets {

// ----------------------------------------------------------------------------
// length: numero de bytes (== std::string::size).
// ----------------------------------------------------------------------------
inline double string_length(const std::string& value) {
    return static_cast<double>(value.size());
}

// ----------------------------------------------------------------------------
// charAt(i = 0): string de 1 byte en la posicion i, o "" si fuera de rango.
// ----------------------------------------------------------------------------
inline std::string string_charAt(const std::string& value, double index = 0.0) {
    if (std::isnan(index)) index = 0.0;
    if (index < 0 || index >= static_cast<double>(value.size())) return std::string();
    return std::string(1, value[static_cast<std::size_t>(index)]);
}

// ----------------------------------------------------------------------------
// charCodeAt(i = 0): byte en posicion i como double (0-255), o NaN si fuera
// de rango (como JavaScript).
// ----------------------------------------------------------------------------
inline double string_charCodeAt(const std::string& value, double index = 0.0) {
    if (std::isnan(index)) index = 0.0;
    if (index < 0 || index >= static_cast<double>(value.size())) return std::numeric_limits<double>::quiet_NaN();
    return static_cast<unsigned char>(value[static_cast<std::size_t>(index)]);
}

// at(i): byte en i como string; i negativo cuenta desde el final. Fuera de
// rango, undefined (Optional vacío).
inline Optional<std::string> string_at(const std::string& value, double index) {
    if (std::isnan(index)) index = 0.0;
    index = std::trunc(index);
    if (index < 0) index += static_cast<double>(value.size());
    if (index < 0 || index >= static_cast<double>(value.size())) return {};
    return std::string(1, value[static_cast<std::size_t>(index)]);
}

// codePointAt(i): código Unicode del carácter UTF-8 que empieza en el byte i.
// En un byte de continuación devuelve el byte. Fuera de rango, undefined.
inline Optional<double> string_codePointAt(const std::string& value, double index) {
    if (std::isnan(index)) index = 0.0;
    if (index < 0 || index >= static_cast<double>(value.size())) return {};
    const auto at = static_cast<std::size_t>(index);
    const auto lead = static_cast<unsigned char>(value[at]);
    int extra = 0; std::uint32_t code = lead;
    if (lead >= 0xF0 && lead < 0xF8) { extra = 3; code = lead & 0x07; }
    else if (lead >= 0xE0) { extra = 2; code = lead & 0x0F; }
    else if (lead >= 0xC0) { extra = 1; code = lead & 0x1F; }
    if (lead >= 0xF8 || (lead >= 0x80 && lead < 0xC0) || at + extra >= value.size()) return static_cast<double>(lead);
    for (int k = 1; k <= extra; ++k) {
        const auto next = static_cast<unsigned char>(value[at + k]);
        if ((next & 0xC0) != 0x80) return static_cast<double>(lead);
        code = (code << 6) | (next & 0x3F);
    }
    return static_cast<double>(code);
}

// ----------------------------------------------------------------------------
// indexOf(needle, start=0): primera posicion de needle, o -1. Si start < 0 o
// needle vacio, devuelve 0 (TS semantics).
// ----------------------------------------------------------------------------
inline double string_indexOf(const std::string& value, const std::string& needle, double start = 0.0) {
    std::size_t from = 0;
    if (start > 0.0) from = start > static_cast<double>(value.size()) ? value.size() : static_cast<std::size_t>(start);
    if (needle.empty()) return static_cast<double>(from);
    const auto found = value.find(needle, from);
    return found == std::string::npos ? -1.0 : static_cast<double>(found);
}

// ----------------------------------------------------------------------------
// lastIndexOf(needle, from=infinito): ultima posicion de needle que empieza
// en from o antes, o -1.
// ----------------------------------------------------------------------------
inline double string_lastIndexOf(const std::string& value, const std::string& needle,
                                 double from = std::numeric_limits<double>::infinity()) {
    if (std::isnan(from)) from = std::numeric_limits<double>::infinity();
    std::size_t limit = value.size();
    if (from < 0) limit = 0;
    else if (from < static_cast<double>(value.size())) limit = static_cast<std::size_t>(from);
    if (needle.empty()) return static_cast<double>(limit);
    const auto found = value.rfind(needle, limit);
    return found == std::string::npos ? -1.0 : static_cast<double>(found);
}

// ----------------------------------------------------------------------------
// includes(needle, start=0): true si needle aparece a partir de start.
// ----------------------------------------------------------------------------
inline bool string_includes(const std::string& value, const std::string& needle, double start = 0.0) {
    if (needle.empty()) return true;
    std::size_t from = 0;
    if (start > 0.0) from = static_cast<std::size_t>(start);
    if (from > value.size()) return false;
    return value.find(needle, from) != std::string::npos;
}

// ----------------------------------------------------------------------------
// startsWith(prefix, position=0): true si value empieza por prefix en position.
// ----------------------------------------------------------------------------
inline bool string_startsWith(const std::string& value, const std::string& prefix, double position = 0.0) {
    std::size_t from = 0;
    if (position > 0.0) from = position > static_cast<double>(value.size()) ? value.size() : static_cast<std::size_t>(position);
    return value.size() - from >= prefix.size() && value.compare(from, prefix.size(), prefix) == 0;
}

// ----------------------------------------------------------------------------
// endsWith(suffix, endPosition=length): true si value[0, endPosition) termina
// por suffix.
// ----------------------------------------------------------------------------
inline bool string_endsWith(const std::string& value, const std::string& suffix,
                            double endPosition = std::numeric_limits<double>::infinity()) {
    std::size_t end = value.size();
    if (std::isnan(endPosition) || endPosition < 0) end = 0;
    else if (endPosition < static_cast<double>(value.size())) end = static_cast<std::size_t>(endPosition);
    return end >= suffix.size() && value.compare(end - suffix.size(), suffix.size(), suffix) == 0;
}

// ----------------------------------------------------------------------------
// slice(start, end=length): substring desde start (puede ser negativo) hasta
// end (negativo cuenta desde el final). Equivalente a JS Array.prototype.slice.
// ----------------------------------------------------------------------------
inline std::string string_slice(const std::string& value, double start = 0.0,
                                double end = std::numeric_limits<double>::infinity()) {
    const auto size = static_cast<double>(value.size());
    auto clamp = [size](double n) {
        if (n < 0) n = size + n;
        if (n < 0) n = 0;
        if (n > size) n = size;
        return static_cast<std::size_t>(n);
    };
    const auto s = clamp(start);
    const auto e = clamp(end);
    if (e <= s) return std::string();
    return value.substr(s, e - s);
}

// ----------------------------------------------------------------------------
// substring(start, end=length): como slice pero clampea negativos a 0 y
// intercambia start/end si vienen invertidos (TS semantics).
// ----------------------------------------------------------------------------
inline std::string string_substring(const std::string& value, double start,
                                    double end = std::numeric_limits<double>::infinity()) {
    const auto size = static_cast<double>(value.size());
    auto toPos = [size](double n) {
        if (n < 0) n = 0;
        if (n > size) n = size;
        return static_cast<std::size_t>(n);
    };
    auto s = toPos(start);
    auto e = toPos(end);
    if (e < s) std::swap(s, e);
    if (e == s) return std::string();
    return value.substr(s, e - s);
}

// ----------------------------------------------------------------------------
// substr(start, length=length-start): como TS legacy substr.
// ----------------------------------------------------------------------------
inline std::string string_substr(const std::string& value, double start,
                                 double length = std::numeric_limits<double>::infinity()) {
    const auto size = static_cast<double>(value.size());
    double s = start;
    if (s < 0) s = size + s;
    if (s < 0) s = 0;
    if (s > size) return std::string();
    const auto from = static_cast<std::size_t>(s);
    const auto remaining = size - s;
    const auto len = static_cast<std::size_t>(length < 0 ? 0 : (length > remaining ? remaining : length));
    return value.substr(from, len);
}

// ----------------------------------------------------------------------------
// split(separator, limit?): corta por separator (string literal) y devuelve
// como mucho limit partes. Sin regex. Con separator "" separa cada byte.
// ----------------------------------------------------------------------------
inline std::vector<std::string> string_split(const std::string& value, const std::string& separator,
                                             double limit = std::numeric_limits<double>::infinity()) {
    std::vector<std::string> result;
    // Como JavaScript: limit se convierte a uint32 (negativo = muy grande).
    std::size_t max = std::numeric_limits<std::size_t>::max();
    if (!std::isnan(limit) && !std::isinf(limit)) max = static_cast<std::size_t>(static_cast<std::uint32_t>(static_cast<std::int64_t>(std::trunc(limit))));
    else if (std::isnan(limit)) max = 0;
    if (max == 0) return result;
    if (separator.empty()) {
        for (std::size_t at = 0; at < value.size() && result.size() < max; ++at) result.push_back(std::string(1, value[at]));
        return result;
    }
    std::size_t start = 0;
    while (result.size() < max) {
        const auto pos = value.find(separator, start);
        if (pos == std::string::npos) {
            result.push_back(value.substr(start));
            break;
        }
        result.push_back(value.substr(start, pos - start));
        start = pos + separator.size();
    }
    return result;
}

// ----------------------------------------------------------------------------
// trim(): quita espacios (\t \n \r ' ' \v \f) al principio y al final.
// ----------------------------------------------------------------------------
inline std::string string_trim(const std::string& value) {
    const auto first = value.find_first_not_of(" \t\r\n\v\f");
    if (first == std::string::npos) return std::string();
    const auto last = value.find_last_not_of(" \t\r\n\v\f");
    return value.substr(first, last - first + 1);
}

// trimStart / trimEnd
inline std::string string_trimStart(const std::string& value) {
    const auto first = value.find_first_not_of(" \t\r\n\v\f");
    if (first == std::string::npos) return std::string();
    return value.substr(first);
}
inline std::string string_trimEnd(const std::string& value) {
    const auto last = value.find_last_not_of(" \t\r\n\v\f");
    if (last == std::string::npos) return std::string();
    return value.substr(0, last + 1);
}
// Alias antiguos de TypeScript.
inline std::string string_trimLeft(const std::string& value) { return string_trimStart(value); }
inline std::string string_trimRight(const std::string& value) { return string_trimEnd(value); }

// concat(...strings): value seguido de cada argumento.
template <typename... Parts>
inline std::string string_concat(const std::string& value, const Parts&... parts) {
    std::string out = value;
    (out.append(parts), ...);
    return out;
}

// Añade a out el código Unicode code en UTF-8 (fuera de rango, U+FFFD).
inline void append_utf8(std::string& out, double number) {
    std::uint32_t code = 0xFFFD;
    if (!std::isnan(number) && number >= 0 && number <= 0x10FFFF) code = static_cast<std::uint32_t>(number);
    if (code < 0x80) out.push_back(static_cast<char>(code));
    else if (code < 0x800) { out.push_back(static_cast<char>(0xC0 | (code >> 6))); out.push_back(static_cast<char>(0x80 | (code & 0x3F))); }
    else if (code < 0x10000) { out.push_back(static_cast<char>(0xE0 | (code >> 12))); out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F))); out.push_back(static_cast<char>(0x80 | (code & 0x3F))); }
    else { out.push_back(static_cast<char>(0xF0 | (code >> 18))); out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F))); out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F))); out.push_back(static_cast<char>(0x80 | (code & 0x3F))); }
}

// ----------------------------------------------------------------------------
// toLowerCase / toUpperCase: byte-level usando unsigned char para evitar UB
// con valores >127. NO es Unicode-correct (UTF-8 multibyte pasaria a ASCII
// si toca letras); pero es byte-level y consistente con la regla del runtime.
// ----------------------------------------------------------------------------
inline std::string string_toLowerCase(const std::string& value) {
    std::string out;
    out.resize(value.size());
    for (std::size_t i = 0; i < value.size(); ++i) {
        out[i] = static_cast<char>(std::tolower(static_cast<unsigned char>(value[i])));
    }
    return out;
}
inline std::string string_toUpperCase(const std::string& value) {
    std::string out;
    out.resize(value.size());
    for (std::size_t i = 0; i < value.size(); ++i) {
        out[i] = static_cast<char>(std::toupper(static_cast<unsigned char>(value[i])));
    }
    return out;
}

// ----------------------------------------------------------------------------
// repeat(count): repite el string count veces. count <= 0 -> "".
// ----------------------------------------------------------------------------
inline std::string string_repeat(const std::string& value, double count) {
    const auto n = static_cast<std::size_t>(count < 0 ? 0 : count);
    if (n == 0 || value.empty()) return std::string();
    std::string out;
    out.reserve(value.size() * n);
    for (std::size_t i = 0; i < n; ++i) out.append(value);
    return out;
}

// ----------------------------------------------------------------------------
// padStart(length, pad=" "): rellena al inicio hasta alcanzar length.
// padStart(length) con 1 argumento -> pad por defecto " " (TS semantics).
// ----------------------------------------------------------------------------
inline std::string string_padStart(const std::string& value, double targetLength, const std::string& pad = " ") {
    const auto target = static_cast<std::size_t>(targetLength < 0 ? 0 : targetLength);
    if (value.size() >= target) return value;
    if (pad.empty()) return value;  // TS devuelve value sin pad si pad vacio
    const std::size_t need = target - value.size();
    std::string out;
    out.reserve(target);
    if (pad.size() >= need) {
        out.append(pad, 0, need);
    } else {
        const std::size_t fullRepeats = need / pad.size();
        const std::size_t tail = need % pad.size();
        for (std::size_t i = 0; i < fullRepeats; ++i) out.append(pad);
        out.append(pad, 0, tail);
    }
    out.append(value);
    return out;
}

// ----------------------------------------------------------------------------
// padEnd(length, pad=" "): rellena al final hasta alcanzar length.
// ----------------------------------------------------------------------------
inline std::string string_padEnd(const std::string& value, double targetLength, const std::string& pad = " ") {
    const auto target = static_cast<std::size_t>(targetLength < 0 ? 0 : targetLength);
    if (value.size() >= target) return value;
    if (pad.empty()) return value;
    const std::size_t need = target - value.size();
    std::string out;
    out.reserve(target);
    out.append(value);
    if (pad.size() >= need) {
        out.append(pad, 0, need);
    } else {
        const std::size_t fullRepeats = need / pad.size();
        const std::size_t tail = need % pad.size();
        for (std::size_t i = 0; i < fullRepeats; ++i) out.append(pad);
        out.append(pad, 0, tail);
    }
    return out;
}

// ----------------------------------------------------------------------------
// replace(search, replacement): primera ocurrencia (TS semantics).
// ----------------------------------------------------------------------------
inline std::string string_replace(const std::string& value, const std::string& search, const std::string& replacement) {
    if (search.empty()) return value;
    const auto pos = value.find(search);
    if (pos == std::string::npos) return value;
    return value.substr(0, pos) + replacement + value.substr(pos + search.size());
}

// ----------------------------------------------------------------------------
// replaceAll(search, replacement): todas las ocurrencias.
// ----------------------------------------------------------------------------
inline std::string string_replaceAll(const std::string& value, const std::string& search, const std::string& replacement) {
    if (search.empty()) return value;
    std::string out;
    out.reserve(value.size());
    std::size_t start = 0;
    while (true) {
        const auto pos = value.find(search, start);
        if (pos == std::string::npos) {
            out.append(value, start, std::string::npos);
            break;
        }
        out.append(value, start, pos - start);
        out.append(replacement);
        start = pos + search.size();
    }
    return out;
}

// ----------------------------------------------------------------------------
// localeCompare(other): comparacion byte-level. < 0 si menor, 0 si igual, > 0
// si mayor. Devuelve -1/0/1 para alinearse con TS que suele devolver +-1.
// ----------------------------------------------------------------------------
inline double string_localeCompare(const std::string& a, const std::string& b) {
    const int cmp = a.compare(b);
    if (cmp < 0) return -1.0;
    if (cmp > 0) return 1.0;
    return 0.0;
}

// ----------------------------------------------------------------------------
// toString: alias identidad (string es ya string).
// ----------------------------------------------------------------------------
inline std::string string_toString(const std::string& value) {
    return value;
}

// ----------------------------------------------------------------------------
// numberToString: ya esta en ets_core.hpp. Redefinido aqui por consistencia
// para que el codegen pueda llamarlo via ets::string_numberToString.
// Tambien exportado en el namespace global (sin prefijo) para que el
// codegen de `numberToString(x)` (que se emite como llamada libre) lo
// encuentre en el linker.
// ----------------------------------------------------------------------------
// Number.prototype.toString() de JavaScript (#204): los dígitos más cortos que
// recuperan el double y notación decimal salvo si el exponente es < -6 o >= 21
// (3628800 → "3628800", 0.1+0.2 → "0.30000000000000004", 1e21 → "1e+21").
inline std::string js_number(double value) {
    if (value != value) return "NaN";
    // -0 se conserva (como console.log); el compilador lo necesita para sus constantes.
    if (value == 0) return std::signbit(value) ? "-0" : "0";
    if (value == HUGE_VAL) return "Infinity";
    if (value == -HUGE_VAL) return "-Infinity";
    char buffer[64];
    const auto converted = std::to_chars(buffer, buffer + sizeof(buffer), value, std::chars_format::scientific);
    if (converted.ec != std::errc{}) return std::string();
    std::string text(buffer, converted.ptr);
    std::string sign; if (text[0] == '-') { sign = "-"; text.erase(0, 1); }
    const std::size_t e = text.find('e');
    std::string digits = text.substr(0, e); digits.erase(std::remove(digits.begin(), digits.end(), '.'), digits.end());
    const int exponent = std::stoi(text.substr(e + 1));
    const int k = static_cast<int>(digits.size()); const int n = exponent + 1;
    if (k <= n && n <= 21) return sign + digits + std::string(static_cast<std::size_t>(n - k), '0');
    if (0 < n && n <= 21) return sign + digits.substr(0, static_cast<std::size_t>(n)) + "." + digits.substr(static_cast<std::size_t>(n));
    if (-6 < n && n <= 0) return sign + "0." + std::string(static_cast<std::size_t>(-n), '0') + digits;
    const int shown = n - 1;
    return sign + digits.substr(0, 1) + (k > 1 ? "." + digits.substr(1) : std::string()) + "e" + (shown >= 0 ? "+" : "-") + std::to_string(shown >= 0 ? shown : -shown);
}
inline std::string string_numberToString(double value) {
    return js_number(value);
}
inline std::string numberToString(double value) {
    return string_numberToString(value);
}

// ----------------------------------------------------------------------------
// string_size: tamano exacto que ocuparia un double si se serializara con
// string_numberToString. Usado por ets::detail::size_of_part (en
// ets_core.hpp) para pre-reservar buffers en ets::concat.
// ----------------------------------------------------------------------------
inline std::size_t string_size(double value) noexcept {
    return js_number(value).size();
}

// ----------------------------------------------------------------------------
// append_to: append optimizado a un std::string sin alocar temporales.
// Para doubles usa to_chars directo al buffer del string (C++20).
// Usado por ets::concat (en ets_core.hpp) bajo el namespace `detail`.
// ----------------------------------------------------------------------------
namespace detail {
inline void append_to(std::string& out, const std::string& s) { out.append(s); }
inline void append_to(std::string& out, const char* s) { out.append(s); }
inline void append_to(std::string& out, char c) { out.push_back(c); }
inline void append_to(std::string& out, double v) { out.append(js_number(v)); }
inline void append_to(std::string& out, float v) { append_to(out, static_cast<double>(v)); }
inline void append_to(std::string& out, int v) { append_to(out, static_cast<double>(v)); }
inline void append_to(std::string& out, long v) { append_to(out, static_cast<double>(v)); }
inline void append_to(std::string& out, long long v) { append_to(out, static_cast<double>(v)); }
inline void append_to(std::string& out, unsigned v) { append_to(out, static_cast<double>(v)); }
inline void append_to(std::string& out, unsigned long v) { append_to(out, static_cast<double>(v)); }
inline void append_to(std::string& out, unsigned long long v) { append_to(out, static_cast<double>(v)); }
inline void append_to(std::string& out, bool b) { b ? out.append("true", 4) : out.append("false", 5); }
}  // namespace detail

// ----------------------------------------------------------------------------
// length (alias sin prefijo para templates / sobrecarga). Tambien overloads
// para vector y tuple, como en el archivo original.
// ----------------------------------------------------------------------------
inline double length(const std::string& value) {
    return static_cast<double>(value.size());
}
template <typename T>
inline double length(const std::vector<T>& value) {
    return static_cast<double>(value.size());
}
template <typename... T>
inline double length(const std::tuple<T...>&) {
    return static_cast<double>(sizeof...(T));
}

// ----------------------------------------------------------------------------
// stringify_any: V30.36 helper para string concat con operandos no-string.
// Toma cualquier valor y devuelve su representacion como std::string.
// Usa std::ostringstream que soporta tipos primitivos, std::string,
// y containers con operator<<. Para tipos que no tengan operator<<,
// emite "<unstringifiable>" para que el error sea detectable.
// ----------------------------------------------------------------------------
#include <sstream>
// ----------------------------------------------------------------------------
// inspect: arrays, tuplas, Map, Set y T | undefined con el formato de
// console.log / util.inspect de Node (#214): `[ 1, 2 ]`, `[ 'a' ]`,
// `Map(1) { 'a' => 1 }`, `Set(2) { 1, 2 }`; una línea si cabe en 80 columnas,
// columnas para más de 6 elementos, profundidad 2 y como mucho 100 elementos.
// ----------------------------------------------------------------------------
template <typename T> struct inspect_vector : std::false_type {};
template <typename T, typename A> struct inspect_vector<std::vector<T, A>> : std::true_type {};
template <typename T> struct inspect_tuple : std::false_type {};
template <typename... T> struct inspect_tuple<std::tuple<T...>> : std::true_type {};
template <typename T, typename = void> struct inspect_optional : std::false_type {};
template <typename T> struct inspect_optional<T, std::void_t<decltype(std::declval<const T&>().isPresent()), decltype(std::declval<const T&>().value())>> : std::true_type {};
template <typename T, typename = void> struct inspect_keyed : std::false_type {};
template <typename T> struct inspect_keyed<T, std::void_t<decltype(std::declval<const T&>().data().begin()->second)>> : std::true_type {};
template <typename T, typename = void> struct inspect_set : std::false_type {};
template <typename T> struct inspect_set<T, std::void_t<decltype(*std::declval<const T&>().data().begin()), decltype(std::declval<const T&>().size())>> : std::bool_constant<!inspect_keyed<T>::value> {};
template <typename T, typename = void> struct inspect_boxed_bool : std::false_type {};
template <typename T> struct inspect_boxed_bool<T, std::void_t<decltype(std::declval<const T&>().value)>>
    : std::is_same<std::remove_cv_t<std::remove_reference_t<decltype(std::declval<const T&>().value)>>, bool> {};

template <typename T>
inline constexpr bool inspect_container = inspect_vector<T>::value || inspect_tuple<T>::value || inspect_keyed<T>::value || inspect_set<T>::value;

struct InspectContext {
    int indentation = 0;  // ctx.indentationLvl
    int currentDepth = 0; // ctx.currentDepth
};

// Comillas de Node: simples salvo que el texto las contenga (y no dobles).
inline std::string inspect_string(const std::string& text) {
    char quote = '\'';
    if (text.find('\'') != std::string::npos) {
        if (text.find('"') == std::string::npos) quote = '"';
        else if (text.find('`') == std::string::npos) quote = '`';
    }
    std::string result(1, quote);
    for (const char c : text) {
        if (c == quote || c == '\\') { result += '\\'; result += c; }
        else if (c == '\n') result += "\\n";
        else if (c == '\t') result += "\\t";
        else if (c == '\r') result += "\\r";
        else if (c == '\b') result += "\\b";
        else if (c == '\f') result += "\\f";
        else if (c == '\v') result += "\\v";
        else if (static_cast<unsigned char>(c) < 0x20 || c == 0x7f) {
            static const char* digits = "0123456789ABCDEF";
            result += "\\x"; result += digits[(static_cast<unsigned char>(c) >> 4) & 0xF]; result += digits[static_cast<unsigned char>(c) & 0xF];
        } else result += c;
    }
    result += quote;
    return result;
}

template <typename T> std::string inspect_value(InspectContext& ctx, const T& value, int depth);

// groupArrayElements de Node: con más de 6 elementos, en columnas.
inline std::vector<std::string> inspect_group(const InspectContext& ctx, const std::vector<std::string>& output, bool numbers, bool more) {
    const std::size_t outputLength = more ? output.size() - 1 : output.size();
    const double separatorSpace = 2;
    std::vector<double> dataLen(outputLength);
    double totalLength = 0, maxLength = 0;
    for (std::size_t i = 0; i < outputLength; ++i) {
        const double len = static_cast<double>(output[i].size());
        dataLen[i] = len; totalLength += len + separatorSpace;
        if (maxLength < len) maxLength = len;
    }
    const double actualMax = maxLength + separatorSpace;
    if (!(actualMax * 3 + ctx.indentation < 80 && (totalLength / actualMax > 5 || maxLength <= 6))) return output;
    const double averageBias = std::sqrt(actualMax - totalLength / static_cast<double>(output.size()));
    const double biasedMax = std::max(actualMax - 3 - averageBias, 1.0);
    double columns = std::round(std::sqrt(2.5 * biasedMax * static_cast<double>(outputLength)) / biasedMax);
    columns = std::min({columns, std::floor((80 - ctx.indentation) / actualMax), 3.0 * 4, 15.0});
    if (columns <= 1) return output;
    const std::size_t cols = static_cast<std::size_t>(columns);
    std::vector<double> maxLineLength;
    for (std::size_t i = 0; i < cols; ++i) {
        double lineLength = 0;
        for (std::size_t j = i; j < output.size(); j += cols) if (j < outputLength && dataLen[j] > lineLength) lineLength = dataLen[j];
        maxLineLength.push_back(lineLength + separatorSpace);
    }
    auto pad = [&](const std::string& text, double width) {
        const std::size_t w = width > 0 ? static_cast<std::size_t>(width) : 0;
        if (text.size() >= w) return text;
        return numbers ? std::string(w - text.size(), ' ') + text : text + std::string(w - text.size(), ' ');
    };
    std::vector<std::string> grouped;
    for (std::size_t i = 0; i < outputLength; i += cols) {
        const std::size_t max = std::min(i + cols, outputLength);
        std::string line;
        std::size_t j = i;
        for (; j < max - 1; ++j) line += pad(output[j] + ", ", maxLineLength[j - i]);
        if (numbers) line += pad(output[j], maxLineLength[j - i] - separatorSpace);
        else line += output[j];
        grouped.push_back(line);
    }
    if (more) grouped.push_back(output.back());
    return grouped;
}

// reduceToSingleString de Node.
inline std::string inspect_join(const InspectContext& ctx, std::vector<std::string> output, const std::string& base,
                                const std::string& open, const std::string& close, bool array, bool numbers, bool more, int depth) {
    const std::size_t entries = output.size();
    if (array && entries > 6) output = inspect_group(ctx, output, numbers, more);
    if (ctx.currentDepth - depth < 3 && entries == output.size()) {
        const std::size_t start = output.size() + static_cast<std::size_t>(ctx.indentation) + open.size() + base.size() + 10;
        std::size_t total = output.size() + start;
        bool below = total + output.size() <= 80;
        for (const auto& entry : output) { if (!below) break; total += entry.size(); below = total <= 80; }
        if (below) {
            std::string joined;
            for (std::size_t i = 0; i < output.size(); ++i) { if (i > 0) joined += ", "; joined += output[i]; }
            if (joined.find('\n') == std::string::npos) return (base.empty() ? "" : base + " ") + open + " " + joined + " " + close;
        }
    }
    const std::string indentation = "\n" + std::string(static_cast<std::size_t>(ctx.indentation), ' ');
    std::string result = (base.empty() ? "" : base + " ") + open + indentation + "  ";
    for (std::size_t i = 0; i < output.size(); ++i) { if (i > 0) result += "," + indentation + "  "; result += output[i]; }
    return result + indentation + close;
}

template <typename T>
inline std::string inspect_entry(InspectContext& ctx, const T& value, int depth) {
    ctx.indentation += 2;
    std::string text = inspect_value(ctx, value, depth);
    ctx.indentation -= 2;
    return text;
}

template <typename T>
std::string inspect_value(InspectContext& ctx, const T& value, int depth) {
    if constexpr (std::is_same_v<T, std::string>) return inspect_string(value);
    else if constexpr (std::is_same_v<T, bool>) return value ? "true" : "false";
    else if constexpr (inspect_boxed_bool<T>::value) return value.value ? "true" : "false";
    else if constexpr (std::is_floating_point_v<T>) return js_number(static_cast<double>(value));
    else if constexpr (std::is_integral_v<T>) return std::to_string(value);
    else if constexpr (inspect_optional<T>::value) return value.isPresent() ? inspect_value(ctx, value.value(), depth) : std::string("undefined");
    else if constexpr (inspect_container<T>) {
        const std::string kind = inspect_keyed<T>::value ? "Map" : inspect_set<T>::value ? "Set" : "Array";
        std::string base;
        if constexpr (inspect_keyed<T>::value || inspect_set<T>::value) base = kind + "(" + std::to_string(value.size()) + ")";
        if (depth > 2) return "[" + kind + "]";
        ctx.currentDepth = depth;
        std::vector<std::string> output;
        bool numbers = true, more = false;
        if constexpr (inspect_vector<T>::value) {
            using E = typename T::value_type;
            numbers = std::is_arithmetic_v<E> && !std::is_same_v<E, bool>;
            if (value.empty()) return "[]";
            const std::size_t shown = std::min<std::size_t>(value.size(), 100);
            for (std::size_t i = 0; i < shown; ++i) output.push_back(inspect_entry(ctx, value[i], depth + 1));
            if (value.size() > shown) {
                const std::size_t rest = value.size() - shown;
                output.push_back("... " + std::to_string(rest) + " more item" + (rest > 1 ? "s" : ""));
                more = true;
            }
        } else if constexpr (inspect_tuple<T>::value) {
            numbers = false;
            std::apply([&](const auto&... item) { (output.push_back(inspect_entry(ctx, item, depth + 1)), ...); }, value);
            if (output.empty()) return "[]";
        } else if constexpr (inspect_keyed<T>::value) {
            if (value.size() == 0) return base + " {}";
            for (const auto& pair : value.data()) output.push_back(inspect_entry(ctx, pair.first, depth + 1) + " => " + inspect_entry(ctx, pair.second, depth + 1));
        } else {
            if (value.size() == 0) return base + " {}";
            for (const auto& item : value.data()) output.push_back(inspect_entry(ctx, item, depth + 1));
        }
        const bool array = inspect_vector<T>::value || inspect_tuple<T>::value;
        return inspect_join(ctx, output, base, array ? "[" : "{", array ? "]" : "}", array, numbers, more, depth);
    } else {
        std::ostringstream text;
        text << value;
        return text.str();
    }
}

// Escribe un valor como lo mostraría JavaScript: true/false y números con
// js_number (#204, #208), contenedores como util.inspect (#214); el resto con
// su operator<<.
template <typename T>
inline void display(std::ostream& out, const T& value) {
    if constexpr (std::is_same_v<T, bool>) out << (value ? "true" : "false");
    else if constexpr (std::is_floating_point_v<T>) out << js_number(static_cast<double>(value));
    else if constexpr (inspect_container<T> || inspect_boxed_bool<T>::value) { InspectContext ctx; out << inspect_value(ctx, value, 0); }
    else if constexpr (inspect_optional<T>::value) { if (value.isPresent()) display(out, value.value()); else out << "undefined"; }
    else out << value;
}
template <typename T>
inline std::string stringify_any(const T& value) {
    std::ostringstream oss;
    display(oss, value);
    return oss.str();
}

}  // namespace ets

// `String` global: String.fromCharCode(...) y String.fromCodePoint(...).
// Cada código se escribe en UTF-8; fromCharCode toma el código módulo 2^16.
struct ets_string_object {
    template <typename... Codes>
    static std::string fromCharCode(const Codes&... codes) {
        std::string out;
        (ets::append_utf8(out, static_cast<double>(static_cast<std::uint16_t>(static_cast<std::int64_t>(std::isnan(static_cast<double>(codes)) ? 0.0 : static_cast<double>(codes))))), ...);
        return out;
    }
    template <typename... Codes>
    static std::string fromCodePoint(const Codes&... codes) {
        std::string out;
        (ets::append_utf8(out, static_cast<double>(codes)), ...);
        return out;
    }
};
inline ets_string_object String{};
