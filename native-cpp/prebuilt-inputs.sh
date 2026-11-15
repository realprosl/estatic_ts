# Huella de las fuentes que determinan el compilador precompilado: la semilla
# que lo genera, las fuentes ETS y nativas de compiler/ y el runtime. La usan
# build-compiler.sh (para aceptar un precompilado), seed-prebuilt.yml (para
# publicarlo bajo esa huella) y fetch-prebuilt.sh (para bajar justo ese).
# Uso: source native-cpp/prebuilt-inputs.sh; compiler_inputs <raíz del repo>
prebuilt_sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
compiler_inputs() {
  (cd "$1" && find native-cpp/compiler/unity.cpp runtime compiler \
      -type f \( -name '*.ets' -o -name '*.hpp' -o -name '*.h' -o -name '*.cpp' -o -name '*.c' \) \
      | LC_ALL=C sort | while IFS= read -r f; do prebuilt_sha256 "$f"; done) | prebuilt_sha256 | cut -d' ' -f1
}
