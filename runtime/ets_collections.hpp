// V7: helpers de colecciones (`filter`, `map`, `reduce`) sobre `std::vector<T>`.
//
// El dialecto no soporta métodos sobre tipos genéricos parametrizados como
// `T[]` (no hay `arr.filter(p)` directamente — el método se reescribe en el
// codegen a una llamada a uno de estos helpers). Cada helper se modela como
// plantilla C++ con dos parámetros: el tipo de elemento y el functor (lambda
// o `std::function`). Así el caller no paga indirección de `std::function`
// si pasa una lambda inline.
//
// API expuesta (en el namespace global para que el codegen pueda emitir las
// llamadas directamente sin lookup de namespace):
//   ets_filter_vec<T>(src, pred)    → std::vector<T>
//   ets_map_vec<T, U>(src, f)       → std::vector<U>
//   ets_reduce<U, T>(init, src, op) → U
//
// Las cadenas conservan etapas eager: filter termina antes de map y map
// antes de reduce. La antigua fusión AST se retiró porque intercalaba efectos
// observables y perdía capturas locales. La fuente se observa por const&;
// filter y map producen vectores independientes y reduce respeta init vacío.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <initializer_list>
#include <sstream>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>
#include "ets_optional.hpp"
#include "ets_string.hpp"

// Llama al callback de un método de array con (valor) o (valor, índice),
// según lo que acepte, como en JavaScript.
template <typename F, typename T>
inline decltype(auto) ets_call_item(F& f, const T& item, std::size_t index) {
    if constexpr (std::is_invocable_v<F&, const T&, double>) return f(item, static_cast<double>(index));
    else return f(item);
}
template <typename F, typename A, typename T>
inline decltype(auto) ets_call_fold(F& f, const A& acc, const T& item, std::size_t index) {
    if constexpr (std::is_invocable_v<F&, const A&, const T&, double>) return f(acc, item, static_cast<double>(index));
    else return f(acc, item);
}

// `ets_filter_vec<T>(src, pred)` — versión plantilla que acepta cualquier
// callable compatible con `bool(const T&)` (incluye lambdas `[=](const T&) -> bool`).
// Evita la sobrecarga de `std::function` cuando el caller pasa una lambda
// inline. La firma con `std::function<bool(const T&)>` también se acepta
// por conversión implícita.
template <typename T, typename Pred>
inline std::vector<T> ets_filter_vec(const std::vector<T>& src, Pred&& pred) {
    std::vector<T> out;
    out.reserve(src.size());
    for (std::size_t i = 0; i < src.size(); ++i) {
        if (ets_call_item(pred, src[i], i)) out.push_back(src[i]);
    }
    return out;
}

// Overload para `std::function` explícito (legibilidad cuando el caller
// guarda el predicado en una variable de tipo `std::function`).
template <typename T>
inline std::vector<T> ets_filter_vec(const std::vector<T>& src, const std::function<bool(const T&)>& pred) {
    return ets_filter_vec<T, std::function<bool(const T&)>>(src, pred);
}

// `ets_map_vec<T, U>(src, f)` — aplica `f` a cada elemento y devuelve un
// `std::vector<U>`. El parámetro `T` es deducible del `src`; `U` debe
// poder deducirse del tipo de retorno de `f` (`auto`).
template <typename T, typename U, typename F>
inline std::vector<U> ets_map_vec(const std::vector<T>& src, F&& f) {
    std::vector<U> out;
    out.reserve(src.size());
    for (std::size_t i = 0; i < src.size(); ++i) {
        out.push_back(ets_call_item(f, src[i], i));
    }
    return out;
}

// Overload para `std::function` explícito.
template <typename T, typename U>
inline std::vector<U> ets_map_vec(const std::vector<T>& src, const std::function<U(const T&)>& f) {
    return ets_map_vec<T, U, std::function<U(const T&)>>(src, f);
}

