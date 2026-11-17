// Map<K, V> y Set<T> de JavaScript: se recorren en orden de inserción.
// Las entradas viven en un vector (con huecos al borrar) y un índice hash da
// get/set/has/delete en O(1). Los huecos se compactan cuando son muchos o al
// recorrer por posición.
#pragma once
#include <cstddef>
#include <iterator>
#include <type_traits>
#include <optional>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>

namespace ets {

// Vista de las entradas vivas (sin huecos) para recorrerlas con for.
template <typename Entry>
class LiveEntries {
    const std::vector<std::optional<Entry>>* entries_;
public:
    explicit LiveEntries(const std::vector<std::optional<Entry>>& entries) : entries_(&entries) {}
    class iterator {
        const std::vector<std::optional<Entry>>* entries_; std::size_t at_;
        void skip() { while (at_ < entries_->size() && !(*entries_)[at_]) ++at_; }
    public:
        using iterator_category = std::forward_iterator_tag;
        using value_type = Entry; using difference_type = std::ptrdiff_t;
        using pointer = const Entry*; using reference = const Entry&;
        iterator(const std::vector<std::optional<Entry>>* entries, std::size_t at) : entries_(entries), at_(at) { skip(); }
        reference operator*() const { return *(*entries_)[at_]; }
        pointer operator->() const { return &*(*entries_)[at_]; }
        iterator& operator++() { ++at_; skip(); return *this; }
        iterator operator++(int) { iterator copy = *this; ++*this; return copy; }
        bool operator==(const iterator& other) const { return at_ == other.at_; }
        bool operator!=(const iterator& other) const { return at_ != other.at_; }
    };
    iterator begin() const { return iterator(entries_, 0); }
    iterator end() const { return iterator(entries_, entries_->size()); }
};

template <typename Key, typename Entry>
class OrderedTable {
protected:
    std::vector<std::optional<Entry>> entries_;
    std::unordered_map<Key, std::size_t> index_;
    std::size_t holes_ = 0;
    void compact() {
        if (holes_ == 0) return;
        std::vector<std::optional<Entry>> next;
        next.reserve(index_.size());
        for (auto& entry : entries_) if (entry) { next.push_back(std::move(entry)); }
        entries_ = std::move(next);
        for (std::size_t at = 0; at < entries_.size(); ++at) index_[key(*entries_[at])] = at;
        holes_ = 0;
    }
    static const Key& key(const Entry& entry) {
        if constexpr (std::is_same_v<Key, Entry>) return entry; else return entry.first;
    }
    bool erase(const Key& value) {
        auto it = index_.find(value);
        if (it == index_.end()) return false;
        entries_[it->second].reset();
        index_.erase(it);
        ++holes_;
        if (holes_ > 32 && holes_ * 2 > entries_.size()) compact();
        return true;
    }
public:
    bool has(const Key& value) const { return index_.find(value) != index_.end(); }
    bool removeKey(const Key& value) { return erase(value); }
    std::size_t size() const { return index_.size(); }
    void clear() { entries_.clear(); index_.clear(); holes_ = 0; }
    LiveEntries<Entry> data() const { return LiveEntries<Entry>(entries_); }
    // Entrada viva número `position` (para for...of por posición).
    const Entry& entryAt(std::size_t position) const { const_cast<OrderedTable*>(this)->compact(); return *entries_[position]; }
};

template <typename K, typename V>
class Map : public OrderedTable<K, std::pair<K, V>> {
    using Base = OrderedTable<K, std::pair<K, V>>;
public:
    Map() = default;
    std::optional<V> get(const K& key) const {
        auto it = this->index_.find(key);
        if (it == this->index_.end()) return std::nullopt;
        return this->entries_[it->second]->second;
    }
    // set devuelve el propio Map, como en JavaScript (m.set(a, 1).set(b, 2)).
    Map& set(const K& key, V value) {
        auto it = this->index_.find(key);
        if (it != this->index_.end()) this->entries_[it->second]->second = std::move(value);
        else { this->index_.emplace(key, this->entries_.size()); this->entries_.emplace_back(std::pair<K, V>(key, std::move(value))); }
        return *this;
    }
    // new Map(entradas): cualquier secuencia de pares/tuplas clave-valor.
    template <typename Source>
    static Map from(const Source& source) {
        Map result;
        for (const auto& entry : source) result.set(std::get<0>(entry), std::get<1>(entry));
        return result;
    }
    std::vector<K> keys() const { std::vector<K> out; out.reserve(this->size()); for (const auto& e : this->data()) out.push_back(e.first); return out; }
    std::vector<V> values() const { std::vector<V> out; out.reserve(this->size()); for (const auto& e : this->data()) out.push_back(e.second); return out; }
    std::vector<std::tuple<K, V>> entries() const { std::vector<std::tuple<K, V>> out; out.reserve(this->size()); for (const auto& e : this->data()) out.emplace_back(e.first, e.second); return out; }
    template <typename F>
    void forEach(F&& fn) const {
        for (const auto& entry : this->entries_) if (entry) {
            if constexpr (std::is_invocable_v<F&, const V&, const K&>) fn(entry->second, entry->first);
            else fn(entry->second);
        }
    }
};

template <typename T>
class Set : public OrderedTable<T, T> {
public:
    Set() = default;
    // add devuelve el propio Set, como en JavaScript (s.add(1).add(2)).
    Set& add(const T& value) {
        if (this->index_.find(value) == this->index_.end()) { this->index_.emplace(value, this->entries_.size()); this->entries_.emplace_back(value); }
        return *this;
    }
    // new Set(valores): cualquier secuencia.
    template <typename Source>
    static Set from(const Source& source) { Set result; for (const auto& value : source) result.add(value); return result; }
    std::vector<T> keys() const { return values(); }
    std::vector<T> values() const { std::vector<T> out; out.reserve(this->size()); for (const auto& e : this->data()) out.push_back(e); return out; }
    std::vector<std::tuple<T, T>> entries() const { std::vector<std::tuple<T, T>> out; out.reserve(this->size()); for (const auto& e : this->data()) out.emplace_back(e, e); return out; }
    template <typename F>
    void forEach(F&& fn) const {
        for (const auto& entry : this->entries_) if (entry) {
            if constexpr (std::is_invocable_v<F&, const T&, const T&>) fn(*entry, *entry);
            else fn(*entry);
        }
    }
};

} // namespace ets
