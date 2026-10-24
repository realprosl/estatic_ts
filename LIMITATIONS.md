# Limitaciones del dialecto Estatic

El dialecto "Estatic" es un subset curado de TypeScript con salida a C++20.
NO es un transpilador TS-completo: muchas features de TypeScript se han
rechazado explícitamente para mantener las garantías del dialecto (RAII,
sin herencia y sin tipos dinámicos generales). Algunos nodos internos usan
`any` como recurso de implementación, pero no equivale al `any` abierto de
TypeScript.

Las secciones generales de CLI/emisión y evaluador principal describen stage 0
(`src/`), salvo indicación contraria. El frontend ETS tiene su propio
[inventario auditado](./bootstrap/PENDING.md) y
[revisión reproducible](./bootstrap/audit/FRONTEND-REVIEW.md): incluye switch,
consultas typeof cualificadas, expansión higiénica y un único evaluador nativo
para comptime/@etsgen. No se deduce la cobertura ETS de los límites del backend TS.
IR y emisión desde las tablas nativas aún no están implementados.

Este documento está dividido en tres secciones:

- **✅ Implementado** — features de TS soportadas. Para uso y ejemplos ver `README.md`.
- **❌ Rechazado por diseño** — features que el dialecto NUNCA tendrá (con motivo).
- **🟡 Pendiente / TS no cubierto** — features en TS que aún no están en el dialecto.

> Este doc se sincroniza con el código vía `scripts/check-docs-sync.ts`. Si
> encuentras una feature implementada que no aparece en "Implementado", o una
> limitación que el código ya no aplica, ejecuta el check y abre una PR.

---

## ✅ Implementado

Lista no exhaustiva — ver `README.md`, `examples/` y los nodos AST en
`src/ast/nodes.ts` para la cobertura completa.

### Sistema de tipos

- Tipos primitivos: `number`, `string`, `boolean`, `void`.
- Genéricos con constraints (`<T extends X>`) y parameter packs (`<T...>`).
- Sobrecargas de funciones libres resueltas estáticamente por firma.
- Type aliases (`type X = …`).
- **Unions** (`A | B | C`) e **intersecciones** (`A & B`) de tipos.
- **Satisfies operator** (`expr satisfies T`, TS 4.9).
- `typeof` valor y `typeof` tipo (`T typeof expr`).
- `instanceof` para validar miembros de un union contra una clase.
- `readonly` en campos de clase.
- Optional parameters (`name?: T`).
- Tipos literales numéricos no decimales (`0xFF`, `0b1010`, `0o17`).

### Clases y objetos

- Clases por valor (sin herencia, sin vtable) — `class X { field: T; method(): R }`.
- Constructores (`constructor(params) { this.x = params.x; }`).
- Decoradores simples (`@deprecated` emite warning; `@sealed` no-op).
- Interfaces estructurales (sin `implements` explícito).
- Composición de campos (la clase satisface una interface por estructura).
- Modificadores `public`, `private` y `protected`. Al no existir herencia,
  `protected` se comporta de forma conservadora como acceso de la clase.
- Campos y métodos `static`.

### Funciones y control de flujo

- `function`, arrow functions, closures, lambdas con `std::function`.
- Las capturas de lambdas se resuelven por identidad de símbolo y respetan
  ámbitos y sombreado. Las capturas mutadas usan referencias: no hay análisis
  de escape completo que garantice su lifetime si la closure sobrevive al local.
  Una protección parcial rechaza retornos de tipo función o array dinámico de funciones cuya procedencia
  conocida contiene capturas por referencia (`E4210`); no protege escapes por
  campos, otros contenedores o callbacks retenidos. Ver
  [`docs/closure-return-safety.md`](docs/closure-return-safety.md).
  Ver [`docs/closure-captures.md`](docs/closure-captures.md).
- Parámetros rest (`...args: T[]`) y variádicos genéricos.
- `if/else`, `while`, `for`, `for..in`, `for..of`, `for await..of`.
- `break`, `continue` validados por contexto.
- **Operador ternario** `cond ? then : else`.
- **Match expressions** — V30.5.1 unifica **una sola forma válida**: la
  V23 `match(value, [when(pat, cb), otherwise(cb)])` o
  `match(value, "key", [when(pat, cb)])` con discriminator. Es TS-compatible
  (CallExpression regular, no keyword). La forma V2 destructurada
  `match (r) { case { kind: ... }: ...; }` se **eliminó en V30.5.1** con
  error E4410. La forma TC39 `match (x) { when (pat) => r; }` se eliminó
  en V23.
