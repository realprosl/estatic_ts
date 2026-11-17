// Primitivas en C++ de las librerías del runtime "estatic:math" y
// "estatic:number" (runtime/lib/*.ts). Solo lo que no se puede escribir en
// Estatic: funciones de <cmath>, bits de un double, aleatorios y el redondeo
// decimal exacto de toFixed/toPrecision/toExponential.
#pragma once
#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <random>
#include <string>
#include "runtime/ets_string.hpp"

namespace ets_numeric {

inline double infinity() { return std::numeric_limits<double>::infinity(); }
inline double nan() { return std::numeric_limits<double>::quiet_NaN(); }
inline double maxValue() { return std::numeric_limits<double>::max(); }
inline double minValue() { return std::numeric_limits<double>::denorm_min(); }
inline double floor(double x) { return std::floor(x); }
inline double ceil(double x) { return std::ceil(x); }
inline double trunc(double x) { return std::trunc(x); }
inline double abs(double x) { return std::fabs(x); }
inline double sqrt(double x) { return std::sqrt(x); }
// cbrt en long double y redondeado: glibc da 3.0000000000000004 para 27 (JS da 3).
inline double cbrt(double x) { return static_cast<double>(std::cbrt(static_cast<long double>(x))); }
inline double pow(double x, double y) { return std::pow(x, y); }
inline double exp(double x) { return std::exp(x); }
inline double expm1(double x) { return std::expm1(x); }
inline double log(double x) { return std::log(x); }
inline double log2(double x) { return std::log2(x); }
inline double log10(double x) { return std::log10(x); }
inline double log1p(double x) { return std::log1p(x); }
inline double sin(double x) { return std::sin(x); }
inline double cos(double x) { return std::cos(x); }
inline double tan(double x) { return std::tan(x); }
inline double asin(double x) { return std::asin(x); }
inline double acos(double x) { return std::acos(x); }
inline double atan(double x) { return std::atan(x); }
inline double atan2(double y, double x) { return std::atan2(y, x); }
inline double sinh(double x) { return std::sinh(x); }
inline double cosh(double x) { return std::cosh(x); }
inline double tanh(double x) { return std::tanh(x); }
inline double asinh(double x) { return std::asinh(x); }
inline double acosh(double x) { return std::acosh(x); }
inline double atanh(double x) { return std::atanh(x); }
inline double hypot2(double x, double y) { return std::hypot(x, y); }
inline double fround(double x) { return static_cast<double>(static_cast<float>(x)); }
inline bool signbit(double x) { return std::signbit(x); }
inline double nextUp(double x) { return std::nextafter(x, std::numeric_limits<double>::infinity()); }
// Exponente binario de x = m * 2^e con m entero de 53 bits (Double::Exponent de V8).
inline double binaryExponent(double x) { int e = 0; std::frexp(x, &e); return static_cast<double>(e - 53); }

// ToInt32 / ToUint32 de JavaScript.
inline std::uint32_t toUint32(double x) {
    if (!std::isfinite(x)) return 0;
    const double m = std::fmod(std::trunc(x), 4294967296.0);
    return static_cast<std::uint32_t>(static_cast<std::int64_t>(m < 0 ? m + 4294967296.0 : m));
}
inline double clz32(double x) { const std::uint32_t v = toUint32(x); return v == 0 ? 32.0 : static_cast<double>(std::countl_zero(v)); }
inline double imul(double a, double b) { return static_cast<double>(static_cast<std::int32_t>(toUint32(a) * toUint32(b))); }

inline double random() {
    static thread_local std::mt19937_64 engine{std::random_device{}()};
    return std::uniform_real_distribution<double>(0.0, 1.0)(engine);
}

[[noreturn]] inline void rangeError(const std::string& message) {
    std::fputs(("RangeError: " + message + "\n").c_str(), stderr);
    std::exit(1);
}

// Expansión decimal exacta de |x| (printf de glibc es exacto): cifras
// significativas sin ceros a los lados y posición del punto, de modo que
// |x| = 0.d1d2d3... * 10^point.
struct Decimal { std::string digits; int point = 0; };
inline Decimal exactDecimal(double x) {
    static char text[1500];
    std::snprintf(text, sizeof text, "%.1100f", std::fabs(x));
    std::string all = text;
    const std::size_t dot = all.find('.');
    const std::string integer = all.substr(0, dot), fraction = dot == std::string::npos ? "" : all.substr(dot + 1);
    std::string joined = integer + fraction;
    std::size_t lead = joined.find_first_not_of('0');
    Decimal d;
    if (lead == std::string::npos) return d;
    d.digits = joined.substr(lead);
    d.digits.erase(d.digits.find_last_not_of('0') + 1);
    d.point = static_cast<int>(integer.size()) - static_cast<int>(lead);
    return d;
}

// Las primeras n cifras redondeadas «hacia el n mayor» (mitad hacia arriba
// sobre el valor exacto, como pide JavaScript). Si hay acarreo, sube point.
inline std::string roundDigits(const Decimal& d, int n, int& point) {
    point = d.point;
    if (n <= 0) {
        // Todo cae tras el redondeo: solo queda 1 si la cifra n-ésima lo pide.
        if (n == 0 && !d.digits.empty() && d.digits[0] >= '5') { point += 1; return "1"; }
        return "";
    }
    std::string head = d.digits.substr(0, std::min<std::size_t>(d.digits.size(), static_cast<std::size_t>(n)));
    head.append(static_cast<std::size_t>(n) - head.size(), '0');
    if (static_cast<std::size_t>(n) < d.digits.size() && d.digits[static_cast<std::size_t>(n)] >= '5') {
        int at = n - 1;
        while (at >= 0 && head[static_cast<std::size_t>(at)] == '9') { head[static_cast<std::size_t>(at)] = '0'; --at; }
        if (at >= 0) ++head[static_cast<std::size_t>(at)];
        else { head.insert(head.begin(), '1'); head.pop_back(); point += 1; }
    }
    return head;
}

inline std::string exponentText(int e) { return std::string("e") + (e < 0 ? "-" : "+") + std::to_string(e < 0 ? -e : e); }

// x.toFixed(digits): 0..100 cifras; |x| >= 1e21 se escribe como String(x).
inline std::string fixed(double x, double digits) {
    if (std::isnan(digits)) digits = 0;
    digits = std::trunc(digits);
    if (digits < 0 || digits > 100) rangeError("toFixed() digits argument must be between 0 and 100");
    if (std::isnan(x)) return "NaN";
    if (std::fabs(x) >= 1e21) return ets::js_number(x);
    const int f = static_cast<int>(digits);
    const Decimal d = exactDecimal(x);
    int point = 0;
    std::string n = roundDigits(d, d.point + f, point);
    // n son las cifras de round(|x| * 10^f); se reparte en entero y fracción.
    const int integerDigits = point;
    std::string integer, fraction;
    if (n.empty()) { integer = "0"; fraction = std::string(static_cast<std::size_t>(f), '0'); }
    else {
        std::string all = n;
        if (static_cast<int>(all.size()) < integerDigits + f) all.append(static_cast<std::size_t>(integerDigits + f) - all.size(), '0');
        if (integerDigits <= 0) { integer = "0"; fraction = std::string(static_cast<std::size_t>(-integerDigits), '0') + all; }
        else { integer = all.substr(0, static_cast<std::size_t>(integerDigits)); fraction = all.substr(static_cast<std::size_t>(integerDigits)); }
        fraction = fraction.substr(0, static_cast<std::size_t>(f));
        fraction.append(static_cast<std::size_t>(f) - fraction.size(), '0');
    }
    return (x < 0 ? "-" : "") + integer + (f > 0 ? "." + fraction : "");
}

// Cifras más cortas que representan x sin ambigüedad (las de String(x)).
inline Decimal shortestDecimal(double x) {
    char text[64];
    for (int precision = 1; precision <= 17; ++precision) {
        std::snprintf(text, sizeof text, "%.*e", precision - 1, std::fabs(x));
        if (std::strtod(text, nullptr) == std::fabs(x)) break;
    }
    std::string s = text;
    const std::size_t e = s.find('e');
    std::string mantissa = s.substr(0, e);
    mantissa.erase(std::remove(mantissa.begin(), mantissa.end(), '.'), mantissa.end());
    mantissa.erase(mantissa.find_last_not_of('0') + 1);
    Decimal d;
    d.digits = mantissa.empty() ? "0" : mantissa;
    d.point = std::atoi(s.c_str() + e + 1) + 1;
    return d;
}

// x.toExponential(digits?): sin digits, las cifras justas.
inline std::string exponential(double x, double digits, bool given) {
    if (std::isnan(x)) return "NaN";
    if (std::isinf(x)) return x < 0 ? "-Infinity" : "Infinity";
    if (given) {
        if (std::isnan(digits)) digits = 0;
        digits = std::trunc(digits);
        if (digits < 0 || digits > 100) rangeError("toExponential() argument must be between 0 and 100");
    }
    std::string n; int point = 1;
    if (x == 0) { n = std::string(given ? static_cast<std::size_t>(digits) + 1 : 1, '0'); point = 1; }
    else if (given) n = roundDigits(exactDecimal(x), static_cast<int>(digits) + 1, point);
    else { const Decimal d = shortestDecimal(x); n = d.digits; point = d.point; }
    const std::string mantissa = n.size() > 1 ? n.substr(0, 1) + "." + n.substr(1) : n;
    return (x < 0 ? "-" : "") + mantissa + exponentText(point - 1);
}

// x.toPrecision(precision): 1..100 cifras significativas.
inline std::string precision(double x, double digits) {
    if (std::isnan(x)) return "NaN";
    if (std::isinf(x)) return x < 0 ? "-Infinity" : "Infinity";
    if (std::isnan(digits)) digits = 0;
    digits = std::trunc(digits);
    if (digits < 1 || digits > 100) rangeError("toPrecision() argument must be between 1 and 100");
    const int p = static_cast<int>(digits);
    std::string n; int point = 1;
    if (x == 0) n = std::string(static_cast<std::size_t>(p), '0');
    else n = roundDigits(exactDecimal(x), p, point);
    const int e = point - 1;
    const std::string sign = x < 0 ? "-" : "";
    if (x != 0 && (e < -6 || e >= p)) return sign + (n.size() > 1 ? n.substr(0, 1) + "." + n.substr(1) : n) + exponentText(e);
    if (e >= 0) return sign + n.substr(0, static_cast<std::size_t>(e) + 1) + (p > e + 1 ? "." + n.substr(static_cast<std::size_t>(e) + 1) : "");
    return sign + "0." + std::string(static_cast<std::size_t>(-e - 1), '0') + n;
}

// x.toString(radix): algoritmo DoubleToRadixCString de V8.
inline std::string radixString(double value, double radixValue) {
    if (std::isnan(radixValue)) radixValue = 10;
    radixValue = std::trunc(radixValue);
    if (radixValue < 2 || radixValue > 36) rangeError("toString() radix must be between 2 and 36");
    const int radix = static_cast<int>(radixValue);
    if (radix == 10 || std::isnan(value) || std::isinf(value)) return ets::js_number(value);
    static const char chars[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    constexpr int size = 2200;
    char buffer[size];
    int integerCursor = size / 2, fractionCursor = integerCursor;
    const bool negative = value < 0;
    if (negative) value = -value;
    double integer = std::floor(value), fraction = value - integer;
    double delta = 0.5 * (nextUp(value) - value);
    delta = std::max(nextUp(0.0), delta);
    if (fraction >= delta) {
        buffer[fractionCursor++] = '.';
        do {
            fraction *= radix; delta *= radix;
            const int digit = static_cast<int>(fraction);
            buffer[fractionCursor++] = chars[digit];
            fraction -= digit;
            if (fraction > 0.5 || (fraction == 0.5 && (digit & 1))) {
                if (fraction + delta > 1) {
                    while (true) {
                        fractionCursor--;
                        if (fractionCursor == size / 2) { integer += 1; break; }
                        const char c = buffer[fractionCursor];
                        const int previous = c > '9' ? (c - 'a' + 10) : (c - '0');
                        if (previous + 1 < radix) { buffer[fractionCursor++] = chars[previous + 1]; break; }
                    }
                    break;
                }
            }
        } while (fraction >= delta);
    }
    while (binaryExponent(integer / radix) > 0) { integer /= radix; buffer[--integerCursor] = '0'; }
    do {
        const double remainder = std::fmod(integer, static_cast<double>(radix));
        buffer[--integerCursor] = chars[static_cast<int>(remainder)];
        integer = (integer - remainder) / radix;
    } while (integer > 0);
    if (negative) buffer[--integerCursor] = '-';
    return std::string(buffer + integerCursor, buffer + fractionCursor);
}

// strtod de un literal decimal ya validado por parseFloat.
inline double parseDecimal(const std::string& text) { return std::strtod(text.c_str(), nullptr); }

} // namespace ets_numeric
