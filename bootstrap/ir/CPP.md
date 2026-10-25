# C++20 desde `ets-ir-2`

El emisor `src/codegen/ir/cpp-generator.ts` consume exclusivamente el IR nativo
verificado. No reconstruye un AST ni llama al codegen histórico para traducir
el programa. El adaptador Node construye/invoca el lowering ETS y gestiona E/S.
La implementación de este backend es TypeScript; no se anuncia autoalojamiento.

```sh
npm run bootstrap:ir:cpp -- examples/hello.ets -o build/hello-ir.cpp --run
npm run bootstrap:ir:cpp -- examples/async-await.ets --build --binary build/async-ir
# Entrada alternativa: JSON de un productor nativo de confianza ya verificado.
npm run bootstrap:ir:cpp -- --from-ir build/project.ir.json -o build/app-ir.cpp
npm run test:bootstrap:ir:cpp
```

También se instala `etsc-ir-cpp`. `--cxx` selecciona el compilador y `--help`
documenta los argumentos. Una capacidad no implementada produce
`IR_CPP_UNSUPPORTED`, con archivo/offset cuando hay procedencia. El emisor
termina antes de escribir el resultado; no deja C++ parcial al fallar.
`success:true` es un requisito del productor, no una firma criptográfica: los
chequeos estructurales de esta frontera no sustituyen al verificador nativo ni
convierten `--from-ir` en un deserializador para entradas hostiles.

API pública, exportada desde `src/compiler.ts`:

```ts
const { cpp, headers, runtimeBackends, capabilities } = generateCppFromIr(project);
```

## Reutilización

- `cpp-types.ts`: representación de escalares y tipos propios del runtime.
- `runtime-callees.ts`: mismos nombres runtime para el backend histórico y éste.
- `runtimeBackendsForCalls` y `TERMINAL_METHODS`: metadatos compartidos de `src/`.
- `ets_runtime.hpp`, `ets_string.hpp`, `ets_collections.hpp`, `ets_optional.hpp`,
  `ets_async.hpp`, `ets_file.hpp` y demás servicios existentes según su uso.
- `ets::Task`/`syncWait` y libuv para suspensión, ejecución diferida y event loop.

`runtime/ets_ir.hpp` sólo adapta almacenamiento, flags de inicialización y
operaciones numéricas del IR. No implementa otro scheduler, filesystem ni
biblioteca de colecciones. `Slot<T>` utiliza `std::optional<T>` para soportar
valores sin constructor por defecto y no asignables, como `Task<T>`. Los campos
son slots independientes: mover un campo no destruye sus hermanos y el drop
posterior sólo destruye subobjetos vivos. Los índices y préstamos son vistas
sin ownership. `boolean[]` usa un bool direccionable en lugar del proxy de
`std::vector<bool>`, para preservar `ref<boolean>`.

## Recorrido soportado

CFG por bloques y saltos; escalares y enteros exactos de 64 bits; promociones,
conversión y wrapping entero sin overflow con signo de C++; agregados, clases,
campos, constructores, métodos resueltos, genéricos especializados, defaults,
closures, capturas por valor/referencia y llamadas indirectas; Optional/Result,
variantes y sum types; bucles, switch, match y cortocircuito; moves parciales,
préstamos y limpieza; async, await y for-await; inicialización y finalización
de módulos. Los contratos runtime soportados usan sus implementaciones originales.

El frame físico de una función async es la corutina C++. Sus parámetros se
transportan antes del arranque diferido, y sus slots se destruyen al cancelar
por destrucción del handle, incluso antes del primer resume. Las continuaciones
normales siguen el CFG del IR. El cancelador/event loop es el del runtime;
este backend no añade cancelación dura de I/O ni ejecución paralela.
`drainDetached()` termina las tareas que el loop posee (spawn y perdedoras de
race) usando `runOne()`. No llama al loop permanente `run()` después de un await
normal ni deja las tareas desacopladas sin ejecutar al terminar main.

Los helpers Optional/Result reciben sus conversiones de argumento en el IR,
incluida la creación explícita de owners. `Optional.value()` tiene sobrecargas
por categoría de valor, equivalentes a las de `Result.value()`, para extraer un
payload propietario de un contenedor consumido.

## Límites explícitos

- `backendEscape` (`@cppgen`) se rechaza: aún no hay una etapa de ejecución del
  generador desde el IR. No se interpreta como una llamada ordinaria.
- Las llamadas opacas a métodos de interfaces/intersecciones no contienen aún
  un destino concreto/tabla de dispatch suficiente. Se rechazan por capacidad;
  el backend no vuelve al AST para recuperar esa información ni inventa vtables.
