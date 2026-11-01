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
echo "Runtime dependency boundary: OK"