// `ets_reduce<U, T>(init, src, op)` — pliega `src` con `op` desde `init`.
// `U` es el tipo del acumulador, `T` el del elemento; ambos se deducen de
// los argumentos. Si `src` está vacío, devuelve `init` sin invocar `op`.
template <typename U, typename T, typename Op>
inline U ets_reduce(U init, const std::vector<T>& src, Op&& op) {
    U acc = init;
    for (std::size_t i = 0; i < src.size(); ++i) {
        acc = ets_call_fold(op, acc, src[i], i);
    }
    return acc;
}

// reduce(op) sin valor inicial: empieza con el primer elemento. Con el array
// vacío JavaScript lanza TypeError; aquí, sin excepciones, el programa termina
// con ese mismo mensaje.
[[noreturn]] inline void ets_reduce_empty() {
    std::fputs("TypeError: Reduce of empty array with no initial value\n", stderr);
    std::exit(1);
}
template <typename T, typename Op>
inline T ets_reduce_first(const std::vector<T>& src, Op&& op) {
    if (src.empty()) ets_reduce_empty();
    T acc = src[0];
    for (std::size_t i = 1; i < src.size(); ++i) acc = ets_call_fold(op, acc, src[i], i);
    return acc;
}
template <typename U, typename T, typename Op>
inline U ets_reduce_right(U init, const std::vector<T>& src, Op&& op) {
    U acc = init;
    for (std::size_t i = src.size(); i-- > 0;) acc = ets_call_fold(op, acc, src[i], i);
    return acc;
}
template <typename T, typename Op>
inline T ets_reduce_right_first(const std::vector<T>& src, Op&& op) {
    if (src.empty()) ets_reduce_empty();
    T acc = src.back();
    for (std::size_t i = src.size() - 1; i-- > 0;) acc = ets_call_fold(op, acc, src[i], i);
    return acc;
}

// Overload para `std::function` explícito (útil cuando el operator se
// guarda en una variable capturada).
template <typename U, typename T>
inline U ets_reduce(U init, const std::vector<T>& src, const std::function<U(const U&, const T&)>& op) {
    return ets_reduce<U, T, std::function<U(const U&, const T&)>>(init, src, op);
}

// V11: `ets_for_each_vec<T>(src, fn)` — aplica `fn` a cada elemento
// sin producir resultado. Equivalente a `for (auto& item : src) fn(item)`.
template <typename T, typename F>
inline void ets_for_each_vec(const std::vector<T>& src, F&& fn) {
    for (std::size_t i = 0; i < src.size(); ++i) ets_call_item(fn, src[i], i);
}

// V13: `ets_find_vec<T>(src, pred)` — devuelve `Optional<T>` con el
// primer elemento que cumple `pred`, o vacío si ninguno. El usuario
// discrimina con `?.`, `match` o `value()` (que aborta si vacío).
template <typename T, typename Pred>
inline ets::Optional<T> ets_find_vec(const std::vector<T>& src, Pred&& pred) {
    for (std::size_t i = 0; i < src.size(); ++i) if (ets_call_item(pred, src[i], i)) return ets::Optional<T>::some(src[i]);
    return ets::Optional<T>::none();
}

// findIndex / findLast / findLastIndex: como find, con -1 si no hay ninguno.
template <typename T, typename Pred>
inline double ets_find_index_vec(const std::vector<T>& src, Pred&& pred) {
    for (std::size_t i = 0; i < src.size(); ++i) if (ets_call_item(pred, src[i], i)) return static_cast<double>(i);
    return -1.0;
}
template <typename T, typename Pred>
inline ets::Optional<T> ets_find_last_vec(const std::vector<T>& src, Pred&& pred) {
    for (std::size_t i = src.size(); i-- > 0;) if (ets_call_item(pred, src[i], i)) return ets::Optional<T>::some(src[i]);
    return ets::Optional<T>::none();
}
template <typename T, typename Pred>
inline double ets_find_last_index_vec(const std::vector<T>& src, Pred&& pred) {
    for (std::size_t i = src.size(); i-- > 0;) if (ets_call_item(pred, src[i], i)) return static_cast<double>(i);
    return -1.0;
}

