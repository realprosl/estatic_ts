#!/usr/bin/env bash
# compiler-build-bench.sh — mide cuánto cuesta construir etsc (#175, épica #174).
#
# Uso: scripts/compiler-build-bench.sh [--seed RUTA] [--opt -O1|-O2] [--jobs N]
#                                      [--out DIR] [--no-change] [--keep]
#
# Repite las tres fases de native-cpp/build-compiler.sh por separado:
#   1. análisis  : etsc compiler/driver/main.ets --check --emit-ir
#   2. codegen   : etsc --from-ir IR -o etsc.cpp           (IR → C++)
#   3. g++       : etsc --from-ir IR --build --binary ...   (codegen + g++ +
#                  enlace); el tiempo de g++ es (3) − (2)
# y lo hace dos veces:
#   - en frío: caché de análisis vacía y sin objetos del programa;
#   - tras cambiar una línea del cuerpo de una función de
#     compiler/checker/safety.ets (se añade una sentencia sin efecto y se
#     deshace al terminar), reutilizando la caché de la medición en frío.
#
#   --seed RUTA   ejecutable con el que se compila compiler/ (por defecto, la
#                 semilla precompilada native-cpp/prebuilt/<plataforma>/etsc o
#                 `etsc` del PATH)
#   --opt FLAG    optimización de g++ (por defecto -O1, como build-compiler.sh)
#   --jobs N      procesos de análisis (por defecto 1)
#   --out DIR     directorio de trabajo (por defecto, uno temporal)
#   --no-change   solo la medición en frío
#   --keep        no borrar el directorio de trabajo
#
# Imprime una tabla en Markdown lista para benchmarks/compiler-build.md.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
seed="" opt="-O1" jobs=1 out="" change=1 keep=0
while (($#)); do
  case "$1" in
    --seed) seed="$2"; shift 2 ;;
    --opt) opt="$2"; shift 2 ;;
    --jobs) jobs="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --no-change) change=0; shift ;;
    --keep) keep=1; shift ;;
    --help|-h) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "compiler-build-bench: opción desconocida: $1" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
arch="$(uname -m)"; [ "$arch" = aarch64 ] && arch=arm64
if [ -z "$seed" ]; then
  if [ -x "$repo/native-cpp/prebuilt/$os-$arch/etsc" ]; then seed="$repo/native-cpp/prebuilt/$os-$arch/etsc"
  elif command -v etsc >/dev/null 2>&1; then seed="$(command -v etsc)"
  else echo "compiler-build-bench: no hay semilla; usa --seed o native-cpp/fetch-prebuilt.sh" >&2; exit 2; fi
fi
if [ -z "$out" ]; then out="$(mktemp -d "${TMPDIR:-/tmp}/etsc-bench.XXXXXX")"; else mkdir -p "$out"; fi

target="$repo/compiler/checker/safety.ets"
backup="$out/safety.ets.orig"
restore() { [ -f "$backup" ] && cp "$backup" "$target"; [ "$keep" -eq 1 ] || rm -rf "$out"; }
trap restore EXIT

export ESTC_ROOT="$repo"
# Caché de usuario aislada: los objetos del programa no se reutilizan entre
# mediciones salvo los que la propia medición genera.
export XDG_CACHE_HOME="$out/user-cache"

now() { date +%s.%N; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.1f", b-a}'; }

# measure ETIQUETA: ejecuta las tres fases y deja los tiempos en $phase_*.
measure() {
  local label="$1" t0 t1 t2 t3
  local ir="$out/$label.ir.json" cpp="$out/$label.cpp" bin="$out/$label-etsc"
  echo "[$label] análisis…" >&2
  t0="$(now)"
  "$seed" "$repo/compiler/driver/main.ets" --check --emit-ir "$ir" --cache "$out/analysis-cache" \
    --jobs "$jobs" --no-progress >"$out/$label.analysis.log" 2>&1
  t1="$(now)"
  echo "[$label] codegen…" >&2
  "$seed" --from-ir "$ir" -o "$cpp" --no-progress >"$out/$label.codegen.log" 2>&1
  t2="$(now)"
  echo "[$label] g++ $opt…" >&2
  "$seed" --from-ir "$ir" --build -o "$cpp" --binary "$bin" --cxx-flag "$opt" --cxx-flag "-I$repo" \
    --no-progress >"$out/$label.build.log" 2>&1
  t3="$(now)"
  phase_analysis="$(elapsed "$t0" "$t1")"
  phase_codegen="$(elapsed "$t1" "$t2")"
  local build; build="$(elapsed "$t2" "$t3")"
  phase_cxx="$(awk -v b="$build" -v c="$phase_codegen" 'BEGIN{v=b-c; if(v<0)v=0; printf "%.1f", v}')"
  phase_total="$(awk -v a="$phase_analysis" -v b="$build" 'BEGIN{printf "%.1f", a+b}')"
  phase_cpp_size="$(wc -c <"$cpp" | awk '{printf "%.1f MB", $1/1048576}')"
}

fmt() { awk -v s="$1" 'BEGIN{m=int(s/60); r=s-m*60; if(m>0) printf "%d min %02.0f s", m, r; else printf "%.1f s", s}'; }

measure cold
cold=("$phase_analysis" "$phase_codegen" "$phase_cxx" "$phase_total" "$phase_cpp_size")

if [ "$change" -eq 1 ]; then
  cp "$target" "$backup"
  # Una línea en el cuerpo de un método no genérico: SafetyAnalyzer.owner().
  python3 - "$target" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
anchor = "  owner(scope: number): number {\n"
if anchor not in s:
    sys.exit("compiler-build-bench: no encuentro SafetyAnalyzer.owner() en safety.ets")
s = s.replace(anchor, anchor + "    const benchmarkLine: number = scope + 0;\n", 1)
open(p, "w").write(s)
EOF
  measure change
  changed=("$phase_analysis" "$phase_codegen" "$phase_cxx" "$phase_total" "$phase_cpp_size")
fi

commit="$(git -C "$repo" rev-parse --short HEAD)"
cpu="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu)"
mem="$(awk '/MemTotal/{printf "%.0f GB", $2/1048576}' /proc/meminfo 2>/dev/null || echo "?")"
cxx="$("${CXX:-g++}" --version 2>/dev/null | head -1)"

echo
echo "Commit \`$commit\` · $os-$arch · $cpu CPU · $mem · $cxx · g++ \`$opt\` · análisis con --jobs $jobs"
echo
echo "| Fase | En frío | Tras cambiar 1 línea de safety.ets |"
echo "|---|---|---|"
row() { printf '| %s | %s | %s |\n' "$1" "$(fmt "${cold[$2]}")" "$( [ "$change" -eq 1 ] && fmt "${changed[$2]}" || echo "—")"; }
row "Análisis (\`--check --emit-ir\`)" 0
row "Codegen IR → C++ (\`--from-ir\`)" 1
row "g++ + enlace" 2
row "**Total**" 3
echo "| Tamaño del \`.cpp\` | ${cold[4]} | $( [ "$change" -eq 1 ] && echo "${changed[4]}" || echo "—") |"
