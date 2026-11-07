#!/usr/bin/env bash
#
# install.sh — instala el compilador nativo `etsc` a partir de la semilla C++.
#
# La semilla es `native-cpp/`: el C++ ya generado desde `bootstrap/` (el
# frontend completo, el driver, el backend IR y el runtime). Este script la
# compila con el compilador C++20 del sistema y publica el resultado en
# <prefix>/bin/etsc.
#
# No requiere Node.js ni TypeScript: todo lo que se instala procede de la
# semilla. Node sólo hace falta para REGENERAR la semilla cuando cambian las
# fuentes de `bootstrap/*.ets` (scripts/generate-native-cpp-snapshot.mjs).
#
# Uso:  ./install.sh [--prefix /usr/local] [--cxx g++] [--frontend binario]
#
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
seed_dir="$repo_dir/native-cpp"
prefix="/usr/local"
cxx="${CXX:-g++}"
frontend=""
ar_tool="${AR:-ar}"

usage() {
  cat <<'EOF'
Uso: ./install.sh [--prefix /usr/local] [--cxx g++] [--frontend binario]

Compila la semilla C++ de native-cpp/ y instala el compilador nativo etsc.

  --prefix DIR     donde instalar (por defecto /usr/local)
  --cxx COMPILADOR compilador C++20 (por defecto g++, o $CXX)
  --frontend BIN   usar un frontend ya construido en vez de compilar la semilla
  --help           esta ayuda

No requiere Node.js. Requisitos: un compilador C++20, `ar` y las cabeceras de
desarrollo de OpenSSL (libssl-dev). El runtime se precompila durante la
instalacion.
EOF
}

fail() { echo "ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --prefix|--cxx|--frontend)
      [ $# -ge 2 ] || fail "Opcion sin valor: $1"
      case "$1" in
        --prefix) prefix="$2" ;;
        --cxx) cxx="$2" ;;
        --frontend) frontend="$2" ;;
      esac
      shift 2 ;;
    *) fail "Opcion invalida: $1" ;;
  esac
done

