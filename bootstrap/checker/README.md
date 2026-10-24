# Checker nativo con flujo y memoria (v64)

El lenguaje completo sigue pendiente. El [registro de cierre](../PENDING.md)
es la referencia para completar este núcleo antes de empezar el IR.
`npm run audit:bootstrap` es una puerta de cobertura separada de las regresiones:
pasa 83/83 obligaciones de referencia y no certifica por sí sola el cierre del lenguaje.

```bash
npm run bootstrap:checker -- examples/hello.ets --cache build/project-cache
npm run bootstrap:checker -- examples/native-semantics/main.ets --cache build/project-cache
npm run test:bootstrap:checker
```

Node construye el ejecutable. Después el binario abre el proyecto, ejecuta el
cargador y `analyzeProject(graph)` en ETS compilado a C++20. Este punto de entrada
expande los generadores ETS, enlaza y comprueba el grafo resultante.
No consulta el checker TypeScript para analizar el proyecto solicitado. Los tests
sí lo usan como referencia diferencial para un conjunto acotado de casos.

Este frontend sigue siendo una **migración parcial de comprobación**, no la paridad con stage 0
ni una autorización para generar código nativo de cualquier proyecto. El CLI
principal conserva su cadena actual. El nuevo driver entrega sintaxis, binding
y tablas tipadas; no conecta todavía esos datos al codegen.

## Contrato

`checker.ets` consume `ModuleGraph` y su `BindingResult` de la misma carga.
`types.ets` contiene operaciones sobre tipos canónicos; no hace binding.
v63 añade la pasada independiente [`safety.ets`](./safety.ets). Su
[contrato de flujo, memoria, escapes y API pública](./SAFETY.md) describe las
reglas, tablas y restricciones conservadoras. `model.ets` contiene las estructuras
compartidas, evitando dependencias circulares. `CheckResult` devuelve:

- `files[m].types[node]`: tipo de expresiones y declaraciones comprobadas.
  Una entrada vacía corresponde a un nodo sin tipo de valor (o no recorrido
  tras un error), incluidos los nodos huérfanos del parser.
- `files[m].members[node]`: símbolo original de un miembro nominal/namespace.
- `files[m].selected[node]` y `selectedModules[node]`: nodo y módulo de la
  declaración elegida para una llamada de función/método/constructor.
- `files[m].signatures[node]`: firma instanciada de la llamada; conserva las
  sustituciones genéricas, además del tipo de retorno en `types`.
- `files[m].exactIntegers[node]`: decimal exacto de literales i64/u64, obtenido
  del token sin pasar por double.
- `files[m].conversions[node]`: destino de una conversión comprobada. `satisfies`
  comprueba compatibilidad sin convertir el resultado.
- `files[m].caseValues[node]`: clave canónica de una etiqueta constante de switch.
- `symbolTypes`: tipos resueltos por identidad de símbolo original. Se calculan
  bajo demanda y para declaraciones requeridas por seguridad; otras entradas permanecen vacías. Los imports
  consultan el destino del binder, sin crear una copia de la identidad nominal.
- `captures`: símbolos capturados por arrow o función anidada y modo `value`/`reference`.
- `borrows`: raíz e intervalo por offsets de cada préstamo local.
- `effects`: efectos por función, destinos de llamadas, callbacks invocados/retenidos,
  procedencia del retorno y obligaciones de préstamos; ver [EFFECTS.md](./EFFECTS.md).
- `diagnostics`: fase `checker`, archivo canónico y posición UTF-16 original.
  Los errores previos se conservan e impiden crear las tablas tipadas.
  Todas las fases usan [ets-diagnostic-1](../frontend/DIAGNOSTICS.md): código y
  severidad separados, mensaje sin prefijo, intervalos completos y procedencia
  generada. La salida de proyecto es `ets-checked-2`; las coordenadas planas
  se mantienen como alias de compatibilidad.
- `success`: no hubo errores en las comprobaciones de este núcleo. **No acredita
  una prueba completa de memoria/flujo más allá de las reglas** descritas abajo.

