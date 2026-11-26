#pragma once

// Relojes y duraciones de <chrono> para las cabeceras del runtime (#377).
// En libstdc++ el <chrono> completo de C++20 añade calendarios, zonas horarias
// y formato (~0,4 s por unidad de compilación). steady_clock, system_clock,
// time_point, duration y duration_cast están en <bits/chrono.h>, que <thread>
// y <mutex> ya incluyen. En otras bibliotecas estándar se usa <chrono>.
#include <version>
#if defined(__GLIBCXX__) && __has_include(<bits/chrono.h>)
#include <bits/chrono.h>
#else
#include <chrono>
#endif
