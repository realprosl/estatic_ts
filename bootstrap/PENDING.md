# Cierre del lenguaje antes del IR

Base auditada: v64, `d151b506ebd35245b912291c7ff7941b2dff6561`.

**El frontend nativo no está completo. El IR no se empieza hasta cerrar este
registro.** Esta rama reúne la auditoría y la implementación en una sola PR;
la PR debe permanecer en borrador mientras haya obligaciones abiertas.
No se cambia la revisión pública para anunciar un cierre que aún no existe.

## Progreso de implementación tras la PR #24

La auditoría pasa de **77/80 a 80/80** obligaciones de referencia. Ahora exige
valores constantes tipados y metadatos de decoradores, además de aceptación.
Ninguna cifra de este muestreo cierra por sí sola una fila del inventario.
No se introduce IR ni se conecta el frontend nativo al backend actual.

Se añaden argumentos nombrados con correspondencia formal publicada y orden de
evaluación original; rest de arrays y spread con expansión de posiciones en
tuplas/arrays fijos; sobrecargas como valores con contexto; Map/Set y delete;
inicialización de campos y readonly en constructores; métodos funcionales de
arrays con efectos, préstamos temporales y procedencia de callbacks; uniones
declaradas, constructores genéricos y payloads; narrowing por discriminador e
instanceof en ramas, guards, cortocircuitos y ternarios; y match con when,
whenType, otherwise y discriminadores.

También se corrige el almacenamiento global diferido de Result en C++: se
inicializa con un estado de error válido antes de ejecutar la inicialización del
módulo. Las pruebas compilan y ejecutan los caminos de éxito y error.
Las tareas globales diferidas usan un handle vacío y reconstrucción por movimiento,
sin exigir asignación de Task ni adelantar la ejecución de la corutina. Se corrige
además el namespace de los wrappers globales readFile/writeFile.

Se implementan packs de funciones con expansión, forwarding y firma instanciada;
el orden de evaluación se conserva. Los packs con owners o préstamos se rechazan
explícitamente hasta disponer de una prueba de transferencia polimórfica.

Los agregados con owners son move-only, también tras sustitución genérica. Se
comprueban movimientos parciales de campos e índices constantes, reinicialización,
uniones de ramas y puntos fijos de bucles. Una lectura del agregado completo
exige que no queden partes movidas. Los índices dinámicos se solapan de forma
conservadora y una escritura dinámica no demuestra la restauración de un hueco.
Los métodos propagan sus movimientos al receptor; los consumidores que copian
owners exigen transferencia explícita. Esto amplía M01/M02, sin cerrar todas sus
obligaciones de composición y destrucción.

Se añaden firmas async externas `Promise<T>` con retornos internos `T`, arrows,
await de consumo único y for-await-of. Las tablas conservan la procedencia de
las tareas por punto fijo. Se separan los efectos de creación (defaults) de los
del cuerpo suspendido: crear una tarea no ejecuta su cuerpo, y reanudarla no
repite argumentos ni defaults. All/race y sus aliases consumen arrays de tareas;
spawn exige transferencia y conserva restricciones de retención/efectos.

Los préstamos vivos no pueden cruzar una suspensión; los que terminan durante
la evaluación del operando de await ya no están vivos al suspender. Los frames
transportan sus capturas, pero el resultado de await sólo transporta las del
valor devuelto. Se rechazan escapes de frames por return, spawn y almacenamiento
fuera del bloque de sus capturas. Las declaraciones externas sin cuerpo
conservan efectos opacos. Se corrige además el flujo de for-of/for-in: sus rutas
de cero iteraciones ya no se tratan como bucles infinitos.

Se implementa evaluación nativa de `comptime` y funciones `@comptime`, después
de validar tipos y seguridad, sin recurrir al evaluador TS desde el driver.
Se conservan identidades de símbolos, ámbitos, TDZ, control, callbacks y límites
por raíz; los valores y errores estructurados se publican en tablas laterales.
Se añaden casts numéricos intrínsecos, enteros exactos de 64 bits y redondeo f32.
Se corrigen las conversiones de comparaciones y la adaptación de callbacks con
argumentos de tipo explícitos en map/flatMap/reduce. Hay 99 regresiones nuevas.
Los decoradores comptime/deprecated/sealed e include/link conservan metadatos
validados. Ver [checker/COMPTIME.md](./checker/COMPTIME.md) para el contrato y
los límites: clases, memoria, expansiones y ABI siguen sin cierre.

