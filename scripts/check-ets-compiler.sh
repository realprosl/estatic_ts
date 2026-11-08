#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
export ESTC_ROOT="$root"
export TMPDIR="${TMPDIR:-$root/build/tmp}"
mkdir -p "$TMPDIR" build/ets-compiler/smoke
compiler=${1:-$root/build/ets-compiler/etsc}
case "$compiler" in /*) ;; *) compiler="$root/$compiler";; esac
work="$root/build/ets-compiler/smoke"
printf 'print("ETS compiler works");\n' > "$work/main.ets"
"$compiler" --help > "$work/help.txt"
"$compiler" build "$work/main.ets" --emit-ir "$work/main.ir.json" \
  -o "$work/main.cpp" --binary "$work/main" --verbose --no-progress
[[ "$("$work/main")" == 'ETS compiler works' ]]
"$compiler" --from-ir "$work/main.ir.json" --build -o "$work/from-ir.cpp" --binary "$work/from-ir" --no-progress
cmp "$work/main.cpp" "$work/from-ir.cpp"
[[ "$("$work/from-ir")" == 'ETS compiler works' ]]
printf 'function broken(:void{}\n' > "$work/broken.ets"
if "$compiler" build "$work/broken.ets" --binary "$work/should-not-exist" --no-progress; then
  echo 'Invalid source unexpectedly succeeded' >&2; exit 1
fi
[[ ! -e "$work/should-not-exist" ]]
echo 'ETS compiler smoke checks passed'
