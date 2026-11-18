// Object.keys / Object.values / Object.entries de TypeScript.
// Un Record<K, V> abierto es un ets::Map (se recorre en orden de inserción); un
// objeto con campos es un struct con ets_fields (orden de declaración). R es el
// tipo del resultado que decide el compilador (string[], V[] o [string, V][]).
#pragma once
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

namespace ets {

template <class T> concept HasEntries = requires(const T& value) { value.keys(); value.values(); value.entries(); };
template <class T> concept HasFields = requires(const T& value) { value.ets_fields([](const char*, const auto&) {}); };

// Los campos de un struct pueden venir envueltos (con .get()).
template <class F> decltype(auto) field_value(const F& field) { if constexpr (requires { field.get(); }) return field.get(); else return (field); }

template <class R, class T> R object_keys(const T& value) {
    R out;
    if constexpr (HasEntries<T>) { for (auto& key : value.keys()) out.push_back(key); }
    else { static_assert(HasFields<T>, "Object.keys: tipo sin campos"); value.ets_fields([&](const char* name, const auto&) { out.push_back(std::string(name)); }); }
    return out;
}
template <class R, class T> R object_values(const T& value) {
    R out;
    if constexpr (HasEntries<T>) { for (auto& item : value.values()) out.push_back(item); }
    else {
        using V = typename R::value_type;
        value.ets_fields([&](const char*, const auto& field) { if constexpr (std::is_convertible_v<decltype(field_value(field)), V>) out.push_back(V(field_value(field))); });
    }
    return out;
}
template <class R, class T> R object_entries(const T& value) {
    R out;
    using E = typename R::value_type;
    if constexpr (HasEntries<T>) { for (auto& entry : value.entries()) out.push_back(E(std::get<0>(entry), std::get<1>(entry))); }
    else {
        using V = std::remove_cvref_t<decltype(std::get<1>(std::declval<E>()))>;
        value.ets_fields([&](const char* name, const auto& field) { if constexpr (std::is_convertible_v<decltype(field_value(field)), V>) out.push_back(E(std::string(name), V(field_value(field)))); });
    }
    return out;
}

}  // namespace ets
