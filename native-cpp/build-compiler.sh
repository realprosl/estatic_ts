#!/usr/bin/env bash
# Construye el compilador de compiler/ (generación 2): la semilla (un etsc
# completo) analiza compiler/driver/main.ets y compila el C++ resultante. Es el ÚNICO sitio que
# lo construye; lo usan install.sh y el CI.
#
# Uso: native-cpp/build-compiler.sh --seed DIR --out BINARIO
#                                   [--force] [--static] [--update-prebuilt]
#
#   --seed DIR         semilla ya construida (DIR/etsc)
#   --out BINARIO      dónde dejar el compilador
#   --force            ignora el compilador precompilado y lo compila
#   --static           enlace autocontenido (Linux estático; macOS solo con
#                      librerías del sistema)
#   --update-prebuilt  compila con --static y -O2 y guarda el resultado y su
#                      huella en native-cpp/prebuilt/<plataforma>/compiler/
#
# Si native-cpp/prebuilt/<plataforma>/compiler/ existe y su huella (sha256 de
# la semilla, compiler/ y runtime/) coincide con el checkout, se copia en vez
# de compilar. Si no coincide, o no arranca, se compila.
set -euo pipefail
seed_dir="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$seed_dir/.." && pwd)"
source "$root/compiler/native/progress.sh"
ETSC_CLI_SCOPE=${ETSC_CLI_SCOPE:-compiler}

seed="" out="" force=0 static=0 update_prebuilt=0 opt=-O1
while (($#)); do
  case "$1" in
    --seed) seed="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --force) force=1; shift ;;
    --static) static=1; shift ;;
    --update-prebuilt) update_prebuilt=1; static=1; force=1; opt=-O2; shift ;;
    --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ -n $out ]] || { echo "Falta --out" >&2; exit 2; }
case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
arch="$(uname -m)"; [[ $arch == aarch64 ]] && arch=arm64
platform="$os-$arch"
prebuilt="$seed_dir/prebuilt/$platform/compiler"

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
# Todo lo que determina el binario: la semilla que lo genera, las fuentes ETS y
# nativas de compiler/ y el runtime que incluye.
compiler_inputs() {
  (cd "$root" && find native-cpp/compiler/unity.cpp runtime compiler \
      -type f \( -name '*.ets' -o -name '*.hpp' -o -name '*.h' -o -name '*.cpp' -o -name '*.c' \) \
      | LC_ALL=C sort | while IFS= read -r f; do sha256 "$f"; done) | sha256 | cut -d' ' -f1
}

mkdir -p "$(dirname "$out")"
if ((!force)) && [[ -f $prebuilt/inputs.sha256 ]]; then
  if [[ "$(cat "$prebuilt/inputs.sha256")" == "$(compiler_inputs)" ]] \
     && "$prebuilt/etsc" --version >/dev/null 2>&1; then
    cp "$prebuilt/etsc" "$out"; chmod +x "$out"
    etsc_info "✓ Compilador precompilado ($platform) · --force-compiler para recompilarlo"
    exit 0
  fi
  etsc_info "El compilador precompilado ($platform) no coincide con las fuentes; se compila"
fi

[[ -x $seed/etsc ]] || { echo "Falta la semilla en $seed (--seed)" >&2; exit 1; }
work="$(mktemp -d "${TMPDIR:-/tmp}/etsc-compiler.XXXXXX")"
trap 'rm -rf "$work"' EXIT
flags=(--cxx-flag "$opt" --cxx-flag "-I$root")
if ((static)); then
  if [[ $os == linux ]]; then flags+=(--cxx-flag -static)
  else export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.3}"; fi
fi
export ESTC_ROOT="${ESTC_ROOT:-$root}"
# Análisis y compilación C++ en pasos separados: así no están los dos en memoria
# a la vez (el análisis de compiler/ ocupa varios GB).
etsc_spin "Semilla · analizar compiler/" "$seed/etsc" "$root/compiler/driver/main.ets" \
  --check --emit-ir "$work/driver.ir.json" --no-progress
etsc_spin "Semilla · construir el compilador" "$seed/etsc" \
  --from-ir "$work/driver.ir.json" --build -o "$work/etsc.cpp" --binary "$work/etsc" \
  "${flags[@]}" --no-progress
[[ -x $work/etsc ]] || { echo "La generación 2 no produjo un ejecutable." >&2; exit 1; }
cp "$work/etsc" "$out"; chmod +x "$out"

if ((update_prebuilt)); then
  mkdir -p "$prebuilt"
  cp "$work/etsc" "$prebuilt/etsc"
  strip "$prebuilt/etsc" 2>/dev/null || true
  compiler_inputs > "$prebuilt/inputs.sha256"
  etsc_info "Compilador precompilado actualizado en native-cpp/prebuilt/$platform/compiler"
fi
