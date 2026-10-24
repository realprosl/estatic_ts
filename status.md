# Ts2cpp — Estado actual

Última revisión documental: **2026-10-24**. Este archivo es una fotografía
del repositorio, no un historial de sesiones. El historial vive en
[`CHANGELOG.md`](./CHANGELOG.md) y en [`docs/historical/`](./docs/historical/).

## Resumen

Bootstrap ya dispone de un [IR nativo `ets-ir-2`](./bootstrap/ir/README.md)
con lowering de agregados, clases, genéricos, closures, variantes y async,
verificación de ownership y préstamos por CFG, y contratos de runtime/efectos.
La integración con backends y su validación de ejecución siguen pendientes.
[`bootstrap/PENDING.md`](./bootstrap/PENDING.md) registra el trabajo abierto y
sus criterios de cierre. La [revisión reproducible](./bootstrap/audit/FRONTEND-REVIEW.md)
actualiza las 49 filas y separa implementación, restricciones y obligaciones.
La matriz `audit:bootstrap` pasa 83/83 muestras; no sustituye la suite estable
ni certifica por sí sola cierre o paridad semántica.

Ts2cpp transpila el dialecto Estatic a C++20. El frontend, el checker, el
codegen y el flujo modular son utilizables para proyectos y ejemplos. El
runtime async y HTTP todavía necesita validación con sanitizers, cancelación
cooperativa y límites de protocolo antes de considerarlo preparado para
producción concurrente.

| Área | Estado | Observación |
|---|---|---|
| Lexer, parser y diagnósticos | Estable para el dialecto documentado | No pretende aceptar TypeScript completo |
| Autoalojamiento | Frontend nativo con tipos, memoria, efectos, comptime y expansión | 2182 pruebas focalizadas y autoanálisis verdes; IR con recursos, closures y async implementado; cierre global, backend y scheduler pendientes |
| Tipos, genéricos, unions y clases | Funcional | Checker y codegen siguen muy acoplados |
| Módulos | Funcional con límites | Default, reexports y multilínea; análisis mediante AST combinado |
| Ownership y borrow checking | Funcional, conservador | Hay moves, conflictos y NLL; no hay lifetime parameters |
| `comptime` | Experimental | Validación semántica en dos fases, ámbitos, TDZ, bucles y cortocircuito; conversiones y promociones numéricas tipadas; faltan higiene modular y unificación de evaluadores |
| Runtime async/libuv | Experimental | Lifetime de handles y frames de `race` corregido; falta sanitizers y cancelación cooperativa |
| HTTP cpp-httplib | Funcional con límites básicos | Cola, workers, cuerpo y timeouts acotados; falta carga sostenida y API de configuración `.ets` |
| HTTP Drogon | Integrado, validación parcial | Caché ilimitada eliminada; falta validar el servidor completo con Drogon |
| Tooling y build incremental | Funcional | Caché persistente de sintaxis, AST, snapshot de transpilación y `.o`; falta type-check incremental por interfaz y CI reproducible |

Las declaraciones del editor tienen una única fuente canónica en
`types/estatic.d.ts`. `etsc init` la copia y `etsc update-types` actualiza
proyectos existentes con respaldo `.bak`. El registro semántico y el archivo
se comprueban mediante una regresión automática. La versión visible por CLI es
`estatic 1.26.0 (v64)` mediante `--version` o `-v`; verbose usa `--verbose`.

El incremental informa tiempos reales por fase y registra interfaces/dependencias
por módulo para planificar invalidaciones. v48 restaura cuerpos de funciones
escalares intactos en los checks fuente/final; declaraciones y globals se
revalidan. Las construcciones no cubiertas conservan el checker global.
El codegen continúa siendo global. Ver `docs/semantic-cache.md`.
Retirado el PCH no utilizado y preservados los artefactos idénticos, incluida
la cabecera común en hits completos. Ver `docs/transpilation-cache.md`.

## Verificación actual del frontend

Sobre `24e32ac`, el 2026-10-24: **2182/2182** pruebas focalizadas, **83/83**
obligaciones, **75/75** contratos de sintaxis y **132/132** archivos parseados por
ambos pipelines. El checker nativo acepta 131 y rechaza el ejemplo privado inválido
esperado. El autoanálisis termina con **23 módulos, 6594 símbolos, 75596 nodos
tipados y cero diagnósticos**; 216 contratos de builtins están sincronizados.

