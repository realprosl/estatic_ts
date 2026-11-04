# @cpp_native end-to-end fixture

This fixture tests three synchronous bindings: numeric addition, string return, and the successful path of a validation function.

Expected output:
```text
5
Hola, ETS
OK
```

The negative path of `nativeCheckedLabel` throws a C++ exception and **must not** be treated as a verified ETS error-handling contract until the runtime's exception boundary is inspected. Do not call it with negative input in this fixture.

This fixture has been added for subsequent compile-and-run validation; it has not yet been demonstrated to compile or execute successfully.
