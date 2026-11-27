#pragma once

// symbol de TypeScript (#221). Symbol(desc) da un valor único (un contador
// global, no un hash del texto); Symbol.for(key) usa un registro global, así la
// misma clave da siempre el mismo symbol; Symbol.keyFor(s) devuelve esa clave.
// Con std::hash, un symbol sirve de clave de Map y Record.

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <ostream>
#include <string>
#include "runtime/ets_optional.hpp"

namespace ets {

struct Symbol {
    std::uint64_t id = 0;
    bool described = false;
    std::string text;
    bool operator==(const Symbol& other) const { return id == other.id; }
    bool operator!=(const Symbol& other) const { return id != other.id; }
};

inline std::uint64_t symbol_next() {
    static std::atomic<std::uint64_t> counter{1};
    return counter.fetch_add(1);
}

inline Symbol symbol_create() { return Symbol{symbol_next(), false, ""}; }
inline Symbol symbol_create(const std::string& description) { return Symbol{symbol_next(), true, description}; }

struct SymbolRegistry {
    std::mutex lock;
    std::map<std::string, Symbol> byKey;
    std::map<std::uint64_t, std::string> keys;
};

inline SymbolRegistry& symbol_registry() {
    static SymbolRegistry registry;
    return registry;
}

inline Symbol symbol_for(const std::string& key) {
    SymbolRegistry& registry = symbol_registry();
    std::lock_guard<std::mutex> guard(registry.lock);
    auto found = registry.byKey.find(key);
    if (found != registry.byKey.end()) return found->second;
    Symbol created = symbol_create(key);
    registry.byKey.emplace(key, created);
    registry.keys.emplace(created.id, key);
    return created;
}

inline Optional<std::string> symbol_keyFor(const Symbol& value) {
    SymbolRegistry& registry = symbol_registry();
    std::lock_guard<std::mutex> guard(registry.lock);
    auto found = registry.keys.find(value.id);
    if (found == registry.keys.end()) return Optional<std::string>::none();
    return Optional<std::string>::some(found->second);
}

inline Optional<std::string> symbol_description(const Symbol& value) {
    return value.described ? Optional<std::string>::some(value.text) : Optional<std::string>::none();
}

inline std::string symbol_toString(const Symbol& value) { return "Symbol(" + value.text + ")"; }

inline std::ostream& operator<<(std::ostream& out, const Symbol& value) { return out << symbol_toString(value); }

}  // namespace ets

template <>
struct std::hash<ets::Symbol> {
    std::size_t operator()(const ets::Symbol& value) const noexcept { return std::hash<std::uint64_t>{}(value.id); }
};
