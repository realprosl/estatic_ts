#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
export ESTC_ROOT="$root"
export TMPDIR="${TMPDIR:-$root/build/tmp}"
output=${ESTATIC_ETS_BUILD_DIR:-build/ets-compiler}
mkdir -p "$TMPDIR" "$output"
stage=${1:-stage1}
if [[ "$stage" != stage1 && "$stage" != stage2 ]]; then
  echo 'Usage: scripts/build-ets-compiler.sh [stage1|stage2]' >&2
  exit 2
fi
if [[ ! -x native-cpp/native/frontend || ! -x native-cpp/native/etsc ]]; then
  bash native-cpp/build-all.sh
fi
# Bootstrap the ETS backend first. Compiler generations then use ETS emission,
# including its conservative single-use length-load optimization.
native-cpp/native/frontend bootstrap/backend/cpp/demo.ets > "$output/backend.ir.json"
native-cpp/native/etsc --from-ir "$output/backend.ir.json" --build \
  -o "$output/backend.cpp" --binary "$output/backend" --no-progress
native-cpp/native/frontend bootstrap/driver/main.ets --verbose > "$output/stage1.ir.json"
"$output/backend" "$output/stage1.ir.json" > "$output/stage1.cpp"
"${CXX:-g++}" -std=c++20 -O0 -pthread -fno-exceptions -I"$root" \
  "$output/stage1.cpp" -o "$output/etsc"
if [[ "$stage" == stage2 ]]; then
  "$output/etsc" build bootstrap/driver/main.ets \
    --emit-ir "$output/stage2.ir.json" \
    -o "$output/stage2.cpp" --binary "$output/etsc-stage2" --verbose
fi