- `switch / case / default` sobre enums, strings y números.
- `delete` sobre propiedades dinámicas de Map/Set.
- `await` y `async function` (compilados a corutinas C++20).
- `for await (const x of Promise<T>[])` para iterar arrays de promesas.
- **Narrowing de tagged unions** (V1.4): si `if (r.ok == true)` marca la
  expresión como narrowada y `r.value` resuelve al tipo del payload sin
  cast explícito. Funciona con la sintaxis object-variant
  `{ ok: true; value: T } | { ok: false; error: E }` (V1.4) y con unions
  nombradas (V1.2+).
- **Escape implícito** (V8.0, deprecado en V22): si la firma de
  retorno es `Unq<T>` o `Rc<T>`, `return new T()` o `return x` se
  envolvía automáticamente con `unSome<T>(...)` o `rcShare<T>(...)`.
  V22 elimina `Unq<T>` y `Rc<T>`; la regla se reemplaza por
  `return new T()` que infiere `ptr<T>` por contexto, y
  `make_unique<T>(...)` se aplica automáticamente cuando el destino
  es `ptr<T>` (`std::unique_ptr<T>`). Ver [CHANGELOG.md](./CHANGELOG.md)
  y `docs/memory-model.md`.

### Strings y literales

- String literals con escapes (`\n`, `\t`, `\"`, etc.).
- **Template literals con interpolación** `` `Hola ${name}` `` y anidamiento.
- Multi-línea literal.

### Colecciones

- **`arr.filter((x: T) => boolean): T[]`** sobre arrays `T[]`. Se emite a
  `ets_filter_vec<T>` (V7.0).
- **`arr.map<U>((x: T) => U): U[]`** — transforma cada elemento. Se emite
  a `ets_map_vec<T, U>` (V7.0).
- **`arr.reduce<U>(init: U, op: (acc: U, x: T) => U): U`** — pliega el
  array respetando `init` si está vacío. Se emite a `ets_reduce<U, T>` (V7.0).
- **Pipelines eager**: `arr.filter(p).map(f).reduce(init, op)` conserva las
  etapas completas y sus vectores intermedios. Retirada la fusión AST antigua:
  intercalaba efectos de callbacks y perdía capturas locales. No se mueve ni
  reutiliza implícitamente el array inicial. La fusión segura sigue pendiente;
  ver [`docs/chained-method-optimization.md`](docs/chained-method-optimization.md).
- `arr.length` (alias del builtin `length(arr)`).
- `forEach`, `find` (devuelve `Optional<T>`), `some`, `every`, `includes`.
- `slice(start, end)`, `concat(...arrays)` y `flatMap<U>(callback)`.
- `sort(comparator)` in-place. A diferencia de JavaScript, el comparador es
  obligatorio; `sort()` sin argumentos todavía no está soportado.

### Operadores

- Aritméticos: `+ - * / %`.
- Relacionales: `< <= > >= == !=`.
- Lógicos: `&& || !`.
- Bitwise: `& | ^ ~ << >>` (TS 5.x).
- **Nullish coalescing `??`** sobre `Optional<T>`.
- **Optional chaining `?.`** sobre `Optional<T>`.
- Ternario `cond ? a : b`.

### Módulos

- `export` de declaraciones top-level.
- `export default` de funciones/clases nombradas o anónimas y expresiones.
- `export { x as y }` resuelve la identidad local, incluidos imports reenviados.
- Sistema de módulos con `moduleRoots` y aliases (`src/modules/`).
- `import` interno para resolver referencias (no dinámico).
- `import { X as Y }` e `import type { X as Y }` resuelven aliases en el AST.
- `import * as model` permite miembros, tipos y constructores estáticos; no
  es un objeto runtime ni admite índices calculados. Ver `docs/import-aliases.md`.
- Imports default y mixtos, re-exports nombrados/default, `export *` y
  `export * as model`, incluidos namespaces estáticos anidados.
- Descubrimiento por tokens de imports/re-exports multilínea, conservando
  offsets y saltos de línea. Ver `docs/module-exports.md`.
- Identidades estables de módulo derivadas de la ruta para evitar colisiones
  entre archivos con el mismo basename.

Las publicaciones generadas se pueden importar anunciándolas con
`export { nombre }`. El aislamiento de nombres fuente homónimos se aplica
antes del análisis combinado; ver `docs/module-symbols.md`. Los módulos
cíclicos y las identidades de símbolo universales siguen pendientes.

### Terminal (`console`)

- Global `console` (ampliación del logging existente): salida, colores/estilos, cursor, limpieza y dimensiones.
- Header C++ propio bajo demanda solo para métodos de terminal; el logging
  habitual no lo activa. Sin dependencias de terceros. Los pipes no
  reciben secuencias de control; el texto sigue disponible.
