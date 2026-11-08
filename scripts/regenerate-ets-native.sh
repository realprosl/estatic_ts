#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
# Do not publish a snapshot until both generations execute the smoke cases.
bash scripts/build-ets-compiler.sh stage2
bash scripts/check-ets-compiler.sh build/ets-compiler/etsc
bash scripts/check-ets-compiler.sh build/ets-compiler/etsc-stage2
cmp build/ets-compiler/stage1.ir.json build/ets-compiler/stage2.ir.json
mkdir -p native-cpp/compiler
cp build/ets-compiler/stage2.cpp native-cpp/compiler/unity.cpp
printf 'Generated full ETS compiler snapshot: native-cpp/compiler/unity.cpp\n'
