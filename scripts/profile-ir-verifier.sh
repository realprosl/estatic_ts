#!/usr/bin/env bash
# Verify an existing full IR without repeating source analysis or C++ emission.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
if [[ $# -lt 1 || $# -gt 2 || ! -s "$1" ]]; then
  echo 'Usage: scripts/profile-ir-verifier.sh existing.ir.json [all|borrows|ownership]' >&2
  exit 2
fi
input=$(realpath "$1")
phase=${2:-all}
case "$phase" in all|borrows|ownership) ;; *) echo "Unknown phase: $phase" >&2; exit 2 ;; esac
output=${ESTATIC_IR_PROFILE_DIR:-build/ir-profile}
export ESTC_ROOT="$root"
export TMPDIR="${TMPDIR:-$root/build/tmp}"
mkdir -p "$output" "$TMPDIR"
if [[ ! -x native-cpp/native/frontend || ! -x native-cpp/native/etsc ]]; then
  bash native-cpp/build-all.sh
fi
native-cpp/native/frontend bootstrap/ir/profile.ets > "$output/harness.ir.json"
native-cpp/native/etsc --from-ir "$output/harness.ir.json" --build \
  -o "$output/harness.cpp" --binary "$output/profile" --cxx-flag -O1 --no-progress
status=0
"$output/profile" "$input" "$phase" > "$output/result.txt" 2> "$output/timings.tsv" || status=$?
python3 scripts/report-ir-profile.py "$output/timings.tsv" | tee "$output/report.md"
exit "$status"
