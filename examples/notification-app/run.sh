#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compiler="${ETSC:-etsc}"
cd "$project_dir"
mkdir -p .build
"$compiler" update-types . >/dev/null
"$compiler" run --verbose > .build/actual-output.txt
if ! cmp -s expected.txt .build/actual-output.txt; then
  diff -u expected.txt .build/actual-output.txt
  exit 1
fi
cat .build/actual-output.txt
