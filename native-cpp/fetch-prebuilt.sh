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
#                                   [--platform P] [--compiler-only]
#
#   --platform P       solo la plataforma P (p. ej. linux-x86_64). Sin esta
#                      opción se descargan todas.
#   --compiler-only    solo el compilador (P/compiler/), sin la semilla. Lo usa
#                      install.sh para no descargar ni preparar la semilla
#                      cuando el compilador precompilado vale (#151).
#
# Con --platform se usa un clon parcial con sparse checkout, así que solo se
# descargan los binarios pedidos; si el servidor no lo admite, se clona la
# rama completa y se copia solo lo pedido.
#
# No falla nunca: si no hay git, red o rama, avisa y sale con 0, y build-all.sh /
# build-compiler.sh compilan desde las fuentes. Que los binarios descargados
# correspondan a este checkout lo decide después su huella (inputs.sha256).
set -uo pipefail
seed_dir="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$seed_dir/.." && pwd)"
remote="${ETSC_PREBUILT_REMOTE:-origin}" branch="${ETSC_PREBUILT_BRANCH:-prebuilt}"
platform="" compiler_only=0
while (($#)); do
  case "$1" in
    --remote) remote="$2"; shift 2 ;;
    --branch) branch="$2"; shift 2 ;;
    --platform) platform="$2"; shift 2 ;;
    --compiler-only) compiler_only=1; shift ;;
    --help) sed -n '2,27p' "$0"; exit 0 ;;
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
# Lo que se pide de la rama: todo, una plataforma o solo su compilador.
subset=""
if [ -n "$platform" ]; then
  subset="$platform"; [ "$compiler_only" -eq 1 ] && subset="$platform/compiler"
elif [ "$compiler_only" -eq 1 ]; then
  note "precompilados: --compiler-only necesita --platform"; exit 2
fi
cloned=0
if [ -n "$subset" ]; then
  # Clon parcial: solo se descargan los blobs del subconjunto pedido.
  if git clone --quiet --depth 1 --single-branch --branch "$branch" --filter=blob:none --sparse "$url" "$tmp/clone" 2>/dev/null \
     && git -C "$tmp/clone" sparse-checkout set --no-cone "/$subset/" 2>/dev/null; then
    cloned=1
  else
    rm -rf "$tmp/clone"
  fi
fi
if [ "$cloned" -eq 0 ] && ! git clone --quiet --depth 1 --single-branch --branch "$branch" "$url" "$tmp/clone" 2>/dev/null; then
  note "precompilados: no se pudo descargar la rama '$branch' de '$remote'; se compilará desde las fuentes"
  exit 0
fi
target="$seed_dir/prebuilt"
if [ -z "$subset" ]; then
  rm -rf "$target"; mkdir -p "$target"
  # La rama tiene en su raíz un directorio por plataforma (linux-x86_64, ...).
  (cd "$tmp/clone" && tar -c --exclude=.git .) | tar -x -C "$target"
else
  if [ ! -d "$tmp/clone/$subset" ]; then
    note "precompilados: la rama '$branch' no tiene '$subset'; se compilará desde las fuentes"
    exit 0
  fi
  # Solo se sustituye el subconjunto pedido; lo demás de prebuilt/ se conserva.
  rm -rf "$target/$subset"; mkdir -p "$target/$subset"
  (cd "$tmp/clone/$subset" && tar -c .) | tar -x -C "$target/$subset"
fi
find "$target" -type f -name etsc -exec chmod +x {} +
note "precompilados: rama '$branch' ($(git -C "$tmp/clone" rev-parse --short HEAD))${subset:+, solo $subset,} en native-cpp/prebuilt/"
exit 0
