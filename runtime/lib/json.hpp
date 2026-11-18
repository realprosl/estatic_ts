// Soporte en C++ de estatic:json: JSON.stringify y JSON.parse<T> sobre los
// tipos que genera el compilador. Las clases se recorren con ets_fields, que el
// generador emite en cada struct (nombre del campo y su valor).
#pragma once
#include <array>
#include <cmath>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <tuple>
#include <type_traits>
#include <variant>
#include <vector>
#include "runtime/ets_runtime.hpp"

namespace ets_jsonlib {

template<class T> struct is_slot : std::false_type {};
template<class T> struct is_slot<ets::ir::Slot<T>> : std::true_type { using inner = T; };
template<class T> struct is_optional : std::false_type {};
template<class T> struct is_optional<ets::Optional<T>> : std::true_type {};
template<class T> struct is_std_optional : std::false_type {};
template<class T> struct is_std_optional<std::optional<T>> : std::true_type {};
template<class T> struct is_vector : std::false_type {};
template<class T, class A> struct is_vector<std::vector<T, A>> : std::true_type {};
template<class T> struct is_array : std::false_type {};
template<class T, std::size_t N> struct is_array<std::array<T, N>> : std::true_type {};
template<class T> struct is_tuple : std::false_type {};
template<class... T> struct is_tuple<std::tuple<T...>> : std::true_type {};
template<class T> struct is_map : std::false_type {};
template<class K, class V> struct is_map<ets::Map<K, V>> : std::true_type {};
template<class T> struct is_set : std::false_type {};
template<class T> struct is_set<ets::Set<T>> : std::true_type {};
template<class T> struct is_unique : std::false_type {};
template<class T, class D> struct is_unique<std::unique_ptr<T, D>> : std::true_type {};
template<class T> struct is_variant : std::false_type {};
template<class... T> struct is_variant<std::variant<T...>> : std::true_type {};

template<class T> concept Record = requires(const T& value) { value.ets_fields([](const char*, const auto&) {}); };
template<class T> concept Sum = requires(const T& value) { value.data; } && is_variant<std::remove_cvref_t<decltype(std::declval<const T&>().data)>>::value;

inline void quote(std::string& out, const std::string& text) {
    static const char* hex = "0123456789abcdef";
    out.push_back('"');
    for (unsigned char c : text) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) { out += "\\u00"; out.push_back(hex[c >> 4]); out.push_back(hex[c & 15]); }
                else out.push_back(static_cast<char>(c));
        }
    }
    out.push_back('"');
}

// Sangría de JSON.stringify(valor, null, space): "" es la salida compacta.
struct Layout {
    std::string gap;
    std::string current;
};

template<class T> bool write(std::string& out, const T& value, Layout& layout);

inline void open(std::string& out, Layout& layout, char bracket, std::string& saved) {
    out.push_back(bracket); saved = layout.current; layout.current += layout.gap;
}
inline void item(std::string& out, const Layout& layout, bool first) {
    if (!first) out.push_back(',');
    if (!layout.gap.empty()) { out.push_back('\n'); out += layout.current; }
}
inline void close(std::string& out, Layout& layout, char bracket, const std::string& saved, bool empty) {
    layout.current = saved;
    if (!empty && !layout.gap.empty()) { out.push_back('\n'); out += layout.current; }
    out.push_back(bracket);
}

inline void writeValue(std::string& out, const ets_json_value& value, Layout& layout) {
    if (value.isNull()) { out += "null"; return; }
    if (value.isString()) { quote(out, std::get<std::string>(value.storage)); return; }
    if (value.isBool()) { out += std::get<bool>(value.storage) ? "true" : "false"; return; }
    if (value.isNumber()) { const double n = std::get<double>(value.storage); out += !std::isfinite(n) ? "null" : n == 0 ? "0" : ets::js_number(n); return; }
    std::string saved; bool first = true;
    if (value.isArray()) {
        open(out, layout, '[', saved);
        for (const auto& element : std::get<ets_json_value::Array>(value.storage)) { item(out, layout, first); first = false; writeValue(out, element, layout); }
        close(out, layout, ']', saved, first); return;
    }
    open(out, layout, '{', saved);
    for (const auto& [key, element] : std::get<ets_json_value::Object>(value.storage)) {
        item(out, layout, first); first = false; quote(out, key); out += layout.gap.empty() ? ":" : ": "; writeValue(out, element, layout);
    }
    close(out, layout, '}', saved, first);
}

