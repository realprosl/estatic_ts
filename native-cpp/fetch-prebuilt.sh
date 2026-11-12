#!/usr/bin/env bash
# Descarga los precompilados (semilla y compilador de compiler/) de la rama
# `prebuilt` del repositorio en native-cpp/prebuilt/, que git ignora.
#
# La rama `prebuilt` NO se fusiona nunca con main: seed-prebuilt.yml la
# sobrescribe (un único commit, force-push) cada vez que cambian las fuentes,
# así que nunca acumula binarios en el historial. Aquí se trae solo ese último
# commit (--depth 1).
#
# Uso: native-cpp/fetch-prebuilt.sh [--remote NOMBRE|URL] [--branch RAMA]
#
# No falla nunca: si no hay git, red o rama, avisa y sale con 0, y build-all.sh /
# build-compiler.sh compilan desde las fuentes. Que los binarios descargados
# correspondan a este checkout lo decide después su huella (inputs.sha256).
set -uo pipefail
seed_dir="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$seed_dir/.." && pwd)"
remote="${ETSC_PREBUILT_REMOTE:-origin}" branch="${ETSC_PREBUILT_BRANCH:-prebuilt}"
while (($#)); do
  case "$1" in
    --remote) remote="$2"; shift 2 ;;
    --branch) branch="$2"; shift 2 ;;
    --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
note() { printf '    %s\n' "$*" >&2; }

if ! command -v git >/dev/null 2>&1 || ! git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
  note "precompilados: no es un checkout de git; se compilará desde las fuentes"
  exit 0
fi
# Se clona la rama en un directorio temporal: el repositorio del usuario no se
# toca (ni refs, ni historial superficial).
url="$(git -C "$root" remote get-url "$remote" 2>/dev/null || printf '%s' "$remote")"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/etsc-prebuilt.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
if ! git clone --quiet --depth 1 --single-branch --branch "$branch" "$url" "$tmp/clone" 2>/dev/null; then
  note "precompilados: no se pudo descargar la rama '$branch' de '$remote'; se compilará desde las fuentes"
  exit 0
fi
target="$seed_dir/prebuilt"
rm -rf "$target"; mkdir -p "$target"
# La rama tiene en su raíz un directorio por plataforma (linux-x86_64, ...).
(cd "$tmp/clone" && tar -c --exclude=.git .) | tar -x -C "$target"
find "$target" -type f -name etsc -exec chmod +x {} +
note "precompilados: rama '$branch' ($(git -C "$tmp/clone" rev-parse --short HEAD)) en native-cpp/prebuilt/"
exit 0