`npm test` global no se repitió en esta revisión. Los comandos, la carencia de
comptime con parámetros prestados y los límites de la evidencia están en
[FRONTEND-REVIEW.md](./bootstrap/audit/FRONTEND-REVIEW.md). No se marca el frontend
como cerrado ni se introduce IR por actualizar documentos.

## Verificación histórica por revisión

Las cifras y pendientes siguientes pertenecen a sus checkpoints. No describen
la última ejecución; para el estado de las filas se usa `bootstrap/PENDING.md`.

- Tras PR #25 se añaden consultas typeof cualificadas con identidades originales,
  metadatos por ruta y precedencia correcta en arrays de unions/callables.
  Pasan 42 pruebas focalizadas del checker y 12 adicionales de parser/binder.
  npm test pasa **3154/3154**, sin fallos, cancelaciones ni skips, y el audit
  ampliado pasa **83/83**. Se añaden 53 pruebas netas. T07 sigue parcial;
  no se modifica IR ni se anuncia paridad del CLI de stage 0.


- Tras PR #24 se incorpora un evaluador comptime nativo con valores tipados,
  enteros exactos, callbacks, ámbitos y límites por raíz; 99 regresiones nuevas
  pasan. El audit pasa **80/80** y exige materialización de constantes y
  metadatos de decoradores. Esto no cierra el lenguaje: expansiones, ABI,
  memoria y otras composiciones siguen en `bootstrap/PENDING.md`.
  npm test pasa **3101/3101**, con ejemplos/libuv incluidos, sin fallos,
  cancelaciones ni skips. Los resultados anteriores que siguen corresponden
  a sus revisiones respectivas.


- Tras PR #23, el checker nativo incorpora async/await, consumo de tareas,
  for-await y all/race/spawn con separación entre creación y ejecución diferida,
  préstamos durante suspensión y procedencia de frames. Pasan **904/904** pruebas
  del checker. npm test pasa **2994/2994**, con ejemplos/libuv incluidos.
  El audit llega a **77/80**; comptime, decoradores y obligaciones
  adicionales de composición siguen abiertos. No se implementa IR.

- Revisión posterior a PR #22: `npm test` pasa **2926/2926**, incluida la suite
  de ejemplos con libuv, sin fallos ni skips. Las comprobaciones posteriores
  de composición pasan dentro de una ejecución focalizada de **86/86**.
  El audit nativo pasa **74/80**; los seis casos pendientes y las obligaciones
  adicionales de composición siguen en [`bootstrap/PENDING.md`](./bootstrap/PENDING.md).
  Se implementan packs de funciones y owners en agregados con movimientos
  parciales. Esto no certifica el cierre del lenguaje ni autoriza comenzar IR.

- v64 incorpora [resúmenes de efectos nativos](./bootstrap/checker/EFFECTS.md):
  lecturas/escrituras/moves transitivos, destinos conservadores de callables,
  callbacks invocados/retenidos y obligaciones de préstamos por función.
  Permite consumidores locales demostrados y recursión con efectos conocidos;
  conserva rechazos de llamadas opacas. 348 pruebas del checker. El
  [IR común para los backends](./bootstrap/checker/IR.md) está diseñado, pendiente
  de implementación; el codegen principal conserva su cadena.

- v63 añade [seguridad semántica nativa](./bootstrap/checker/SAFETY.md): flujo de
  inicialización/ownership con ramas y bucles, préstamos/readonly, capturas y
  procedencia de escapes, y tipos privados en superficies públicas. Añade tablas
  de capturas/préstamos sin modificar AST/binding. 300 pruebas del checker,
  incluidas 137 regresiones adicionales; las reglas conservadoras y los límites
  de efectos/lifetimes generales están documentados. No conecta aún codegen.

- v62 añade [`bootstrap/checker/`](./bootstrap/checker/README.md): núcleo nativo
  inicial de inferencia y compatibilidad, llamadas/sobrecargas, genéricos simples,
  clases/interfaces y tipos entre módulos. Tipos y firmas seleccionadas en tablas
  separadas. Sus 163 pruebas pasan, incluidas comparaciones con stage 0 y cuatro
  diferencias explícitas. No certifica aún memoria/flujo/escapes ni API públicas;
  la paridad completa y el codegen desde esas tablas siguen pendientes.