// Escribe el valor; devuelve false si es undefined (se omite en un objeto).
template<class T> bool write(std::string& out, const T& value, Layout& layout) {
    using V = std::remove_cvref_t<T>;
    if constexpr (is_slot<V>::value) return write(out, value.get(), layout);
    else if constexpr (std::is_same_v<V, bool>) { out += value ? "true" : "false"; return true; }
    else if constexpr (std::is_arithmetic_v<V>) {
        const double n = static_cast<double>(value);
        out += !std::isfinite(n) ? "null" : n == 0 ? "0" : ets::js_number(n); return true;
    }
    else if constexpr (std::is_same_v<V, std::string>) { quote(out, value); return true; }
    else if constexpr (std::is_same_v<V, ets_json_value>) { writeValue(out, value, layout); return true; }
    else if constexpr (is_optional<V>::value) { if (value.isEmpty()) return false; return write(out, value.value(), layout); }
    else if constexpr (is_std_optional<V>::value) { if (!value) return false; return write(out, *value, layout); }
    else if constexpr (is_unique<V>::value) { if (!value) { out += "null"; return true; } return write(out, *value, layout); }
    else if constexpr (is_vector<V>::value || is_array<V>::value) {
        std::string saved; bool first = true; open(out, layout, '[', saved);
        for (const auto& element : value) { item(out, layout, first); first = false; if (!write(out, element, layout)) out += "null"; }
        close(out, layout, ']', saved, first); return true;
    }
    else if constexpr (is_tuple<V>::value) {
        std::string saved; bool first = true; open(out, layout, '[', saved);
        std::apply([&](const auto&... element) { ((item(out, layout, first), first = false, write(out, element, layout) || (out += "null", true)), ...); }, value);
        close(out, layout, ']', saved, first); return true;
    }
    // Como en JavaScript, un Map o un Set sin toJSON se escribe como {}.
    else if constexpr (is_map<V>::value || is_set<V>::value) { out += "{}"; return true; }
    else if constexpr (Record<V>) {
        std::string saved; bool first = true; open(out, layout, '{', saved);
        value.ets_fields([&](const char* name, const auto& field) {
            std::string piece; Layout inner = layout;
            if (!write(piece, field, inner)) return;
            item(out, layout, first); first = false; quote(out, name); out += layout.gap.empty() ? ":" : ": "; out += piece;
        });
        close(out, layout, '}', saved, first); return true;
    }
    else if constexpr (Sum<V>) { return std::visit([&](const auto& alternative) { return write(out, alternative, layout); }, value.data); }
    else if constexpr (std::is_invocable_v<V>) return false;
    else { out += "null"; return true; }
}

template<class T> std::string stringify(const T& value, double spaces, const std::string& text) {
    Layout layout;
    if (text.empty()) { const int count = spaces != spaces ? 0 : static_cast<int>(std::min(10.0, std::max(0.0, std::trunc(spaces)))); layout.gap = std::string(count, ' '); }
    else layout.gap = text.substr(0, 10);
    std::string out;
    if (!write(out, value, layout)) return "undefined";
    return out;
}

// --- JSON.parse<T>: del árbol JSON al tipo, con la ruta del error ($.a[0].b). ---

inline const char* kind(const ets_json_value& value) {
    if (value.isNull()) return "null";
    if (value.isString()) return "string";
    if (value.isNumber()) return "number";
    if (value.isBool()) return "boolean";
    if (value.isArray()) return "array";
    return "object";
}
inline bool fail(std::string& error, const std::string& path, const std::string& expected, const ets_json_value& value) {
    error = "se esperaba " + expected + " en " + path + " y hay " + kind(value);
    return false;
}

template<class T> bool read(const ets_json_value& value, T& target, const std::string& path, std::string& error);

template<class T> constexpr bool optionalField() {
    using V = std::remove_cvref_t<T>;
    if constexpr (is_slot<V>::value) return optionalField<typename is_slot<V>::inner>();
    else return is_optional<V>::value;
}

