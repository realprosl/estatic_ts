#!/usr/bin/env bash
# Construye la semilla C++ (native/frontend y native/etsc).
#
# native-cpp/ solo contiene lo GENERADO desde bootstrap/ (frontend/, tablas en
# build/bootstrap/etsc/ y templates/). Todo lo demás se comparte con el resto
# del repositorio y se usa desde su ubicación canónica:
#   runtime/                 runtime C++ único (semilla, bootstrap y programas)
#   bootstrap/native/        coordinador nativo (driver.cpp, platform.hpp, progress.*)
#   bootstrap/modules/*.hpp  cabeceras de frontera nativa
#   src/codegen/ir/native/   emisor IR -> C++
set -euo pipefail
seed="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$seed/.." && pwd)"
cd "$seed"
source "$root/bootstrap/native/progress.sh"
ETSC_CLI_SCOPE=seed
mkdir -p native
etsc_spin "Frontend · C++20" g++ -std=c++20 -O1 -pthread -fno-exceptions -I"$root" -I"$seed" -I"$seed/frontend" \
  '-DESTATIC_FRONTEND_ID="portable"' frontend/unity.cpp -o native/frontend
etsc_spin "Coordinador y emisor · C++20" g++ -std=c++20 -O2 -I"$root" -I"$seed/build/bootstrap/etsc" \
  "$root/bootstrap/native/driver.cpp" "$root/src/codegen/ir/native/generator.cpp" \
  -lcrypto -o native/etsc
