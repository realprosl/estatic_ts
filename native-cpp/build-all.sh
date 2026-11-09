#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source bootstrap/native/progress.sh
ETSC_CLI_SCOPE=seed
mkdir -p native
etsc_spin "Frontend · C++20" g++ -std=c++20 -O1 -pthread -fno-exceptions -I. -Ifrontend \
  '-DESTATIC_FRONTEND_ID="portable"' frontend/unity.cpp -o native/frontend
etsc_spin "Coordinador y emisor · C++20" g++ -std=c++20 -O2 -I. -Ibuild/bootstrap/etsc \
  bootstrap/native/driver.cpp src/codegen/ir/native/generator.cpp \
  -lcrypto -o native/etsc