case "$prefix" in /*) ;; *) prefix="$PWD/$prefix" ;; esac

command -v "$cxx" >/dev/null 2>&1 || fail "No se encuentra el compilador '$cxx'. Instala g++ o usa --cxx."
command -v "$ar_tool" >/dev/null 2>&1 || fail "No se encuentra '$ar_tool'. Forma parte de binutils."
[ -d "$seed_dir" ] || fail "Falta la semilla C++ en $seed_dir. Clona el repositorio completo."

if command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | cut -d" " -f1; }
  hash_stdin() { sha256sum | cut -d" " -f1; }
elif command -v shasum >/dev/null 2>&1; then
  hash_file() { shasum -a 256 "$1" | cut -d" " -f1; }
  hash_stdin() { shasum -a 256 | cut -d" " -f1; }
else
  fail "Hace falta sha256sum o shasum para verificar la instalacion."
fi

work="$repo_dir/build/install-$$"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

# --- Proteccion: no pisar una distribucion o un comando ajeno ---------------
library="$prefix/lib/estc"
current="$library/current"
destination="$prefix/bin/etsc"
legacy="$prefix/bin/estc"

if [ -e "$current" ] && [ ! -L "$current" ]; then
  fail "No se sobrescribe un directorio ajeno: $current"
fi
if [ -L "$current" ]; then
  format=""
  [ -f "$current/installation.json" ] && format="$(sed -n 's/.*"format"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$current/installation.json" | head -1)"
  [ "$format" = "estc-install-1" ] || fail "No se sustituye una distribucion ajena: $current"
fi
if [ -e "$destination" ]; then
  owned=0
  if [ -f "$current/installation.json" ]; then
    expected="$(sed -n 's/.*"commandHash"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$current/installation.json" | head -1)"
    [ "$expected" = "$(hash_file "$destination")" ] && owned=1
  fi
  # Un enlace de npm hacia este checkout es un launcher propio, no otra herramienta.
  if [ "$owned" -eq 0 ] && [ -L "$destination" ]; then
    target="$(readlink -f "$destination" 2>/dev/null || true)"
    [ "$target" = "$repo_dir/src/cli.ts" ] && owned=1
  fi
  [ "$owned" -eq 1 ] || fail "No se sobrescribe un comando ajeno: $destination; usa otro --prefix"
fi

echo "==> Compilando la semilla C++ de native-cpp/"
mkdir -p "$work/native"

if [ -n "$frontend" ]; then
  [ -x "$frontend" ] || fail "Frontend inexistente: $frontend"
  cp "$frontend" "$work/native/frontend"
  echo "    usando el frontend proporcionado: $frontend"
else
  echo "    frontend (analizador) -> native/frontend"
  "$cxx" -std=c++20 -O1 -pthread -fno-exceptions \
    -I"$seed_dir" -I"$seed_dir/frontend" \
    '-DESTATIC_FRONTEND_ID="portable"' \
    "$seed_dir/frontend/unity.cpp" -o "$work/native/frontend"
fi

echo "    driver y emisor IR -> native/etsc"
"$cxx" -std=c++20 -O2 \
  -I"$seed_dir" -I"$seed_dir/build/bootstrap/etsc" \
  "$seed_dir/bootstrap/native/driver.cpp" \
  "$seed_dir/src/codegen/ir/native/generator.cpp" \
  -lcrypto -o "$work/native/etsc"

command_hash="$(hash_file "$work/native/etsc")"

# --- Publicacion ------------------------------------------------------------
echo "==> Publicando en $prefix"
stage="$library/.install-$$"
mkdir -p "$stage/native" "$stage/templates"

cp -R "$seed_dir/runtime" "$stage/runtime"
cp -R "$seed_dir/types" "$stage/types"
cp -R "$seed_dir/templates/." "$stage/templates/"
# Las declaraciones canonicas son la unica fuente de verdad: si el checkout las
# tiene mas actualizadas que la semilla, mandan ellas.
[ -f "$repo_dir/types/estatic.d.ts" ] && cp "$repo_dir/types/estatic.d.ts" "$stage/templates/types/estatic.d.ts"
[ -f "$repo_dir/types/estatic.d.ts" ] && cp "$repo_dir/types/estatic.d.ts" "$stage/types/estatic.d.ts"

cp "$work/native/frontend" "$stage/native/frontend"
chmod +x "$stage/native/frontend"
cp "$repo_dir/package.json" "$stage/package.json"

# El compilador instalado usa el compilador que se pidio al instalar.
if [ -f "$stage/templates/estatic.config.json" ]; then
  sed "s/\"command\": \"[^\"]*\"/\"command\": \"$cxx\"/" "$stage/templates/estatic.config.json" > "$stage/templates/estatic.config.json.tmp"
  mv "$stage/templates/estatic.config.json.tmp" "$stage/templates/estatic.config.json"
fi

# libuv precompilado: evita depender de libuv1-dev en la maquina destino.
if [ -d "$repo_dir/build/libs" ]; then
  mkdir -p "$stage/build"
  cp -R "$repo_dir/build/libs" "$stage/build/libs"
fi

version="$(cd "$stage" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do printf '%s %s\n' "$file" "$(hash_file "$file")"; done | hash_stdin)"
version="${version:0:24}"

printf '{\n  "format": "estc-install-1",\n  "version": "%s",\n  "compiler": "%s",\n  "native": true,\n  "frontend": "native/frontend",\n  "commandHash": "%s"\n}\n' \
  "$version" "$cxx" "$command_hash" > "$stage/installation.json"

mkdir -p "$library/releases" "$(dirname "$destination")"
release="$library/releases/$version-$$"
mv "$stage" "$release"

# El puntero `current` se sustituye de forma atomica.
pointer="$library/.current-$$"
ln -sfn "releases/$(basename "$release")" "$pointer"
mv -T "$pointer" "$current" 2>/dev/null || { rm -f "$current"; mv "$pointer" "$current"; }

# El comando se publica de forma atomica.
command_tmp="$(dirname "$destination")/.etsc-$$"
cp "$work/native/etsc" "$command_tmp"
chmod +x "$command_tmp"
mv -T "$command_tmp" "$destination" 2>/dev/null || { rm -f "$destination"; mv "$command_tmp" "$destination"; }

# El comando legacy `estc` lo elimina esta distribucion si era suyo.
if [ -f "$current/installation.json" ] && [ -e "$legacy" ]; then
  legacy_hash="$(hash_file "$legacy")"
  expected="$(sed -n 's/.*"commandHash"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$current/installation.json" | head -1)"
  [ "$legacy_hash" = "$expected" ] && rm -f "$legacy"
fi

# --- Runtime precompilado ----------------------------------------------------
# El driver sabe calcular la clave de cache, el manifiesto y las rutas que
# despues reutiliza. Compilar un programa de prueba con el compilador ya
# instalado deja el runtime listo en su cache y en la distribucion.
echo "==> Precompilando el runtime (libuv, red y cpp-httplib)"
probe="$work/probe"
mkdir -p "$probe/src"
cat > "$probe/src/main.ets" <<'EOF'
async function main(): Promise<void> {
  const server = http.createServer();
  print("runtime listo");
}
main();
EOF
if ESTC_ROOT="$current" "$destination" build "$probe/src/main.ets" \
     -o "$probe/app.cpp" --binary "$probe/app" --no-progress >"$work/warm.log" 2>&1; then
  warm_cache="${ESTC_RUNTIME_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/estc/runtime}"
  if [ -d "$warm_cache" ]; then
    mkdir -p "$release/build/runtime-cache"
    for entry in "$warm_cache"/*/; do
      [ -d "$entry" ] || continue
      name="$(basename "$entry")"
      [ -e "$release/build/runtime-cache/$name" ] || cp -R "$entry" "$release/build/runtime-cache/$name"
    done
  fi
  echo "    runtime compilado y cacheado"
else
  echo "    aviso: no se pudo precompilar el runtime; el compilador lo hara al primer uso." >&2
  sed 's/^/    /' "$work/warm.log" >&2 || true
fi

echo "==> Instalado: $destination"
echo "    etsc init proyecto"
echo "    cd proyecto"
echo "    etsc build"
echo "    etsc run"