- v61 añade [`bootstrap/binder/`](./bootstrap/binder/README.md): ámbitos, símbolos,
  referencias léxicas y de tipos, imports/exports y namespaces. Tablas separadas
  del AST, grupos de sobrecargas y miembros ordinarios diferidos al checker.
  Sus 63 pruebas nativas pasan, incluidas las de su propio proyecto ETS y
  todo-project; no infiere tipos ni
  selecciona firmas. La caché de sintaxis permanece sin anotaciones semánticas.


- v60 incorpora [`bootstrap/modules/`](./bootstrap/modules/README.md): resolución
  de imports/reexports con aliases/raíces, identidad canónica, ciclos y ausencias.
  Registro atómico por archivo con tamaño, mtime/ctime nanosegundo, identidad
  filesystem, SHA-256, dependencias y tokens/AST hidratados sin nuevo parseo.
  La resolución de rutas se repite para comprobar cambios del filesystem.
  Las 42 pruebas nativas pasan, además de las 663 regresiones de bootstrap.
  La validez semántica, interfaces públicas, C++/`.o` y paralelismo quedan pendientes.


- La verificación del conjunto unitario estable realizada durante esta revisión
  pasó **2352/2352 pruebas**: 1236 unitarias de stage 0 y 1116 de bootstrap,
  ejecutadas por bloques. No incluye `test/runner.ts` ni la suite E2E/libuv.
- El lexer de `bootstrap/lexer/` pasa **64/64** pruebas nativas, incluidas
  comparaciones con stage 0, su propio código ETS y aislamiento del módulo.
  Ver [`bootstrap/README.md`](./bootstrap/README.md) para ejecutarlo por separado.
- El parser aislado pasa **542/542** pruebas (incluido el adaptador léxico),
  incluido el análisis de su propio fuente y del lexer, sin importar otros
  módulos ETS. La cobertura y las formas excluidas están en `bootstrap/parser/README.md`.
- v59 añade el puente nativo por archivo con **57/57** pruebas: lexer ETS,
  expansión léxica de templates, conversión de tokens y parser ETS, sin preparar
  tokens en Node. Se comparan tokens/spans y arenas completas con las referencias
  aisladas; 120 ejemplos aceptados por el parser TS directo también pasan en la
  cadena nativa. Cada resultado conserva archivo, errores y estado de parseo;
  un error léxico evita ejecutar el parser. Serialización de AST existente sin
  segundo parseo y JSON por fragmentos, sin reconstruir el acumulador en cada nodo.
  Las llamadas entre archivos se prueban en un proceso, secuencialmente. El resolver y la caché se añaden en v60; siguen pendientes
  scheduler concurrente y la paridad completa del checker ETS.
  Se documenta el helper de reutilización por archivo: manifiesto de metadatos y
  contenido, AST/imports y artefactos C++/`.o`, invalidación por capa/interfaz y
  deduplicación de trabajos. No equivale a implementar esa caché en el puente.
- v58 cierra la etapa del parser aislado con cabeceras include/link y decoradores
  de declaraciones/miembros, posiciones inline y orden de origen. Stage 0 conserva
  decoradores de campos de interfaces, acepta decoradores tras export y corrige
  default exports decorados; rechaza anotaciones que descartaría. Regresión C++
  de comptime tras export/function. La auditoría recorre 128 ejemplos y acepta
  en el parser ETS los 120 que admite el parser TS directo; los ocho restantes
  requieren la ruta de módulos y no se cuentan como paridad directa. Validación
  estructural de coordenadas/EOF, truncamientos y recuperación de miembros.
  Esto no certifica paridad formal de toda entrada. La conexión por archivo
  se añade posteriormente en v59.
- Packs genéricos en el AST, marcas variadic por TypeParameter y lista ordenada
  por declaración; parámetros rest conservados sin expansión sintética. Spans
  completos de parámetros de tipo, diagnósticos y recuperación. Stage 0 y ETS
  rechazan packs que se perdían en métodos/unions. Las clases conservan los
  packs en el AST pero su checker sigue rechazándolos. Prueba C++ de llamadas
  inferidas, explícitas, vacías y forwarding de packs de funciones.
- Parámetros-propiedad en constructores de instancia: access/readonly, tipos,
  defaults, optional/out y spans completos. AST conserva metadatos y no
  sintetiza campos. TS y ETS rechazan modificadores de propiedad en métodos
  ordinarios/estáticos; se ejecuta una regresión C++ de inicialización.
  Auditoría pendiente en el checker de stage 0: los campos implícitos de estos
  parámetros aún permiten acceso externo a private y escritura a readonly.