// V11: `ets_some_vec<T>(src, pred)` — true si AL MENOS UN elemento cumple `pred`.
template <typename T, typename Pred>
inline bool ets_some_vec(const std::vector<T>& src, Pred&& pred) {
    for (std::size_t i = 0; i < src.size(); ++i) if (ets_call_item(pred, src[i], i)) return true;
    return false;
}

// V11: `ets_every_vec<T>(src, pred)` — true si TODOS los elementos cumplen `pred`.
// (Vacío → true, convención JS.)
template <typename T, typename Pred>
inline bool ets_every_vec(const std::vector<T>& src, Pred&& pred) {
    for (std::size_t i = 0; i < src.size(); ++i) if (!ets_call_item(pred, src[i], i)) return false;
    return true;
}

// V14: `ets_slice_vec<T>(src, start, end)` — sub-array desde `start`
// (inclusivo) hasta `end` (exclusivo). Índices negativos se cuentan
// desde el final (al estilo JS): -1 = último elemento, -2 = penúltimo.
template <typename T>
inline std::vector<T> ets_slice_vec(const std::vector<T>& src, int start, int end) {
    const int n = static_cast<int>(src.size());
    if (start < 0) start = std::max(0, n + start);
    if (end < 0) end = n + end;
    if (start >= n || start >= end) return {};
    if (end > n) end = n;
    return std::vector<T>(src.begin() + start, src.begin() + end);
}

// V14: `ets_sort_vec<T>(src, cmp)` — ordena `src` in-place con `cmp(a, b)`
// y devuelve el mismo vector. El dialecto emite esto para `arr.sort(cmp)`.
//
// Importante: el comparator debe implementar **strict weak ordering**.
// Comparadores como `(a, b) => a - b` son **incorrectos** para `double`
// porque la resta puede dar ±0.0 para valores iguales (rompe transitividad
// y el comportamiento de `std::sort` es indefinido en ese caso). Para
// hacerlo seguro, el runtime envuelve el comparator devuelto por el
// usuario en un adaptador que:
//   - si el comparator ya devuelve bool, lo usa tal cual (caso ideal);
//   - si devuelve un número, lo convierte a `r < 0` (orden por signo).
// Esto es seguro para enteros, floats y doubles: para dobles iguales
// `r == 0`, lo que da `false < 0 == false`, equivalente a `!(b < a)`,
// manteniendo strict weak ordering (a == b → !(a < b) && !(b < a)).
template <typename T, typename Cmp>
inline std::vector<T>& ets_sort_vec(std::vector<T>& src, Cmp&& cmp) {
    using R = std::invoke_result_t<Cmp, const T&, const T&>;
    if constexpr (std::is_same_v<R, bool>) {
        std::sort(src.begin(), src.end(), std::forward<Cmp>(cmp));
    } else {
        // Adaptador: cualquier R convertible a bool (típicamente number)
        // se evalúa como `r < 0` (orden ascendente por signo de la resta).
        std::sort(src.begin(), src.end(), [c = std::forward<Cmp>(cmp)](const T& a, const T& b) -> bool {
            return c(a, b) < 0;
        });
    }
    return src;
}

// V14: `ets_flat_map_vec<T, U>(src, f)` — aplica `f` (que devuelve vector)
// y concatena los resultados en un solo vector (1 nivel de flattening).
template <typename T, typename U, typename F>
inline std::vector<U> ets_flat_map_vec(const std::vector<T>& src, F&& f) {
    std::vector<U> out;
    for (std::size_t i = 0; i < src.size(); ++i) {
        auto inner = ets_call_item(f, src[i], i);
        for (auto& v : inner) out.push_back(std::move(v));
    }
    return out;
}

