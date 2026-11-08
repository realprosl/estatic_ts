#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -f compiler/unity.cpp ]]; then
  echo 'Missing compiler/unity.cpp; first run scripts/regenerate-ets-native.sh from the source repository.' >&2
  exit 1
fi
mkdir -p native
"${CXX:-g++}" -std=c++20 -O1 -pthread -fno-exceptions -I"$PWD" compiler/unity.cpp -o native/etsc-ets
