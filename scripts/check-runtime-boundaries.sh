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
# Production native host and backend must not import Stage0.
# Audit/lexer/parser/binder/checker helpers intentionally compare against Stage0;
# bootstrap/modules/build.ts is the explicit first-stage compiler adapter.
# Do not exclude bootstrap/build/native-tables.ts: it feeds the native compiler.
violations="$(grep -nE '^[[:space:]]*(import|export)[[:space:]]|import[[:space:]]*[(]' \
  bootstrap/cli.ts bootstrap/install.ts bootstrap/build/native-compiler.ts \
  bootstrap/build/native-tables.ts bootstrap/ir/cpp.ts backend/ir/*.ts \
  shared/ir/*.ts shared/runtime/*.ts shared/project/*.ts shared/core/*.ts \
  | grep 'src/' || true)"
if [[ -n "$violations" ]]; then
  echo "$violations" >&2
  echo "ERROR: production native bootstrap/backend/shared imports Stage0 src/" >&2
  exit 1
fi
echo "Native compiler dependency boundary: OK"
echo "Runtime dependency boundary: OK"
