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
if "$compiler" build "$work/broken.ets" --binary "$work/should-not-exist" --no-progress 2> "$work/broken.log"; then
  echo 'Invalid source unexpectedly succeeded' >&2; exit 1
fi
cat "$work/broken.log"
grep -q 'PARSER_ERROR' "$work/broken.log"
if grep -q 'IR_INPUT' "$work/broken.log"; then
  echo 'Source diagnostics must not cause a redundant IR_INPUT' >&2; exit 1
fi
[[ ! -e "$work/should-not-exist" ]]
cat > "$work/regressions.ets" <<'ETS'
interface Options { method: string; body: string; }
const options: Options = {
  method: "GET",
  body: ""
};
function yes(): void { print(options.method); }
function no(): void { print("no"); }
true ? yes() : no();
false ? yes() : no();
for (let i: number = 0; i < 3; i++) print(i);
let n: number = 0;
print(n++);
print(++n);
ETS
"$compiler" build "$work/regressions.ets" -o "$work/regressions.cpp" \
  --binary "$work/regressions" --no-progress
printf 'GET\nno\n0\n1\n2\n0\n2\n' > "$work/regressions.expected"
"$work/regressions" > "$work/regressions.actual"
cmp "$work/regressions.expected" "$work/regressions.actual"
printf 'print(argument(1));\n' > "$work/args.ets"
[[ "$("$compiler" run "$work/args.ets" --binary "$work/args" --no-progress -- 'argument with spaces')" == 'argument with spaces' ]]
printf '{"entry":"main.ets","output":{"cpp":"configured.cpp","binary":"configured"},"compiler":{"enabled":true}}\n' > "$work/estatic.config.json"
"$compiler" --config "$work/estatic.config.json" --no-progress
[[ "$("$work/configured")" == 'ETS compiler works' ]]
echo 'ETS compiler smoke checks passed'
