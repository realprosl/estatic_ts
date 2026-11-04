# @cpp_native — implementation contract (draft)

This branch is an isolated work area for native function bindings. **Not implemented yet.**

Proposed ETS syntax (subject to parser validation):

```ts
@include("experiments/cpp-native/console.hpp")
@cpp_native("ets_native::print")
export function print(text: string): void;
```

## Required end-to-end changes

1. Parse and validate the annotation on function declarations; reject non-literal names and declarations with bodies.
2. Preserve the annotation and target function identity across the native frontend and the ets-ir-2 boundary (not only source text).
3. Generate a typed C++ wrapper that forwards parameters, including void returns, and include the requested header.
4. Ensure imported ETS modules propagate annotation metadata into the final program.
5. Restrict supported C++ symbol spelling and validate signatures; report unsupported types instead of emitting broken C++.
6. Add a three-stage CI workflow: annotation parsing and diagnostics; imported native print execution; add a second native function and rebuild only the application, not the compiler.
7. Do not alter runtime native tables or existing @cppgen behavior.

## Acceptance criteria

- A program importing `print` builds and runs using the C++ header without adding the function to native tables.
- A second binding can be added without rebuilding the compiler.
- Missing headers and incompatible signatures fail with actionable diagnostics.

This file is a planning checkpoint, not evidence of a passing proof of concept.