- Los decoradores de ABI externo C++ (`@cpp_name`, `@cpp_type`, `@include`, `@link` y selección Drogon) se
  rechazan: no se confunden sus layouts externos con los records internos.
- HTTP y capacidades runtime sin binding explícito se rechazan. La existencia
  de una API en el frontend no demuestra por sí sola su soporte en este backend.
- `Timer` no copiable requiere cerrar el contrato de ownership/copia que hoy
  publica el frontend/IR. No se introduce shared ownership para evitar el error.
- El CLI histórico, su caché incremental y sus perfiles de optimización no se
  sustituyen. Esta entrada genera una unidad C++; no se anuncia cierre del corpus.

## Dependencias y verificación

GCC/Clang C++20. Los programas síncronos básicos no enlazan libuv. Async,
Result y archivos usan las dependencias habituales del runtime. El adaptador
prefiere `build/libs/libuv/{include,lib/libuv.a}` y utiliza `-luv` si no existe
esa instalación local. TLS y curl requieren además sus bibliotecas cuando se
seleccionan. No se instalan paquetes del sistema implícitamente.

Las pruebas generan IR nativo, emiten C++, compilan y ejecutan el binario,
comparando stdout. Comprueban determinismo, callbacks, parámetros prestados,
slots booleanos, owners, async, módulos y rechazos. El audit separado permite
medir todo el corpus sin ejecutar servidores ni red:

```sh
node --experimental-strip-types bootstrap/ir/audit-cpp.ts --compile
```

La prueba de ASan/UBSan activa LeakSanitizer normalmente. En entornos sin `/proc`
o con ptrace puede repetirse con `ESTATIC_TEST_DISABLE_LSAN=1`: esto desactiva
sólo el comprobador de fugas dentro de ese binario de pruebas. No modifica el
C++ entregado por el backend ni demuestra ausencia de fugas.

## Validación de 2026-10-25

| Comprobación | Resultado |
|---|---|
| C++ del IR: generación, compilación y ejecución | **57/57**, cero fallos, cancelaciones y skips |
| Lowering/verificador nativo | **128/128** |
| Tipos C++, codegen histórico y selección de runtime reutilizados | **180/180** |
| Suite global con libuv y objetos de runtime locales | **3706/3706**, cero fallos, cancelaciones y skips; 724702 ms |
| Corpus completo: generación, compilación y enlace, sin ejecución | **119/131 fuentes válidos**; el ejemplo negativo esperado se rechaza |
| CLI de fuente y `--from-ir`, ejecutando hello | `Hola, mundo` y `120` |
| ASan/UBSan para ownership y aritmética exacta | Pasa; LeakSanitizer desactivado sólo en ese binario por la restricción de `/proc`/ptrace |
| `git diff --check` | Sin errores |

La ejecución global incluyó las 56 pruebas del backend anteriores al caso de
spawn y al helper de drenaje. Después se repitieron las 57 pruebas del backend,
que incluyen el comportamiento final de todos sus entrypoints async. No se
presenta 3706 como el total de una ejecución global con la prueba adicional.

La dependencia local fue libuv v1.48.0, sin instalar paquetes del sistema. Para
la suite general se prepararon `build/runtime_ets_libuv.o` y
`build/runtime_ets_net_libuv.o`, como requiere el runner histórico. Se usaron
`CPLUS_INCLUDE_PATH`, `LIBRARY_PATH` y `TMPDIR` apuntando a los directorios de
build locales, junto con `ESTATIC_TEST_DISABLE_LSAN=1`.

Los doce fuentes válidos rechazados por el audit pertenecen a estas capacidades:

| Capacidad pendiente | Ejemplos |
|---|---|
| Métodos opacos de interfaces/intersecciones | `complete-demo`, `interface`, `intersection-demo`, `svg-with-discriminated-union`, `svg-with-spread` |
| `@cppgen` | `comptime-overloads/main` |
| HTTP | `express-style-server`, `todo-project/server` |
| io_uring | `io-uring-async-demo` |
| Ownership/copia de Timer | `memory-safe-timer` |
| ABI externo `@link`/`@include`/`@cpp_name` | `libc.lib`, `libraries-demo` |

El audit de cobertura sale con código 1 mientras estas capacidades sigan
pendientes. Los rechazos son explícitos, no fallos de compilación del C++
emitido. Compilar los 119 ejemplos no certifica su ejecución ni paridad completa.
Las pruebas con resultados esperados independientes cubren las 57 regresiones.