El soporte async no cierra A01/A02: siguen pendientes obligaciones
de composición, entre ellas resultados con owners en for-await, captura del
receptor, efectos polimórficos de tareas opacas y precisión de multiplicidad en
contenedores e inicializadores de campo que suspenden sin contrato del constructor. El análisis de all/race/for-await conserva alternativas y puede
rechazar secuencias seguras de tareas que comparten recursos.
Además siguen abiertos límites de composición: inferencia genérica avanzada y
sobrecargas genéricas como valores; llamadas opcionales; callbacks
genéricos/bound methods; defaults de destructuring; objetos sin contexto;
composición de tipos callable/union; exhaustividad de match; y catálogo completo
de builtins.
La invalidación de narrowing ante llamadas o escrituras es conservadora.

El switch nativo comprobado no incorpora parser/codegen de switch a stage 0.
Las declaraciones de helpers nativos tampoco certifican su lowering en el CLI
anterior. No se presenta el soporte semántico de este núcleo como soporte de
ejecución de todas esas construcciones en el compilador anterior.

## Qué significa «todo el lenguaje»

La referencia es Estatic documentado y ejercitado en `README.md`, `LIMITATIONS.md`,
`types/estatic.d.ts`, `examples/`, `test/` y los documentos técnicos vigentes.
No significa implementar TypeScript completo. Los rechazos deliberados (herencia,
excepciones, tipos dinámicos abiertos e imports dinámicos) deben conservar sus
diagnósticos. Las ideas futuras, como shared ownership, parámetros de lifetime,
conditional types o mapped types, no se convierten accidentalmente en requisitos
de esta migración.

Stage 0 es una referencia contrastable, no un oráculo: sus aceptaciones inseguras,
omisiones y diferencias documentadas también son pendientes. Un diagnóstico de
«comprobación nativa pendiente» no constituye soporte semántico ni una prueba
negativa válida. Tampoco basta borrar ese diagnóstico o delegar el análisis al
checker TypeScript desde el driver.

## Inventario por orden de dependencia

Las filas son unidades de trabajo, no estimaciones ni promesas de una prueba
exhaustiva. Cada una exige ejemplos positivos, errores negativos y composición
con las capas que consume. «Abierto» incluye cobertura parcial en v64.

