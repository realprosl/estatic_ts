#!/usr/bin/env bash
#
# install.sh — instala el compilador nativo `etsc` a partir de la semilla C++.
#
# La semilla es `native-cpp/compiler/unity.cpp`: el C++ que el compilador de
# `compiler/` genera de sí mismo. Compilada, es un `etsc` completo que compila
# `compiler/` (generación 2); ese es el `etsc` que se publica en <prefix>/bin.
# El runtime (`runtime/`) y las cabeceras de frontera (`compiler/modules/`) se
# usan desde su sitio canónico.
#
# No requiere Node.js ni TypeScript, ni para instalar ni para regenerar la
# semilla (native-cpp/regenerate.sh).
#
# Uso:  ./install.sh [--prefix /usr/local] [--cxx g++]
#  o, sin clonar el repositorio:
#   curl -fsSL https://raw.githubusercontent.com/realprosl/estatic_ts/main/install.sh | bash
#
set -euo pipefail

# --- Instalacion remota: curl -fsSL .../install.sh | bash ---------------------
# Sin el repositorio al lado (script leido de stdin o copiado suelto), se clona
# lo minimo en un directorio temporal, se instala desde ahi y se borra. La
# instalacion usa los precompilados de la rama `prebuilt` como siempre.
script_dir=""
[ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ] && script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "$script_dir" ] || [ ! -f "$script_dir/native-cpp/build-all.sh" ]; then
  for arg in "$@"; do [ "$arg" = "--help" ] && { echo "Uso: curl -fsSL https://raw.githubusercontent.com/realprosl/estatic_ts/main/install.sh | bash -s -- [opciones]"; echo "Las opciones son las de ./install.sh --help."; exit 0; }; done
  command -v git >/dev/null 2>&1 || { echo "ERROR: hace falta git para descargar estatic_ts." >&2; exit 1; }
  remote="${ESTC_REPO:-https://github.com/realprosl/estatic_ts.git}"
  ref="${ESTC_REF:-main}"
  checkout="$(mktemp -d "${TMPDIR:-/tmp}/estatic-install.XXXXXX")"
  echo "Descargando estatic_ts ($ref) en $checkout"
  status=0
  if git clone -q --depth 1 --single-branch --branch "$ref" "$remote" "$checkout/estatic_ts"; then
    # stdin desde /dev/null: con `curl | bash` el resto del script sigue en el pipe.
    bash "$checkout/estatic_ts/install.sh" "$@" </dev/null || status=$?
  else
    echo "ERROR: no se pudo clonar $remote ($ref)" >&2; status=1
  fi
  rm -rf "$checkout"
  exit "$status"
fi

repo_dir="$script_dir"
ETSC_CLI_SCOPE=install
seed_dir="$repo_dir/native-cpp"
prefix="/usr/local"
cxx="${CXX:-g++}"
ar_tool="${AR:-ar}"

usage() {
  cat <<'EOF'
Uso: ./install.sh [--prefix /usr/local] [--cxx g++] [--seed BIN] [--seed-only] [--force-seed] [--force-compiler]

Compila la semilla C++ de native-cpp/ y con ella compila compiler/, y
publica el ejecutable resultante como el compilador nativo etsc.

  --prefix DIR     donde instalar (por defecto /usr/local)
  --cxx COMPILADOR compilador C++20 (por defecto g++, o $CXX)
  --seed BIN       usar ese etsc (semilla ya compilada) en vez de construirla
  --seed-only      publicar la semilla sin la generacion 2 (compilador rapido)
  --force-seed     recompilar la semilla aunque haya una precompilada valida
  --force-compiler recompilar el compilador de compiler/ aunque haya uno
                   precompilado valido (alias: --force-compile)
  --force          las dos cosas: --force-seed y --force-compiler
  --help           esta ayuda (lista todas las opciones)

Por defecto se descargan (rama `prebuilt`, native-cpp/fetch-prebuilt.sh) y usan
las versiones precompiladas de native-cpp/prebuilt/<plataforma>
(Linux x86_64, macOS arm64) de la semilla y del compilador, cada una solo si su
huella coincide con las fuentes; si no hay o esta desfasada, se compila.

No requiere Node.js. Requisitos: un compilador C++20, `ar` y las cabeceras de
desarrollo de OpenSSL (libssl-dev). El runtime se precompila durante la
instalacion.
EOF
}