- Destructuring plano de variables en arrays/objetos, aliases, tipos y defaults
  preservados como AST. Spans por binding, patrones vacíos diferenciados y
  diagnósticos de duplicados, formas no soportadas e inicializadores ausentes.
  Stage 0 conserva ahora defaults de aliases/propiedades tipadas y admite
  patrones de objeto multilínea. No se modifica su checker ni el lowering de
  defaults de objetos, que sigue simplificado y pendiente de auditoría.
- Templates e interpolaciones producen AST en el parser ETS compilado, con
  posiciones absolutas UTF-16. El adaptador host prepara tokens, no ASTs.
  Ambos lexers usan una pila explícita de contextos y reconocen objetos,
  strings, comentarios y templates anidados sin truncarlos. El parser de
  stage 0 rechaza expresiones parciales y rebasa spans y errores al origen.
  Se conservan escapes crudos; v59 añade la conexión nativa por archivo.
- Imports y exports preservan aliases, origen y marcas type en el AST;
  default anónimos no reciben nombres globales sintéticos. La resolución
  de módulos/símbolos y el type checker siguen fuera de este módulo.
- Enum/union se comparan con stage 0 y preservan números exactos y campos.
  Switch se comprueba contra ASTs esperados independientes: el parser TS no
  lo reconoce y su codegen omite el nodo. Esto aún no añade switch al compilador.
- La mutación de campos de `this` a través de índices y los `push` anidados
  dejan de generar métodos C++ incorrectamente `const`; regresión nativa.
- El proyecto modular de ejemplo `examples/todo-project/` pasó **8/8**
  comprobaciones de integración.
- Las correcciones de `Timer` y `FsWatcher` tienen regresiones específicas.
- El event loop usa almacenamiento estable y cierre diferido; su regresión
  nativa está preparada, pero no pudo ejecutarse aquí por ausencia de `uv.h`.
- `race` transfiere los frames perdedores al event loop para drenarlos sin
  use-after-free; `timeout` comparte esa ruta y tiene regresión nativa.
- Las pruebas nativas con sanitizers requieren headers y librerías de libuv.
- El backend Drogon no se ha compilado ni sometido a carga en este entorno por
  ausencia de sus headers y librerías.
- El lookup de queries usado por Drogon pasa una regresión C++ standalone con
  100.000 queries distintas en cuatro hilos, en modo optimizado y con UBSan.
  ASan/LeakSanitizer no completó la ejecución por restricciones de `/proc`.
- `npm run test:http-limits` pasa: cola saturada rechazada y HTTP real en
  loopback con cuerpo de 32 bytes aceptado y 33 rechazado con `413`.
- `npm run test:http-routing` pasa sus seis casos de HTTP real: rutas con
  parámetros independientes, GET/POST, cabeceras case-insensitive y servidor
  movido después de registrar los handlers. Antes del arreglo fallaban cuatro.
- La selección de `@cpp_drogon` está cubierta por pruebas del generador para
  nombres arbitrarios y tipo `Server` explícito o inferido. Esto verifica el
  header elegido, no la compilación ni ejecución nativa del framework Drogon.
- El evaluador `comptime` pasa 15 regresiones de cortocircuito para `&&`, `||`
  y `??`, incluidas ramas con efectos y errores.
- Hay 21 regresiones nuevas de ámbitos léxicos, sombreado, bucles, callbacks,
  recursión y retorno desde bloques anidados. Esto no certifica la restauración
  del contexto capturado entre llamadas de entrada anidadas del intérprete.
- Otras 16 regresiones de `comptime` verifican `break` y `continue` en `for` y
  `while`, anidamiento, propagación de `return`, controles inválidos y el
  presupuesto de instrucciones. Antes del arreglo fallaban 15 de esos casos.
- Doce regresiones verifican la zona muerta temporal en bloques, destructuring,
  `for`, callbacks, funciones y capturas top-level. Antes del arreglo fallaban
  10 de esos casos.
- Ocho regresiones verifican capturas y llamadas anidadas entre funciones
  decoradas; cuatro fallaban antes por evaluación prematura o pérdida del
  ámbito capturado exterior.
