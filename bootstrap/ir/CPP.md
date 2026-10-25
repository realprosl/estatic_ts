# C++20 desde `ets-ir-2`

El emisor `src/codegen/ir/cpp-generator.ts` consume exclusivamente el IR nativo
verificado. No reconstruye un AST ni llama al codegen histórico para traducir
el programa. El adaptador Node construye/invoca el lowering ETS y gestiona E/S.
La referencia TypeScript se mantiene para bootstrap y pruebas; la implementación
nativa de `src/codegen/ir/native/` está integrada en `estc` y no ejecuta Node.
El frontend es ETS compilado y el backend/driver C++20; no se anuncia que todo
el compilador esté escrito en ETS.

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

## Interfaces y HTTP

El productor publica `methods`/`methodTypes` en las shapes y una tabla
`dispatches` con la interfaz, tipo concreto, nombre, firma y función IR de cada
implementación. `interfaceCall` usa estos IDs; el backend no vuelve al AST ni
resuelve métodos por nombres de clases. El verificador comprueba destinos,
receptores, firmas y cobertura de cada llamada. Los métodos genéricos se
especializan por firma de llamada; el checker compara sus parámetros genéricos
por equivalencia de nombres ligados, conservando sus restricciones.

La representación C++ es una variante cerrada de boxes de los tipos concretos
que realmente se convierten a cada interfaz. Los boxes copian su contenido por
valor, permiten containers recursivos y no convierten owners en shared pointers.
Se conservan métodos, campos de representación uniforme, intersecciones,
arrays heterogéneos, conversiones entre interfaces y clases genéricas. Las
reglas conservadoras de efectos/préstamos del frontend siguen vigentes:
un `E4104` no se transforma en una autorización para invocar efectos opacos.
Tampoco se permite borrar ownership al convertir un recurso a una interfaz
que el frontend declara copiable.

HTTP reutiliza `ets_http_httplib.hpp` por defecto y `ets_http_drogon.hpp` con
`@cpp_drogon`. Se selecciona un wrapper por unidad generada, igual que en el
backend histórico. Ambos admiten registro de rutas, parámetros, headers,
consulta de request, respuestas encadenadas y `listen(port)`/`listen(host,port)`.
`Server` es move-only en el contrato nativo y se presta para invocar sus métodos.
Los adapters retienen el callback por valor y pasan vistas de Request/Response
válidas durante el handler síncrono; no duplican peticiones ni respuestas.

`http.get/post` reutiliza el cliente async de libcurl, con `Task<Result<...>>`,
status, body y headers. La creación fallida de un handle produce `Result::failure`
sin exigir excepciones de C++. Se preserva la diferencia existente de queries:
httplib URL-decodea y Drogon consulta el texto crudo. Las pruebas HTTP ejercitan
ambos comportamientos reales en loopback, no un sustituto del runtime.

El [CLI general de bootstrap](../CLI.md) conecta el recorrido completo:

```sh
estc run examples/interface.ets
estc build examples/express-style-server.ets
estc run --config estatic.config.json
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
- Los decoradores de ABI externo C++ (`@cpp_name`, `@cpp_type`, `@include` y `@link`) se
  rechazan: no se confunden sus layouts externos con los records internos.
- Las capacidades runtime sin binding explícito, como `io_uring`, se rechazan.
  La existencia de una API en el frontend no demuestra por sí sola su soporte.
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

## Validación de interfaces, HTTP y CLI (2026-10-25)

| Comprobación | Resultado |
|---|---|
| Backend, HTTP real y CLI de bootstrap | **75/75**, sin fallos ni skips |
| Lowering/verificador nativo, incluidos dispatches corruptos | **133/133** |
| Checker nativo, seguridad y efectos | **1376/1376** |
| Tipos C++, backend histórico, selección de runtime y docs | **181/181** |
| Corpus: generación, compilación y enlace, sin ejecutar ejemplos | **126/131 fuentes válidos**; el ejemplo negativo esperado se rechaza |
| Servidores HTTP | Rutas, path/query/header, POST, DELETE, status y JSON con **httplib y Drogon reales** |
| Cliente HTTP | GET/POST reales con **libcurl**, corutinas y Result |
| CLI | Fuente → IR → C++ → binario; JSON → C++; config, aliases, raíces, caché, argumentos, errores y exit code |
| ASan/UBSan | Pasan ownership/aritmética y copias recursivas de interfaces; sólo LSan desactivado por restricción de `/proc`/ptrace |

Para esta validación se prepararon localmente libuv v1.48.0, Drogon v1.9.11,
Trantor (submódulo de Drogon) y JsonCpp 1.9.6. El cliente usó libcurl del sistema.
Las bibliotecas se instalaron bajo `build/libs/`, sin cambiar paquetes del sistema.
La suite se ejecutó con `TMPDIR` dentro del workspace y
`ESTATIC_TEST_DISABLE_LSAN=1`. Las dependencias locales no forman parte del commit.

Los cinco fuentes válidos todavía rechazados pertenecen a capacidades ajenas a
interfaces y HTTP: `comptime-overloads/main` (`@cppgen`), `io-uring-async-demo`,
`memory-safe-timer`, `libc.lib` y `libraries-demo` (ABI externa). El audit sale
con código 1 mientras queden estas capacidades pendientes. Compilar los 126
fuentes no certifica su ejecución: los resultados de ejecución se verifican en
las pruebas del backend, incluidos los servidores y el cliente HTTP locales.

La suite global anterior pasó **3706/3706** antes de esta ampliación; esa cifra
es histórica y no se presenta como una ejecución global del cambio actual.