template<class T> bool read(const ets_json_value& value, T& target, const std::string& path, std::string& error) {
    using V = std::remove_cvref_t<T>;
    if constexpr (is_slot<V>::value) {
        using Inner = typename is_slot<V>::inner;
        Inner inner{}; if (!read(value, inner, path, error)) return false; target.set(std::move(inner)); return true;
    }
    else if constexpr (std::is_same_v<V, bool>) { if (!value.isBool()) return fail(error, path, "boolean", value); target = std::get<bool>(value.storage); return true; }
    else if constexpr (std::is_arithmetic_v<V>) {
        if (!value.isNumber()) return fail(error, path, "number", value);
        const double n = std::get<double>(value.storage);
        if constexpr (std::is_integral_v<V>) { if (std::trunc(n) != n) return fail(error, path, "un entero", value); }
        target = static_cast<V>(n); return true;
    }
    else if constexpr (std::is_same_v<V, std::string>) { if (!value.isString()) return fail(error, path, "string", value); target = std::get<std::string>(value.storage); return true; }
    else if constexpr (std::is_same_v<V, ets_json_value>) { target = value; return true; }
    else if constexpr (is_optional<V>::value) {
        if (value.isNull()) { target = V(); return true; }
        typename std::remove_cvref_t<decltype(target.value())> inner{};
        if (!read(value, inner, path, error)) return false; target = V(std::move(inner)); return true;
    }
    else if constexpr (is_vector<V>::value) {
        if (!value.isArray()) return fail(error, path, "array", value);
        const auto& items = std::get<ets_json_value::Array>(value.storage); V result; result.reserve(items.size());
        for (std::size_t at = 0; at < items.size(); ++at) {
            typename V::value_type element{};
            if (!read(items[at], element, path + "[" + std::to_string(at) + "]", error)) return false;
            result.push_back(std::move(element));
        }
        target = std::move(result); return true;
    }
    else if constexpr (is_array<V>::value) {
        if (!value.isArray()) return fail(error, path, "array", value);
        const auto& items = std::get<ets_json_value::Array>(value.storage);
        if (items.size() != target.size()) { error = "se esperaban " + std::to_string(target.size()) + " elementos en " + path + " y hay " + std::to_string(items.size()); return false; }
        for (std::size_t at = 0; at < items.size(); ++at) if (!read(items[at], target[at], path + "[" + std::to_string(at) + "]", error)) return false;
        return true;
    }
    else if constexpr (is_tuple<V>::value) {
        if (!value.isArray()) return fail(error, path, "array", value);
        const auto& items = std::get<ets_json_value::Array>(value.storage);
        if (items.size() != std::tuple_size_v<V>) { error = "se esperaban " + std::to_string(std::tuple_size_v<V>) + " elementos en " + path + " y hay " + std::to_string(items.size()); return false; }
        bool ok = true; std::size_t at = 0;
        std::apply([&](auto&... element) { ((ok = ok && read(items[at], element, path + "[" + std::to_string(at) + "]", error), ++at), ...); }, target);
        return ok;
    }
    else if constexpr (is_map<V>::value) {
        if (!value.isObject()) return fail(error, path, "object", value);
        V result;
        for (const auto& [key, element] : std::get<ets_json_value::Object>(value.storage)) {
            std::remove_cvref_t<decltype(result.get(key).value())> inner{};
            if (!read(element, inner, path + "." + key, error)) return false;
            result.set(key, std::move(inner));
        }
        target = std::move(result); return true;
    }
    else if constexpr (Record<V>) {
        if (!value.isObject()) return fail(error, path, "object", value);
        const auto& object = std::get<ets_json_value::Object>(value.storage); bool ok = true;
        target.ets_fields([&](const char* name, auto& field) {
            if (!ok) return;
            auto found = object.find(name);
            if (found == object.end()) {
                if constexpr (optionalField<std::remove_cvref_t<decltype(field)>>()) {
                    using F = std::remove_cvref_t<decltype(field)>;
                    if constexpr (is_slot<F>::value) field.set(typename is_slot<F>::inner()); else field = F();
                }
                else { error = "falta el campo '" + std::string(name) + "' en " + path; ok = false; }
                return;
            }
            ok = read(found->second, field, path + "." + name, error);
        });
        return ok;
    }
    else if constexpr (Sum<V>) {
        // La primera alternativa que encaja.
        bool ok = false; std::string first;
        auto attempt = [&](auto tag) {
            if (ok) return;
            using A = typename decltype(tag)::type; A alternative{}; std::string message;
            if (read(value, alternative, path, message)) { target.data = std::move(alternative); ok = true; }
            else if (first.empty()) first = message;
        };
        [&]<class... A>(std::variant<A...>*) { (attempt(std::type_identity<A>{}), ...); }(static_cast<decltype(target.data)*>(nullptr));
        if (!ok) error = first;
        return ok;
    }
    else { error = "tipo sin lectura JSON en " + path; return false; }
}

// decode(texto) se convierte en el Result<T, string> que espera la función de Estatic.
struct Decoded {
    std::string text;
    template<class R> operator R() const {
        using T = std::remove_cvref_t<decltype(std::declval<R&>().value())>;
        ets_json_value tree; std::string error;
        if (!ets_json_parser::parseDocument(text, tree, error)) return R::failure("JSON no válido: " + error);
        T result{};
        if (!read(tree, result, "$", error)) return R::failure(error);
        return R::success(std::move(result));
    }
};
inline Decoded decode(const std::string& text) { return Decoded{text}; }

}  // namespace ets_jsonlib