- Probado en Linux con PTY; Windows/macOS implementados sin validación nativa.
- Pendientes teclado, modos raw/echo y pantalla alternativa. La restauración al
  salir es best effort y no restaura un snapshot del estado previo en POSIX.
  Ver `docs/terminal.md`.

### Stdlib y runtime (`runtime/`)

- `Result<T>`, `Optional<T>`, `Task<T>` (Promise C++).
- `Map<T>`, `Set<T>` con `forEach`, `has`, `get`, `set`, `delete`, `size`.
- `etS::concat` para strings heterogéneos.
- `numberToString`, `length`, `charAt`, `concat`.
- **Memory Model v2 (V22)**: `ptr<T>` (`std::unique_ptr<T>`),
  `constPtr<T>` (`std::unique_ptr<const T>`), `ref<T>` (`T&`),
  `constRef<T>` (`const T&`). Sustituyen a `Un<T>`, `Rc<T>`, `Mut<T>`,
  `MutRef<T>`. Ver `docs/memory-model.md` para el contrato completo.
- Helpers async: `all(tasks)`, `race(tasks)`, `sleep(ms)`.
- File I/O: `readFile`, `writeFile`, `appendFile`, `copyFile`, `moveFile`,
  `removeFile`, `fileExists` (+ variantes `Async`).
- Console: `print`, `printError`, `write`, `writeError` + `console.log/info/debug/trace/warn/error`.
- Servidor HTTP: cpp-httplib por defecto y Drogon con `@cpp_drogon`.
  `http-server.ets` es un ejemplo manual sobre TCP, no un tercer backend.
- TLS: `tls-server.ets` con `TlsContext` y `TlsConnection`.
- JSON.parse con árbol dinámico `JsonValue`.

### Compilador y tooling

- CLI `init` para scaffolding de proyectos.
- Modo incremental con cache SHA-256 por módulo.
- Build unitario con `--unity` para inspección.
- Suite de tests con `node:test` y golden files.
- Informe de compilación JSON (`build/.estatic/transpiler-report.json`).
- Tree-sitter grammar para editores (vendored en `third_party/`).
- Evaluación durante compilación mediante `comptime()`, funciones
  `@comptime`, generación `@etsgen` y escape C++ `@cppgen`.

---

## ❌ Rechazado por diseño

Estas features **no se implementarán** — son incompatibles con las garantías
del dialecto (RAII puro, sin vtable, sin tipado dinámico).

| Feature rechazada | Razón |
|---|---|
| `Object`, `any`, `unknown` como tipos dinámicos generales | Sin tipado dinámico abierto; para datos externos se usa `JsonValue` o tipos explícitos |
| `throw` / `try` / `catch` | Rompe RAII — usar `Result<T, E>` |
| Herencia (`extends`, `implements`) | Polimorfismo dinámico requiere vtable |
| `>>>`, `===`, `!==` | Operadores ambiguos o coerción no deseada en C++ |
| `arguments` | C++ no tiene arguments object — usar rest (`...args`) |
| `eval` | Seguridad + rendimiento |
| `function*` (generadores) | Lazy iteration no encaja con RAII — usar async/Promise |
| Tagged templates (`tag\`...\``) | Sin uso idiomático claro en el dialecto |
| Dynamic imports (`import("...")`) | El grafo de módulos se resuelve estáticamente durante la compilación |

---

## 🟡 Pendiente / TS no cubierto

Features de TypeScript presentes en versiones modernas (TS 3.x+ / 4.x / 5.x)
que el dialecto aún no implementa. **Se aceptan contribuciones** en estas
áreas si no rompen las garantías del dialecto.

### Sistema de tipos avanzado

- `as` / `<T>x` type assertions — se prefiere `match` para narrowing.
- `const` type parameters (`<T const>`).
- Conditional types (`T extends U ? X : Y`) en tipos.
- Mapped types (`{ [K in keyof T]: V }`).
- `keyof T` operator.
- Utility types (`Partial`, `Pick`, `Record`, `Required`, `Omit`).
- Template literal types (`` `prefix_${T}` ``).
- `infer U` en conditional types.
- Variadic tuple types (`[...T, ...U]`).
- Tuples con spread variádico (`[T, ...U]`).
- `if (typeof x === "string") { x.toUpperCase() }` — narrowing por tipo (cubierto por V1.4 para tagged unions con discriminador literal).
- Exhaustiveness checking con `never` — el dialecto no valida la rama `_ =>` por cobertura exhaustiva; sigue siendo pattern matching por igualdad.
- Type predicates `x is T`.

