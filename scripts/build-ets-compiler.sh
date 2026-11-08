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
if [[ ! -x native-cpp/native/frontend || ! -x native-cpp/native/etsc || native-cpp/src/codegen/ir/native/generator.cpp -nt native-cpp/native/etsc ]]; then
  bash native-cpp/build-all.sh
fi
# The seed assembles the first complete ETS compiler. Its conservative length
# fusion prevents the parser from copying entire token/AST arrays for .length.
native-cpp/native/frontend bootstrap/driver/main.ets --verbose > "$output/stage1.ir.json"
native-cpp/native/etsc --from-ir "$output/stage1.ir.json" --build \
  -o "$output/stage1.cpp" --binary "$output/etsc" --cxx-flag -O1 --verbose
if [[ "$stage" == stage2 ]]; then
  # This generation performs analysis, lowering, emission and orchestration in ETS.
  "$output/etsc" build bootstrap/driver/main.ets \
    --emit-ir "$output/stage2.ir.json" \
    -o "$output/stage2.cpp" --binary "$output/etsc-stage2" --cxx-flag -O1 --verbose
fi
