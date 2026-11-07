# Auditoría del paso de objetos en `bootstrap/`

**Alcance:** el compilador nativo escrito en Estatic (`bootstrap/**.ets`, 45 ficheros, 9.192 call sites).
**Pregunta:** ¿el compilador reutiliza `ref<T>` / `constRef<T>` cuando debe, o lo pasa todo por copia?
**Método:** análisis estático sobre el AST real (lexer + parser de stage 0), clasificando cada
parámetro formal por su modo real de paso en C++ y cruzando la firma con el cuerpo del callee.
Verificado contra el C++ generado (`src/cli.ts` → `g++`).

> No se ha modificado ningún fichero del compilador. Este documento es solo lectura.

---

## 1. Veredicto

**No. El compilador pasa prácticamente todo por copia.** El uso de préstamos en `bootstrap/`
es testimonial y está concentrado en un solo módulo.

| Modo de paso en C++ | Parámetros | % |
|---|---:|---:|
| `T` — **copia** | 1426 | **95.5 %** |
| `const T&` — `constRef<T>` | 48 | 3.2 % |
| `T&` — `out` (ya es referencia) | 20 | 1.3 % |
| `T&` — `ref<T>` | **0** | **0 %** |
| `std::unique_ptr<T>` — `ptr<T>` | 0 | 0 % |

Sobre **9.192 call sites** analizados:

| Categoría | Call sites | Firmas |
|---|---:|---:|
| Copia real de un objeto pesado a un parámetro por valor | **993** | 115 |
| Retorno de un objeto pesado por valor | **1454** | 101 |
| Paso por referencia (correcto) | 404 | 25 |
| **Mutaciones perdidas** (el callee muta un objeto recibido por valor) | **0** | 0 |

**Lo bueno:** no hay ni una sola mutación perdida. Ningún callee modifica un objeto que el
caller le pasó por valor esperando que el cambio se vea. La semántica de ownership es correcta;
el problema es puramente de **rendimiento**.

**Lo malo:** `ref<T>` (préstamo mutable) **no se usa ni una vez** en todo el compilador, y
`constRef<T>` se usa solo en `bootstrap/checker/`, `bootstrap/ir/` y `bootstrap/modules/`.

---

## 2. El caso caliente: `AstNode`

`AstNode` (`bootstrap/parser/parser.ets:22`) es el tipo que más se copia del compilador:

```ts
export class AstNode {
  kind: NodeKind; start: ParserToken; end: ParserToken; analysisStart: number;
  analysisEnd: number; generatedId: string; generatedStart: ParserToken; generatedEnd: ParserToken;
  attributes: AstAttribute[]; edges: AstEdge[];
}
```

Contiene **3 `ParserToken`** (cada uno con 2 `std::string` + 6 números), **1 `std::string`** y
**2 vectores** de objetos con heap. Copiar un `AstNode` son ~4Reserve de string + 2 reservas de
vector: **≈6 asignaciones de heap por copia**.

### 2.1 `bindingChild` — 307 copias por compilación

```ts
// bootstrap/binder/binder.ets:47
export function bindingChild(node: AstNode, role: EdgeRole): number {
  for (const edge of node.edges) { if (edge.role == role) return edge.node; } return -1;
}
```

Solo lee `node.edges`. El C++ generado por stage 0 lo confirma:

```cpp
static inline double bindingChild(AstNode node, std::string role);   // ← POR VALOR
...
print(bindingChild(n, std::string("Args")));                          // ← copia el AstNode entero
```

**Candidatos:** `bindingChild(node: constRef<AstNode>, role: EdgeRole): number`.
Es el único cambio con impacto real: 307 call sites en el bucle más caliente del binder y del checker.

### 2.2 La familia `node()` — 533 retornos por valor

Los accesores que devuelven un nodo del AST lo devuelven **por valor**:

