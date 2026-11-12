#!/usr/bin/env bash
# Construye la semilla C++: <out>/frontend (analizador) y <out>/etsc
# (coordinador + emisor IR). Es el ÚNICO sitio que compila la semilla; lo usan
# install.sh, el CI y los desarrolladores.
#
# native-cpp/ solo contiene lo GENERADO desde bootstrap/ (frontend/, tablas en
# build/bootstrap/etsc/ y templates/) más la semilla precompilada (prebuilt/).
# Todo lo demás se comparte con el resto del repositorio:
#   runtime/                 runtime C++ único (semilla, bootstrap y programas)
#   bootstrap/native/        coordinador nativo (driver.cpp, platform.hpp, progress.*)
#   bootstrap/modules/*.hpp  cabeceras de frontera nativa
#   src/codegen/ir/native/   emisor IR -> C++
#
# Uso: native-cpp/build-all.sh [--out DIR] [--cxx CXX] [--frontend BINARIO]
#                              [--static] [--force] [--update-prebuilt]
#
#   --out DIR          destino (por defecto native-cpp/native)
#   --cxx CXX          compilador C++20 (por defecto $CXX o g++; clang++ en macOS)
#   --frontend BIN     usa ese frontend ya compilado en vez de construirlo
#   --static           enlace autocontenido: Linux totalmente estático; macOS con
#                      libcrypto estática (libSystem y libc++ siempre son del SO)
#   --force            ignora native-cpp/prebuilt/ y compila desde las fuentes
#                      (alias: --no-prebuilt)
#   --update-prebuilt  compila con --static y guarda el resultado y su huella en
#                      native-cpp/prebuilt/<plataforma>/ (lo usa el CI)
#
# Si existe native-cpp/prebuilt/<plataforma>/ y su huella (sha256 de todas las
# fuentes de entrada) coincide con el checkout, se copian esos binarios en vez
# de compilar. Si no coincide, o no arrancan, se compila: nunca se usa una
# semilla precompilada desfasada.
set -euo pipefail
seed="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$seed/.." && pwd)"
source "$root/bootstrap/native/progress.sh"
ETSC_CLI_SCOPE=${ETSC_CLI_SCOPE:-seed}

out="$seed/native" frontend_bin="" static=0 use_prebuilt=1 update_prebuilt=0
case "$(uname -s)" in Darwin) os=darwin; default_cxx=clang++ ;; *) os=linux; default_cxx=g++ ;; esac
cxx="${CXX:-$default_cxx}"
while (($#)); do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --cxx) cxx="$2"; shift 2 ;;
    --frontend) frontend_bin="$2"; shift 2 ;;
    --static) static=1; shift ;;
    --force|--no-prebuilt) use_prebuilt=0; shift ;;
    --update-prebuilt) update_prebuilt=1; static=1; use_prebuilt=0; shift ;;
    --help) sed -n '2,31p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
arch="$(uname -m)"; [[ $arch == aarch64 ]] && arch=arm64
platform="$os-$arch"
prebuilt="$seed/prebuilt/$platform"

# Huella de TODO lo que entra en los dos binarios. Cambia si cambia cualquiera.
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
seed_inputs() {
  (cd "$root" && find native-cpp/frontend/unity.cpp native-cpp/build/bootstrap/etsc \
      bootstrap/native/driver.cpp bootstrap/native/platform.hpp src/codegen/ir/native runtime \
      -type f | LC_ALL=C sort | while IFS= read -r f; do sha256 "$f"; done) | sha256 | cut -d' ' -f1
}

mkdir -p "$out"

if ((use_prebuilt)) && [[ -z $frontend_bin && -f $prebuilt/inputs.sha256 ]]; then
  if [[ "$(cat "$prebuilt/inputs.sha256")" == "$(seed_inputs)" ]] \
     && "$prebuilt/etsc" --version >/dev/null 2>&1; then
    cp "$prebuilt/frontend" "$out/frontend"; cp "$prebuilt/etsc" "$out/etsc"
    chmod +x "$out/frontend" "$out/etsc"
    etsc_info "✓ Semilla precompilada ($platform) · --force-seed para recompilarla"
    exit 0
  fi
  etsc_info "La semilla precompilada ($platform) no coincide con las fuentes; se compila"
fi

# --- Enlace -------------------------------------------------------------------
# Solo libcrypto (hash del coordinador), la librería estándar y pthread: el
# resto del runtime (libuv, curl, TLS...) no entra en la semilla.
frontend_link=() etsc_link=(-lcrypto) crypto_include=()
if ((static)); then
  if [[ $os == linux ]]; then
    frontend_link=(-static) etsc_link=(-static -lcrypto)
  else
    # macOS no admite binarios 100% estáticos (libSystem); OpenSSL sí va dentro.
    ssl="${OPENSSL_PREFIX:-$(brew --prefix openssl@3 2>/dev/null || true)}"
    [[ -f $ssl/lib/libcrypto.a ]] || { echo "No se encuentra libcrypto.a (OPENSSL_PREFIX o brew openssl@3)" >&2; exit 1; }
    crypto_include=(-I"$ssl/include") etsc_link=("$ssl/lib/libcrypto.a")
    # std::to_chars(double) en libc++ exige macOS 13.3.
    export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.3}"
  fi
elif [[ $os == darwin ]]; then
  ssl="${OPENSSL_PREFIX:-$(brew --prefix openssl@3 2>/dev/null || true)}"
  [[ -n $ssl ]] && crypto_include=(-I"$ssl/include") etsc_link=(-L"$ssl/lib" -lcrypto)
fi

build_frontend() {
  "$cxx" -std=c++20 -O1 -pthread -fno-exceptions -I"$root" -I"$seed" -I"$seed/frontend" \
    '-DESTATIC_FRONTEND_ID="portable"' "$seed/frontend/unity.cpp" -o "$out/frontend" ${frontend_link[@]+"${frontend_link[@]}"}
}
build_etsc() {
  "$cxx" -std=c++20 -O2 -pthread -I"$root" -I"$seed/build/bootstrap/etsc" ${crypto_include[@]+"${crypto_include[@]}"} \
    "$root/bootstrap/native/driver.cpp" "$root/src/codegen/ir/native/generator.cpp" \
    -o "$out/etsc" ${etsc_link[@]+"${etsc_link[@]}"}
}
# Las dos piezas son independientes: se compilan a la vez. (El frontend va en un
# único unity.cpp a propósito: por unidades cuesta ~7x más CPU porque cada una
# vuelve a procesar las cabeceras del runtime.)
build_both() {
  local front_pid etsc_pid status=0
  if [[ -n $frontend_bin ]]; then
    [[ -x $frontend_bin ]] || { echo "Frontend inexistente: $frontend_bin" >&2; return 1; }
    cp "$frontend_bin" "$out/frontend"
  else
    build_frontend & front_pid=$!
  fi
  build_etsc & etsc_pid=$!
  [[ -z ${front_pid:-} ]] || wait "$front_pid" || status=$?
  wait "$etsc_pid" || status=$?
  return "$status"
}
label="frontend + coordinador · C++20 en paralelo"; [[ -n $frontend_bin ]] && label="coordinador · C++20"
((static)) && label="$label · estático"
etsc_spin "$label" build_both

if ((update_prebuilt)); then
  mkdir -p "$prebuilt"
  cp "$out/frontend" "$out/etsc" "$prebuilt/"
  strip "$prebuilt/frontend" "$prebuilt/etsc" 2>/dev/null || true
  seed_inputs > "$prebuilt/inputs.sha256"
  etsc_info "Semilla precompilada actualizada en native-cpp/prebuilt/$platform"
fi
