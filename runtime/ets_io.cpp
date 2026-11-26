// Implementación de runtime/ets_io.hpp (#377). Con ETS_RUNTIME_PRECOMPILED se
// compila aparte; si no, la incluye la propia cabecera (ver runtime/ets_api.hpp).
#include "runtime/ets_io.hpp"
#include <chrono>
#include <cstdint>
#include <ctime>
#include <random>

// `Math.random()`: double en [0, 1) con Mersenne Twister, sembrado una vez.
ETS_API double ets_math::random() noexcept {
    static std::mt19937 generator{std::random_device{}()};
    std::uniform_real_distribution<double> dist(0.0, 1.0);
    return dist(generator);
}

ETS_API double ets_date::now() noexcept {
    return static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count());
}

ETS_API double ets_date::utc(const double year, const double month, const double day) noexcept {
    std::tm time{};
    time.tm_year = static_cast<int>(year) - 1900;
    time.tm_mon = static_cast<int>(month);
    time.tm_mday = static_cast<int>(day);
    time.tm_isdst = 0;
    return static_cast<double>(static_cast<std::int64_t>(timegm(&time)) * 1000);
}
