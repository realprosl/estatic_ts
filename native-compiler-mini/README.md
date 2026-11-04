# Native compiler mini — full baseline

Untrimmed C++ compiler generated from `bootstrap/ir/demo.ets` by the
original `src/modules/module-loader.ts`. This snapshot deliberately
preserves all runtime and native backend dependencies.

On Linux with a C++20 compiler and OpenSSL development headers:

```sh
./build-all.sh
export ESTC_ROOT="$(pwd)"
./native/etsc --version
./native/etsc build path/to/main.ets --no-progress
```

No Node.js or TypeScript sources are needed to build this snapshot.
The generated binaries in `native/` are not committed.