### Clases y objetos

- Getters / setters (`get` / `set`).
- Clases y métodos `abstract`.
- Index signatures `[key: string]: T`.
- Override de métodos (no aplica — sin herencia).

### Memory Model v2 — límites pendientes

V22 introdujo `ptr<T>`, `constPtr<T>`, `ref<T>`, `constRef<T>` y la
semántica de copia para `T`. El checker implementa value semantics,
`make_unique`, tracking de moves, conflictos `ref + ref`/`ref + constRef` y
non-lexical lifetimes conservadores. También impide almacenar o devolver
préstamos y aplica restricciones en closures, genéricos y funciones async.
Siguen pendientes:

- Análisis de lifetimes interprocedural y parámetros de lifetime.
- Permitir retornos o campos prestados cuando exista una demostración formal
  de su duración.
- **`Rc<T>`** (shared ownership): deprecado en V22. Se rediseñará con
  `weak<T>` en un PR futuro.
- **Nullable ptr explícito**: `let p: ptr<T> = null` no se admite
  todavía. El estado vacío se obtiene únicamente vía `move()`.
- **Lifetime parameters** (`<'a>`): no soportados.

> Los códigos se interpretan junto con la fase y el contrato del frontend.
> En bootstrap, E4102/E4103 cubren usos movidos/posiblemente movidos, E4203
> almacenamiento de préstamos y E4204 restricciones de suspensión. E4401
> identifica exposición de tipos privados; no se agrupa E4400–E4406 como una
> familia común de APIs legacy. `out` conserva en el frontend nativo su contrato
> vigente de referencia mutable de entrada/salida, descrito en
> [checker/README.md](./bootstrap/checker/README.md).

### Módulos y tooling

- Dynamic imports.
- El análisis todavía usa un AST combinado con nombres internos normalizados,
  sin identidades de símbolo universales en todas las APIs. Los homónimos fuente
  ya se aíslan, incluidos los privados. Las publicaciones generadas sin reserva
  de export pueden seguir produciendo `MODULE_SYMBOL_COLLISION`. Ver
  `docs/module-symbols.md`.
- Triple-slash directives.
- `globalThis` / `global`.

### Stdlib y runtime

- `fetch` nativo (usar `runtime/ets_net.hpp` o librería externa).
- Streams / `ReadableStream`.
- Workers / `SharedArrayBuffer`.
- `Buffer` (Node-style).

### Async y HTTP

- Los handles internos de libuv usan ya almacenamiento estable y cierre
  diferido. La corrección necesita validación final con ASan/UBSan en un
  entorno con libuv antes de considerar seguro el runtime concurrente. Ver
  `docs/MEMORY-AUDIT.md`.
- `race` conserva y drena de forma segura las tareas perdedoras, pero todavía
  no las cancela. Una operación que nunca termina puede quedar retenida hasta
  destruir el event loop.
- Los únicos backends del servidor HTTP son cpp-httplib y Drogon. Se ha
  eliminado el servidor experimental antiguo; no se mantiene como fallback.
- El backend Drogon consulta la query sin caché persistente. Su helper todavía
  devuelve valores crudos, sin decodificar `%XX` ni convertir `+` en espacio;
  no ofrece aún la misma semántica URL-decoded que los otros backends.
- El backend cpp-httplib aplica 8 workers, 128 conexiones pendientes, 1 MiB de
  cuerpo y timeouts explícitos. No hay aún configuración desde `.ets`, deadline
  absoluto de petición ni política equivalente validada para Drogon. Ver
  `docs/http-limits.md`.

### Evaluación `comptime`

- El AST fuente se valida antes de la evaluación y el AST transformado se
  valida de nuevo después. La ruta tipada i64/u64 del intérprete principal
  almacena valores exactos BigInt y conserva decimales exactos en el AST;
  ver `docs/comptime-exact64.md`.
- Las operaciones i64/u64 anotadas usan cálculo interno exacto para
  aritmética, bits y división entera, con errores tipados para overflow,
  conteos de shift inválidos y conversiones a number que perderían precisión.
  Las promociones tipadas i8..u64/f32/f64/number, destinos flotantes y
  callbacks arrow se detallan en `docs/comptime-numeric-callbacks.md`.
  No se unifica el mini-evaluador de @etsgen ni se completa la auditoría de
  Math, APIs externas y bitwise legacy sobre number.