- Seis regresiones verifican diagnósticos tipados de valores no disponibles y
  que TDZ, división por cero y otros fallos no se aplacen accidentalmente.
- Siete regresiones verifican que el checker examine el AST fuente antes de
  ejecutar `comptime` y el AST generado después. Cubren tipos locales,
  mutación de `const`, arrays, argumentos, callbacks y aliases; cinco casos
  eran aceptados incorrectamente antes del arreglo.
- Veintisiete regresiones verifican aislamiento de homónimos top-level fuente,
  sobrecargas, capturas, scopes y diagnósticos originales. Cinco compilan y
  ejecutan unidades C++ separadas, incluidos genéricos, helpers de definición,
  unions y destructuring. Ver `docs/module-symbols.md`.
- Veinticinco regresiones verifican selección semántica de sobrecargas en los
  evaluadores, arrays vacíos, aliases, genéricos, recursión, decoradores por
  firma y las APIs directas. El ejemplo `examples/comptime-overloads/main.ets`
  se transpiló, compiló con `g++` y ejecutó con salida `11, 99, 33, 77, 88`.
- Dieciséis regresiones verifican presupuestos por evaluación raíz,
  aislamiento de intentos preliminares fallidos y límites compartidos por los
  helpers. Diez fallan al ejecutarlas contra v18. El ejemplo
  `examples/comptime-budgets/main.ets` se transpiló, compiló con `g++` y ejecutó
  con salida verificada `1400`.
- Veintiocho regresiones cubren payload UTF-8, resultados y argumentos,
  crecimiento de arrays, índices dispersos, claves, ciclos y `array.length`.
  Veinticuatro fallan contra v19. El ejemplo
  `examples/comptime-values/main.ets` se transpiló, compiló con `g++` y ejecutó
  con salida verificada `España 🙂` y `100`.
- Diecisiete regresiones verifican posiciones de diagnósticos `comptime`,
  CRLF, Unicode, formato del fragmento y remapeo de archivos/offsets en entry
  y dependencias. Todas fallaban antes; ver `docs/comptime-diagnostics.md`.
- Veinte regresiones verifican límites de `@etsgen`: recursión, instrucciones,
  valores UTF-8, texto generado, raíces independientes y opciones inválidas.
  Dieciséis fallan contra v21. El ejemplo `examples/etsgen-limits/main.ets`
  se transpiló, compiló con `g++` y ejecutó con salida verificada `7` y `8`.
- Veintidós regresiones verifican semántica de fragmentos `@etsgen` en contexto,
  emisión tipada, capturas y dependencias generadas. Dieciséis fallan contra
  v22. `examples/etsgen-semantics/main.ets` se transpiló, compiló con `g++` y
  ejecutó con salida verificada `12`.
- Nueve regresiones de pipelines de arrays verifican la ruta eager; todas
  fallan contra v23. Tres compilan y ejecutan C++20 para comprobar orden de
  callbacks, capturas, fuente intacta, vacíos, cambio de tipo y anidamiento con
  callbacks nombrados. `examples/array-pipeline-semantics/main.ets` se transpiló,
  compiló con `g++` y ejecutó con salida verificada `55, 1, 2, 3`. La fusión
  insegura se retiró; no hay mejora de rendimiento medida.
- Dieciséis regresiones de capturas léxicas verifican sombreado, parámetros
  interiores, callbacks locales y propagación transitiva. Nueve fallan contra
  v24; cinco compilan y ejecutan C++20. `examples/closure-captures/main.ets`
  se transpiló, compiló y ejecutó con salida verificada `18, 1, 2, 3`. El
  análisis de escape/lifetimes de closures por referencia sigue pendiente;
  ver `docs/closure-captures.md`.
- Diecinueve regresiones cubren la protección parcial de retornos de closures
  por referencia (`E4210`); trece fallan contra v25. Incluyen aliases,
  reasignaciones, ciclos, condicionales, capturas transitivas, retornos implícitos
  y diagnósticos modulares. Una compila y ejecuta C++20; el ejemplo
  `examples/closure-return-safety/main.ets` también se transpiló, compiló y
  ejecutó con salida `1, 2, 2, 8, 8`. No cubre escapes por contenedores,
  campos ni callbacks retenidos; ver `docs/closure-return-safety.md`.