El formato de demostración incluye los AST completos y las tablas. Los tipos
nominales usan `#<symbolId>`, los parámetros genéricos `@<symbolId>` y los
receptores de clase `class:#<symbolId>`. Esos IDs pertenecen al binding de esta
carga, no son un formato persistente intercambiable entre proyectos/versiones.
Los tipos compuestos usan sintaxis canónica (`number[]`, `[number,string]`,
`(number)=>string`, `#195|#203`). `!error` propaga un diagnóstico existente;
`!print` identifica el builtin de impresión. No constituyen tipos fuente.

Ni el AST ni el binding reciben atributos semánticos. La demo ejecuta dos
checkers independientes, compara la salida completa y verifica los hashes de
cada SourceResult y la serialización del binding antes/después (exit 3 si cambia).
La caché persistente continúa almacenando exclusivamente sintaxis. No hay caché
semántica ni ejecución concurrente del checker.

## Cobertura inicial

- Inferencia de literales, variables, expresiones numéricas/lógicas, templates,
  arrays homogéneos y tuplas heterogéneas; arrays/objetos con contexto en una
  anotación o firma. Los arrays vacíos requieren contexto.
- Anotaciones primitivas, numéricos concretos hasta 64 bits, f32/f64, aliases
  simples, consultas `typeof` de valores y rutas cualificadas, tipos callable y uniones sin narrowing.
  Los nombres de clases/interfaces conservan su identidad entre archivos y
  namespaces; dos nombres iguales no colapsan en el mismo tipo.
- Funciones, métodos y arrows, recursión con firma, parámetros opcionales y
  valores por defecto, aridad y selección no ambigua de sobrecargas. Inferencia
  genérica simple desde parámetros `T`/`T[]`, y argumentos de tipo explícitos.
  Se conserva la firma instanciada. No se elige silenciosamente la primera
  sobrecarga cuando hay varias candidatas.
- Retornos y comprobación conservadora de rutas en bloques e if/else; condiciones
  booleanas, while/for (incluido incremento), break/continue y asignaciones.
  Se infieren retornos en cuerpos expresión y bloques, sin incluir retornos de
  funciones anidadas. Las rutas incompletas siguen siendo un error.
- Clases, constructores/propiedades de parámetros, `this`, miembros
  estáticos/de instancia, miembros privados/protegidos y campos readonly.
  Se rechazan escrituras sobre constantes y sus campos/índices. La comprobación
  de efectos de métodos es conservadora: una escritura o llamada sobre `this`
  requiere receptor mutable, incluso si una llamada transitiva resultara pura.
- Interfaces estructurales e intersecciones satisfechas por clases u objetos con contexto: campos requeridos,
  opcionales, duplicados, desconocidos y tipos de valores. No se infiere una
  forma estructural arbitraria para objetos sin contexto.
- Builtins de impresión, `numberToString`, `argument`, `argumentCount`,
  `exitProcess`, métodos de string y un subconjunto de métodos de array
  (`push`, `pop`, `includes`, `join`, `slice` y consumidores funcionales). Los
  contratos concretos se generan desde las tablas de stage 0 y se verifican
  con `node --experimental-strip-types scripts/generate-native-builtins.ts --check`.
- Lecturas locales evidentes antes de inicialización, ciclos de inferencia y
  aliases circulares. Rangos de literales enteros decimales en contextos
  numéricos concretos, también al pasar argumentos. La rama de cierre añade
  bases 2/8/16, separadores y fracciones, validación de tokens/finitud y
  promociones numéricas y literales i64/u64 exactos con rangos y conversiones.
- Arrays fijos con tamaños literales/constantes, longitud e índices constantes;
  destructuring plano con bindings tipados y defaults, y declaraciones `using`.
- Enums nominales numéricos/string, switch con etiquetas constantes y fallthrough,
  for-of/for-in sobre arrays y for-of sobre string. El flujo de bucles converge
  por estabilización de estados, conservando break/continue y préstamos del iterable.
