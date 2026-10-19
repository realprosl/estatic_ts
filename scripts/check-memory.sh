#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${root_dir}/build/memory-audit"
cxx="${CXX:-g++}"

# Esta regresion no depende de libuv ni Drogon y puede validarse incluso
# cuando faltan los headers de los backends de red.
mkdir -p "${build_dir}"
"${cxx}" \
  -std=c++20 -O1 -g \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I"${root_dir}" \
  "${root_dir}/runtime/tests/test_http_query.cpp" \
  -pthread -o "${build_dir}/test_http_query_asan"

ASAN_OPTIONS="detect_leaks=1:halt_on_error=1" \
UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1" \
  "${build_dir}/test_http_query_asan"

"${cxx}" \
  -std=c++20 -O1 -g -fno-exceptions -DCPPHTTPLIB_NO_EXCEPTIONS \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I"${root_dir}" \
  "${root_dir}/runtime/tests/test_http_limits.cpp" \
  -pthread -o "${build_dir}/test_http_limits_asan"

ASAN_OPTIONS="detect_leaks=1:halt_on_error=1" \
UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1" \
  "${build_dir}/test_http_limits_asan"

"${cxx}" \
  -std=c++20 -O1 -g -fno-exceptions -DCPPHTTPLIB_NO_EXCEPTIONS \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I"${root_dir}" \
  "${root_dir}/runtime/tests/test_http_routing.cpp" \
  -pthread -o "${build_dir}/test_http_routing_asan"

ASAN_OPTIONS="detect_leaks=1:halt_on_error=1" \
UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1" \
  "${build_dir}/test_http_routing_asan"

if ! printf '#include <uv.h>\n' | "${cxx}" -x c++ -E - >/dev/null 2>&1; then
  echo "Falta uv.h. Instala las dependencias de libuv antes de ejecutar esta comprobacion." >&2
  exit 2
fi

mkdir -p "${build_dir}"
"${cxx}" \
  -std=c++20 -O1 -g \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I"${root_dir}" \
  "${root_dir}/runtime/libuv/tests/test_wrappers_v29.cpp" \
  "${root_dir}/runtime/runtime_ets_libuv.cpp" \
  -luv -pthread \
  -o "${build_dir}/test_wrappers_asan"

ASAN_OPTIONS="detect_leaks=1:halt_on_error=1" \
UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1" \
  "${build_dir}/test_wrappers_asan"

"${cxx}" \
  -std=c++20 -O1 -g \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I"${root_dir}" -I"${root_dir}/runtime" \
  "${root_dir}/runtime/libuv/tests/test_event_loop_lifetime.cpp" \
  "${root_dir}/runtime/runtime_ets_libuv.cpp" \
  -luv -pthread \
  -o "${build_dir}/test_event_loop_lifetime_asan"

ASAN_OPTIONS="detect_leaks=1:halt_on_error=1" \
UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1" \
  "${build_dir}/test_event_loop_lifetime_asan"

"${cxx}" \
  -std=c++20 -O1 -g \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I"${root_dir}" -I"${root_dir}/runtime" \
  "${root_dir}/runtime/libuv/tests/test_race_lifetime.cpp" \
  "${root_dir}/runtime/runtime_ets_libuv.cpp" \
  -luv -pthread \
  -o "${build_dir}/test_race_lifetime_asan"

ASAN_OPTIONS="detect_leaks=1:halt_on_error=1" \
UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1" \
  "${build_dir}/test_race_lifetime_asan"
