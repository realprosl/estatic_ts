#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node_command="${NODE:-node}"
if ! command -v "${node_command}" >/dev/null 2>&1; then
  echo "ERROR: install.sh requiere Node >=22.6, un compilador C++20 y ar." >&2
  exit 1
fi
exec "${node_command}" --experimental-strip-types --no-warnings "${repo_dir}/bootstrap/install.ts" "$@"
