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
# Native IR code generation and the IR frontend bridge must not pull Stage0
# modules back into the dependency graph. Compatibility facades in src/ are
# permitted to import backend/, never the other way around.
if grep -RInE --include='*.ts' \
  '^[[:space:]]*(import|export)[[:space:]].*from[[:space:]]*["\x27][^"\x27]*src/' \
  backend/ir bootstrap/ir; then
  echo "ERROR: native IR backend or bridge imports Stage0 src/" >&2
  exit 1
fi
# The same rule applies to side-effect imports and dynamic imports.
if grep -RInE --include='*.ts' \
  '(import[[:space:]]*\\(|import[[:space:]]*["\x27])[^;]*src/' \
  backend/ir bootstrap/ir; then
  echo "ERROR: native IR backend or bridge dynamically imports Stage0 src/" >&2
  exit 1
fi
echo "Native IR dependency boundary: OK"
echo "Runtime dependency boundary: OK"
