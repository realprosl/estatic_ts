#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
variant=${1:?Expected variant}
result="$root/build/analysis-lab"
reference="$result/reference"
mkdir -p "$reference" "$result/baseline" "$result/candidate"
# Identical source paths, bytes and compiler optimization in both measurements.
git archive ccbfe46610a83a426e247f58b2b08926cf5de1bd | tar -x -C "$reference"
export ESTATIC_ETS_OPTIMIZATION=-O2
ESTATIC_ETS_BUILD_DIR="$result/baseline" bash scripts/build-ets-compiler.sh stage1
python3 scripts/analysis-experiments/variants.py "$variant"
git diff -- bootstrap/checker > "$result/variant.diff"
ESTATIC_ETS_BUILD_DIR="$result/candidate" bash scripts/build-ets-compiler.sh stage1
printf 'compiler\twall_seconds\tuser_seconds\tsystem_seconds\tpeak_rss_kib\n' > "$result/analysis.tsv"
for compiler in baseline candidate; do
  (
    cd "$reference"
    export ESTC_ROOT="$root"
    /usr/bin/time -a -o "$result/analysis.tsv" -f "$compiler\t%e\t%U\t%S\t%M" \
      timeout 1200 "$result/$compiler/etsc" bootstrap/driver/main.ets --check \
      --emit-ir "$result/$compiler.ir.json" --verbose --no-progress \
      > "$result/$compiler.stdout" 2> "$result/$compiler.log"
  )
done
cmp "$result/baseline.ir.json" "$result/candidate.ir.json"
python3 - "$result/analysis.tsv" <<'PYREPORT'
import csv, sys
with open(sys.argv[1]) as stream:
    rows = list(csv.DictReader(stream, delimiter='\t'))
a, b = (float(row['wall_seconds']) for row in rows)
print(f'Paired baseline {a:.3f}s; candidate {b:.3f}s; time reduction {(a-b)/a*100:.2f}% (pending correctness tests)')
PYREPORT
echo 'Identical compiler IR' > "$result/equivalence.txt"
# Build the actual experimental checker, including negative ownership fixtures.
export ESTC_ROOT="$root"
native-cpp/native/frontend bootstrap/checker/demo.ets > "$result/checker.ir.json"
native-cpp/native/etsc --from-ir "$result/checker.ir.json" --build \
  -o "$result/checker.cpp" --binary "$result/checker" --cxx-flag -O2 --no-progress
ESTATIC_CHECKER_BINARY="$result/checker" node --experimental-strip-types --test bootstrap/checker/checker.test.ts \
  > "$result/checker-tests.log" 2>&1
bash scripts/check-ets-compiler.sh "$result/candidate/etsc" > "$result/smoke.log" 2>&1
