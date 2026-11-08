#!/usr/bin/env bash
# Compila la semilla C++, construye con ella el compilador completo ETS y
# publica el binario, runtime precompilado, cabeceras, tipos y plantillas.
# No requiere Node. Uso: ./install.sh [--prefix /usr/local] [--cxx g++]
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

Compila la semilla C++, construye el compilador ETS y lo instala como etsc.

  --prefix DIR     donde instalar (por defecto /usr/local)
  --cxx COMPILADOR compilador C++20 (por defecto g++, o $CXX)
  --frontend BIN   usar un frontend ya construido en vez de compilar la semilla
  --help           esta ayuda

No requiere Node.js. Requisitos: un compilador C++20, `ar` y las cabeceras de
desarrollo de OpenSSL, libuv y libcurl. El runtime se precompila durante la
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
stage=""
cleanup() { rm -rf "$work"; if [ -n "$stage" ]; then rm -rf "$stage"; fi; }
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
  # El comando legacy `estc` se retira solo si la instalacion ACTUAL lo
  # declara suyo. Hay que decidirlo antes de publicar: `current` pasara a
  # apuntar a la distribucion nueva, con otro hash.
  legacy_hash="$(sed -n 's/.*"commandHash"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$current/installation.json" | head -1)"
  if [ -e "$legacy" ] && [ "$legacy_hash" = "$(hash_file "$legacy")" ]; then
    owned_legacy=1
  else
    owned_legacy=0
  fi
else
  owned_legacy=0
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
  -lcrypto -o "$work/native/seed-etsc"

echo "==> Construyendo el compilador completo desde bootstrap/driver/main.ets"
# Every installation regenerates from the current ETS sources, not a stale snapshot.
ESTC_ROOT="$repo_dir" "$work/native/frontend" "$repo_dir/bootstrap/driver/main.ets" --verbose > "$work/compiler.ir.json"
compiler_flags=(--cxx-flag -O2)
if [ -f "$repo_dir/build/libs/libuv/include/uv.h" ]; then compiler_flags+=(--cxx-flag "-I$repo_dir/build/libs/libuv/include"); fi
ESTC_ROOT="$repo_dir" "$work/native/seed-etsc" --from-ir "$work/compiler.ir.json" --build \
  -o "$work/compiler.cpp" --binary "$work/native/etsc" --cxx "$cxx" "${compiler_flags[@]}" --verbose
command_hash="$(hash_file "$work/native/etsc")"

# --- Publicacion ------------------------------------------------------------
echo "==> Preparando distribución en $prefix"
stage="$library/.install-$$"
mkdir -p "$stage/native" "$stage/templates"

cp -R "$repo_dir/runtime" "$stage/runtime"
# Generated bootstrap C++ includes these native boundary headers by this path.
# Ship only headers, without the ETS/TS compiler sources or native driver.
mkdir -p "$stage/bootstrap/modules"
find "$repo_dir/bootstrap/modules" -maxdepth 1 -type f \
  \( -name '*.hpp' -o -name '*.h' \) -exec cp {} "$stage/bootstrap/modules/" \;
cp -R "$seed_dir/types" "$stage/types"
cp -R "$seed_dir/templates/." "$stage/templates/"
# Las declaraciones canonicas son la unica fuente de verdad: si el checkout las
# tiene mas actualizadas que la semilla, mandan ellas.
[ -f "$repo_dir/types/estatic.d.ts" ] && cp "$repo_dir/types/estatic.d.ts" "$stage/templates/types/estatic.d.ts"
[ -f "$repo_dir/types/estatic.d.ts" ] && cp "$repo_dir/types/estatic.d.ts" "$stage/types/estatic.d.ts"

# Keep the seed available for recovery, while bin/etsc contains the ETS driver.
cp "$work/native/frontend" "$stage/native/frontend"
cp "$work/native/seed-etsc" "$stage/native/seed-etsc"
cp "$work/compiler.cpp" "$stage/native/compiler.cpp"
cp "$work/compiler.ir.json" "$stage/native/compiler.ir.json"
chmod +x "$stage/native/frontend" "$stage/native/seed-etsc"
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

echo "==> Precompilando el runtime antes de publicar"
bash "$repo_dir/scripts/precompile-installed-runtime.sh" "$stage" "$cxx"
# Check relocation and build/run against the distribution about to be published.
mkdir -p "$work/probe"
printf 'print("ETS compiler works");\n' > "$work/probe/main.ets"
ESTC_ROOT="$stage" "$work/native/etsc" build "$work/probe/main.ets" \
  -o "$work/probe/main.cpp" --binary "$work/probe/main" --no-progress
[ "$("$work/probe/main")" = "ETS compiler works" ] || fail "Falló la comprobación del compilador ETS"

version="$(cd "$stage" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do printf '%s %s\n' "$file" "$(hash_file "$file")"; done | hash_stdin)"
version="${version:0:24}"

printf '{\n  "format": "estc-install-1",\n  "version": "%s",\n  "compiler": "%s",\n  "native": true,\n  "implementation": "ets",\n  "frontend": "native/frontend",\n  "commandHash": "%s"\n}\n' \
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

# El comando legacy `estc` lo elimina esta distribucion si era suyo, y el
# `nativo` de la v1 si su manifiesto declara que le pertenece.
if [ "$owned_legacy" -eq 1 ] && [ -e "$legacy" ]; then
  rm -f "$legacy"
fi
legacy_nativo="$prefix/bin/nativo"
legacy_nativo_manifest="$prefix/lib/nativo/current/installation.json"
if [ -e "$legacy_nativo" ] && [ -f "$legacy_nativo_manifest" ]; then
  legacy_format="$(sed -n 's/.*"format"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$legacy_nativo_manifest" | head -1)"
  legacy_nativo_hash="$(sed -n 's/.*"commandHash"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$legacy_nativo_manifest" | head -1)"
  if [ "$legacy_format" = "nativo-install-1" ] && [ "$legacy_nativo_hash" = "$(hash_file "$legacy_nativo")" ]; then
    rm -f "$legacy_nativo"
  fi
fi

echo "==> Instalado: $destination"
echo "    etsc init proyecto"
echo "    cd proyecto"
echo "    etsc build"
echo "    etsc run"