| ID | Estado | Pendiente y condición de cierre | Evidencia principal |
|---|---|---|---|
| N01 | Implementado en esta rama; pendiente de validación completa | Validar tokens numéricos, bases 2/8/16, separadores, fracciones, finitud y rangos hasta 32 bits/f32/f64. Rechazar entradas malformadas también sin anotación. | `checker.ets:literalRange`, nuevo `numeric.ets` |
| N02 | Implementado en esta rama; pendiente de validación completa | Promociones binarias/unarias y shifts coherentes con `src/types/numeric-semantics.ts`; rechazar bitwise f32/f64. Comprobar los tipos publicados, además de aceptar el fuente. | `checker.ets:expressionInner`, nuevo `numeric.ets` |
| N03 | Parcial; sigue abierto | i64/u64 exactos desde el token, límites y signo mínimo, operaciones y comparación mixta; conservar decimales exactos en tablas sin double intermedio. | `checker.ets:annotationInner`, `docs/comptime-exact64.md` |
| N04 | Parcial; sigue abierto | Contexto y conversiones numéricas en argumentos, defaults, retornos, asignaciones, arrays, objetos, callbacks, genéricos y sobrecargas. Publicar conversiones requeridas sin mutar AST. | `call`, `expression`, documentos `comptime-*-integers.md` |
| T01 | Parcial; sigue abierto | Arrays fijos, tamaños constantes/simbólicos válidos, longitud e índices; identidad y compatibilidad con arrays dinámicos/tuplas según contrato. | `annotationInner`, `IndexExpression` |
| T02 | Parcial; sigue abierto | Enums numéricos/string: miembros, incrementos exactos, identidad, rangos y usos entre módulos. | `symbolType`, comprobación nominal, miembros y rangos i32/string |
| T03 | Parcial; sigue abierto | Unions declaradas y parametrizadas, variantes, payloads, constructores y discriminadores. | `UnionDeclaration`, `GenericIdentifierExpression` |
| T04 | Parcial; sigue abierto | Narrowing de unions por discriminador y `instanceof`, uniones de estados al salir de ramas y comprobación de accesos. Fijar la cobertura exigida a match. | `narrowCondition`, refinamientos `variant`, invalidación conservadora |
| T05 | Parcial; sigue abierto | Intersecciones y compatibilidad estructural de clases/interfaces, campos opcionales y contratos de métodos; detectar ciclos sin confundir homónimos. | `typeCompatible` sólo compara identidades nominales |
| T06 | Parcial; sigue abierto | Contexto e inferencia de objetos/arrays vacíos, tuplas y retornos; literales de objeto fuera de una interfaz contextual. | `ObjectLiteralExpression`, `signature` |
| T07 | Abierto | `typeof` cualificado y composiciones de tipos; resolver las diferencias entre parser, binder y checker, con identidad original. | `checker/README.md`, `qualifiedType` |
| T08 | Parcial; sigue abierto | Casts, `satisfies` y readonly: validar las operaciones permitidas y preservar el tipo correcto del resultado. `satisfies` no debe reemplazar el tipo de la expresión por el tipo comprobado. | `AsExpression`/`SatisfiesExpression` comparten retorno |
| G01 | Parcial; sigue abierto | Clases y aliases genéricos, sustitución recursiva en miembros/constructores y tipos anidados. | `instantiateType`, `instantiateMember`; inferencia avanzada pendiente |
| G02 | Parcial; sigue abierto | Constraints, defaults, inferencia contextual y desde retornos cuando esté definida; diagnóstico de argumentos insuficientes/incompatibles. | `statement` rechaza constraint/default |
| G03 | Parcial; sigue abierto | Packs de tipos, parámetros rest, expansión/forwarding y aridad; no descartar el orden de los argumentos. | Rest, spread y packs de funciones con forwarding comprobados; transferencia polimórfica de owners pendiente |
| G04 | Parcial; sigue abierto | Sobrecargas como valores con firma contextual, genéricos sobre callables y selección consistente. No elegir una declaración arbitraria ni publicar tipos parciales de candidatos descartados. | `IdentifierExpression`, `call` |
| F01 | Parcial; sigue abierto | Argumentos nombrados y spread: correspondencia con parámetros, duplicados, defaults y orden de evaluación. Publicar correspondencias para el consumidor posterior. | `argumentParameters`, `argumentPosition`, expansión de posiciones en arrays/tuplas |
| F02 | Parcial; sigue abierto | Parámetros opcionales dentro del cuerpo: su tipo debe modelar ausencia según el contrato Optional, además de admitir omitir el argumento. | `parameterType` envuelve Optional; aridad indirecta pendiente |
| F03 | Parcial; sigue abierto | Inferencia de retornos de arrows con bloque y funciones cuando corresponda; retornos incompatibles y rutas incompletas. | `signature`, límites del README del checker |
| F04 | Parcial; sigue abierto | Funciones nombradas anidadas y sus capturas, recursión y transporte del entorno. No bloquearlas sólo por un lowering futuro. | `safety.ets:captures`, transporte de funciones anidadas |
| B01 | Parcial; sigue abierto | Destructuring plano de arrays/objetos: símbolos por binding, aliases, tipos, defaults, patrones vacíos y posiciones. Comprobar tipo del campo, sin fallback a `any`. | `destructure`; defaults conservadores y exportación de hojas por auditar |
| B02 | Parcial; sigue abierto | `using`: binding inmutable, tipos válidos y obligaciones de destrucción por salida. Definir la semántica del recurso antes de cualquier emisión. | Binding inmutable y transferencia comprobados; limpieza pendiente de cierre |
| C01 | Parcial; sigue abierto | `for of`/`for in`: tipo de binding, ámbitos, inicialización, ownership, break/continue y punto fijo del bucle. | `statement`/`safety.walk` |
| C02 | Parcial; sigue abierto | `switch`: discriminante, compatibilidad/duplicados de etiquetas, default, fallthrough y canales de salida. Resolver el soporte anunciado pero ausente en stage 0. | `parser/README.md`, `LIMITATIONS.md` |
| C03 | Parcial; sigue abierto | Match canónico con `when`/`otherwise`/`whenType` y discriminadores: firmas, acceso a payload y flujo de cada callback. | `docs/match-syntax.md`, builtins pendientes |
| O01 | Parcial; sigue abierto | Inicialización de campos y readonly en constructor: exigir inicialización válida y permitir sólo las escrituras autorizadas. Mantener encapsulación en parámetros-propiedad. | `constructorInitialization`, slots y rutas; orden/ciclos de defaults por auditar |
| O02 | Abierto | Efectos de métodos sobre receptores, métodos static/instancia, inicializadores no literales y clases con campos compuestos. Evitar clasificar toda llamada sobre `this` como mutación sin resolver su contrato. | `methodMutates`, `effects.ets:analyze` |
| L01 | Parcial; sigue abierto | API completa de arrays: map/filter/reduce/forEach/find/some/every/concat/flatMap/sort y callbacks genéricos. Comprobar orden, mutabilidad, retornos y efectos. | `arrayCall` y consumidores síncronos; callbacks genéricos pendientes |
| L02 | Parcial; sigue abierto | Map/Set, tipos de clave/valor, métodos, índices y `delete`, incluyendo propagación de capturas/owners. | Constructores/métodos/delete y forEach tipados; ownership pendiente |
| L03 | Parcial; sigue abierto | Optional/Result, constructores/helpers, payloads y tipos públicos, con identidades semánticas canónicas. | `annotationInner`, `containerCall`, tablas de procedencia |
| L04 | Parcial; sigue abierto | `??` y `?.`: tipo de resultado y cortocircuito, efectos y ownership de la rama ejecutada. | `expressionInner` y flujo; llamadas opcionales pendientes |
| A01 | Parcial; sigue abierto | Promise/Task, async function/arrow, await y for-await-of: firma externa e interna, contextos válidos y tipo resultante. | Firmas externas/internas, await de consumo único, for-await y all/race; resultados owners en for-await pendientes |
| A02 | Parcial; sigue abierto | Memoria durante suspensión: préstamos vivos, capturas, movimientos, tareas retenidas y salidas. Se comprueban préstamos vivos, retención de frames y escapes por bloque; tareas opacas y receptores siguen siendo conservadores. | `SAFETY.md`, `EFFECTS.md`, pruebas `native async` |
| S01 | Parcial; sigue abierto | Catálogo completo de builtins y métodos: globals de string/array, Math, console/terminal, fs/path/process, JSON/JsonValue, red/TLS/HTTP, timers y callbacks. Alinear binder, checker y `types/estatic.d.ts`. | Registro stage 0 y listas independientes en binder/checker |
| S02 | Parcial; sigue abierto | Contratos de efectos/retención de cada builtin y operación externa. Una firma de tipos por sí sola no justifica aceptar un callback o ignorar préstamos activos. | `EffectAnalyzer.builtin`, `canRetain`, llamadas opacas |
| X01 | Parcial; sigue abierto | Decoradores reconocidos, argumentos, alcance, compatibilidad y metadatos include/link/ABI/backend. Diagnosticar los desconocidos sin descartarlos. | Metadatos comptime/deprecated/sealed/include/link; ABI y expansiones pendientes |
| X02 | Parcial; sigue abierto | Evaluación comptime nativa: ámbitos, TDZ, control, sobrecargas, numéricos exactos, callbacks y límites de recursos; evaluación determinista sin I/O implícito. | `comptime.ets`, `constant.ets`, `checker/COMPTIME.md`; clases, memoria y composición pendientes |
| X03 | Abierto | `@etsgen`: parseo de salida, AST, higiene por símbolo/módulo, publicación, límites, spans y validación antes/después. Unificar o justificar semántica de evaluadores existentes. | Documentos `etsgen-*`, código sólo en stage 0 |
| X04 | Abierto | `@cppgen` y declaraciones externas: contratos explícitos de tipo/efectos/ownership, auditoría de entrada y spans. No tratarlos como operaciones puras. | `PROJECT.md`, `RawCppExpression`, código stage 0 |
| M01 | Parcial; sigue abierto | Owners en campos, arrays/tuplas/objetos y demás agregados: copia prohibida donde corresponda, moves parciales, reinicialización y destrucción de cada recurso. | `ownership.ets`, rutas de recursos en `safety.ets`; destrucción y composición completa pendientes |
| M02 | Parcial; sigue abierto | Préstamos y genéricos tras sustitución; reborrows y procedencia de lvalues; definir qué rechazos conservadores pertenecen al lenguaje y cuáles son carencias de análisis. | `call`, `SAFETY.md` |
| M03 | Parcial; sigue abierto | Capturas de `this`/owners/préstamos donde el lenguaje las admita; transporte por valor/move/ref, lifetime y escape por todos los contenedores soportados. | `captures`, `provenance`, `SAFETY.md` |
| M04 | Parcial; sigue abierto | Efectos interprocedurales completos para todas las construcciones añadidas; callbacks simbólicos/recursivos, instanciación de obligaciones y efectos opacos. | `effects.ets`, E4104 y límites de `EFFECTS.md` |
| M05 | Parcial; sigue abierto | Terminación del análisis de flujo por estabilización del dominio, cobertura de nuevos nodos y obligaciones de limpieza por return/break/continue/suspensión. No convertir offsets en una prueba de todas las rutas. | `safety.ets:loop`, `borrows`, `IR.md` |
| P01 | Abierto | Superficie pública para todos los tipos nuevos, genéricos, variantes, aliases, callbacks, defaults, expansiones y módulos. No filtrar identidades privadas. | `safety.ets:visibility` |
| P02 | Parcial; sigue abierto | Tablas completas y coherentes entre archivos: tipos, firmas elegidas/instanciadas, correspondencia argumentos, conversiones, capturas, efectos y origen. Un nodo aceptado que necesite semántica no puede quedar sin resolver. | `model.ets`, `format.ets`, `expression` |
| V01 | Parcial; sigue abierto | Pruebas cruzadas del lenguaje completo, corpus de ejemplos y fuentes ETS del bootstrap, errores combinados y metamórficos. Corregir diferencias de stage 0 sin copiarlas ni ocultarlas. | `checker.test.ts`, nuevo `audit/` |
| V02 | Parcial; sigue abierto | Cerrar contradicciones documentales y dejar evidencia reproducible de cada fila. Verificar que el CLI nuevo analiza nativamente y no recurre a stage 0 para el proyecto solicitado. | `README.md`, `LIMITATIONS.md`, documentos de cada etapa |
| V03 | Validación completa de esta revisión pasada; repetir tras nuevos cambios | npm test pasa 3101/3101 con libuv, sin fallos, cancelaciones ni skips. Incluye 99 regresiones nuevas de comptime/conversiones/decoradores; audit nativo 80/80 con resultados tipados. | npm test, checker.test.ts, audit/run.ts, test/runner.ts |