- Los símbolos de varios módulos se recolectan por nombre en un ámbito
  combinado, por lo que aún no existe higiene completa entre módulos. El
  loader normaliza los destinos de aliases/namespaces y rechaza las colisiones
  top-level restantes antes de evaluar el programa.
- Los evaluadores estáticos utilizan la sobrecarga seleccionada por el checker
  para cada llamada. Las APIs directas `evaluateComptime`/`evalEtsgenCalls`
  necesitan ese resolver si hay varias firmas; sin él, emiten
  `COMPTIME_OVERLOAD_UNRESOLVED` en vez de elegir la última declaración. Esto
  no amplía el soporte de defaults, parámetros opcionales ni packs durante la
  ejecución estática. Ver `docs/comptime-overloads.md`.
- Los ámbitos léxicos de bloques, ramas y contadores `for` están aislados y
  las declaraciones locales aplican zona muerta temporal a lecturas y
  escrituras, incluido destructuring y el inicializador de `for`.
- Las entradas anidadas al intérprete guardan y restauran el ámbito capturado.
  Las llamadas decoradas que dependen de parámetros o locales del caller se
  posponen hasta disponer de sus valores reales.
- La decisión de aplazar una llamada usa el código de diagnóstico estable
  `COMPTIME_VALUE_UNAVAILABLE`, no coincidencias sobre el mensaje mostrado.
- `break` y `continue` tienen señales separadas de `return` y están cubiertos
  para `for` y `while`, incluidos bucles anidados. No atraviesan límites de
  función ni sustituyen el control de límites de instrucciones.
- El intérprete principal aplica los contadores por evaluación raíz; los
  helpers y callbacks comparten el presupuesto de su caller. Los límites de
  valores cuentan payload UTF-8, resultados y crecimiento de colecciones, pero
  siguen siendo conservadores y acumulativos dentro de esa raíz, no una
  medición de memoria viva ni un límite agregado del programa. Los valores
  cíclicos no pueden convertirse en literales y se rechazan. Ver
  `docs/comptime-values.md` y `docs/comptime-budgets.md`.
- `@cppgen` inyecta C++ literal y evita las garantías del checker. Debe
  tratarse como una operación insegura.
- `@etsgen` usa por ahora un evaluador reducido y genera código desde texto;
  las sentencias generadas se validan semánticamente en contexto y se
  aplica higiene léxica a bindings privados. `@etsPublish` publica en el caller
  y `etsDefinition` selecciona valores/funciones del módulo de definición;
  la higiene modular completa sigue pendiente. Los nombres generados pueden
  importarse si el productor los anuncia con `export { nombre }` y los publica
  mediante `@etsPublish`; ver `docs/generated-module-exports.md`. Las
  funciones genéricas de definición ya se enlazan entre módulos, incluidas sus
  dependencias privadas. Ver
  `docs/etsgen-publication.md` y `docs/etsgen-hygiene.md`.
  Genera Estatic y conserva su AST con
  procedencia, sin extracción intermedia de C++; ver `docs/etsgen-ast-pipeline.md`.
  El CLI materializa mapas C++ por tramos y directivas `#line`, con ETS original
  y cadena de llamadas. Faltan precisión por token/columna, cobertura completa,
  enlace y stacks runtime; ver `docs/etsgen-cpp-source-maps.md`.
  Tiene presupuestos propios de
  instrucciones, profundidad y valores, y un límite UTF-8 antes de parsear el
  texto generado. No limitan el tiempo global ni todo el trabajo del parser y
  codegen. La generación requiere una llamada como sentencia, no una expresión
  con valor. Ver `docs/etsgen-limits.md` y `docs/etsgen-semantics.md`.

### Compilador

- Source maps entre `.ets` y C++.
- Backend abstracto para generar otros destinos (no solo C++).
- Cabeceras individuales por módulo para ABI precisa.

---

## Cómo se mantiene este doc

`scripts/check-docs-sync.ts` realiza comprobaciones heurísticas sobre:

- Nodos AST exportados en `src/ast/nodes.ts`.
- `TokenKind` y `KEYWORDS` en `src/lexer/token.ts`.
- Ejemplos en `examples/*.ets`.
- Afirmaciones en este `LIMITATIONS.md`.

El check detecta algunas contradicciones y referencias rotas, pero no puede
demostrar que toda la documentación sea correcta ni exigir que cada nodo se
mencione literalmente. La revisión humana y las pruebas siguen siendo la
fuente principal de verdad.

Para ejecutarlo:

```bash
node --experimental-strip-types scripts/check-docs-sync.ts
```

El test `test/unit/docs-sync.test.ts` lo invoca automáticamente y falla el
build cuando detecta una contradicción cubierta por esas reglas.