- Diecisiete regresiones nuevas amplían E4210 a rutas de arrays dinámicos y
  validación de argumentos de push; quince fallan contra v26. Una compila y
  ejecuta C++20. El ejemplo `examples/closure-array-safety/main.ets` también se
  transpiló, compiló y ejecutó con salida `8, 8`. No prueba escapes completos;
  ver `docs/closure-array-safety.md`.
- Doce regresiones verifican aliases bajo arrays anidados, ciclos y E4210;
  once fallan contra v27. Una compila y ejecuta C++20. El ejemplo
  `examples/nested-array-aliases/main.ets` verifica matrices y lectores
  devueltos por valor; ver `docs/nested-array-aliases.md`.
- Veintiuna regresiones verifican operaciones i64/u64 del evaluador principal:
  desplazamientos, bits, división entera, wrap unsigned y diagnósticos de
  overflow/precisión. Diecinueve fallan contra v27. Una contrasta resultados
  plegados y funciones runtime en C++20; ver `docs/comptime-integer64.md`.
- Veintiocho regresiones amplían la ruta tipada i64/u64 a valores exactos
  fuera de 53 bits, literales, bases, intermedios, arrays, templates y AST JSON.
  Veinticinco fallan contra v28; una ejecuta C++20 con límites exactos, llamadas,
  concatenación y comparación. El ejemplo `examples/comptime-exact64/main.ets`
  se transpiló, compiló y ejecutó; ver `docs/comptime-exact64.md`.

Estos resultados no certifican seguridad de memoria del runtime. Para ello
deben pasar ASan, UBSan y las pruebas de cancelación después de las
correcciones descritas abajo.

## Trabajo prioritario

### P0 — Corrección del runtime

1. Ejecutar bajo ASan/UBSan la regresión nueva de almacenamiento estable y
   cierre diferido de handles libuv.
2. Implementar cancelación cooperativa para que `race` pueda desregistrar las
   operaciones perdedoras en vez de esperar a que terminen.
3. Ejecutar todas las regresiones bajo ASan, UBSan y LeakSanitizer.

Detalles: [`docs/MEMORY-AUDIT.md`](./docs/MEMORY-AUDIT.md).

### P1 — HTTP robusto

1. Unificar la decodificación URL de queries entre backends (Drogon sigue
   devolviendo valores crudos, pero ya no conserva una caché ilimitada).
2. Exponer en `.ets` la configuración de límites de cpp-httplib y añadir una
   política equivalente para Drogon. Los límites básicos de cpp-httplib ya se
   aplican por defecto; ver [`docs/http-limits.md`](./docs/http-limits.md).
3. Separar handlers bloqueantes del event loop de Drogon.
4. Ejecutar carga sostenida y medir throughput, p50, p95, p99, errores y RSS.

### Prioridad actual — Estatic generado y procedencia de `@etsgen`

1. **Hecho:** mantener la salida Estatic de `@etsgen`, parsearla e insertar
   sus nodos en el AST normal; checker y backend procesan el programa expandido.
   Eliminada la extracción intermedia de C++ y su representación RawCpp.
2. **Hecho:** conservar la fuente de cada fragmento, un identificador y sus
   coordenadas internas; mostrar fragmento y llamada en diagnósticos, también
   entre módulos y en revalidaciones posteriores. Ver `docs/etsgen-ast-pipeline.md`.
3. **Hecho para bindings privados:** identidades léxicas y nombres frescos por
   expansión, capturas externas registradas y `etsCapture("nombre")` explícito.
   Hay expansión recursiva acotada y capturas de bindings del padre, conservando
   Estatic como formato. Ver `docs/etsgen-hygiene.md`.
4. **Hecho:** `@etsPublish` publica declaraciones directas para uso del caller;
   los chequeos intermedios permiten nombres introducidos por expansiones y
   se valida estrictamente antes de evaluar `comptime`.
5. **Hecho con alcance explícito:** `etsDefinition` accede a funciones y variables
   top-level visibles desde el módulo del generador, incluso helpers privados
   entre unidades C++; no cambia su visibilidad semántica.
6. **Hecho:** `--emit-etsgen directorio` guarda ETS original y manifiesto de
   procedencia en unity, multi y errores con fragmento. Ver
   `docs/etsgen-publication.md` y `examples/etsgen-publication/`.
