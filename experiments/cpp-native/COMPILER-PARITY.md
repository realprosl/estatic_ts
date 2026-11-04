# @cpp_native: src and bootstrap parity

Implementation order:

1. Implement and test `@cpp_native` in the TypeScript compiler under `src/`, including parsing, signature validation, module imports, and C++ lowering.
2. Ensure annotation metadata survives the native frontend's ets-ir-2 serialization, then implement equivalent native bootstrap handling.
3. Compile the same imported ETS binding with both compiler paths and compare runtime output.
4. Add a second C++ binding to the ETS library and rebuild only the app using the same compiler binaries.
5. Keep `@include` and `@cppgen` behavior intact and do not add new native table entries.

Proposed first fixture:

```ts
@include("experiments/cpp-native/console.hpp")
@cpp_native("ets_native::print")
export function print(text: string): void;
```

This file records acceptance requirements only. It does not mean either compiler has been modified or tested. Keep PR #56 in draft until both paths pass CI.
