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
debug_flags=()
if [[ "${SELF_BOOTSTRAP_DEBUG:-0}" == 1 ]]; then
  debug_flags=(--cxx-flag -g --cxx-flag -fno-omit-frame-pointer)
fi

capture_debug_stack() {
  local label="$1" trace
  shift
  [[ "${SELF_BOOTSTRAP_DEBUG:-0}" == 1 ]] || return 0
  command -v gdb >/dev/null || return 0
  trace="$output/gdb-${label//[![:alnum:]]/_}.log"
  printf 'Capturing GDB stack for %s in %s\n' "$label" "$trace" >&2
  # SIGINT stops the inferior, allowing batch GDB to execute the stack commands.
  # Follow a driver child as well, since the driver launches the frontend.
  timeout --preserve-status --signal=INT --kill-after=15s "${SELF_BOOTSTRAP_DEBUG_SAMPLE_SECONDS:-30}s" \
    gdb --batch --quiet \
      -ex 'set pagination off' -ex 'set confirm off' -ex 'set debuginfod enabled off' \
      -ex 'set print elements 5' -ex 'set print max-depth 3' \
      -ex 'set follow-fork-mode child' -ex 'set detach-on-fork on' \
      -ex run -ex 'thread apply all bt 40' -ex 'info args' -ex 'list' \
      --args "$@" > "$trace" 2>&1 || true
  tail -100 "$trace" >&2
}

# Bound each individual command so a stalled frontend reports its stage and
# source instead of silently consuming the entire workflow's 90-minute budget.
run_step() {
  local label="$1" started=$SECONDS status=0
  shift
  printf '[%s] START %s\n' "$(date -u +%FT%TZ)" "$label" >&2
  timeout --signal=TERM --kill-after=10s "${SELF_BOOTSTRAP_STEP_TIMEOUT:-600}s" "$@" || status=$?
  printf '[%s] END %s: exit=%s elapsed=%ss\n' "$(date -u +%FT%TZ)" "$label" "$status" "$((SECONDS-started))" >&2
  if [[ "$status" == 124 || "$status" == 137 ]]; then
    printf 'TIMEOUT: %s exceeded the per-command limit\n' "$label" >&2
    capture_debug_stack "$label" "$@"
  fi
  return "$status"
}

echo '=== Stage 1: rebuild native-cpp exclusively from its C++ sources ==='
run_step 'Stage 1: rebuild C++ sources' bash native-cpp/build-all.sh
stage1="$ESTC_ROOT/native/etsc"
frontend1="$ESTC_ROOT/native/frontend"
test -x "$stage1"
test -x "$frontend1"
"$stage1" --version

echo '=== Stage 2: use native compiler to compile its own Bootstrap IR frontend ==='
run_step 'Stage 2: generate and build frontend' "$stage1" build bootstrap/ir/demo.ets \
  -o "$output/stage2/frontend.cpp" \
  --emit-ir "$output/stage2/frontend.ir.json" "${debug_flags[@]}" \
  --binary "$output/stage2/frontend" --verbose --no-progress
test -s "$output/stage2/frontend.cpp"
test -x "$output/stage2/frontend"
python3 - "$output/stage2/frontend.ir.json" "$output/stage2/function-map.tsv" <<'PY'
import json
import sys
from pathlib import Path
project = json.loads(Path(sys.argv[1]).read_text())
with Path(sys.argv[2]).open("w") as output:
    for index, function in enumerate(project["functions"]):
        source = function["source"]
        print(f"ir_f{index}", function["name"], source["file"], source["start"], source["end"], sep="\t", file=output)
PY
capture_debug_stack 'Stage 2 sample bootstrap/ir/demo.ets' "$output/stage2/frontend" bootstrap/ir/demo.ets

echo '=== Compare stage-1 and stage-2 frontend IR ==='
for source in examples/hello.ets bootstrap/ir/demo.ets bootstrap/checker/demo.ets; do
  name="${source//\//_}"
  run_step "Stage 1 IR: $source" "$frontend1" "$source" > "$output/ir/stage1-$name.json"
  run_step "Stage 2 IR: $source" "$output/stage2/frontend" "$source" > "$output/ir/stage2-$name.json"
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
run_step 'Stage 3: generate and build frontend' "$stage1" build bootstrap/ir/demo.ets \
  --frontend "$output/stage2/frontend" \
  "${debug_flags[@]}" \
  -o "$output/stage3/frontend.cpp" \
  --binary "$output/stage3/frontend" --verbose --no-progress
test -s "$output/stage3/frontend.cpp"
test -x "$output/stage3/frontend"

echo '=== Compare stage-2 and stage-3 frontend IR ==='
for source in examples/hello.ets bootstrap/ir/demo.ets bootstrap/checker/demo.ets; do
  name="${source//\//_}"
  run_step "Stage 3 IR: $source" "$output/stage3/frontend" "$source" > "$output/ir/stage3-$name.json"
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
run_step 'Control: compile hello.ets with stage 3' "$stage1" build examples/hello.ets \
  --frontend "$output/stage3/frontend" \
  -o "$output/control/hello.cpp" \
  --binary "$output/control/hello" --verbose --no-progress
run_step 'Control: execute hello' "$output/control/hello" > "$output/control/actual.txt"
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