fail() { echo "ERROR: $*" >&2; exit 1; }

seed_only=0
seed_bin=""
force_seed=0
force_compiler=0
while [ $# -gt 0 ]; do
  case "$1" in
    --help) usage; exit 0 ;;
    --seed-only) seed_only=1; shift ;;
    --force-seed|--no-prebuilt) force_seed=1; shift ;;
    --force-compiler|--force-compile) force_compiler=1; shift ;;
    --force) force_seed=1; force_compiler=1; shift ;;
    --prefix|--cxx|--seed)
      [ $# -ge 2 ] || fail "Opcion sin valor: $1"
      case "$1" in
        --prefix) prefix="$2" ;;
        --cxx) cxx="$2" ;;
        --seed) seed_bin="$2" ;;
      esac
      shift 2 ;;
    *) fail "Opcion invalida: $1" ;;
  esac
done

case "$prefix" in /*) ;; *) prefix="$PWD/$prefix" ;; esac

command -v "$cxx" >/dev/null 2>&1 || fail "No se encuentra el compilador '$cxx'. Instala g++ o usa --cxx."
command -v "$ar_tool" >/dev/null 2>&1 || fail "No se encuentra '$ar_tool'. Forma parte de binutils."
[ -d "$seed_dir" ] || fail "Falta la semilla C++ en $seed_dir. Clona el repositorio completo."
source "$repo_dir/compiler/native/progress.sh"

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

# Los precompilados se descargan de la rama `prebuilt` (no estan en main).
if [ "$force_seed" -eq 0 ] || [ "$force_compiler" -eq 0 ]; then
  bash "$seed_dir/fetch-prebuilt.sh"
fi

etsc_info "Construyendo la semilla C++20"
mkdir -p "$work/native"
# native-cpp/build-all.sh es el unico sitio que construye la semilla: por
# defecto usa la precompilada de native-cpp/prebuilt/<plataforma> si coincide
# con las fuentes y, si no (o con --force-seed), la compila.
seed_args=(--out "$work/native" --cxx "$cxx")
[ "$force_seed" -eq 1 ] && seed_args+=(--force)
if [ -n "$seed_bin" ]; then
  [ -x "$seed_bin" ] || fail "Semilla inexistente: $seed_bin"
  rm -f "$work/native/etsc"; cp "$seed_bin" "$work/native/etsc"; chmod +x "$work/native/etsc"
  echo "    usando la semilla proporcionada: $seed_bin"
else
  ETSC_CLI_SCOPE=install bash "$seed_dir/build-all.sh" "${seed_args[@]}"
fi

# --- Generacion 2: la semilla compila compiler/ ------------------------------
# La semilla es el generador: con ella se compila `compiler/` y el ejecutable
# resultante es el compilador que se instala. Asi
# el `etsc` publicado refleja siempre el codigo actual de `compiler/`, y no el
# snapshot C++ de la semilla, que puede quedar desfasado.
#
# Con --seed-only se conserva el comportamiento anterior (publicar la
# semilla) para quien solo quiere el compilador rapido sin Node.
if [ "$seed_only" -eq 0 ]; then
  etsc_info "Generacion 2 · compilador de compiler/"
  # native-cpp/build-compiler.sh: por defecto usa el compilador precompilado de
  # native-cpp/prebuilt/<plataforma>/compiler si coincide con las fuentes; si no
  # (o con --force-compiler), lo compila con la semilla.
  compiler_args=(--seed "$work/native" --out "$work/generation/etsc")
  [ "$force_compiler" -eq 1 ] && compiler_args+=(--force)
  ETSC_CLI_SCOPE=install ESTC_ROOT="$repo_dir" CXX="$cxx" bash "$seed_dir/build-compiler.sh" "${compiler_args[@]}"
  # El ejecutable de la generacion 2 sustituye a la semilla como comando
  # publicado: es el que implementa el codigo actual de compiler/.
  # Borrar antes de copiar: si algún proceso aún ejecuta la semilla, sobrescribirla
  # falla con "Text file busy"; borrarla (unlink) siempre se puede.
  rm -f "$work/native/etsc"
  cp "$work/generation/etsc" "$work/native/etsc"
  chmod +x "$work/native/etsc"
fi

command_hash="$(hash_file "$work/native/etsc")"

# --- Publicacion ------------------------------------------------------------
etsc_info "Publicando en $prefix"
stage="$library/.install-$$"
mkdir -p "$stage/native" "$stage/templates"

# Runtime unico del repositorio: el mismo que usan la semilla y compiler/.
cp -R "$repo_dir/runtime" "$stage/runtime"
# Generated bootstrap C++ includes these native boundary headers by this path.
# Ship only headers, without the ETS/TS compiler sources or native driver.
mkdir -p "$stage/compiler/modules"
find "$repo_dir/compiler/modules" -maxdepth 1 -type f \
  \( -name '*.hpp' -o -name '*.h' \) -exec cp {} "$stage/compiler/modules/" \;
cp -R "$repo_dir/types" "$stage/types"
cp -R "$repo_dir/messages" "$stage/messages"
cp -R "$seed_dir/templates/." "$stage/templates/"
# Las declaraciones canonicas son la unica fuente de verdad.
cp "$repo_dir/types/estatic.d.ts" "$stage/templates/types/estatic.d.ts"

# native/frontend: adaptador del protocolo fuente->IR (JSON por stdout) que usan
# las herramientas de compiler/*.ts, sobre el etsc instalado.
cat > "$stage/native/frontend" <<'FRONTEND'
#!/usr/bin/env bash
set -euo pipefail
home="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/etsc-frontend.XXXXXX")"
trap 'rm -rf "$work"' EXIT
# <prefijo>/lib/estc/{current,releases/ID} -> <prefijo>/bin/etsc. Se recorta la
# ruta en vez de subir con ../ (current es un enlace simbólico) y así el prefijo
# se puede mover.
prefix="${home%/lib/estc/*}"
ESTC_ROOT="${ESTC_ROOT:-$home}" "$prefix/bin/etsc" "$@" --check --emit-ir "$work/project.ir.json" --no-progress
cat "$work/project.ir.json"
FRONTEND
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

# --- Runtime precompilado ----------------------------------------------------
# Los .cpp del runtime se compilan una vez aqui y quedan dentro de la
# distribucion (<release>/build/objects), de solo lectura y comunes a todos los
# usuarios: etsc los busca ahi antes que en su cache (~/.cache/estc/objects).
# Se compila un proyecto de prueba creado con `etsc init`, asi los objetos
# llevan los flags por defecto de estatic.config.json.
etsc_info "Preparando runtime · libuv, red, HTTP y regex"
probe="$work/probe"
mkdir -p "$release/build/objects"
if ESTC_ROOT="$current" "$destination" init "$probe" >"$work/warm.log" 2>&1; then
  cat > "$probe/src/main.ts" <<'EOF'
async function main(): Promise<void> {
  const server = http.createServer();
  process.stdin.on("data", (chunk: string): void => { print(chunk); });
  print("runtime listo");
}
main();
EOF
fi
if [ -f "$probe/estatic.config.json" ] && (cd "$probe" && ESTC_ROOT="$current" ESTC_OBJECT_CACHE="$release/build/objects" "$destination" build --no-progress) >>"$work/warm.log" 2>&1; then
  # La PCH del programa de prueba solo serviria a esa combinacion de APIs y
  # ocupa mas de 100 MB: cada usuario compone las suyas en su cache.
  rm -rf "$release/build/pch"
  echo "    runtime compilado: $(find "$release/build/objects" -name '*.o' | wc -l | tr -d ' ') objetos en $release/build/objects"
else
  echo "    aviso: no se pudo precompilar el runtime; el compilador lo hara al primer uso." >&2
  sed 's/^/    /' "$work/warm.log" >&2 || true
fi

etsc_info "✓ Instalado: $destination"
echo "    etsc init proyecto"
echo "    cd proyecto"
echo "    etsc build"
echo "    etsc run"