| Método | Fichero | Call sites |
|---|---|---:|
| `NativeChecker.node()` | `bootstrap/checker/checker.ets:24` | 194 |
| `SafetyAnalyzer.node()` | `bootstrap/checker/safety.ets:58` | 122 |
| `IrLowering.node()` | `bootstrap/ir/lower.ets:46` | 70 |
| `EffectAnalyzer.node()` | `bootstrap/checker/effects.ets:29` | 57 |
| `NativeComptime.node()` | `bootstrap/checker/comptime.ets:35` | 51 |
| `Parser.node()` | `bootstrap/parser/parser.ets:126` | 39 |

```ts
node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
```

Cuando el resultado se usa directamente (`bindingChild(this.node(id), role)`) el compilador C++
aplica *copy elision* y no copia; el coste aparece cuando el resultado **se materializa en un
lvalue** (`const n = this.node(id);`) — ahí hay copia o movimiento completo del `AstNode`.

---

## 3. Siguientes culpables (por número de copias)

| Firma | Fichero:línea | Tipo | Call sites | Qué hace el callee |
|---|---|---|---:|---|
| `bindingChild(node: AstNode, role)` | `binder/binder.ets:47` | `AstNode` | **307** | lee `node.edges` |
| `IrVerifier.error(source: IrSource, message)` | `ir/verify.ets:18` | `IrSource` | 90 | lo copia dentro de un `IrIssue` |
| `Parser.add(kind, start: ParserToken, end: ParserToken)` | `parser/parser.ets:123` | `ParserToken` | **65 + 60** | lo guarda en el `AstNode` |
| `bindingNumbers(values: number[])` | `binder/format.ets:6` | `number[]` | 36 | recorre el array |
| `SafetyAnalyzer.expression(active: number[])` | `checker/safety.ets:933` | `number[]` | 29 | recorre el array |
| `Parser.reportAt(token: ParserToken)` | `parser/parser.ets:107` | `ParserToken` | 28 | lee el token |
| `NativeComptime.put(value: ConstantValue)` | `checker/comptime.ets:59` | `ConstantValue` | 27 | lo guarda |
| `Parser.setEnd(cursor, end: ParserToken)` | `parser/parser.ets:130` | `ParserToken` | 11 | lo asigna |
| `formatDiagnostic(diagnostic: SourceDiagnostic)` | `frontend/frontend.ets:78` | `SourceDiagnostic` | 5 | lo formatea |
| `formatIr(project: IrProject)` | `ir/format.ets:6` | `IrProject` | 4 | lo recorre entero |

Detalle de dos casos típicos:

```ts
// bootstrap/ir/verify.ets:18  — IrSource se copia DOS veces: al entrar y al construir IrIssue
error(source: IrSource, message: string): void { this.issues.push(new IrIssue("IR_INVALID", message, source)); }

// bootstrap/parser/parser.ets:123 — cada ParserToken copiado trae 2 std::string (2 heap) cada uno
add(kind: NodeKind, start: ParserToken, end: ParserToken): number {
  this.nodes.push(new AstNode(kind, start, end)); return this.nodes.length - 1;
}
```

Y las funciones que **devuelven** colecciones por valor, copiando el vector en cada llamada:

| Firma | Fichero:línea | Call sites |
|---|---|---:|
| `genericArguments(text)` → `string[]` | `checker/types.ets:159` | 64 |
| `splitTypes(text)` → `string[]` | `checker/types.ets:3` | 61 |
| `functionParams(text)` → `string[]` | `checker/types.ets:28` | 52 |

---

## 4. Lo que ya está bien

No todo está mal. Estas firmas ya evitan la copia y sirven de referencia del estilo deseado:

```ts
// bootstrap/checker/ownership.ets:10  — el grafo, el binding y el resultado por CONST REF
export function resourceType(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>,
                              checked: constRef<CheckResult>, text: string, history: string[]): boolean

// bootstrap/ir/verify-shapes.ets:3
export function irAssignable(project: constRef<IrProject>, from: number, to: number, depth: number): boolean

// bootstrap/ir/verify-borrows.ets:4
export function verifyBorrowRoutes(project: constRef<IrProject>, f: IrFunction): IrIssue[]

// bootstrap/checker/safety.ets:1172  — el resultado se escribe con `out`, que ya es T&
export function validateSafety(graph: ModuleGraph, binding: BindingResult, out result: CheckResult, trace: boolean = false): void
```

