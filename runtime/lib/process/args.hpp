// Soporte en C++ de estatic:process/args: argv de C y la salida del proceso,
// sin libuv (solo ets_core.hpp). Lo usa el propio compilador (#310).
#pragma once
#include <string>
#include "runtime/ets_core.hpp"

namespace ets_process_args_lib {

inline std::string argumentAt(double index) { return ::argument(index); }
inline double argumentTotal() { return ::argumentCount(); }
inline void exit(double code) { exitProcess(code); }

}  // namespace ets_process_args_lib