- Aliases y clases genéricas con sustitución de miembros, constraints/defaults
  básicos; Optional/Result con helpers, parámetros opcionales, `??` y acceso
  opcional a campos y llamadas, con cortocircuito de argumentos y efectos.
- Globals de string, Math, console/terminal, Date, JSON, filesystem, path/process,
  HTTP/red, timers y FileReader. El catálogo estático generado se comparte con
  los contratos de stage 0; las operaciones genéricas se comprueban en ETS.
  Los efectos externos se publican separados de las lecturas/escrituras de símbolos.

Los packs de funciones admiten inferencia, argumentos explícitos, vacío y
forwarding; la firma elegida conserva la expansión ordenada. Los packs con
owners exigen transferencias explícitas y conservan `argumentElements`; los packs
que almacenarían préstamos se rechazan sin un contrato de lifetime. Los agregados con owners se
comprueban como move-only, con movimientos parciales y restauración por ruta,
también después de sustituir parámetros genéricos. Ver [SAFETY.md](./SAFETY.md).

## Tareas y suspensión

Las funciones async publican `Promise<T>` y comprueban sus retornos contra `T`.
Los arrows async sin retorno anotado infieren la envoltura. Await requiere una
tarea y un contexto async o superior; consume el lvalue, incluso campos e índices.
For-await consume su iterable. Los combinadores all/race y sus aliases requieren
transferir el array. Spawn recibe una tarea void por transferencia.

Crear una tarea evalúa argumentos/defaults; reanudarla ejecuta el cuerpo sin
repetirlos. Los resúmenes publican fases `body` y `creation`, enlazadas por el
índice `creation`. `files[m].taskSources[node]` conserva los orígenes posibles:
un valor no negativo identifica un nodo Call mediante los offsets acumulados de
las arenas del proyecto; uno negativo representa un origen opaco (parámetro o
llamada sin implementación). Son IDs de esta carga, no un formato persistente.
Ver [EFFECTS.md](./EFFECTS.md) y [SAFETY.md](./SAFETY.md).

## Procedencia y contrato de salida

Cada archivo del resultado conserva su AST, ruta canónica, ID persistente y hash
de contenido. `symbolIds` normaliza identidades entre cargas; `moduleRecords`
publica interfaces, cuerpos y dependencias para invalidación futura. Los IDs
numéricos de nodos y símbolos siguen siendo locales a la carga. El contrato y
sus límites están en [MODULES.md](./MODULES.md). No se implementa backend ni IR.

## Consultas y composición de tipos

El parser nativo admite sufijos de arrays, unions e intersecciones tras una
consulta `typeof`, además de arrays/unions de tuplas. Las consultas no leen el
valor runtime ni usan su narrowing: resuelven el tipo estático desde el símbolo
original. Se permiten imports de valor usados sólo como tipo y namespaces
importados sólo de tipo, sin autorizar acceso runtime a esos imports.

`queries` publica una entrada por `(module,node,text)` con el tipo resuelto y
los símbolos de cada segmento de la ruta. Las identidades son originales, tras
aliases/reexports. Un segmento builtin o compuesto sin símbolo único usa `-1`.
El nodo conserva su AST/binding y las tablas de selección y miembros de sus
expresiones; dos consultas de la misma anotación no se pisan. Las posiciones
siguen ancladas al nodo propietario de la anotación.

Los arrays dinámicos y fijos conservan la precedencia del elemento union,
intersección o callable en su representación canónica. Las unions con callables y los tipos agrupados conservan la distinción respecto
a una función que devuelve una union. Los guards typeof refinan alternativas
y los ternarios publican su tipo común o union sin cambiar el tipo de una rama.

## Evaluación nativa de constantes

`comptime(callback)` y las llamadas `@comptime` publican valores tipados después
de comprobar el fuente. No se modifica el AST ni el binding. Se conservan las
identidades originales entre módulos, errores estructurados y presupuestos por
raíz. Los decoradores reconocidos publican objetivo y argumentos. El contrato,
las tablas y los límites están en [COMPTIME.md](./COMPTIME.md).

## Límites y diferencias conocidas