**404 call sites ya pasan por referencia** (25 firmas distintas), todas con `constRef<T>` o `out`.

El patrón `out` merece atención: `out result: CheckResult` se traduce a `CheckResult&` en C++
(`src/codegen/cpp-parameters.ts`), así que **no copia**. Es la forma barata de devolver un objeto
grande mutado, y ya se usa 20 veces.

---

## 5. Por qué el compilador no detecta esto solo

El dialecto **no** convierte implícitamente `T` en `const T&` (V22, "T significa copia"), y
eso está bien: es una decisión explícita de diseño. Pero el compilador no ofrece todavía una
forma de **detectar** el abuso, así que el coste se paga en silencio:

- `bootstrap/checker/SAFETY.md:56-68` describe las reglas de préstamo, pero no hay ningún
  diagnóstico que diga "este parámetro por valor es un objeto grande que solo se lee".
- Las aserciones de `T&`/`const T&` que existían (`test/unit/codegen.test.ts:392-414`) cubrían
  **solo stage 0**; el pipeline nativo no tenía ninguna aserción sobre el texto del C++ emitido.
  La comprobación que faltaba vive ahora en `scripts/check-ref-parity.ts`, **fuera de `npm test`**
  a propósito: `src/` solo existe hoy para compilar `bootstrap/`, así que la paridad entre ambos
  pipelines es un invariante transitorio y no algo que deba imposto a la suite para siempre.

### Corregido en esta rama: el contrato de paso ya es el mismo en los dos pipelines

La auditoría destapó una divergencia real: el backend nativo emitía `ref<T>` como `T*` y
`constRef<T>` como `const T*`, mientras stage 0 emite `T&`/`const T&` (`src/codegen/cpp-types.ts:114-122`).
El dialecto promete lo mismo en los dos pipelines, así que **lo que se escribe es lo que se obtiene**.

La causa era estructural, no un descuido: `ets::ir::Slot<T>` es `std::optional<T>` y no admite
referencias (`runtime/ets_ir.hpp:34`), y el op `borrow`/`address` solo puede producir un puntero
(`src/codegen/ir/cpp-generator.ts:182`). Por eso el shape `ref` del IR está **partido** en dos cosas
que compartían la misma función `type()`:

| Papel | Antes | Ahora |
|---|---|---|
| El **binding** de la firma (lo que ve el callee) | `T*` | **`T&` / `const T&`** |
| El **valor** interno del shape (slots y temporales de préstamo) | `T*` | `T*` (sin cambios) |

El arreglo separa ambos: `parameterType()` se usa solo para las firmas y `type()` sigue devolviendo
punteros para el interior del IR. El slot del parámetro guarda el puntero al referente
(`std::addressof(a0)`) y los call sites desreferencian al llegar a la firma.

| Modificador | Stage 0 | Nativo (antes) | Nativo (ahora) |
|---|---|---|---|
| `ref<T>` | `T&` | `T*` | **`T&`** |
| `constRef<T>` | `const T&` | `const T*` | **`const T&`** |
| `ptr<T>` | `std::unique_ptr<T>` | `std::unique_ptr<T>` | `std::unique_ptr<T>` |
| `constPtr<T>` | `std::unique_ptr<const T>` | `std::unique_ptr<const T>` | `std::unique_ptr<const T>` |
| `T` | `T` (copia) | `T` (copia) | `T` (copia) |
| `out T` | `T&` | `T*` | **`T&`** |

Los parámetros `out` también se alinean: el checker nativo reescribe `out T` a `ref<T>`
(`bootstrap/checker/checker.ets:437`), así que antes emitían `T*` cuando stage 0 emite `T&`.

El contrato llega también a los **callbacks**: el shape `function` del IR construye el
`std::function` de una lambda, y ese tipo es observable. Un callback `(x: constRef<T>) => void`
se declara `std::function<void(const T&)>` — igual que stage 0 (`src/codegen/cpp-types.ts:130`) y
que los overloads del runtime (`runtime/ets_collections.hpp:66`). Por eso el shape `function` usa
también la forma observable, y no la punteada que usaba antes.

