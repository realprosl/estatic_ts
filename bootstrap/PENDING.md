# Estado de cierre del frontend bootstrap antes del IR

Revisión documental: **2026-10-24**. Base de código inspeccionada y ejecutada:
[`24e32ac`](https://github.com/realprosl/estatic_ts/commit/24e32ac005586e738c179472d41f031d265a8b47).
La revisión no cambia la revisión pública v64. Actualización de implementación:
el [IR nativo `ets-ir-2`](./ir/README.md) ya incluye lowering, verificación de recursos/préstamos y continuaciones async;
hay un backend C++ separado sobre estas tablas; su cobertura se documenta en
[ir/CPP.md](./ir/CPP.md). El cierre global sigue pendiente.

El frontend nativo ejecuta lexer, parser, cargador, expansión, binder, checker,
seguridad, efectos y evaluación comptime. Devuelve `ets-checked-2`, con ASTs por
archivo y tablas laterales. El CLI/codegen de `src/` sigue siendo stage 0;
sus límites de emisión no se atribuyen automáticamente al frontend ETS.

**La puerta de cierre anterior no se da por satisfecha con esta actualización.**
Existe IR tipado con agregados, closures, limpieza y préstamos por CFG, y un
backend C++ separado con regresiones de ejecución; véase [ir/CPP.md](./ir/CPP.md).
La revisión de frontend corrige un inventario desactualizado:
no es correcto describir todo lo listado aquí como funcionalidad ausente.

## Evidencia actual

| Comprobación repetida | Resultado |
|---|---|
| Lexer, esquema, parser, frontend, módulos, binder y checker | 2182/2182; cero fallos, cancelaciones y skips |
| Audit de obligaciones de referencia | 83/83; salida 0 |
| Audit de sintaxis | 75/75 contratos; 132/132 archivos del corpus en ambos pipelines; cero formas eliminadas |
| Corpus semántico nativo | 131/132 aceptados; `expected-errors/private-bad.ets` rechazado por acceso privado, como exige la prueba |
| Autoanálisis nativo | 23 módulos, 6594 símbolos, 75596 nodos tipados; cero diagnósticos |
| Catálogo estático de builtins | 216 contratos verificados por el generador |
| npm test global | No repetido en esta revisión; no se publica un total global nuevo |

Los comandos, límites, casos reproducibles y lectura de resultados están en
[FRONTEND-REVIEW.md](./audit/FRONTEND-REVIEW.md). El historial con totales como
18/80, 71/80, 3154/3154 o 3489/3489 se conserva en
[docs/historical/bootstrap-closure-v64.md](../docs/historical/bootstrap-closure-v64.md);
no describe esta ejecución.

## Cómo leer el inventario

- **I — implementado y ejercitado:** hay código y regresiones identificadas.
  No afirma una prueba exhaustiva ni cierra por sí solo todo el lenguaje.
- **R — contrato restringido/conservador:** la construcción existe con un límite
  explícito. No se convierte una futura extensión de Estatic/TypeScript en requisito.
- **P — obligación pendiente:** queda una cobertura, un contrato del consumidor
  o una validación concreta por cerrar. No equivale a ausencia total de la fila.

La revisión clasifica las 49 filas en **29 I, 13 R y 7 P**.

| ID | Estado | Estado observado y alcance | Implementación/evidencia |
|---|---|---|---|
| N01 | I | Literales, bases, separadores, finitud y rangos implementados. | `literalRange, numeric.ets`; [native numeric](./checker/checker.test.ts#L374) |
| N02 | I | Promociones unarias/binarias y shifts implementados; se publican tipos y conversiones. | `expressionInner, numeric.ets`; [native numeric promotes](./checker/checker.test.ts#L395) |
| N03 | I | i64/u64 exactos, límites, comparaciones mixtas y metadatos implementados. | `exactIntegers, constant.ets`; [native exact64](./checker/checker.test.ts#L425) |
| N04 | I | Conversiones de llamadas y destinos, defaults y callbacks implementadas. | `requireType, conversions, comptime.ets`; [native exact64 publishes instantiated call conversions; native comptime applies aggregate destination conversions](./checker/checker.test.ts#L454) |
| T01 | I | Arrays fijos, tamaños, índices y composición con tuplas/arrays implementados. | `annotationInner, IndexExpression`; [native fixed arrays](./checker/checker.test.ts#L461) |
| T02 | I | Enums numéricos/string, límites e identidad nominal entre imports implementados. | `symbolType, nativeNumericLiteral`; [native enums and using; native enum identity survives import aliases](./checker/checker.test.ts#L542) |
| T03 | I | Unions, payloads, constructores genéricos y discriminadores implementados. | `unionObject, symbolType, call`; [native unions](./checker/checker.test.ts#L868) |
| T04 | I | Narrowing por discriminador, typeof e instanceof implementado con invalidación conservadora. | `narrowCondition, affectsFacts`; [frontend closure; native type composition](./checker/checker.test.ts#L1391) |
| T05 | I | Compatibilidad estructural e intersecciones implementadas; conservan identidad nominal. | `compatibleInner, memberSymbol`; [native intersections](./checker/checker.test.ts#L641) |
| T06 | R | Arrays vacíos requieren contexto; objetos requieren contexto de interfaz o union. No se exige inferir shapes arbitrarias. | `ObjectLiteralExpression`; [checker accepts/rejects; frontend parity](./checker/checker.test.ts#L100) |
| T07 | I | Consultas typeof cualificadas y composición de tipos verificadas; no sigue parcial por el antiguo checkpoint. | `queryType, queries`; [native type composition](./checker/checker.test.ts#L1375) |
| T08 | I | Casts, satisfies y readonly comprobados; satisfies conserva el tipo fuente y no fabrica una conversión. | `AsExpression, SatisfiesExpression`; [native satisfies](./checker/checker.test.ts#L411) |
| G01 | I | Clases/aliases genéricos y sustitución de miembros implementados. | `instantiateType, instantiateMember`; [native generic class field has concrete instantiated type](./checker/checker.test.ts#L593) |
| G02 | R | Constraints, defaults e inferencia soportada implementados; no se anuncia inferencia genérica arbitraria ni extracción sin instanciar. | `genericParameters, inferToken, call`; [native generic; frontend closure generic function extraction](./checker/checker.test.ts#L593) |
| G03 | R | Packs y forwarding implementados, también owners con move. Almacenar préstamos en packs exige un contrato de lifetime y se rechaza. | `packSignature, argumentElements`; [frontend closure pack overload ranking](./checker/checker.test.ts#L1831) |
| G04 | R | Sobrecargas como valores con contexto implementadas. Una función genérica como valor requiere un arrow que instancie la llamada. | `IdentifierExpression, call`; [native overload values; frontend closure generic function extraction](./checker/checker.test.ts#L861) |
| F01 | I | Argumentos nombrados/rest/spread con correspondencia formal y orden fuente implementados. | `argumentPosition, argumentParameters`; [native named arguments publish correspondence without reordering AST](./checker/checker.test.ts#L719) |
| F02 | I | Parámetros opcionales modelados con Optional; aridad indirecta según tipo callable. | `parameterType, optionalParameter`; [native optional parameter](./checker/checker.test.ts#L671) |
| F03 | I | Inferencia de arrows con bloque y comprobación de rutas implementadas. | `signature, inferReturns, alwaysReturns`; [native block return inference](./checker/checker.test.ts#L701) |
| F04 | I | Funciones nombradas anidadas y capturas analizadas; no se posponen por no existir backend. | `captures, provenance`; [native safety; frontend closure](./checker/checker.test.ts#L564) |
| B01 | I | Destructuring plano, aliases, defaults y tipos de cada binding implementados. | `destructure`; [native destructuring publishes types for each binding](./checker/checker.test.ts#L513) |
| B02 | P | Binding inmutable y transferencia de using implementados. El IR materializa limpieza de recursos por salidas; no hay llamada automática a dispose. El backend C++ tiene regresiones de ejecución; falta cerrar cobertura. | `UsingDeclaration, safety.walk`; [native enums and using](./checker/checker.test.ts#L542) |
| C01 | I | for-of/for-in, bindings y flujo con puntos fijos implementados. | `statement, safety.loop`; [native iteration; frontend closure](./checker/checker.test.ts#L490) |
| C02 | I | switch, etiquetas, duplicados, default y fallthrough implementados en bootstrap; la carencia de stage 0 no es una carencia del frontend ETS. | `switchStatement, caseKey, safety.walk`; [native switch exposes canonical labels for later consumers](./checker/checker.test.ts#L564) |
| C03 | R | Match implementado y publica total/traps. La ausencia de coincidencia termina en trap; no se exige exhaustividad estática adicional. | `matchCoverage, matchCall`; [frontend closure match](./checker/checker.test.ts#L1000) |
| O01 | I | Inicialización de campos por rutas, parámetros-propiedad y readonly implementados. | `constructorInitialization, constructorFields`; [frontend closure constructor](./checker/checker.test.ts#L1496) |
| O02 | R | Efectos de métodos/resúmenes implementados; defaults no literales conservan efectos opacos y comprobación precisa cuando corresponde. | `EffectAnalyzer, methodMutates`; [frontend performance; native effects](./checker/checker.test.ts#L338) |
| L01 | R | Consumidores de arrays y efectos/callbacks implementados dentro del contrato de callables aceptados; no se promete extracción genérica sin instanciar. | `arrayCall, containerCall`; [native array callback effects propagate through consumers](./checker/checker.test.ts#L803) |
| L02 | I | Map/Set, claves/valores, métodos, delete y consumidores comprobados; se conservan restricciones de copia/retención de owners. | `NewExpression, MemberCallExpression, safety.provenance`; [native Map/Set](./checker/checker.test.ts#L776) |
| L03 | I | Optional/Result, payloads, helpers y procedencia implementados. | `containerCall, effects, comptime`; [frontend parity Optional; frontend parity Result](./checker/checker.test.ts#L1512) |
| L04 | I | ?? y ?. implementados con receptor, firma y cortocircuito; no son pendientes por las entradas antiguas. | `receivers, expressionInner, safety.walk`; [frontend closure optional call publishes unwrapped receiver and signature](./checker/checker.test.ts#L1578) |
| A01 | I | Async, firmas internas/externas, await y for-await con resultados propietarios implementados. | `asynchronous, awaitContext, taskSources`; [native async; frontend closure](./checker/checker.test.ts#L1050) |
| A02 | R | Préstamos vivos, frames y efectos de creación/cuerpo se comprueban conservadoramente. No se habilitan lifetimes a través de suspensión ni contratos opacos sin prueba. | `taskSources, safety, effects`; [native async; frontend closure](./checker/checker.test.ts#L1050) |
| S01 | I | Catálogo y contratos estáticos presentes; se verifica sincronización con stage 0 y declaraciones canónicas. | `frontend/builtins.ets, generate-native-builtins.ts`; [binder: native builtin contracts match their generated stage 0 data](./binder/binder.test.ts#L88) |
| S02 | R | Efectos de builtins implementados; externos desconocidos permanecen opacos y no se interpretan como puros. | `EffectAnalyzer.builtin, canRetain`; [native effects preserve external effects separately from symbol reads](./checker/checker.test.ts#L697) |
| X01 | I | Decoradores, objetivos, argumentos y metadatos frontend implementados; los desconocidos se diagnostican. | `decorator, decorators`; [native comptime; frontend closure](./checker/checker.test.ts#L1226) |
| X02 | P | Clases, métodos, enums, match, ámbitos y valores exactos ya se evalúan. Persisten contratos de memoria sin materializar: un parámetro constRef durante comptime produce COMPTIME_UNSUPPORTED. | `NativeComptime.invoke, containsMemory`; [native comptime; caso reproducible en la revisión](./checker/checker.test.ts#L1239) |
| X03 | I | @etsgen usa NativeComptime, expande AST y vuelve a enlazar/comprobar; higiene, publicación y procedencia implementadas. | `NativeExpansion, generatedSources, analysisRanges`; [frontend closure etsgen publishes separate lexical order ranges](./checker/checker.test.ts#L1816) |
| X04 | R | @cppgen y externos tienen contrato opaco frontend. La emisión de backend está excluida de este cierre. | `decorator, EffectSummary.external`; [frontend closure runtime aliases and ABI](./checker/checker.test.ts#L1870) |
| M01 | P | Owners directos/agregados, moves parciales y restauración implementados. El IR genera/verifica moves, drops y salidas de recursos; el backend C++ ejercita esas traducciones; falta cierre de cobertura. | `resourceType, projectionKey, safety.walk`; [native aggregate ownership; frontend closure](./checker/checker.test.ts#L900) |
| M02 | R | Préstamos locales/parámetros, sustitución genérica y readonly comprobados. Campos/retornos prestados y lifetimes explícitos siguen excluidos. | `memoryType, BorrowLease, callBorrows`; [native safety; native effects](./checker/checker.test.ts#L161) |
| M03 | R | Capturas y escapes implementados. Owners/préstamos sin lifetime demostrado y escapes de this no se aceptan por omisión. | `captures, provenance`; [frontend closure this; native safety](./checker/checker.test.ts#L1835) |
| M04 | R | Resúmenes, callbacks y efectos recursivos implementados; callbacks simbólicos recursivos no demostrados conservan E4104. La precisión general no se declara resuelta. | `effects.ets, safety.ets`; [native effects rejects a recursive wrapper around a symbolic callback](./checker/checker.test.ts#L364) |
| M05 | P | Flujo por estabilización y canales de salida implementados. El IR añade leases y endBorrow mediante liveness de CFG, con verificación independiente; queda validar su ejecución en un backend. | `loop, returns, breaks, continues, borrows`; [native safety; IR.md](./checker/checker.test.ts#L165) |
| P01 | I | Superficies públicas, aliases, genéricos y declaraciones generadas comprobados. | `publicSurface, publicType`; [native public surface; frontend closure](./checker/checker.test.ts#L1356) |
| P02 | P | AST/tablas, IDs, hashes, firmas, conversiones y correspondencias implementados. El IR valida su entrada, conserva contratos de runtime/efectos y exige capacidades de backend; la cobertura y límites se documentan en ir/README.md. | `model.ets, format.ets, module-records.ets`; [frontend provenance](./checker/checker.test.ts#L1435) |
| V01 | P | Suites, audit, corpus y autoanálisis pasan. Son muestras y regresiones; no constituyen una certificación de todas las composiciones del inventario. | `audit/, checker.test.ts`; [validación reproducida en esta revisión](./checker/checker.test.ts#L1818) |
| V02 | I | Se separa estado actual de historial y de límites de stage 0; se registra evidencia y alcance de cada fila. | `PENDING.md, FRONTEND-REVIEW.md`; [revisión documental 2026-10-24](./audit/FRONTEND-REVIEW.md) |
| V03 | P | Validación focalizada actualizada y verde. npm test completo no se ha repetido en esta revisión; las cifras globales anteriores se archivan. | `package.json`; [comandos y resultados de esta revisión](./audit/FRONTEND-REVIEW.md) |

## Qué requiere una decisión de cierre antes del IR

1. **X02:** completar o delimitar formalmente los contratos de memoria en
   comptime; no contar `COMPTIME_UNSUPPORTED` como soporte de una evaluación válida.
2. **B02/M01/M05:** fijar semántica de recursos y limpieza por salidas. El frontend
   ya comprueba flujos y movimientos. El lowering `ets-ir-2` genera CFG, leases
   y limpieza; falta validar el backend consumidor antes de anunciar ejecución
   completa de esos contratos.
3. **P02:** fijar la entrada verificable del lowering: identidad módulo/nodo,
   tipos/firmas/conversiones exigidos, estados legítimamente vacíos y rechazo
   explícito de operaciones sin contrato. Un éxito del checker no es un IR válido.
4. **V01/V03:** revisar composición y evidencia de cierre; repetir la suite global
   cuando se anuncie ese resultado. Las pruebas focalizadas actuales no sustituyen
   una ejecución global no realizada.

Las instrucciones de limpieza, `endBorrow`, layout, ABI y optimizaciones son
trabajo de IR/backend; no se exige que ya estén implementadas en el frontend.
Tampoco hace falta cambiar primero la arena `nodes[]` del parser a un árbol de
objetos propietarios. El [diseño de IR](./checker/IR.md) consume los ASTs y tablas
actuales, conserva procedencia y genera su propia representación.

## Reglas del alcance

No se exige TypeScript completo, herencia, shared ownership, lifetime parameters,
retornos/campos prestados ni inferencia de shapes sin contexto. El contrato
actual de un callback genérico puede exigir un arrow que instancie la llamada.
Los efectos externos desconocidos y los rechazos conservadores se conservan;
no se transforman en operaciones puras ni en promesas de ejecución.

La revisión documental original no implementaba IR. La implementación `ets-ir-2`
actual se documenta en [ir/README.md](./ir/README.md); hay codegen C++ en TypeScript desde las tablas ETS; siguen pendientes su autoalojamiento,
scheduler paralelo, caché semántica nativa y cambios al almacenamiento del lexer.
