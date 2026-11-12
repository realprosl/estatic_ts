#!/usr/bin/env bash
# Regenera la semilla: native-cpp/compiler/unity.cpp pasa a ser el C++ que el
# propio compilador de compiler/ genera de sí mismo. No necesita Node ni src/.
#
# Uso: native-cpp/regenerate.sh [--compiler ETSC] [--cxx CXX] [--max-rounds N]
#
#   --compiler ETSC  compilador con el que empezar (por defecto, la semilla
#                    actual: native-cpp/build-all.sh)
#   --cxx CXX        compilador C++ (por defecto $CXX o g++; clang++ en macOS)
#   --max-rounds N   iteraciones máximas hasta el punto fijo (por defecto 3)
#
# Cada ronda: el compilador actual analiza compiler/driver/main.ets, emite su
# IR y su C++, y ese C++ se compila para obtener el compilador de la ronda
# siguiente. Solo se publica cuando dos rondas seguidas emiten EXACTAMENTE el
# mismo IR y el mismo C++ (punto fijo del self-hosting). Análisis y compilación
# C++ van en pasos separados para no tener los dos en memoria a la vez.
#
# Solo reescribe lo generado: compiler/unity.cpp y files.txt; borra prebuilt/,
# que deja de corresponder a las fuentes (seed-prebuilt.yml lo regenera en main).
set -euo pipefail
seed_dir="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$seed_dir/.." && pwd)"
source "$root/compiler/native/progress.sh"
ETSC_CLI_SCOPE=${ETSC_CLI_SCOPE:-regenerate}

compiler="" max_rounds=3
case "$(uname -s)" in Darwin) cxx="${CXX:-clang++}" ;; *) cxx="${CXX:-g++}" ;; esac
while (($#)); do
  case "$1" in
    --compiler) compiler="$2"; shift 2 ;;
    --cxx) cxx="$2"; shift 2 ;;
    --max-rounds) max_rounds="$2"; shift 2 ;;
    --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
export ESTC_ROOT="$root"
work="$(mktemp -d "${TMPDIR:-/tmp}/etsc-regenerate.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if [[ -z $compiler ]]; then
  bash "$seed_dir/build-all.sh" --out "$work/seed"
  compiler="$work/seed/etsc"
fi
[[ -x $compiler ]] || { echo "Compilador inexistente: $compiler" >&2; exit 1; }

current="$compiler" previous=""
for ((round = 1; round <= max_rounds; round++)); do
  etsc_spin "Ronda $round · analizar compiler/" "$current" "$root/compiler/driver/main.ets" \
    --check --emit-ir "$work/round$round.ir.json" --no-progress
  etsc_spin "Ronda $round · emitir C++" "$current" --from-ir "$work/round$round.ir.json" \
    -o "$work/round$round.cpp" --no-progress
  if [[ -n $previous ]] && cmp -s "$work/$previous.ir.json" "$work/round$round.ir.json" \
       && cmp -s "$work/$previous.cpp" "$work/round$round.cpp"; then
    cp "$work/round$round.cpp" "$seed_dir/compiler/unity.cpp"
    rm -rf "$seed_dir/prebuilt"
    (cd "$seed_dir" && find . -type f -not -path './native/*' -not -path './prebuilt/*' \
      | LC_ALL=C sort > files.txt)
    etsc_info "✓ Punto fijo en la ronda $round: native-cpp/compiler/unity.cpp actualizado"
    exit 0
  fi
  etsc_spin "Ronda $round · compilar el C++ emitido" "$cxx" -std=c++20 -O1 -pthread -fno-exceptions \
    -I"$root" "$work/round$round.cpp" -o "$work/round$round-etsc"
  previous="round$round" current="$work/round$round-etsc"
done
echo "No se alcanzó el punto fijo en $max_rounds rondas: la semilla no se ha modificado." >&2
exit 1
