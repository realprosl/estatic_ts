# `examples/` — programas de prueba

Cada `.ets` aquí es un *smoke test* de una característica del lenguaje o del
runtime. Útiles como referencia y como entrada rápida para experimentar.

## Cómo correr uno

```bash
npm start -- examples/hello.ts -o /tmp/hello.cpp
g++ -std=c++20 -fno-exceptions -pthread -I. /tmp/hello.cpp -o /tmp/hello
/tmp/hello
```

O con la configuración del proyecto (modo incremental):

```bash
npm start -- --config estatic.config.ts
```

## Índice por característica

| Fichero | Qué demuestra |
|---|---|
| `hello.ts` | Mínimo: `function`, `let`, `while`, inferencia, `print`. |
| `closures.ts` | Funciones flecha + capturas (`makeAdder`, `makeCounter`). |
| `generics.ts` | Funciones genéricas `<T>`, clases genéricas `Box<T>`, inferencia y argumentos explícitos. |
| `complete-demo.ts` | Interfaces + clases por composición + tipado estructural. |
| `composition.ts` | Composición de clases como alternativa a herencia. |
| `interface.ts` | Interface aislada y satisfacción estructural. |
| `instanceof-demo.ts` | `instanceof` con clases, uniones y primitivos. |
| `memory-values.ts` | **V22**: `T` significa copia (value semantics). |
| `memory-borrows.ts` | **V22**: `ref<T>` y `constRef<T>` modelan préstamos. |
| `memory-ownership.ts` | **V22**: `ptr<T>` para ownership exclusivo. |
| `memory-safe-ownership.ts` | Ownership completo: crear, mover y consumir un `ptr<T>`. |
| `memory-safe-borrows.ts` | Préstamos mutables e inmutables de alcance corto. |
| `memory-safe-timer.ts` | Ciclo de vida de un intervalo y cierre explícito del handle. |
| `mut-demo.ts` | **V22** (antes `Mut<T>`): `ref<T>` es una referencia mutable. |
| `mutref-demo.ts` | **V22** (antes `MutRef<T>`): `ref<T>` es T&. |
| `rc-demo.ts` | **V22** (antes `Rc<T>`): ownership exclusivo vía `ptr<T>`. |
| `un-demo.ts` | **V22** (antes `Unq<T>`): ownership exclusivo. |
| `type-aliases.ts` | `type X = …`. |
| `typeof-value.ts` / `typeof-type.ts` | `typeof` como valor y como tipo. |
| `default-type-params.ts` | Parámetros de tipo con `= default`. |
| `default-args-demo.ts` | `function f(x: T = expr)` — defaults solo en declaración. |
| `overloads-variadics.ts` | Sobrecargas por firma y packs `<...T>` + `...values`. |
| `union-demo.ts` | Tipos unión `A \| B`. |
| `intersection-demo.ts` | Genéricos con constraint `T extends A & B`. |
| `map-set-demo.ts` | `Map<K,V>` y `Set<T>` estilo JS. |
| `collections.ts` | Recorrido de arrays con `for..of`. |
| `for-of-demo.ts` / `for-in-demo.ts` | Bucles `for..of` y `for..in`. |
| `template-strings-demo.ts` | Template literals con `${…}`. |
| `mutable-borrows.ts` | Parámetros `mut`. |
| `delete-demo.ts` | `delete` sobre map/array. |
| `enum-demo.ts` | `enum` con subyacente `number`/`string`. |
| `console-demo.ts` | Facade `console.{log,info,debug,trace,warn,error}`. |
| `fs-demo.ts` | Facade `fs.*` (sync + async). |
| `result-files.ts` | Ficheros con `estatic:fs` y `Result<T, Error>`. |
| `async-await.ts` | `async`/`await` mínimo, top-level await. |
| `async-files.ts` | `readFileAsync` y compañía. |
| `cancellation.ts` | `CancellationSource`/`CancellationToken` con `*Until`. |
| `native-io.ts` | `printError`/`writeError` por stderr. |
| `http-server.ts` | Servidor HTTP/1.1 no bloqueante con `listenTcp`+`acceptTcp`+`spawn`. |
| `tls-server.ts` | Servidor TLS sobre OpenSSL. |
| `node-api-demo.ts` | Varias facades Node-style juntas. |

## Aplicación modular de referencia

`modules/main.ts` + `modules/math.ts` ejercitan el sistema de imports +
visibilidad `export`. La verificación canónica (`estatic.config.ts`
configurado) imprime `26`:

```
build/configured-app → 26   # sumRange(10) con break/continue
```

Para una integración más completa, [`todo-project/`](./todo-project/) contiene
modelo, repositorio, validación, servicio, presentación, ocho comprobaciones
ejecutables y un servidor HTTP opcional seleccionado con `@cpp_drogon`.

## Proyecto modular con el compilador nativo

[`notification-app/`](notification-app/README.md) contiene un proyecto de siete
módulos con canales SMS/correo simulados, clases, interfaces, aliases y async.
Se ejecuta con `etsc run --verbose` desde esa carpeta. Su script `run.sh`
comprueba toda la salida esperada; `npm run test:notification-app` verifica
además la recompilación, las cachés y los errores en una copia temporal.