El punto de entrada `analyzeProject` expande @etsgen sobre una copia del grafo,
resuelve símbolos y comprueba el AST resultante. `checkProject` comprueba un grafo
ya expandido. Las llamadas opcionales conservan el receptor efectivo en
`receivers[node]`, el resultado Optional y la firma de la invocación interior;
los argumentos y efectos solo se ejecutan si existe el payload. Un método void
con acceso opcional produce void.

`out` conserva el contrato vigente de referencia mutable de entrada/salida a
una variable inicializada. Se publica como ref<T> en la firma, junto con el
atributo out de la declaración; se comprueban mutabilidad, aliasing, préstamos y
los movimientos que el cuerpo propaga al caller. No admite optional, default,
rest, propiedad de parámetro ni suspensión async.

`@cppgen` conserva un contrato de sentencia opaca: no produce un valor runtime,
publica efectos externos desconocidos y no se ejecuta durante comptime. Los
decoradores ABI conservan sus datos y validan objetivo y argumentos. La emisión
de C++ de esos escapes pertenece al backend y queda fuera de esta entrega. Las sobrecargas como valor requieren contexto callable y
seleccionan también sus efectos. La sustitución genérica comprueba ownership
sobre el cuerpo instanciado, incluidos préstamos readonly y aliasing. Una función
genérica como valor requiere un arrow que fije los argumentos de tipo; los
literales de objeto requieren contexto de interfaz, según el dialecto vigente.

Se comprueban argumentos nombrados/rest/spread, uniones declaradas y payloads,
Map/Set/delete y callbacks de arrays. `argumentParameters` conserva la posición
formal de cada argumento sin reordenar el AST ni su evaluación. El narrowing por
discriminador e instanceof se aplica en ramas, guards, cortocircuitos y ternarios;
una llamada o escritura invalida conservadoramente las garantías anteriores.
Match comprueba casos, callbacks y resultados, conservando efectos y procedencia.
`matchCoverage[node]` publica `total` o `traps`: si no coincide ningún caso, la
operación termina con un trap. En comptime se diagnostica COMPTIME_MATCH_UNMATCHED. Async
mantiene restricciones sobre parámetros prestados, tareas opacas, resultados
prestados en for-await, suspensiones en inicializadores de campos y capturas de receptores. Sus comprobaciones de contenedores
son conservadoras respecto al orden y la multiplicidad de tareas.

Los constructores comprueban inicialización por rutas, lectura anticipada y
escritura única de readonly. Se mantienen movimientos por ruta, préstamos,
TDZ en llamadas directas, escapes de closures y tipos privados en API públicas.
Los límites conservadores están en [SAFETY.md](./SAFETY.md) y el inventario de
cierre en [PENDING.md](../PENDING.md).

La suite registra cuatro diferencias observadas con el checker TS directo:
`typeof` de una variable local y la inferencia de `T[]` desde un literal pasan
en el nuevo núcleo pero fallan en ese recorrido directo de stage 0; éste acepta
la escritura externa de cierto campo readonly y el literal 128 pasado a i8,
que el núcleo nativo rechaza. No se anuncia paridad general ni se modifica
stage 0 para ocultar esas diferencias. El parser nativo admite ahora
`typeof ns.miembro`, namespaces anidados, imports sólo de tipo y campos/métodos
con sus comprobaciones de acceso y receptor. El parser de stage 0 conserva su
límite de identificador simple; no se anuncia soporte de estas consultas en su
CLI ni en su codegen.

Las posiciones en anotaciones se anclan al nodo propietario: el parser conserva
el texto canónico, no spans internos para cada fragmento. La resolución tiene
límite de profundidad 128 y las búsquedas son lineales; no se certifica una
mejora de rendimiento.

## Validación

La revisión de consultas y composición pasa **3154/3154** pruebas de npm test,
sin fallos, cancelaciones ni skips, con ejemplos/libuv incluidos. Se añaden 53
pruebas netas de checker/parser/binder y se amplía el audit a **83/83**, sin
interpretar ese muestreo como paridad completa del lenguaje. Se comprueban tipos,
identidades originales, precedencia, metadatos y errores de acceso/receptor.