## Diferencias que no se pueden llamar «resueltas» sólo por aceptar el fuente

- El tipo de `i8 + u32` debe ser `u32`, no el tipo del operando izquierdo.
  El audit comprueba tablas cuando la obligación requiere metadatos.
- Un i64/u64 aceptado sin decimal exacto ni conversiones resueltas no cierra N03.
- Un callback aceptado sin su obligación de préstamo/retención no cierra M04.
- Un `switch` parseado sin flujo/fallthrough ni comprobación de etiquetas no cierra C02.
- Un programa con `comptime` aceptado sin expansión/evaluación no cierra X02/X03.
- Un diagnóstico ajeno (p. ej. nombre no declarado, sintaxis errónea o cobertura
  pendiente) no prueba el rechazo semántico específico del caso negativo.

En esta rama se corrige además la preservación del tipo en `satisfies`, con
pruebas para tipos numéricos concretos y comprobación contra un union. Es un
subcaso de T08; el cierre completo de casts/readonly sigue abierto.

## Contradicciones y límites que requieren resolución explícita

1. `LIMITATIONS.md` anuncia switch; `bootstrap/parser/README.md` y el código
   de stage 0 confirman que no tiene parser/codegen operativo. Se mantiene C02.
2. `LIMITATIONS.md` llama estructurales a las interfaces; el núcleo ETS compara
   identidades nominales y rechaza una clase con los mismos miembros. Se mantiene T05.
