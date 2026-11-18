// Soporte en C++ de estatic:date: el reloj del sistema y la zona horaria local.
// El calendario (días, meses, formato y análisis) está en runtime/lib/date.ts.
#pragma once
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <limits>
#include <string>

namespace ets_calendar {

// Milisegundos desde 1970-01-01T00:00:00Z.
inline double now() {
    using namespace std::chrono;
    return static_cast<double>(duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
}

// Desfase de la zona local en minutos en el instante t (ms UTC), con el signo de
// getTimezoneOffset: UTC - local (en Madrid, -60 en invierno y -120 en verano).
inline double offset(double t) {
    if (!std::isfinite(t)) return std::numeric_limits<double>::quiet_NaN();
    const std::time_t seconds = static_cast<std::time_t>(std::floor(t / 1000.0));
    std::tm local{};
    if (!localtime_r(&seconds, &local)) return 0;
    return -static_cast<double>(local.tm_gmtoff) / 60.0;
}

// Abreviatura de la zona local en el instante t ("CET", "CEST", "UTC").
inline std::string zoneName(double t) {
    if (!std::isfinite(t)) return "";
    const std::time_t seconds = static_cast<std::time_t>(std::floor(t / 1000.0));
    std::tm local{};
    if (!localtime_r(&seconds, &local)) return "";
    char buffer[64];
    const std::size_t size = std::strftime(buffer, sizeof buffer, "%Z", &local);
    return std::string(buffer, size);
}

[[noreturn]] inline void rangeError(const std::string& message) {
    std::fputs(("RangeError: " + message + "\n").c_str(), stderr);
    std::exit(1);
}

}  // namespace ets_calendar
