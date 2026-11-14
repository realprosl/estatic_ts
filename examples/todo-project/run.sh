#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build/todo-project"

mkdir -p "${BUILD_DIR}"

# Compilador nativo (#140): el `etsc` instalado o el indicado en $ETSC.
ETSC="${ETSC:-etsc}"
ESTC_ROOT="${ESTC_ROOT:-${ROOT_DIR}}" "${ETSC}" build "${SCRIPT_DIR}/main.ets" \
  -o "${BUILD_DIR}/main.cpp" --binary "${BUILD_DIR}/todo-project" --no-progress

OUTPUT="$("${BUILD_DIR}/todo-project")"
printf '%s\n' "${OUTPUT}"

if [[ "${OUTPUT}" != *"SUMMARY checks=8 failures=0"* ]]; then
  echo "Todo project integration test failed" >&2
  exit 1
fi
