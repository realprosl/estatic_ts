#pragma once
// Storage/CFG adapters for the IR backend. Language services remain in the
// ordinary runtime headers; this file does not implement another runtime.
#include <optional>
#include <memory>
#include <utility>
#include <type_traits>
#include <cstdint>
#include <bit>
#include <limits>
#include <cmath>
#include <cstdlib>

namespace ets::ir {
// Deep-copying indirection preserves value semantics and allows recursive
// interface containers without recursive by-value C++ layouts.
template<class T> class Box {
    std::unique_ptr<T> value_;
public:
    using value_type = T;
    Box() = default;
    explicit Box(T value) : value_(std::make_unique<T>(std::move(value))) {}
    Box(const Box& other) : value_(other.value_ ? std::make_unique<T>(*other.value_) : nullptr) {}
    Box(Box&&) noexcept = default;
    Box& operator=(const Box& other) { if(this != &other) value_ = other.value_ ? std::make_unique<T>(*other.value_) : nullptr; return *this; }
    Box& operator=(Box&&) noexcept = default;
    T& get() { if(!value_) std::abort(); return *value_; }
    const T& get() const { if(!value_) std::abort(); return *value_; }
    bool operator==(const Box& other) const { return bool(value_) == bool(other.value_) && (!value_ || *value_ == *other.value_); }
};

// emplace also handles non-assignable runtime types such as Task<T>.
// An empty slot is the logical initialization flag used by dropRemaining.
template<class T> struct Slot {
    std::optional<T> value;
    T& get() { if (!value) std::abort(); return *value; }
    const T& get() const { if (!value) std::abort(); return *value; }
    template<class U> void set(U&& next) { value.emplace(std::forward<U>(next)); }
    T take() { T next = std::move(get()); value.reset(); return next; }
    void drop() noexcept { value.reset(); }
    bool operator==(const Slot&) const = default;
};
// Views never own their referent. Moving an element leaves a valid moved-from
// object, whose eventual destruction only destroys its remaining subobjects.
template<class T> struct View {
    T* pointer;
    T& get() const { return *pointer; }
    template<class U> void set(U&& value) const {
        if constexpr (std::is_assignable_v<T&, U&&>) *pointer = std::forward<U>(value);
        else { std::destroy_at(pointer); std::construct_at(pointer, std::forward<U>(value)); }
    }
    auto take() const { return std::move(*pointer); }
};
template<class T> View<T> view(T& value) { return {std::addressof(value)}; }
template<class T> T& read(T& value) { return value; }
template<class T> const T& read(const T* value) { return *value; }
template<class T> T& read(T* value) { return *value; }
template<class T> const T& read(const std::unique_ptr<T>& value) { return *value; }

// vector<bool> has proxy elements, which cannot implement ref<boolean>.
// This storage-only wrapper keeps real addressable bools and reuses vector APIs.
struct Boolean {
    bool value=false;
    Boolean()=default;
    Boolean(bool input):value(input){}
    operator bool() const {return value;}
};
inline bool& read(Boolean& value){return value.value;}
inline const bool& read(const Boolean& value){return value.value;}
template<class T> T& read(std::unique_ptr<T>& value){return *value;}

// Defined wrapping for integer arithmetic, including signed overflow. Ordinary
// C++ promotions must not silently change the IR's explicit numeric widths.
template<class T, class U> T cast(U value) {
    if constexpr (std::is_integral_v<T> && std::is_integral_v<U> && !std::is_same_v<T,bool>) {
        using Unsigned = std::make_unsigned_t<T>;
        return std::bit_cast<T>(static_cast<Unsigned>(value));
    } else if constexpr(std::is_integral_v<T> && !std::is_same_v<T,bool> && std::is_floating_point_v<U>) {
        // Same representability rule as src/codegen/comptime-integer-cast.ts.
        const long double truncated=std::trunc(static_cast<long double>(value));
        const long double upper=std::ldexp(1.0L,sizeof(T)*8-(std::is_signed_v<T>?1:0));
        const long double lower=std::is_signed_v<T>?-upper:0;
        if(!std::isfinite(truncated)||truncated<lower||truncated>=upper)std::abort();
        return static_cast<T>(truncated);
    } else return static_cast<T>(value);
}
template<class T> T add(T a, T b) {
    if constexpr(std::is_integral_v<T>) { using U=std::make_unsigned_t<T>; return cast<T>(U(a)+U(b)); }
    else return a+b;
}
template<class T> T sub(T a, T b) {
    if constexpr(std::is_integral_v<T>) { using U=std::make_unsigned_t<T>; return cast<T>(U(a)-U(b)); }
    else return a-b;
}
template<class T> T mul(T a, T b) {
    if constexpr(std::is_integral_v<T>) { using U=std::make_unsigned_t<T>; return cast<T>(U(a)*U(b)); }
    else return a*b;
}
template<class T> T divide(T a, T b) {
    if constexpr(std::is_integral_v<T>) {
        if (!b) std::abort();
        if constexpr(std::is_signed_v<T>) if(a==std::numeric_limits<T>::min() && b==T(-1)) return a;
    }
    return a/b;
}
template<class T> T remainder(T a, T b) {
    if constexpr(std::is_integral_v<T>) {
        if (!b) std::abort();
        if constexpr(std::is_signed_v<T>) if(a==std::numeric_limits<T>::min() && b==T(-1)) return 0;
        return a%b;
    } else {
        // Atajo exacto (#285): con dos enteros de |x| <= 2^53 (lo habitual en
        // `i % n`) el resto entero coincide con fmod y es ~10 veces más rápido.
        // Como en JavaScript, un resto cero lleva el signo del dividendo (-14 % 7
        // es -0). NaN, infinitos, fracciones y divisor 0 siguen por fmod.
        constexpr T limit = T(9007199254740992.0);
        if (a >= -limit && a <= limit && b >= -limit && b <= limit) {
            const long long ia = static_cast<long long>(a), ib = static_cast<long long>(b);
            if (ib != 0 && static_cast<T>(ia) == a && static_cast<T>(ib) == b) {
                const long long r = ia % ib;
                return r == 0 ? std::copysign(T(0), a) : static_cast<T>(r);
            }
        }
        return std::fmod(a,b);
    }
}
// a ** b como en JavaScript: NaN si el exponente es NaN, y (±1) ** ±Infinity es NaN
// (std::pow da 1). En enteros, potencia exacta con desbordamiento modular; un
// exponente negativo da la parte entera (0 salvo para 1 y -1).
template<class T> T power(T a, T b) {
    if constexpr(std::is_integral_v<T>) {
        if constexpr(std::is_signed_v<T>) if (b < 0) { if (a == 0) std::abort(); if (a == 1) return 1; if (a == -1) return (b % 2) ? T(-1) : T(1); return 0; }
        using U=std::make_unsigned_t<T>; U result=1, base=U(a); auto e=b;
        while (e > 0) { if (e & 1) result = U(result*base); base = U(base*base); e = e >> 1; }
        return cast<T>(result);
    } else {
        if (std::isnan(b)) return std::numeric_limits<T>::quiet_NaN();
        if (std::isinf(b) && std::fabs(a) == T(1)) return std::numeric_limits<T>::quiet_NaN();
        return std::pow(a, b);
    }
}
template<class T, class U> T shiftLeft(T a, U b) {
    using V=std::conditional_t<std::is_floating_point_v<T>,std::int64_t,T>;
    if (b<0 || b>=sizeof(V)*8) std::abort();
    using Unsigned=std::make_unsigned_t<V>;
    return static_cast<T>(cast<V>(Unsigned(static_cast<V>(a)) << static_cast<unsigned>(b)));
}
template<class T, class U> T shiftRight(T a, U b) {
    using V=std::conditional_t<std::is_floating_point_v<T>,std::int64_t,T>;
    if (b<0 || b>=sizeof(V)*8) std::abort();
    return static_cast<T>(static_cast<V>(a) >> static_cast<unsigned>(b));
}
}
