#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build/todo-project"

mkdir -p "${BUILD_DIR}"

node --experimental-strip-types "${ROOT_DIR}/src/cli.ts" \
  "${SCRIPT_DIR}/main.ets" -o "${BUILD_DIR}/main.cpp"

g++ -std=c++20 -O2 -DNDEBUG -pthread -fno-exceptions \
  -I"${ROOT_DIR}" "${BUILD_DIR}/main.cpp" -o "${BUILD_DIR}/todo-project"

OUTPUT="$("${BUILD_DIR}/todo-project")"
printf '%s\n' "${OUTPUT}"

if [[ "${OUTPUT}" != *"SUMMARY checks=8 failures=0"* ]]; then
  echo "Todo project integration test failed" >&2
  exit 1
fi
