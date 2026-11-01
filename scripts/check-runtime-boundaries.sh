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
# The native IR implementation must never import historical Stage0 modules.
# Stage0 facades may depend on backend/, but dependency direction is one-way.
if grep -RInE --include='*.ts' '^[[:space:]]*(import|export)[[:space:]]|import[[:space:]]*\\(' backend/ir bootstrap/ir | grep -E 'src/'; then
  echo "ERROR: native IR backend or bridge imports Stage0 src/" >&2
  exit 1
fi
echo "Native IR dependency boundary: OK"
echo "Runtime dependency boundary: OK"
