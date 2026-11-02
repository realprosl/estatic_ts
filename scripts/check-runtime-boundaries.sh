#!/usr/bin/env bash
# Verify boundaries without Node; safe to run before native seed work.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ -d runtime && -d bootstrap && -d src ]] || { echo "Missing expected directories" >&2; exit 1; }
# Runtime implementation must not depend on either compiler's sources.
if grep -RInE --include='*.hpp' --include='*.h' --include='*.cpp'   '^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"][^>"]*(bootstrap/|src/)' runtime; then
  echo "ERROR: runtime includes compiler-specific files" >&2
  exit 1
fi
# C++ runtime is a shared dependency, not a host for compiler code.
if grep -RInE --include='*.hpp' --include='*.h' --include='*.cpp'   '^[[:space:]]*#[[:space:]]*include[[:space:]]*[<"][^>"]*(seed/|tools/legacy/)' runtime; then
  echo "ERROR: runtime depends on seed or legacy" >&2
  exit 1
fi
# Native compiler modules must not import Stage0. The single explicit exception
# is the host-only Stage0 builder used to compile the initial ETS frontend.
# Check import/export statements and dynamic imports, not comments.
violations="$(grep -RInE --include='*.ts' --exclude='*.test.ts' \
  '^[[:space:]]*(import|export)[[:space:]]|import[[:space:]]*[(]' bootstrap backend \
  | grep -E 'src/' \
  | grep -v -E '^bootstrap/modules/build[.]ts:[0-9]+:' || true)\"
if [[ -n "$violations" ]]; then
  echo "$violations" >&2
  echo "ERROR: native bootstrap/backend imports Stage0 src/ outside the host-only builder" >&2
  exit 1
fi
echo "Native compiler dependency boundary: OK"
echo "Runtime dependency boundary: OK"
