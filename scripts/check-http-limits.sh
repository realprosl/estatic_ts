#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${root_dir}/build/http-limits"
cxx="${CXX:-g++}"

mkdir -p "${build_dir}"
"${cxx}" -std=c++20 -O1 -Wall -Wextra -Werror -Wno-comment \
  -fno-exceptions -DCPPHTTPLIB_NO_EXCEPTIONS -I"${root_dir}" \
  "${root_dir}/runtime/tests/test_http_limits.cpp" \
  -pthread -o "${build_dir}/test_http_limits"

"${build_dir}/test_http_limits" "$@"
