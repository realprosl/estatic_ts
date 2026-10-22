# Checker nativo con flujo y memoria (v64)

```bash
npm run bootstrap:checker -- examples/hello.ets --cache build/project-cache
npm run bootstrap:checker -- examples/native-semantics/main.ets --cache build/project-cache
npm run test:bootstrap:checker
```

Node construye el ejecutable. Después el binario abre el proyecto, ejecuta el
cargador, el binder y `checkProject(graph, binding)` en ETS compilado a C++20.
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
- `symbolTypes`: tipos resueltos por identidad de símbolo original. Se calculan
  bajo demanda y para declaraciones requeridas por seguridad; otras entradas permanecen vacías. Los imports
  consultan el destino del binder, sin crear una copia de la identidad nominal.
- `captures`: símbolos capturados por arrow y modo `value`/`reference`.
- `borrows`: raíz e intervalo por offsets de cada préstamo local.
- `effects`: efectos por función, destinos de llamadas, callbacks invocados/retenidos,
  procedencia del retorno y obligaciones de préstamos; ver [EFFECTS.md](./EFFECTS.md).
- `diagnostics`: fase `checker`, archivo canónico y posición UTF-16 original.
  Los errores previos se conservan e impiden crear las tablas tipadas.
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
- Anotaciones primitivas, numéricos concretos hasta 32 bits, f32/f64, aliases
  simples, `typeof` de identificadores, tipos callable y uniones sin narrowing.
  Los nombres de clases/interfaces conservan su identidad entre archivos y
  namespaces; dos nombres iguales no colapsan en el mismo tipo.
- Funciones, métodos y arrows, recursión con firma, parámetros opcionales y
  valores por defecto, aridad y selección no ambigua de sobrecargas. Inferencia
  genérica simple desde parámetros `T`/`T[]`, y argumentos de tipo explícitos.
  Se conserva la firma instanciada. No se elige silenciosamente la primera
  sobrecarga cuando hay varias candidatas.
- Retornos y comprobación conservadora de rutas en bloques e if/else; condiciones
  booleanas, while/for (incluido incremento), break/continue y asignaciones.
  Arrows con cuerpo expresión pueden inferir retorno; con bloque necesitan
  anotación explícita en esta fase.
- Clases sin genéricos, constructores/propiedades de parámetros, `this`, miembros
  estáticos/de instancia, miembros privados/protegidos y campos readonly.
  Se rechazan escrituras sobre constantes y sus campos/índices. La comprobación
  de efectos de métodos es conservadora: una escritura o llamada sobre `this`
  requiere receptor mutable, incluso si una llamada transitiva resultara pura.
- Interfaces nominales satisfechas por objetos con contexto: campos requeridos,
  opcionales, duplicados, desconocidos y tipos de valores. No se infiere una
  forma estructural arbitraria para objetos sin contexto.
- Builtins de impresión, `numberToString`, `argument`, `argumentCount`,
  `exitProcess`, métodos de string y un subconjunto de métodos de array
  (`push`, `pop`, `includes`, `join` de strings y `slice`). Firmas contrastadas
  con stage 0; los otros builtins se rechazan explícitamente.
- Lecturas locales evidentes antes de inicialización, ciclos de inferencia y
  aliases circulares. Rangos de literales enteros decimales en contextos
  numéricos concretos, también al pasar argumentos. Los otros formatos de
  literal en esos contextos producen un diagnóstico de cobertura pendiente.

## Límites y diferencias conocidas

Se emite `Comprobación nativa pendiente: ...` para construcciones aún no
trasladadas: enteros exactos i64/u64, arrays fijos,
clases/aliases genéricos, constraints/defaults/packs genéricos, parámetros out o
variádicos, argumentos nombrados/spread, destructuring, enums/unions declaradas,
switch/for-of/for-in, async/await, acceso opcional, pipelines y builtins no
registrados, decoradores y expansión comptime/cppgen/etsgen. Tampoco se permite
usar un grupo de sobrecargas como valor sin seleccionar una firma. Las capturas locales pasan por la nueva comprobación de procedencia y escapes.

Se comprueban ahora movimientos por ruta, préstamos y readonly, TDZ en llamadas
directas, escapes de closures y tipos privados en API públicas. No hay todavía
análisis completo de efectos/lifetimes interprocedurales ni narrowing/exhaustividad.
Los límites conservadores y las construcciones bloqueadas están en [SAFETY.md](./SAFETY.md). Los campos readonly se
tratan conservadoramente como no escribibles, incluso dentro de un constructor;
los literales por defecto sí se comprueban. La inferencia contextual compleja
entre sobrecargas y de tipos desde el retorno queda pendiente.

La suite registra cuatro diferencias observadas con el checker TS directo:
`typeof` de una variable local y la inferencia de `T[]` desde un literal pasan
en el nuevo núcleo pero fallan en ese recorrido directo de stage 0; éste acepta
la escritura externa de cierto campo readonly y el literal 128 pasado a i8,
que el núcleo nativo rechaza. No se anuncia paridad general ni se modifica
stage 0 para ocultar esas diferencias. `typeof ns.miembro` sigue siendo un
límite del parser actual y se conserva como error previo al checker.

Las posiciones en anotaciones se anclan al nodo propietario: el parser conserva
el texto canónico, no spans internos para cada fragmento. La resolución tiene
límite de profundidad 128 y las búsquedas son lineales; no se certifica una
mejora de rendimiento.

## Validación

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

El siguiente paso es el IR común descrito en [IR.md](./IR.md). Es un contrato de
diseño: esta entrega no implementa el IR ni sus codegens.