// V14: `ets_includes_vec<T>(src, value)` — true si `value` está en `src`.
// Usa `operator==` sobre T (las clases la definen explícitamente).
template <typename T>
inline bool ets_includes_vec(const std::vector<T>& src, const T& value) {
    for (const auto& item : src) if (item == value) return true;
    return false;
}

// V30.8: `ets_concat_vec<T>({a, b, c, ...})` — une N arrays en uno nuevo.
// Variadico: acepta std::initializer_list<std::vector<T>> para no tener
// que enumerar N overloads. Devuelve un nuevo vector por valor (1 malloc
// del buffer resultante). Mismo criterio que `slice` y `map` mientras el
// dialecto siga modelando arrays por valor.
template <typename T>
inline std::vector<T> ets_concat_vec(std::initializer_list<std::vector<T>> arrays) {
    std::vector<T> out;
    std::size_t total = 0;
    for (const auto& a : arrays) total += a.size();
    out.reserve(total);
    for (const auto& a : arrays) {
        for (const auto& v : a) out.push_back(v);
    }
    return out;
}

// V30.13.2: `ets_push_vec<T>(vec, value)` — añade un elemento al final
// de un vector. Acepta `std::vector<T>&` (no const) y hace `push_back`.
// Equivalente a `arr.push(x)` en el dialecto. Devuelve void (no
// devolvemos el nuevo length porque el dialecto no lo usa).
template <typename T>
inline void ets_push_vec(std::vector<T>& vec, const T& value) {
    vec.push_back(value);
}

// An explicit ETS move (or a fresh allocation) must remain an rvalue here.
// The const-reference overload above continues to copy ordinary lvalues.
template <typename T>
inline void ets_push_vec(std::vector<T>& vec, T&& value) {
    vec.push_back(std::move(value));
}

// V30.55: `ets_set_vec<T>(vec, index, value)` — asignación indexada
// con auto-resize. Equivalente a `arr[i] = x` en el dialecto, pero
// seguro cuando `i >= vec.size()` (hace resize en vez de OOB).
// Acepta índices double (como todo en el dialecto) y los trunca a
// `size_t`. El dialecto compila con `-fno-exceptions`, así que
// índices negativos se ignoran (truncados a un valor enorme y
// resize — limitation documentada).
template <typename T>
inline void ets_set_vec(std::vector<T>& vec, double index, const T& value) {
    auto i = index < 0 ? 0 : static_cast<size_t>(index);
    if (i >= vec.size()) vec.resize(i + 1);
    vec[i] = value;
}

// V30.13.2: `ets_pop_vec<T>(vec)` — elimina el último elemento del
// vector. No devuelve el valor (el dialecto no lo necesita; los usuarios
// que necesiten el valor usan `arr[arr.length - 1]` antes de pop).
template <typename T>
inline void ets_pop_vec(std::vector<T>& vec) {
    if (!vec.empty()) vec.pop_back();
}

// V30.24: `ets_join_vec<T>(vec, separator)` — une los elementos del
// vector `vec` en un `std::string`, separados por `separator`. Equivalente
// a `arr.join(sep)` en el dialecto. Para `T = std::string` se usa
// `operator+`; para otros tipos el usuario debe asegurarse de que
// `operator<<` este definido (limitation documentada: el type-checker
// solo valida `T = string`; el codegen no fuerza el tipo en el template).
// ---------------------------------------------------------------------------
// Métodos de Array con la firma de TypeScript.
// ---------------------------------------------------------------------------

// Índice relativo de JavaScript (at, slice, fill...): trunca, cuenta desde el
// final si es negativo y lo deja en [0, n].
inline std::size_t ets_relative_index(double value, std::size_t n) {
    if (std::isnan(value)) return 0;
    value = std::trunc(value);
    if (value < 0) { value += static_cast<double>(n); return value < 0 ? 0 : static_cast<std::size_t>(value); }
    return value > static_cast<double>(n) ? n : static_cast<std::size_t>(value);
}