3. La documentación de memoria contiene descripciones legacy y ejemplos de
   transferencia de campos que no encajan con `move(identifier)` del núcleo.
   Hay que fijar operaciones y diagnósticos; no habilitar copias de unique owners.
4. `out` está preservado por el parser y soportado en rutas de stage 0, mientras
   algunas tablas de deprecación lo agrupan con APIs legacy. Auditar la semántica
   vigente y dejar un único contrato antes de habilitarlo o deprecarlo de forma
   consistente. Si se mantiene, exige asignación por rutas, aliasing y reglas async.
5. La ausencia de parámetros de lifetime y retornos/campos prestados sigue siendo
   una restricción pública. No se anuncia que esta PR incorpore esas extensiones
   futuras; sí se exige comprobar los préstamos que Estatic ya permite.
6. Las firmas de APIs de runtime no resuelven por sí mismas seguridad concurrente,
   contratos de C++ opaco ni retención de callbacks. Esos contratos entran en S02/A02.

## Puerta de cierre y validación

```bash
npm run audit:bootstrap -- --report build/native-language-audit.json
npm test
```

`audit:bootstrap` construye el checker C++ desde ETS y ejecuta proyectos reales
aislados. Incluye 80 obligaciones iniciales; se amplían con la implementación.
Sale con código 1 mientras haya pendientes. No forma parte de `npm test` todavía:
es una puerta de finalización deliberadamente roja, no una regresión que se
oculta con skips, TODOs o expectativas de «unsupported».

