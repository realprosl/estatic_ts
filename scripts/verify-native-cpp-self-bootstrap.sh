#!/usr/bin/env bash
# Prove that the checked-in native-cpp compiler can regenerate its own frontend.
# This test deliberately invokes no Node.js, npm, or src/ stage-0 compiler.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
output="${SELF_BOOTSTRAP_OUTPUT:-$root/build/native-cpp-self-bootstrap}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
export ESTC_ROOT="$root/native-cpp"
export TMPDIR="$output"
mkdir -p "$output/stage2" "$output/stage3" "$output/ir" "$output/control"

echo '=== Stage 1: rebuild native-cpp exclusively from its C++ sources ==='
bash native-cpp/build-all.sh
stage1="$ESTC_ROOT/native/etsc"
frontend1="$ESTC_ROOT/native/frontend"
test -x "$stage1"
test -x "$frontend1"
"$stage1" --version

echo '=== Stage 2: use native compiler to compile its own Bootstrap IR frontend ==='
"$stage1" build bootstrap/ir/demo.ets \
  -o "$output/stage2/frontend.cpp" \
  --binary "$output/stage2/frontend" --no-progress
test -s "$output/stage2/frontend.cpp"
test -x "$output/stage2/frontend"

echo '=== Compare stage-1 and stage-2 frontend IR ==='
for source in examples/hello.ets bootstrap/ir/demo.ets bootstrap/checker/demo.ets; do
  name="${source//\//_}"
  "$frontend1" "$source" > "$output/ir/stage1-$name.json"
  "$output/stage2/frontend" "$source" > "$output/ir/stage2-$name.json"
  python3 - "$output/ir/stage1-$name.json" "$output/ir/stage2-$name.json" <<'PY'
import json
import sys
from pathlib import Path
a, b = [json.loads(Path(p).read_text()) for p in sys.argv[1:]]
if not a.get("success") or not b.get("success"):
    raise SystemExit("Frontend returned unsuccessful IR")
if a != b:
    raise SystemExit(f"Stage 1 and stage 2 IR differ: {sys.argv[1:]}")
print(f"Matching verified IR: {sys.argv[1]}")
PY
done

echo '=== Stage 3: regenerate frontend using the stage-2 frontend ==='
"$stage1" build bootstrap/ir/demo.ets \
  --frontend "$output/stage2/frontend" \
  -o "$output/stage3/frontend.cpp" \
  --binary "$output/stage3/frontend" --no-progress
test -s "$output/stage3/frontend.cpp"
test -x "$output/stage3/frontend"

echo '=== Compare stage-2 and stage-3 frontend IR ==='
for source in examples/hello.ets bootstrap/ir/demo.ets bootstrap/checker/demo.ets; do
  name="${source//\//_}"
  "$output/stage3/frontend" "$source" > "$output/ir/stage3-$name.json"
  python3 - "$output/ir/stage2-$name.json" "$output/ir/stage3-$name.json" <<'PY'
import json
import sys
from pathlib import Path
a, b = [json.loads(Path(p).read_text()) for p in sys.argv[1:]]
if not a.get("success") or not b.get("success"):
    raise SystemExit("Frontend returned unsuccessful IR")
if a != b:
    raise SystemExit(f"Stage 2 and stage 3 IR differ: {sys.argv[1:]}")
print(f"Matching verified IR: {sys.argv[1]}")
PY
done

echo '=== Compile and execute control using stage-3 frontend ==='
"$stage1" build examples/hello.ets \
  --frontend "$output/stage3/frontend" \
  -o "$output/control/hello.cpp" \
  --binary "$output/control/hello" --no-progress
"$output/control/hello" > "$output/control/actual.txt"
printf 'Hola, mundo\n120\n' > "$output/control/expected.txt"
diff -u "$output/control/expected.txt" "$output/control/actual.txt"

cat > "$output/SUMMARY.txt" <<'EOF'
PASS: native-cpp C++ sources rebuild stage-1 compiler
PASS: stage-1 compiler compiles bootstrap/ir/demo.ets into stage-2 native frontend
PASS: stage-1 and stage-2 verified IR match on three programs
PASS: stage-2 frontend regenerates stage-3 native frontend
PASS: stage-2 and stage-3 verified IR match on three programs
PASS: stage-3 frontend compiles and runs hello.ets with expected output
No src/ TypeScript stage-0 compiler or Node.js was invoked during this verification.
EOF
cat "$output/SUMMARY.txt"
