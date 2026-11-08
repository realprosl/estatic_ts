#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
export ESTC_ROOT="$root"
export TMPDIR="${TMPDIR:-$root/build/tmp}"
mkdir -p "$TMPDIR" build/ets-compiler
stage=${1:-stage1}
if [[ "$stage" != stage1 && "$stage" != stage2 ]]; then
  echo 'Usage: scripts/build-ets-compiler.sh [stage1|stage2]' >&2
  exit 2
fi
if [[ ! -x native-cpp/native/frontend || ! -x native-cpp/native/etsc ]]; then
  bash native-cpp/build-all.sh
fi
# Stage 1 uses the checked-in C++ seed. All new compiler policy is ETS.
native-cpp/native/frontend bootstrap/driver/main.ets --verbose > build/ets-compiler/stage1.ir.json
native-cpp/native/etsc --from-ir build/ets-compiler/stage1.ir.json --build \
  -o build/ets-compiler/stage1.cpp --binary build/ets-compiler/etsc --verbose
if [[ "$stage" == stage2 ]]; then
  # The ETS compiler analyzes, lowers, emits C++ and invokes the target toolchain.
  build/ets-compiler/etsc build bootstrap/driver/main.ets \
    --emit-ir build/ets-compiler/stage2.ir.json \
    -o build/ets-compiler/stage2.cpp --binary build/ets-compiler/etsc-stage2 --verbose
fi