// at(i): elemento en i (negativo desde el final) o undefined.
template <typename T>
inline ets::Optional<T> ets_at_vec(const std::vector<T>& vec, double index) {
    if (std::isnan(index)) index = 0;
    index = std::trunc(index);
    if (index < 0) index += static_cast<double>(vec.size());
    if (index < 0 || index >= static_cast<double>(vec.size())) return ets::Optional<T>::none();
    return ets::Optional<T>::some(vec[static_cast<std::size_t>(index)]);
}

// indexOf(x, from?) / lastIndexOf(x, from?) / includes(x, from?).
template <typename T>
inline double ets_index_of_vec(const std::vector<T>& vec, const T& value, double from = 0) {
    for (std::size_t i = ets_relative_index(from, vec.size()); i < vec.size(); ++i) if (vec[i] == value) return static_cast<double>(i);
    return -1.0;
}
template <typename T>
inline double ets_last_index_of_vec(const std::vector<T>& vec, const T& value, double from = INFINITY) {
    if (vec.empty()) return -1.0;
    double start = std::isnan(from) ? 0 : std::trunc(from);
    if (start < 0) start += static_cast<double>(vec.size());
    if (start < 0) return -1.0;
    std::size_t i = start >= static_cast<double>(vec.size()) ? vec.size() - 1 : static_cast<std::size_t>(start);
    for (std::size_t k = i + 1; k-- > 0;) if (vec[k] == value) return static_cast<double>(k);
    return -1.0;
}
template <typename T>
inline bool ets_includes_from_vec(const std::vector<T>& vec, const T& value, double from) {
    return ets_index_of_vec(vec, value, from) >= 0;
}

// push(...items) / unshift(...items): devuelven la nueva longitud.
template <typename T, typename... Items>
inline double ets_push_all_vec(std::vector<T>& vec, Items&&... items) {
    (vec.push_back(std::forward<Items>(items)), ...);
    return static_cast<double>(vec.size());
}
template <typename T, typename... Items>
inline double ets_unshift_vec(std::vector<T>& vec, Items&&... items) {
    std::vector<T> front;
    front.reserve(sizeof...(items));
    (front.push_back(std::forward<Items>(items)), ...);
    vec.insert(vec.begin(), std::make_move_iterator(front.begin()), std::make_move_iterator(front.end()));
    return static_cast<double>(vec.size());
}

// pop() / shift(): quitan y devuelven el último / primer elemento, o undefined.
template <typename T>
inline ets::Optional<T> ets_pop_value_vec(std::vector<T>& vec) {
    if (vec.empty()) return ets::Optional<T>::none();
    T value = std::move(vec.back());
    vec.pop_back();
    return ets::Optional<T>::some(std::move(value));
}
template <typename T>
inline ets::Optional<T> ets_shift_vec(std::vector<T>& vec) {
    if (vec.empty()) return ets::Optional<T>::none();
    T value = std::move(vec.front());
    vec.erase(vec.begin());
    return ets::Optional<T>::some(std::move(value));
}

// reverse() / fill(v, start?, end?): modifican el array y lo devuelven.
template <typename T>
inline std::vector<T>& ets_reverse_vec(std::vector<T>& vec) {
    std::reverse(vec.begin(), vec.end());
    return vec;
}
template <typename T>
inline std::vector<T>& ets_fill_vec(std::vector<T>& vec, const T& value, double start = 0, double end = INFINITY) {
    const std::size_t from = ets_relative_index(start, vec.size());
    const std::size_t to = ets_relative_index(end, vec.size());
    for (std::size_t i = from; i < to; ++i) vec[i] = value;
    return vec;
}