Se aplicó el mismo cambio en los dos backends nativos — el de TypeScript
(`src/codegen/ir/cpp-generator.ts`) y el C++ standalone (`src/codegen/ir/native/generator.cpp`) —
y se añadió `scripts/check-ref-parity.ts`, que comprueba el contrato de los seis modificadores
(`ref`, `constRef`, `ptr`, `constPtr`, valor y `out`) en los dos pipelines.

Esa comprobación **no forma parte de `npm test`**: es manual a propósito. `src/` existe hoy
únicamente para compilar `bootstrap/`, así que la igualdad entre ambos pipelines es transitoria:
cuando el compilador nativo sea el único que evoluciona, el script debe dejar de usarse.

---

## 6. Recomendación

Ordenadas por impacto, sin cambiar la semántica del dialecto (todo esto es seguro: un
`constRef<T>` donde hoy hay `T` por valor **no** cambia el comportamiento, solo evita la copia):

| # | Cambio | Copias evitadas | Riesgo |
|---|---|---:|---|
| 1 | `bindingChild(node: constRef<AstNode>, role)` | 307 | Bajo — solo lee `node.edges` |
| 2 | `node(...)` devuelve `AstNode` por valor en 6 clases → devolver por `constRef` o usar un índice | 533 (parcial) | Medio — toca el corazón del checker |
| 3 | `Parser.add(kind, start: constRef<ParserToken>, end: constRef<ParserToken>)` | 125 | Bajo |
| 4 | `IrVerifier.error(source: constRef<IrSource>, message)` | 90 | Bajo — pero `IrIssue` también debe guardar por referencia |
| 5 | `genericArguments` / `splitTypes` / `functionParams` devuelven `string[]` por valor | 177 | Medio — devolver `constRef<string[]>` cambia la ergonomía |
| 6 | `bindingNumbers`, `SafetyAnalyzer.expression` (`number[]`) | 65 | Bajo |

Los puntos 1, 3 y 4 son cambios de una línea por firma y de riesgo bajo. El punto 2 es el que
manda en rendimiento, pero exige decidir si `node()` debe devolver una vista o un índice.

**Nota de alcance:** nada de esto es un error de corrección. El compilador hoy es *correcto*,
solo que spends copias innecesarias en su camino más caliente. El cambio es una optimización
con el mismo contrato observable.

---

## 7. Reproducir

```bash
node --experimental-strip-types /workspace/audit/audit-object-passing.ts bootstrap
```

El script no modifica nada: parsea `bootstrap/**.ets` con el lexer/parser de stage 0, clasifica
cada parámetro por su modo de paso, y cruza las firmas con los cuerpos para detectar copias
y mutaciones perdidas. Informe completo en `report-bootstrap.txt`.

---

## 8. Estado de la suite de tests (baseline para CI)

`npm test` en `main` (21 min, 3858 tests): **3735 pass / 123 fail**. Ningún fallo procede de este
informe; la rama de auditoría solo toca `docs/`.

Los fallos se reparten así:

| Causa | Nº | Comentario |
|---|---:|---|
| Entorno: falta `libuv1-dev` (`uv.h: No such file or directory`), drogon y red | la mayoría | Pasan en CI con `libuv1-dev libcurl4-openssl-dev libssl-dev` |
| Decisión de diseño: `Promise` no se declara en `types/estatic.d.ts` | 3 | `binder: builtin declarations stay synchronized with canonical d.ts` y dos de `init-project`. El `d.ts` omite `Promise` **a propósito** (choca con el `Promise` estándar del servidor de TS), así que el test es quien está desactualizado. **Corregido en esta rama**: se excluye `Promise` de la comparación, no se añade al `.d.ts`. |
| Decisión de diseño: `includes` con offset opcional | 1 | `checker: string includes keeps the required offset parameter` esperaba un error `/Aridad/` para `includes("b")`, pero el offset es opcional como en JS y TS. **Corregido en esta rama**: el test ahora acepta las dos formas. |

Esto es relevante para CI: **la suite está roja en `main` hoy**, y un workflow que la ejecute
tal cual fallará hasta que se actualicen esos tests o se acepte el estado.
