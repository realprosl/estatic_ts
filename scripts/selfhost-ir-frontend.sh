#!/usr/bin/env bash
set -euo pipefail
# Adapt the complete self-hosted compiler to the source-to-IR JSON protocol
# used by execution fixtures. Never fall back to the older C++ seed frontend.
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
compiler=${ESTATIC_SELFHOST_COMPILER:-$root/build/ets-compiler/etsc-stage2}
if [[ ! -x "$compiler" ]]; then
  echo "Self-hosted compiler not found: $compiler" >&2
  exit 2
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/ets-selfhost-ir.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
export ESTC_ROOT="$root"
"$compiler" "$@" --check --emit-ir "$work/project.ir.json" --no-progress
cat "$work/project.ir.json"
