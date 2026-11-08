#!/usr/bin/env bash
# Build archives inside an unpublished installation. Never uses Node.
set -euo pipefail
root=${1:?Expected installation root}
cxx=${2:-g++}
ar_tool=${AR:-ar}
cache="$root/build/runtime-cache"
mkdir -p "$cache"
flags=(-std=c++20 -O2 -pthread -fno-exceptions -ffunction-sections -fdata-sections -I"$root")
if [[ -f "$root/build/libs/libuv/include/uv.h" ]]; then flags+=(-I"$root/build/libs/libuv/include"); fi
"$cxx" "${flags[@]}" -c "$root/runtime/runtime_ets_libuv.cpp" -o "$cache/libuv.o"
"$cxx" "${flags[@]}" -c "$root/runtime/runtime_ets_net_libuv.cpp" -o "$cache/net-libuv.o"
"$ar_tool" rcs "$cache/libets_libuv.a" "$cache/libuv.o" "$cache/net-libuv.o"
"$cxx" "${flags[@]}" -DCPPHTTPLIB_NO_EXCEPTIONS -c "$root/runtime/external/httplib/httplib.cc" -o "$cache/httplib.o"
"$ar_tool" rcs "$cache/libets_httplib.a" "$cache/httplib.o"
"$cxx" --version > "$cache/compiler.txt"
"$cxx" -dumpmachine >> "$cache/compiler.txt"
hash() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d ' ' -f 1; }
source_dirs=(runtime)
if [[ -d "$root/build/libs" ]]; then source_dirs+=(build/libs); fi
(cd "$root" && find "${source_dirs[@]}" -type f | LC_ALL=C sort) > "$cache/sources.txt"
# All runtime inputs are owned by the installation. Verify them before reuse.
{
  printf '{"compiler":"%s","archives":{"libuv":"%s","httplib":"%s"},"sources":{' "$(hash "$cache/compiler.txt")" "$(hash "$cache/libets_libuv.a")" "$(hash "$cache/libets_httplib.a")"
  comma=''
  while IFS= read -r file; do
    printf '%s"%s":"%s"' "$comma" "$file" "$(hash "$root/$file")"
    comma=,
  done < "$cache/sources.txt"
  printf '}}\n'
} > "$cache/manifest.json"
rm "$cache/sources.txt" "$cache/libuv.o" "$cache/net-libuv.o" "$cache/httplib.o" "$cache/compiler.txt"
