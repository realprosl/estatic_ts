// Test e2e: watchFs crea el watcher correctamente.
// El programa vigila /tmp (directorio que siempre existe) y
// se auto-termina tras 1.5s via el timeout del runner.
// El callback de watchFs NO se ejecuta (el test runtime
// test_wrappers_v29.cpp ya cubre eso; este test verifica
// la integracion codegen -> runtime + type-checker).
// El callback NO imprime nada: el runner compila en paralelo y g++ deja sus
// temporales en /tmp, asi que el watcher dispara de forma intermitente y la
// salida variaba entre ejecuciones. Este test verifica la integracion
// codegen -> runtime (que el watcher se crea y el programa continua), no el
// evento en si: ese lo cubre runtime/libuv/tests/test_wrappers_v29.cpp.
let w: FsWatcher = watchFs("/tmp", (ev: FsEvent): void => {
}, false);
print("watching");
