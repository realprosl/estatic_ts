#!/usr/bin/env bash
# Construye la semilla: <out>/etsc, un compilador ETS completo compilado desde
# native-cpp/compiler/unity.cpp (el C++ que el compilador de compiler/ genera de
# sí mismo; lo produce native-cpp/regenerate.sh). Es el ÚNICO sitio que compila
# la semilla; lo usan install.sh, el CI y los desarrolladores.
#
# El resto del C++ se comparte con el repositorio y se usa desde su sitio:
#   runtime/                 runtime C++ único
#   compiler/modules/*.hpp  cabeceras de frontera nativa
# Los precompilados llegan a prebuilt/ (ignorado por git) con fetch-prebuilt.sh,
# desde la rama `prebuilt`.
#
# Uso: native-cpp/build-all.sh [--out DIR] [--cxx CXX] [--static] [--force]
#                              [--update-prebuilt]
#
#   --out DIR          destino (por defecto native-cpp/native)
#   --cxx CXX          compilador C++20 (por defecto $CXX o g++; clang++ en macOS)
#   --static           enlace autocontenido: Linux totalmente estático; macOS
#                      solo con libSystem y libc++
#   --force            ignora native-cpp/prebuilt/ y compila desde las fuentes
#                      (alias: --no-prebuilt)
#   --update-prebuilt  compila con --static y guarda el resultado y su huella en
#                      native-cpp/prebuilt/<plataforma>/ (lo usa el CI)
#
# Si existe native-cpp/prebuilt/<plataforma>/ y su huella (sha256 de todas las
# fuentes de entrada) coincide con el checkout, se copia en vez de compilar. Si
# no coincide, o no arranca, se compila: nunca se usa una semilla desfasada.
set -euo pipefail
seed="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$seed/.." && pwd)"
source "$root/compiler/native/progress.sh"
ETSC_CLI_SCOPE=${ETSC_CLI_SCOPE:-seed}

out="$seed/native" static=0 use_prebuilt=1 update_prebuilt=0
case "$(uname -s)" in Darwin) os=darwin; default_cxx=clang++ ;; *) os=linux; default_cxx=g++ ;; esac
cxx="${CXX:-$default_cxx}"
while (($#)); do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --cxx) cxx="$2"; shift 2 ;;
    --static) static=1; shift ;;
    --force|--no-prebuilt) use_prebuilt=0; shift ;;
    --update-prebuilt) update_prebuilt=1; static=1; use_prebuilt=0; shift ;;
    --help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
arch="$(uname -m)"; [[ $arch == aarch64 ]] && arch=arm64
platform="$os-$arch"
prebuilt="$seed/prebuilt/$platform"

# Huella de TODO lo que entra en el binario. Cambia si cambia cualquiera.
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
seed_inputs() {
  (cd "$root" && find native-cpp/compiler/unity.cpp compiler/modules runtime \
      -type f \( -name '*.cpp' -o -name '*.hpp' -o -name '*.h' -o -name '*.c' \) \
      | LC_ALL=C sort | while IFS= read -r f; do sha256 "$f"; done) | sha256 | cut -d' ' -f1
}

mkdir -p "$out"

if ((use_prebuilt)) && [[ -f $prebuilt/inputs.sha256 ]]; then
  if [[ "$(cat "$prebuilt/inputs.sha256")" == "$(seed_inputs)" ]] \
     && "$prebuilt/etsc" --version >/dev/null 2>&1; then
    cp "$prebuilt/etsc" "$out/etsc"; chmod +x "$out/etsc"
    etsc_info "✓ Semilla precompilada ($platform) · --force-seed para recompilarla"
    exit 0
  fi
  etsc_info "La semilla precompilada ($platform) no coincide con las fuentes; se compila"
fi

# Solo la librería estándar y pthread: el resto del runtime (libuv, curl,
# TLS...) no entra en el compilador.
link=()
if ((static)); then
  if [[ $os == linux ]]; then link=(-static)
  else
    # macOS no admite binarios 100% estáticos (libSystem); std::to_chars(double)
    # en libc++ exige macOS 13.3.
    export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.3}"
  fi
fi

label="semilla · C++20"; ((static)) && label="$label · estático"
etsc_spin "$label" "$cxx" -std=c++20 -O1 -pthread -fno-exceptions -I"$root" \
  "$seed/compiler/unity.cpp" -o "$out/etsc" ${link[@]+"${link[@]}"}

if ((update_prebuilt)); then
  mkdir -p "$prebuilt"
  cp "$out/etsc" "$prebuilt/etsc"
  strip "$prebuilt/etsc" 2>/dev/null || true
  seed_inputs > "$prebuilt/inputs.sha256"
  etsc_info "Semilla precompilada actualizada en native-cpp/prebuilt/$platform"
fi
