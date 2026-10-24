# Revisión del estado del frontend bootstrap

Fecha: **2026-10-24**. Código revisado:
[`24e32ac005586e738c179472d41f031d265a8b47`](https://github.com/realprosl/estatic_ts/commit/24e32ac005586e738c179472d41f031d265a8b47).
Esta revisión contrasta código, contratos y pruebas; no modifica la semántica ni
implementa IR. El [inventario vigente](../PENDING.md) distingue implementación,
restricciones explícitas y obligaciones pendientes.

## Resultados repetidos

| Comprobación | Resultado observado |
|---|---|
| Seis capas del frontend más el esquema de AST | 2182/2182; cero fallos, cancelaciones y skips |
| Obligaciones de referencia | 83/83; salida 0 |
| Gramática | 75/75 contratos; cero formas eliminadas |
| Corpus físico de sintaxis | 132/132 archivos aceptados por cada pipeline |
| Corpus semántico del checker | 131/132 aceptados; `expected-errors/private-bad.ets` rechazado por acceso privado |
| Autoanálisis del proyecto checker | `success: true`, 23 módulos, 6594 símbolos, 75596 nodos tipados, cero diagnósticos |
| Catálogo de builtins | 216 contratos sincronizados |
| Suite global `npm test` | No repetida en esta revisión |

El caso de acceso privado es una prueba negativa esperada, no un fallo de la
suite. La aceptación de sintaxis de ese archivo tampoco implica su aceptación
semántica. `audit:bootstrap` tiene código de salida 0 cuando sus 83 casos pasan;
no permanece deliberadamente en 1 como afirmaban los checkpoints antiguos.

En esta ejecución, el adaptador de autoanálisis midió **41447 ms de construcción**
y **47895 ms de análisis**. Son mediciones de esta ejecución y entorno, no un
benchmark comparativo ni un objetivo de rendimiento. No se elevó el timeout ni
se omitieron pasadas. El log incluye expansión/binding, tipos, seguridad,
efectos, procedencia, flujo, constantes y registros por módulo.

### Reproducción

Desde la raíz del repositorio, con Node compatible y un compilador C++20:

```bash
node --experimental-strip-types --test --test-concurrency=1 \
  bootstrap/lexer/lexer.test.ts \
  bootstrap/parser/ast-schema.test.ts \
  bootstrap/parser/parser.test.ts \
  bootstrap/frontend/frontend.test.ts \
  bootstrap/modules/loader.test.ts \
  bootstrap/binder/binder.test.ts \
  bootstrap/checker/checker.test.ts

npm run audit:bootstrap -- --report build/native-language-audit.json
npm run audit:bootstrap:syntax
npm run audit:bootstrap:self
node --experimental-strip-types scripts/generate-native-builtins.ts --check
```

Para regenerar los dos artefactos de sintaxis versionados:

```bash
npm run audit:bootstrap:syntax -- --write
```

El directorio temporal del sistema debe existir y ser escribible; en el entorno
de esta revisión se configuró `TMPDIR` a un directorio temporal escribible. No
se cambian los tests ni sus expectativas por esa adaptación del entorno.

Los totales globales de ejecuciones anteriores —2382/84, 3154/3154, 3489/3489,
etc.— se conservan en el [historial](../../docs/historical/bootstrap-closure-v64.md).
No se presentan como una ejecución global actual. Tampoco se deduce cierre del
lenguaje de un número de tests, del corpus ni de que el compilador analice sus
propias fuentes.

## Estructuras que existen hoy

| Capa | Código | Salida/contrato observado |
|---|---|---|
| Lexer | `lexer/lexer.ets` | Tokens con `kind` y `lexeme` string, posiciones UTF-16 y diagnósticos; recorrido interno en bytes UTF-8 |
| Parser | `parser/parser.ets`, `parser/ast-schema.ets` | Arena `nodes[]`; `NodeKind`, `EdgeRole` y `AttributeKind` numéricos; atributos con valores string y enlaces por índice |
| Frontend por archivo | `frontend/frontend.ets` | `SourceResult`: archivo, tokens, AST y diagnósticos |
| Cargador y caché | `modules/loader.ets`, `syntax-cache.ets` | Grafo de archivos y dependencias; caché persistente de sintaxis, no de semántica |
| Expansión | `checker/expansion.ets` | Copia del grafo con AST generado, higiene y procedencia; nuevos ciclos de binding/checking |
| Binder | `binder/binder.ets` | Ámbitos, símbolos, referencias, exports y tablas de padres/declaraciones por archivo |
| Checker | `checker/checker.ets`, `model.ets` | Tipos canónicos string y tablas laterales de miembros, firmas, conversiones, argumentos y constantes |
| Seguridad/efectos | `safety.ets`, `effects.ets`, `ownership.ets` | Estados por rutas, movimientos, préstamos, capturas, procedencia y resúmenes conservadores |
| Comptime | `comptime.ets`, `constant.ets` | Intérprete ETS con estados y valores constantes tipados |
| Procedencia | `module-records.ets`, `format.ets` | `ets-checked-2`, IDs persistentes, hashes y dependencias semánticas |
| IR/backend | `checker/IR.md` | Diseño propuesto; todavía no hay lowering, verificador ni codegen desde estas tablas |

Los nombres legibles de categorías se conservan en JSON/caché; los ordinales de
los enums no son un formato persistente. La arena conserva nodos intermedios
huérfanos, por ejemplo el identificador que pasa a ser una llamada por nombre.
Una entrada vacía en `types[]` no es automáticamente un fallo: programa, bloques,
atributos de decoradores y nodos huérfanos no son todos expresiones de valor.
El consumidor debe definir qué metadatos exige para cada operación.

`analyzeProject` expande y vuelve a enlazar antes de comprobar. `checkProject`
consume un grafo ya expandido. El ejecutable analiza las fuentes solicitadas
nativamente; stage 0 construye el ejecutable, no decide su semántica por él.
No se ha cambiado aquí el AST a hijos propietarios ni el lexer a slices del fuente.

## Correcciones al inventario anterior

- N01–N04 tienen implementación y pruebas de rangos/promociones, exactitud i64/u64,
  comparaciones mixtas y conversiones publicadas; no se describen como ausencia
  general del soporte numérico.
- T07, los callables compuestos y el narrowing ya tienen regresiones posteriores
  a las cifras antiguas. El README tampoco debe decir que sólo existen unions
  «sin narrowing».
- F03/F04, argumentos nombrados/rest/spread, constructores, campos readonly,
  Map/Set y callbacks tienen código y pruebas positivas/negativas.
- L04 ya incluye llamadas opcionales con `receivers` y firmas, además de
  cortocircuito de argumentos y efectos. A01 incluye resultados propietarios
  en for-await. No siguen pendientes por los límites de checkpoints anteriores.
- X02 materializa clases, constructores, métodos, enums y match. X03 usa ese
  mismo intérprete para @etsgen, con higiene, publicación y fuentes generadas.
- S01 tiene un catálogo generado verificable; no basta conservar el antiguo
  estado «validación conjunta en curso» cuando se ha ejecutado su comprobación.
- Los límites de emisión de switch o consultas typeof en stage 0 no se atribuyen
  al parser/checker nativo. Tampoco se exige equivalencia con aceptaciones
  inseguras de stage 0.

En el [inventario](../PENDING.md), **I** significa implementación ejercitada,
**R** contrato restringido/conservador y **P** una obligación pendiente concreta.
Ninguna de esas etiquetas por sí sola certifica todas las composiciones de una fila.

## Carencia reproducida: memoria durante comptime

Este programa llega al checker y al evaluador; no falla por sintaxis o binding:

```ts
function read(x: constRef<number>): number { return x; }
const n = comptime((): number => {
  let x = 3;
  return read(x);
});
```

El resultado nativo es `success: false` con **COMPTIME_UNSUPPORTED**:
«Un contrato de memoria requiere una prueba de aliasing del evaluador».
`NativeComptime.invoke` rechaza parámetros cuyo tipo satisface `containsMemory`.
Es un límite real de cobertura de X02, aunque la lectura sea válida fuera de
comptime. No se cuenta como evaluación soportada ni como un error de tipos del
programa. Se puede reproducir guardando el programa en un `.ets` y ejecutando
`npm run bootstrap:checker -- ruta/al/archivo.ets`.

## Restricciones reproducidas que no son nuevas obligaciones

| Caso | Resultado actual | Interpretación |
|---|---|---|
| `function id<T>(x:T):T{return x;} const f:(x:number)=>number=id;` | Requiere una llamada/arrow que fije los argumentos de tipo | Restricción de extracción genérica documentada; no se exige toda la inferencia de TS |
| `const point={x:1,y:2};` | Un literal de objeto requiere contexto de interfaz | Restricción de shapes sin contexto del dialecto actual |
| Wrapper recursivo que propaga un callback simbólico sin prueba de efectos | E4104 | Rechazo conservador explícito; no equivale a ausencia del análisis de recursión |
| Exponenciación `**` | Rechazo de parser | No está en el inventario actual de operadores `+ - * / %`; no se añade como requisito para cerrar bootstrap |

Las dos primeras restricciones ya se describen en el README del checker; E4104
está cubierto por `native effects rejects a recursive wrapper around a symbolic
callback`. Estas restricciones no se han eliminado para mejorar una cifra.

## Recursos y preparación para el IR

`using` ya crea un binding inmutable y participa en el análisis de ownership.
No implica que el checker ejecute un destructor ni que entregue instrucciones
de limpieza. El codegen actual de stage 0 usa el RAII del tipo C++; **no invoca
`dispose()` por el nombre del método**. Se corrige el comentario que prometía
esa llamada. Tampoco se anuncia que añadir un método llamado dispose introduzca
un destructor del dialecto.

El contrato de destrucción/limpieza y el de entrada al lowering todavía necesitan
una decisión explícita. La ausencia de un CFG o de instrucciones `destroy` en el
frontend no es por sí misma un bug: construirlos es responsabilidad del IR.
Sí hay que fijar qué reglas de salida y qué metadatos acepta el consumidor,
incluidos los casos opacos, y comprobarlos con un verificador.

Los intervalos `borrows` no se pueden convertir mecánicamente en `endBorrow`
usando el offset como una prueba de todas las rutas. Los resúmenes de efectos
no sustituyen el cuerpo. Los símbolos y nodos de una carga deben permanecer
unidos a sus módulos; la procedencia estable está descrita en [MODULES.md](../checker/MODULES.md).

**Conclusión de esta revisión:** la base implementada es más amplia de lo que
indicaba el inventario antiguo, pero esta revisión documental no satisface la
puerta previa de cierre ni introduce el IR. Quedan cobertura de X02, contratos
de recursos/consumidor y validación de cierre identificados en PENDING.md.
No hace falta rediseñar primero el almacenamiento del AST para preparar ese trabajo.