7. **Hecho:** genéricos de definición entre módulos, con cuerpos en el header
   y dependencias privadas alcanzables. Imports con `as` y namespaces estáticos
   resueltos en AST; 31 pruebas nuevas, cinco nativas entre módulos. Ver
   `docs/import-aliases.md` y `examples/imports-as/`.
8. **Hecho:** tabla pública de exports con destinos originales; default, exports
   locales/renombrados, reexports transitivos/estrella y namespaces anidados.
   Descubrimiento de dependencias por tokens con listas multilínea. Se respeta
   el snapshot de default expresión en su sentencia y el binding vivo de exports
   nombrados. 29 pruebas nuevas, cinco nativas. Ver `docs/module-exports.md`.
9. **Hecho:** imports de publicaciones generadas mediante `export { nombre }`,
   con aliases, default, barrels y namespaces. Confirmación obligatoria al terminar
   la expansión; 28 pruebas, cinco nativas. Ver `docs/generated-module-exports.md`.
10. **Hecho para homónimos fuente:** identidades internas por módulo antes del
    análisis combinado; cinco regresiones nativas. Ver `docs/module-symbols.md`.
11. **Hecho por tramos:** mapas C++ de `@etsgen`, directivas `#line`, archivos
    ETS automáticos, sidecars y procedencia de llamadas/hijos. 18 pruebas, cinco
    nativas. Ver `docs/etsgen-cpp-source-maps.md`.
12. **Hecho para líneas seguras:** reanclado por línea del nodo ETS; las firmas
    `template` ya no desplazan el error. Contexto léxico para preservar strings,
    comentarios y macros. 15 regresiones adicionales, dos nativas.
13. **Pendiente:** mapas por token/columna y runtime, cobertura completa e
    identidades universales. Primera fase de `console` terminal implementada; ver bloque siguiente.

### Terminal multiplataforma — primera fase

Ampliado el objeto global `console`, sin imports ni instanciación, con backend
C++ propio sin dependencias de terceros. La cabecera especializada solo se incluye ante un uso
semántico de sus métodos de terminal; el logging habitual no la activa. Salida, colores/estilos, cursor, limpieza
y dimensiones; pipes sin ANSI y restauración normal best effort. 53 pruebas,
doce nativas, cuatro con PTY. Ejecutado en Linux; Windows/macOS aún sin validar.
Siguiente: teclado y sesiones. Ver [`docs/terminal.md`](./docs/terminal.md).

### P1 — Consolidación de `comptime`

1. Usar identidades de símbolo por módulo, no mapas globales por nombre. El
   loader normaliza aliases/namespaces y todos los homónimos fuente top-level,
   incluidos privados. Persisten límites en publicaciones generadas no anunciadas
   y APIs de AST aislado. Ver `docs/module-symbols.md`.
2. Completar conversiones, promociones y overflow según `i8..u64`. La ruta
   tipada i64/u64 ya almacena valores BigInt y emite literales C++ exactos
   dentro de su rango completo. Los casts explícitos a i8..u64 ya convierten
   enteros por módulo y flotantes con truncado y comprobación de rango.
   Las conversiones implícitas escalares a enteros ya se aplican en variables,
   parámetros nombrados y retornos, así como en elementos de literales agregados
   tipados (arrays, tuplas y campos de interfaces). Los callbacks arrow convierten
   parámetros y resultados; f32/f64/number tienen conversiones de destino y
   los operadores tipados aplican promociones C++20 (int de 32 bits).
   La matriz de 121 pares y su referencia C++ pasan. Falta ampliar la auditoría
   a métodos/APIs externas, bitwise legacy sobre number y al mini-evaluador;
   ver `docs/comptime-exact64.md`.
3. Sustituir la estimación de valores por contabilidad de bytes reales y
   definir límites agregados del programa. Los contadores del intérprete
   principal ya son por evaluación raíz y cuentan payload UTF-8 y crecimiento,
   pero no miden el heap vivo; ver `docs/comptime-values.md`.
4. Unificar la evaluación de `@comptime`, `@cppgen` y `@etsgen`. La higiene
   del AST parseado de Estatic generado tiene ahora prioridad propia arriba.
   El mini-evaluador de `@etsgen` ya tiene límites
   independientes y el texto generado se valida en contexto; ver
   `docs/etsgen-limits.md` y `docs/etsgen-semantics.md`.

### P1 — Métodos encadenados y ownership