La suite estable inicial de v64 tenía 348 pruebas del checker. Es un baseline de
regresión, no evidencia de cierre del lenguaje. El audit también es una muestra:
incluso 80/80 no sustituye revisar y cerrar todas las filas anteriores. Una fila
sólo se marca cerrada con implementación, contrato, pruebas positivas/negativas,
composición entre módulos y validación de las tablas que entrega.

El cierre requiere suite estable, audit completo, comparaciones contra contratos
independientes donde stage 0 falle, invariancia de AST/binding, repetibilidad y
caché fría/caliente. Para cambios de runtime se añaden sanitizers y pruebas
nativas apropiadas. No se cambia `success` para convertir entradas pendientes
en programas supuestamente válidos.

### Evidencia de esta revisión

- Checker nativo actualizado: **377/377**, cero fallos y cero skips (29 nuevas
  regresiones respecto de v64). Incluye el ejecutable C++ real y repetibilidad.
- Audit inicial: **18/80** obligaciones satisfechas, **62 pendientes**; salida 1
  esperada mientras se completa el lenguaje. No equivale a 62 bugs independientes.
- `npm test`: **2382 pasan, 84 fallan**, cero skips. Los 84 fallos corresponden
  a ejemplos/runner: se observan dependencias libuv ausentes y errores de C++
  generado. La suite completa no está validada; V03 permanece abierto.
- Tras ajustar el resultado legacy de shifts sobre `number`, se ejecutaron de
  nuevo las **377** pruebas del checker y el audit. La suite general anterior
  incluía las otras 28 regresiones; no se anuncia una repetición general verde.
- `git diff --check` sin incidencias.

## Trabajo separado que no define la semántica del lenguaje

Scheduler paralelo, aceleración incremental semántica, benchmarking y conexión
del nuevo frontend al codegen pertenecen a entregas posteriores. Se mantienen
registrados en los documentos de módulos/build; no se presentan como resueltos.
El runtime conserva tareas de ASan/UBSan, cancelación de `race`, carga HTTP y
equivalencia Drogon/cpp-httplib en `status.md` y `docs/MEMORY-AUDIT.md`.
Esto no autoriza ignorar un fallo de seguridad que afecte a una operación
aceptada durante este trabajo.

**IR bloqueado:** no iniciar su implementación ni anunciar el bootstrap completo
hasta que no queden filas abiertas y la evidencia de cierre esté revisada.

## Validación de esta tanda

El checker actualizado pasa 748/748 pruebas; el binder pasó 63/63 en la
validación conjunta anterior. Los callbacks y uniones públicas tienen pruebas
positivas, negativas y de efectos/procedencia. El audit sigue en 71/80 y sale
con código 1 deliberadamente. Esto no certifica paridad ni cierre del inventario.
