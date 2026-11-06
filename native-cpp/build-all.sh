#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p native
g++ -std=c++20 -O1 -pthread -fno-exceptions -I. -Ifrontend \
  '-DESTATIC_FRONTEND_ID="portable"' frontend/unity.cpp -o native/frontend
g++ -std=c++20 -O2 -I. -Ibuild/bootstrap/etsc \
  bootstrap/native/driver.cpp src/codegen/ir/native/generator.cpp \
  -lcrypto -o native/etsc
