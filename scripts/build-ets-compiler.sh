#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
source "$root/bootstrap/native/progress.sh"
ETSC_CLI_SCOPE=bootstrap
trace=()
if ! etsc_color || [[ ${ESTATIC_BUILD_VERBOSE:-0} == 1 ]]; then trace=(--verbose); fi
export ESTC_ROOT="$root"
export TMPDIR="${TMPDIR:-$root/build/tmp}"
output=${ESTATIC_ETS_BUILD_DIR:-build/ets-compiler}
mkdir -p "$TMPDIR" "$output"
stage=${1:-stage1}
optimization=${ESTATIC_ETS_OPTIMIZATION:--O1}
case "$optimization" in -O1|-O2|-O3) ;; *) echo 'Expected -O1, -O2 or -O3' >&2; exit 2 ;; esac
measure() {
  local phase="$1" presenter="$2" label="$3"
  shift 3
  "$presenter" "$label" /usr/bin/time -a -o "$output/timings.tsv" -f "$phase\t%e\t%U\t%S\t%M" "$@"
}
printf 'phase\twall_seconds\tuser_seconds\tsystem_seconds\tpeak_rss_kib\n' > "$output/timings.tsv"
if [[ "$stage" != stage1 && "$stage" != stage2 ]]; then
  echo 'Usage: scripts/build-ets-compiler.sh [stage1|stage2]' >&2
  exit 2
fi
if [[ ! -x native-cpp/native/frontend || ! -x native-cpp/native/etsc || native-cpp/src/codegen/ir/native/generator.cpp -nt native-cpp/native/etsc ]]; then
  measure seed-build etsc_step "Semilla · construir compilador C++" bash native-cpp/build-all.sh
fi
# The seed assembles the first complete ETS compiler. Its conservative length
# fusion prevents the parser from copying entire token/AST arrays for .length.
measure seed-analysis etsc_spin "Generación 1 · analizar fuentes ETS" native-cpp/native/frontend bootstrap/driver/main.ets "${trace[@]}" > "$output/stage1.ir.json"
measure stage1-build etsc_step "Generación 1 · construir ejecutable" native-cpp/native/etsc --from-ir "$output/stage1.ir.json" --build \
  -o "$output/stage1.cpp" --binary "$output/etsc" --cxx-flag "$optimization" "${trace[@]}"
if [[ "$stage" == stage2 ]]; then
  # This generation performs analysis, lowering, emission and orchestration in ETS.
  ETSC_LOG_FILE="$output/stage2-analysis.log" measure stage2-analysis etsc_spin "Generación 2 · analizar con el compilador ETS" "$output/etsc" bootstrap/driver/main.ets --check \
    --emit-ir "$output/stage2.ir.json" \
    "${trace[@]}"
  measure stage2-build etsc_step "Generación 2 · construir ejecutable" "$output/etsc" --from-ir "$output/stage2.ir.json" --build \
    -o "$output/stage2.cpp" --binary "$output/etsc-stage2" --cxx-flag "$optimization" "${trace[@]}"
fi