// Copias: toReversed(), toSorted(cmp?), with(i, v).
template <typename T>
inline std::vector<T> ets_to_reversed_vec(const std::vector<T>& vec) {
    return std::vector<T>(vec.rbegin(), vec.rend());
}
template <typename T>
inline std::vector<T> ets_to_sorted_vec(const std::vector<T>& vec) {
    std::vector<T> out = vec;
    std::sort(out.begin(), out.end());
    return out;
}
template <typename T, typename Cmp>
inline std::vector<T> ets_to_sorted_vec(const std::vector<T>& vec, Cmp&& cmp) {
    std::vector<T> out = vec;
    ets_sort_vec(out, std::forward<Cmp>(cmp));
    return out;
}
// with(i, v): fuera de rango JavaScript lanza RangeError; sin excepciones, el
// programa termina con ese mensaje.
template <typename T>
inline std::vector<T> ets_with_vec(const std::vector<T>& vec, double index, const T& value) {
    double at = std::isnan(index) ? 0 : std::trunc(index);
    if (at < 0) at += static_cast<double>(vec.size());
    if (at < 0 || at >= static_cast<double>(vec.size())) { std::fputs("RangeError: Invalid index\n", stderr); std::exit(1); }
    std::vector<T> out = vec;
    out[static_cast<std::size_t>(at)] = value;
    return out;
}

// splice(start, deleteCount?, ...items): quita deleteCount elementos desde
// start (todos si se omite), mete items en su lugar y devuelve lo quitado.
// toSpliced hace lo mismo sobre una copia y devuelve la copia.
template <typename T>
inline std::size_t ets_splice_count(const std::vector<T>& vec, std::size_t from, double count) {
    if (std::isnan(count) || count < 0) return 0;
    const double left = static_cast<double>(vec.size() - from);
    return static_cast<std::size_t>(std::trunc(count) > left ? left : std::trunc(count));
}
template <typename T, typename... Items>
inline std::vector<T> ets_splice_items_vec(std::vector<T>& vec, std::size_t from, std::size_t count, Items&&... items) {
    std::vector<T> removed(std::make_move_iterator(vec.begin() + from), std::make_move_iterator(vec.begin() + from + count));
    vec.erase(vec.begin() + from, vec.begin() + from + count);
    std::vector<T> added;
    (added.push_back(std::forward<Items>(items)), ...);
    vec.insert(vec.begin() + from, std::make_move_iterator(added.begin()), std::make_move_iterator(added.end()));
    return removed;
}
template <typename T>
inline std::vector<T> ets_splice_vec(std::vector<T>& vec, double start) {
    const std::size_t from = ets_relative_index(start, vec.size());
    return ets_splice_items_vec(vec, from, vec.size() - from);
}
template <typename T, typename... Items>
inline std::vector<T> ets_splice_vec(std::vector<T>& vec, double start, double count, Items&&... items) {
    const std::size_t from = ets_relative_index(start, vec.size());
    return ets_splice_items_vec(vec, from, ets_splice_count(vec, from, count), std::forward<Items>(items)...);
}
template <typename T, typename... Items>
inline std::vector<T> ets_to_spliced_vec(const std::vector<T>& vec, Items&&... args) {
    std::vector<T> copy = vec;
    ets_splice_vec(copy, std::forward<Items>(args)...);
    return copy;
}

// keys() / values() / entries(): como arrays (sirven en for...of y Array.from).
template <typename T>
inline std::vector<double> ets_keys_vec(const std::vector<T>& vec) {
    std::vector<double> out(vec.size());
    for (std::size_t i = 0; i < vec.size(); ++i) out[i] = static_cast<double>(i);
    return out;
}
template <typename R, typename T>
inline R ets_entries_vec(const std::vector<T>& vec) {
    R out;
    out.reserve(vec.size());
    for (std::size_t i = 0; i < vec.size(); ++i) out.emplace_back(static_cast<double>(i), vec[i]);
    return out;
}