La suite compila obligatoriamente el ejecutable C++20. Comprueba éxitos y errores
de las formas descritas, identidades entre módulos, reexports/default/namespaces,
selección de firmas, tipos inferidos, Unicode/CRLF y límites explícitos. Compara
procesos con caché fría/caliente y vuelve a inferir tras editar una dependencia.
Incluye comparaciones de aceptación/rechazo y tipos inferidos con stage 0, además
de las diferencias documentadas de v62/v63. Cada invocación repite el checker y
verifica que sintaxis y binding permanezcan intactos.

Validación de v64: **348/348** tests del checker (48 adicionales respecto de v63).
Conjunto estable: **2352/2352** por bloques: 1236 stage 0 + 64 lexer +
542 parser + 57 puente + 42 cargador + 63 binder + 348 checker; cero fallos y
cero skips. Se excluyen `test/runner.ts` y E2E/libuv.

La demo de `examples/native-semantics/` comprueba tres módulos: fábrica que devuelve
ownership, préstamo local mutable y lector devuelto por valor. Devuelve cero
diagnósticos, una captura por valor y un intervalo de préstamo. Otro proceso
produce la misma salida completa y conserva los tres registros de sintaxis
sin reescribirlos. Es una demostración del frontend; no ejecuta el programa.

Antes del IR común descrito en [IR.md](./IR.md) se debe cerrar el
[registro del lenguaje](../PENDING.md). El IR sigue siendo un contrato de
diseño: esta entrega no implementa el IR ni sus codegens.

Los constructores implícitos por composición publican `constructionFields[node]`
con los símbolos de campos en orden de declaración y `argumentParameters[arg]`
con la posición formal de cada argumento; el AST conserva el orden original de
evaluación. Si existen inicializadores de campos, el constructor implícito no
acepta argumentos. Los campos static no forman parte de la composición.

Optional admite map, andThen y orElse con tipos y efectos de callbacks. map y
andThen invocan el callback cero o una vez y prestan temporalmente el receptor;
los payloads con ownership requieren parámetros prestados. orElse recibe un
Optional alternativo. Result publica los discriminadores inmutables kind
(Ok/Err) y ok (boolean). La evaluación comptime conserva estas operaciones.

@etsgen publica `generatedSources` con id, módulo/callsite, generador, padre y
texto virtual. Cada nodo generado conserva el id y sus coordenadas internas en
atributos, además del span primario de la llamada. Los diagnósticos incluyen
`generated.sourceId` y la posición en el fragmento. El orden usado por el análisis
de flujo se calcula aparte de los spans de origen. Se mantienen higiene léxica,
publicación explícita @etsPublish, etsCapture y etsDefinition, y se rechazan
imports/exports dentro de fragmentos. Los errores originales sobreviven al
chequeo final; un argumento inválido se comprueba antes de eliminar la llamada.

La API pública comprueba también las referencias a tipos en constraints y defaults
de genéricos, incluidos métodos y declaraciones generadas. Los valores callable
conservan la aridad de su tipo: defaults y parámetros opcionales de una declaración
sólo permiten omisión en llamadas directas, igual que el contrato vigente de stage 0.

`npm run audit:bootstrap:self` construye un ejecutable de auditoría que carga y
analiza las fuentes del frontend con sus propias pasadas ETS. Publica módulos,
símbolos, nodos tipados y diagnósticos; el modo trace muestra sus fases por stderr.
La construcción del ejecutable usa el adaptador existente, sin analizar con el
checker TypeScript el proyecto solicitado ni generar su backend.
El adaptador permite construir la auditoría con optimización O2; las pruebas
funcionales conservan O0. Las consultas de argumentos y estados inmutables usan
constRef para evitar copiar tablas completas en cada acceso. La comparación de
gramática está en [SYNTAX-PARITY.md](../SYNTAX-PARITY.md).
La auditoría completa ya termina sin diagnósticos: ver las medidas, causas y
regresiones en [PERFORMANCE.md](PERFORMANCE.md).