La auditoría retiró la fusión antigua por cambios de efectos observables y
capturas locales inválidas. La ruta actual conserva etapas eager y vectores
intermedios; los helpers observan la fuente por `const&`.

1. Optimizar cadenas de métodos sobre `string` y `Array<T>` mediante paso por
   referencia constante, fusión y movimiento de temporales exclusivos.
2. Mantener siempre inmutable el dato inicial: un lvalue nombrado no se mueve
   ni se modifica implícitamente, aunque el análisis detecte su último uso.
3. Integrar categorías de valor, aliases, préstamos y escapes en la futura IR
   tipada antes de permitir reutilización de buffers o capacidad.
4. Añadir pruebas con contadores de copias/movimientos, casos con aliases y
   benchmarks de asignaciones, bytes copiados, tiempo y memoria.
5. Analizar escapes de closures con capturas por referencia antes de permitir
   que sobrevivan al local. Las capturas léxicas anidadas ya se resuelven por
   identidad y hay una protección parcial para retornos de funciones y arrays
   dinámicos de funciones. Falta modelar otros contenedores, campos, callbacks
   retenidos y efectos interprocedurales;
   esto todavía no prueba que todos los lifetimes sean seguros.

Plan detallado: [`docs/chained-method-optimization.md`](./docs/chained-method-optimization.md).

### P2 — Arquitectura del compilador

- Introducir una IR tipada entre checker y backend.
- Completar la auditoría numérica del backend: las operaciones y parámetros
  numéricas tipadas ya comparten una tabla de promociones con el evaluador.
  Faltan bitwise legacy sobre number, otros métodos y APIs externas antes de
  afirmar paridad numérica completa.
- Dividir `type-checker.ts` y `cpp-generator.ts` por responsabilidades.
- Resolver módulos mediante símbolos calificados.
- Aplicar renombrado sistemático de símbolos globales para evitar colisiones
  con C++/POSIX, por ejemplo una variable `read` frente a `::read`.
- Reemplazar el reconocimiento de imports mediante regex por nodos del parser.
- Completar source maps por token entre Estatic y C++; `@etsgen` ya tiene mapas
  por tramos y procedencia. Faltan cobertura total y stacks runtime.

### P2 — Calidad y publicación

- Añadir CI para Node soportado, GCC y Clang.
- Añadir jobs separados para unit, E2E, sanitizers y Drogon.
- Fuzzing del lexer, parser y evaluador `comptime`.
- Publicar una matriz de compatibilidad por plataforma y backend.
- Mantener benchmarks versionados y reproducibles, sin presentar una prueba
  local como capacidad universal del servidor.

## Capacidades implementadas destacadas

- Tipos numéricos concretos, genéricos, aliases, enums, interfaces, unions e
  intersecciones.
- Clases por valor, access modifiers, miembros `static` y `readonly`.
- Ownership con `ptr<T>`/`constPtr<T>`, préstamos `ref<T>`/`constRef<T>`,
  moves, conflictos de borrow y non-lexical lifetimes conservadores.
- Arrays, tuplas, `Map`, `Set`, `Optional`, `Result` y operaciones funcionales.
- Async/await, timers, archivos, TCP, TLS y cliente HTTP.
- Grafo de módulos, imports de tipos, reexports y compilación incremental.
- Evaluación `comptime`, funciones `@comptime`, `@cppgen` y `@etsgen`.
- Backend HTTP seleccionable, incluido Drogon mediante decorador/configuración.

La lista exacta y sus restricciones está en
[`LIMITATIONS.md`](./LIMITATIONS.md).

## Criterio para cambiar este estado

Una funcionalidad pasa de experimental a estable únicamente cuando:

1. su contrato está documentado;
2. tiene pruebas positivas, negativas y de integración;
3. los errores muestran ubicación y causa útiles;
4. en código nativo, pasa los sanitizers aplicables;
5. no depende de rutas, hardware o servicios privados del desarrollador.

### Limitación detectada: objetos que satisfacen interfaces

Los literales de objetos que satisfacen interfaces se pueden evaluar dentro
de `comptime`, pero su emisión directa en C++ sigue produciendo `{}` sin
un tipo concreto. El checker también rechaza un campo cuyo tipo sea otra
interfaz. Quedan anotados para una corrección independiente del backend y
su modelo de tipos. La prueba nativa de agregados de esta revisión cubre
arrays, tuplas y nesting de arrays; no certifica objetos de interfaz runtime.