// flat(): un nivel de anidamiento (el backend lo encadena para más niveles).
template <typename T>
inline std::vector<T> ets_flat_vec(const std::vector<std::vector<T>>& vec) {
    std::vector<T> out;
    for (const auto& inner : vec) out.insert(out.end(), inner.begin(), inner.end());
    return out;
}

// Array.isArray / Array.of / Array.from.
template <typename T> struct ets_is_vector : std::false_type {};
template <typename T, typename A> struct ets_is_vector<std::vector<T, A>> : std::true_type {};
template <typename T> struct ets_is_std_tuple : std::false_type {};
template <typename... T> struct ets_is_std_tuple<std::tuple<T...>> : std::true_type {};
template <typename T>
inline bool ets_is_array(const T&) {
    return ets_is_vector<T>::value || ets_is_std_tuple<T>::value;
}
template <typename R, typename... Items>
inline R ets_array_of(Items&&... items) {
    R out;
    (out.push_back(std::forward<Items>(items)), ...);
    return out;
}
// Recorre la fuente (array, Set, Map o string) con (valor, índice).
template <typename S, typename F>
inline void ets_array_source(const S& source, F&& visit) {
    std::size_t index = 0;
    if constexpr (std::is_same_v<S, std::string>) {
        for (const char c : source) visit(std::string(1, c), index++);
    } else if constexpr (ets_is_vector<S>::value) {
        for (const auto& item : source) visit(item, index++);
    } else if constexpr (requires { source.data().begin()->second; }) {
        for (const auto& pair : source.data()) visit(std::make_tuple(pair.first, pair.second), index++);
    } else {
        for (const auto& item : source.data()) visit(item, index++);
    }
}
template <typename R, typename S>
inline R ets_array_from(const S& source) {
    R out;
    ets_array_source(source, [&](const auto& item, std::size_t) { out.push_back(item); });
    return out;
}
template <typename R, typename S, typename F>
inline R ets_array_from(const S& source, F&& fn) {
    R out;
    ets_array_source(source, [&](const auto& item, std::size_t index) { out.push_back(ets_call_item(fn, item, index)); });
    return out;
}

// join(sep = ","): cualquier array; cada elemento como lo escribe JavaScript
// (números con su formato, booleanos true/false, undefined vacío).
// Booleano guardado como { bool value } (ets::ir::Boolean evita vector<bool>).
template <typename T, typename = void> struct ets_boxed_bool : std::false_type {};
template <typename T> struct ets_boxed_bool<T, std::void_t<decltype(std::declval<const T&>().value)>>
    : std::is_same<std::remove_cv_t<std::remove_reference_t<decltype(std::declval<const T&>().value)>>, bool> {};

template <typename T>
inline void ets_join_item(std::string& out, const T& item) {
    if constexpr (std::is_same_v<T, std::string>) out += item;
    else if constexpr (ets_boxed_bool<T>::value) out += item.value ? "true" : "false";
    else if constexpr (std::is_arithmetic_v<T>) { std::ostringstream text; ets::display(text, item); out += text.str(); }
    else if constexpr (requires { item.isPresent(); item.value(); }) { if (item.isPresent()) ets_join_item(out, item.value()); }
    else if constexpr (requires { std::declval<std::ostream&>() << item; }) { std::ostringstream text; text << item; out += text.str(); }
    else out += "[object Object]";
}
template <typename T>
inline std::string ets_join_vec(const std::vector<T>& vec, const std::string& separator = ",") {
    std::string out;
    for (std::size_t i = 0; i < vec.size(); ++i) {
        if (i > 0) out += separator;
        ets_join_item(out, vec[i]);
    }
    return out;
}

inline std::string ets_join_vec(const std::vector<std::string>& vec, const std::string& separator) {
    std::string out;
    for (std::size_t i = 0; i < vec.size(); ++i) {
        if (i > 0) out += separator;
        out += vec[i];
    }
    return out;
}
