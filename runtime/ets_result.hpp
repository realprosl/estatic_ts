#pragma once

// Result<T, E> del dialecto: un valor T o un error E (string por defecto, o
// un Error del prelude). Sin excepciones. Vive aparte de ets_async.hpp para
// que un programa síncrono que usa Result no arrastre el bucle de eventos ni
// libuv (#205).

#include <cstdlib>
#include <optional>
#include <string>
#include <utility>

#ifndef ETS_RESULT_DEFINED
#define ETS_RESULT_DEFINED 1
namespace ets {
template <typename T, typename E = std::string>
class [[nodiscard]] Result {
public:
    static Result success(T value) { return Result{std::move(value), std::nullopt}; }
    static Result failure(E error) { return Result{std::nullopt, std::move(error)}; }
    bool isOk() const noexcept { return value_.has_value(); }
    T& value() & noexcept { if (!value_) std::abort(); return *value_; }
    const T& value() const & noexcept { if (!value_) std::abort(); return *value_; }
    T&& value() && noexcept { if (!value_) std::abort(); return std::move(*value_); }
    const E& error() const noexcept { if (!error_) std::abort(); return *error_; }

private:
    Result(std::optional<T> value, std::optional<E> error) : value_(std::move(value)), error_(std::move(error)) {}
    std::optional<T> value_;
    std::optional<E> error_;
};

template <typename T>
Result<T> ok(T value) { return Result<T>::success(std::move(value)); }

template <typename T>
Result<T> err(std::string message) { return Result<T>::failure(std::move(message)); }
}  // namespace ets
#endif
