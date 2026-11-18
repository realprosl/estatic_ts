# Estatic TS → C++

El flujo instalado se prepara con `./install.sh`; después se trabaja con
`etsc init`, `etsc build` y `etsc run`. Ver [instalación](./INSTALL.md)
para requisitos, prefijos y el recorrido instalado sin Node.


Compilador de Estatic, con sintaxis inspirada en TypeScript, tipado estático y salida C++20. El frontend ETS y el driver/backend C++20 se instalan como `etsc`. `src/` conserva el bootstrap y la referencia TypeScript para herramientas y pruebas.

> **¿Qué se soporta exactamente?** Lee [`LIMITATIONS.md`](./LIMITATIONS.md) para ver la lista completa de features rechazadas o pospuestas. Este README documenta cómo usar el dialecto y qué features están implementadas.

## Documentación

| Doc | Para qué |
|---|---|
| [`README.md`](./README.md) (este) | Instalación, uso rápido, sintaxis del dialecto |
| [`status.md`](./status.md) | Estado verificado, riesgos y prioridades actuales |
| [`LIMITATIONS.md`](./LIMITATIONS.md) | Qué se soporta, qué se rechaza por diseño, qué está pendiente |
| [`PROJECT.md`](./PROJECT.md) | Guía técnica para contribuir |
| [`docs/build-system.md`](./docs/build-system.md) | Cómo se compila hoy (V30.6.0+) |
| [`docs/MEMORY-AUDIT.md`](./docs/MEMORY-AUDIT.md) | Auditoría y riesgos abiertos del runtime |
| [`docs/TUTORIAL.md`](./docs/TUTORIAL.md) | Tutorial con ejemplos ejecutables |
| [`docs/match-syntax.md`](./docs/match-syntax.md) | Sintaxis de `match` (V30.5.1+) |
| [`docs/vision.md`](./docs/vision.md) | Visión a largo plazo (aspiracional) |
| [`docs/historical/`](./docs/historical/) | Docs de versiones anteriores (roadmap V0..V10, planes detallados) |
| [`CHANGELOG.md`](./CHANGELOG.md) | Cambios por versión |

## Uso rápido

La instalación no usa Node. El compilador instalado `etsc` necesita `git`, el
toolchain C++20 y las bibliotecas de runtime que use tu programa (libuv,
OpenSSL…). Ver [INSTALL.md](./INSTALL.md).

### Instalar el compilador (una vez)

Sin clonar el repositorio, con una sola línea:

```bash
curl -fsSL https://raw.githubusercontent.com/realprosl/estatic_ts/main/install.sh | sudo bash
```

Descarga lo mínimo en una carpeta temporal, instala con el compilador
precompilado (Linux x86_64 y macOS arm64; tarda unos segundos) y la borra.
Las opciones de `install.sh` van después de `bash -s --`, por ejemplo para
instalar en tu usuario, sin `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/realprosl/estatic_ts/main/install.sh | bash -s -- --prefix "$HOME/.local"
```

Para actualizar: `etsc update` (la última versión) o `etsc update 1.77.0`
(una concreta; `--list` muestra las disponibles y `--dry-run` solo comprueba).
Ver [INSTALL.md](./INSTALL.md#actualizar). Después conviene
ejecutar `etsc update-types` en cada proyecto para refrescar
`types/estatic.d.ts`.

Desde un clon del repositorio (para desarrollar el compilador):

```bash
git clone https://github.com/realprosl/estatic_ts.git
cd estatic_ts
./install.sh
```

### Crear un proyecto nuevo

```bash
etsc init ~/mi-proyecto
cd ~/mi-proyecto
etsc build
etsc run
```

`init` nunca sobrescribe: si alguno de los archivos que crearía ya existe, no
crea nada. Para convertir en proyecto una carpeta que ya tiene su código en
`src/`, usa `--no-src`. Crea la configuración, `tsconfig.json`, `types/`,
`.gitignore` y `README.md`, y deja `src/` como está:

```bash
cd ~/mi-codigo
etsc init --no-src
```

La entrada por defecto es `src/main.ts` (`"entry"` en `estatic.config.json`).

El archivo canónico [`types/estatic.d.ts`](./types/estatic.d.ts) contiene las
declaraciones que usa el editor para los builtins registrados. Para actualizar
un proyecto creado con una versión anterior:

```bash
etsc update-types ~/mi-proyecto
```

Si el archivo anterior es diferente, se conserva primero como
`types/estatic.d.ts.bak`. `etsc init` copia exactamente la misma fuente
canónica y una prueba detecta builtins sin declaración de editor.

Para consultar la versión instalada:

```bash
etsc --version
etsc -v
# etsc 1.26.0 (v64)
```

El `estatic.config.json` generado por `etsc init` no requiere que listes `-luv`, `-lssl`,
etc. — el CLI detecta los backends que el programa usa (desde el IR)
y los añade solo.

### Compilar un ejemplo puntual sin proyecto

```bash
etsc examples/hello.ts -o /tmp/hello.cpp --unity
g++ -std=c++20 -fno-exceptions -pthread -I. /tmp/hello.cpp -o /tmp/hello
/tmp/hello
```

> **Nota:** para ejemplos que usen `readTcp`, `setTimeout`, `createTlsServer`,
> etc. (los de V30+), este flujo directo `--unity` **requiere** que los
> `.o` del runtime (`build/runtime_ets_libuv.o`,
> `build/runtime_ets_net_libuv.o`) existan. Si clonaste el repo, los
> tendrá tras `npm install`. Si no, compílalos a mano o usa el flujo
> con `estatic.config.ts` (que automáticamente los añade). Ver
> `docs/build-system.md` para el detalle.

Para más detalles del flujo de build, ver [`docs/build-system.md`](./docs/build-system.md).

## Scripts y comandos

Todos los scripts del repositorio, qué hace cada uno y sus opciones. Se ejecutan
desde la raíz del repositorio. `--help` muestra la ayuda de los que la tienen.

### Instalación y semilla

| Script | Qué hace | Opciones |
|---|---|---|
| `./install.sh` | Instala `etsc` en `<prefix>/bin`. También se puede ejecutar sin clonar: `curl -fsSL https://raw.githubusercontent.com/realprosl/estatic_ts/main/install.sh \| bash -s -- [opciones]`. Descarga y usa la semilla y el compilador precompilados si coinciden con las fuentes; si no, los compila. No usa Node. | `--prefix DIR`, `--cxx CXX`, `--seed BIN` (reutiliza una semilla ya compilada), `--seed-only` (publica la semilla, sin compilar `compiler/`), `--force-seed` (recompila la semilla), `--force-compiler` / `--force-compile` (recompila el compilador de `compiler/`), `--force` (las dos), `--help` |
| `native-cpp/build-all.sh` | Construye la **semilla** (`native/etsc`, un compilador completo) desde `native-cpp/compiler/unity.cpp`, o copia la precompilada si coincide. | `--out DIR`, `--cxx CXX`, `--static`, `--force`, `--update-prebuilt` (CI), `--help` |
| `native-cpp/build-compiler.sh` | Construye el **compilador de `compiler/`** (generación 2, el `etsc` que se instala) con la semilla, o copia el precompilado si coincide. | `--seed DIR`, `--out BIN`, `--static`, `--force`, `--update-prebuilt` (CI), `--help` |
| `native-cpp/fetch-prebuilt.sh` | Descarga los precompilados de la rama `prebuilt` (clon `--depth 1` en un temporal) en `native-cpp/prebuilt/`. Nunca falla: sin red o sin rama, se compila. | `--remote NOMBRE\|URL`, `--branch RAMA`, `--help` |
| `native-cpp/regenerate.sh` | **Regenera la semilla** con el propio compilador: itera hasta que dos rondas emiten el mismo IR y C++ (punto fijo) y reescribe `native-cpp/compiler/unity.cpp`. Sin Node. | `--compiler ETSC`, `--cxx CXX`, `--max-rounds N`, `--help` |
| `compiler/native/progress.sh` | Utilidad de presentación (spinner, tiempos) que cargan los demás scripts. No se ejecuta sola. | — |

### Compilador ETS (desarrollo del self-hosting)

| Script | Qué hace | Opciones |
|---|---|---|
| `scripts/build-ets-compiler.sh` | Compila el compilador ETS: `stage1` con la semilla (`build/ets-compiler/etsc`) o `stage1`+`stage2` (`etsc-stage2`), con tiempos en `timings.tsv`. | `stage1` \| `stage2`; entorno `ESTATIC_ETS_OPTIMIZATION=-O1\|-O2\|-O3`, `ESTATIC_ETS_BUILD_DIR` |
| `scripts/check-ets-compiler.sh` | Prueba de humo de un compilador: compila y ejecuta un programa mínimo. | `[COMPILADOR]` (por defecto `build/ets-compiler/etsc`) |
| `scripts/selfhost-ir-frontend.sh` | Adaptador que usa el CI: expone el compilador autoalojado con el protocolo fuente→IR JSON de los fixtures. | entorno `ESTATIC_SELFHOST_COMPILER` |
| `scripts/ci-tests.mjs` | Elige los tests de la CI rápida según las rutas tocadas y los reparte en shards. La CI completa (toda la suite, e2e, instalación, punto fijo y binarios) se lanza con la etiqueta `ci-completa` en la PR, a mano, en main y cada noche. | `--full`, `--changed FICHERO`, `--shards N` |

### Dependencias nativas (en `build/libs/` y `build/tools/`)

| Script | Qué hace | Opciones |
|---|---|---|
| `scripts/build-libuv.sh` | Compila libuv en estático desde `third_party/libuv/`. | `[VERSION]` (por defecto `v1.48.0`) |
| `scripts/build-boringssl.sh` | Compila BoringSSL en estático desde `third_party/boringssl/`. | — |
| `scripts/build-curl.sh` | Compila libcurl en estático contra la BoringSSL vendorizada. | — |
| `scripts/build-tree-sitter.sh` | Compila los objetos C de Tree-sitter (runtime y gramática), sin CMake. | `[DIR_SALIDA] [CXX]` |
| `scripts/build-runtime.sh` | Precompila el runtime (`runtime/runtime_ets_*.cpp`) a `.o` cacheados. | — |
| `scripts/build-ast-dump.sh` | Construye `build/tools/ets-ast-dump`, para inspeccionar el AST de un fichero. | `[DIR_SALIDA] [CXX]` |
| `scripts/regenerate-tree-sitter.sh` | Regenera la gramática Tree-sitter de los editores desde la vendorizada. | — |
| `scripts/postinstall.sh` | Se ejecuta tras `npm install`: comprueba que están las librerías del sistema que usa el runtime. | — |

### Pruebas, ejemplos y benchmarks

| Script | Qué hace | Opciones |
|---|---|---|
| `scripts/check-http-limits.sh` | Regresión de límites HTTP del runtime. | argumentos del test |
| `scripts/check-http-routing.sh` | Regresión del enrutado HTTP del runtime. | — |
| `scripts/check-memory.sh` | Auditoría de memoria del runtime con ASan/UBSan (sin libuv ni Drogon). | — |
| `test/strong/run.sh` | Compila y ejecuta los proyectos de `test/strong/` y compara su salida. | — |
| `test/apps/todo/run.sh` | Prueba del CLI `todo` de ejemplo (varios procesos). | — |
| `examples/notification-app/run.sh` | Compila y ejecuta el ejemplo y compara con `expected.txt`. | entorno `ETSC` (compilador) |
| `examples/todo-project/run.sh` | Compila el ejemplo multi-módulo con `src/` y lo ejecuta. | — |
| `benchmarks/all/run-benchmarks.sh`, `benchmarks/match/run-benchmarks.sh` | Comparan el C++ generado con C++ escrito a mano (`hyperfine`). | — |
| `runtime/libuv/tests/tls/generate_test_certs.sh` | Genera certificados autofirmados para las pruebas TLS. | `[DIR_SALIDA]` |

Más detalle de los scripts de `scripts/` en [`scripts/README.md`](scripts/README.md) y
de la semilla en [`native-cpp/README.md`](native-cpp/README.md).

## Mensajes de error

`etsc` presenta los errores al estilo de `rustc`: código, `fichero:línea:columna`,
la línea de código con el tramo subrayado, y una ayuda cuando la hay.

```
error[E2001]: No existe 'cont' en este ámbito
 --> src/main.ts:2:7
  |
2 | print(cont);
  |       ^^^^
  |
  = ayuda: ¿querías decir 'count'?

error: no se pudo compilar por un error
```

- `etsc --explain E3003` explica un código con más detalle.
- `ESTC_LANG=en etsc build` muestra los mensajes en inglés (por defecto, español).
- Sin terminal, o con `NO_COLOR`, no se usan colores.

Los textos están en `messages/<idioma>.json` (se instalan en
`<prefix>/lib/estc/<versión>/messages/`). Cada entrada tiene `mensaje`,
`ayuda`, `nota` y `explicacion`, con huecos `{nombre}` que rellena el
compilador. Una entrada `CÓDIGO/variante` (p. ej. `E2001/sugerencia`) cubre
una forma concreta del error. Para añadir un idioma basta con copiar
`messages/es.json` a `messages/<código>.json` y traducir los textos; lo que
falte se muestra en español. Los mensajes que todavía no están en el
catálogo se muestran con el texto en español que escribe cada fase.

## Compilación incremental y cachés

`etsc build` / `etsc run` solo rehacen lo que ha cambiado:

| Caché | Dónde | Qué evita |
|---|---|---|
| Huella de entradas | `.build/cache/build-fingerprint` | Si fuentes, configuración, argumentos, `etsc`, runtime y g++ no cambian, no se analiza ni se compila. |
| Objetos del programa (uno por módulo, #178) | `.build/cache/objects/program-*.o` | El C++ se genera como una cabecera común (`program.hpp`: tipos, prototipos y globales) y una unidad por módulo fuente, en `<salida>.cpp.units/`. Cada unidad se compila aparte y en paralelo. Si cambias el cuerpo de una función sin tocar tipos ni firmas, solo se recompila la unidad de su módulo y se vuelve a enlazar; si cambia la cabecera, se recompilan todas. Los nombres C++ son estables (`ir_f_calc_c478da57d3b7`: nombre + hash de la identidad del símbolo, no su posición), así que añadir o quitar funciones en un módulo no cambia el texto de las demás unidades. `--unity` compila el programa como un único `.cpp`. |
| Runtime | `<prefix>/lib/estc/<versión>/build/objects` (lo crea `install.sh`) y `~/.cache/estc/objects` | Los `.cpp` del runtime (libuv, red, HTTP, regex) se compilan una vez y se enlazan. |
| Cabecera precompilada | `~/.cache/estc/pch` | Una por combinación de cabeceras del runtime y flags, compuesta según lo que use el programa. Se guardan las 5 más recientes. |

- `incremental.enabled: false` en `estatic.config.json` lo desactiva todo.
- `ESTC_OBJECT_CACHE=<dir>` cambia la caché de usuario; `ESTC_OBJECT_CACHE=off` la desactiva.
- Un objeto dañado en la caché se detecta al enlazar y se recompila.

## Configuración del proyecto

`estatic.config.ts` centraliza la entrada, roots y aliases de módulos, salidas y compilación nativa directa. No utiliza CMake.

```typescript
import type { EstaticConfig } from "./src/config/project-config.ts";

export default {
  entry: "src/main.ts",
  moduleRoots: ["src", "packages"],
  aliases: { "@core": "src/core" },
  output: { cpp: "build/app.cpp", binary: "build/app" },
  compiler: {
    enabled: true,
    command: "clang++", // También g++ u otro compilador C++20.
    flags: ["-std=c++20", "-O3", "-march=native", "-flto", "-pthread", "-fno-exceptions", "-ffunction-sections", "-fdata-sections"],
    linkFlags: ["-Wl,--gc-sections", "-Wl,--as-needed", "-s"]
  },
  incremental: {
    enabled: true,
    cacheDirectory: "build/.estatic/cache",
    generatedDirectory: "build/.estatic/generated"
  },
  logging: {
    enabled: true,
    file: "build/.estatic/transpiler-report.json",
    level: "debug"
  }
} satisfies EstaticConfig;
```

Sin argumentos, el CLI localiza la configuración y, si `compiler.enabled` es `true`, genera C++ y ejecuta directamente el compilador indicado:

```bash
etsc build
etsc build --config otra.config.json
etsc build --config otra.config.json --unity
```

Con la compilación incremental activa hay tres capas independientes de caché: sintaxis/AST por contenido de módulo, snapshot completa de transpilación y objetos C++ por unidad. Si cambia un solo archivo se vuelven a escanear y parsear únicamente sus bytes; los AST de los demás módulos se restauran. El análisis semántico combinado y el codegen se ejecutan para el programa nuevo por seguridad entre módulos, pero el `.o` sólo se recompila si cambió su C++ o la cabecera común. Si no cambió el programa, o sólo cambian flags/runtime nativos, se restaura la snapshot y se omiten parse, type-check, `comptime`, `@etsgen` y codegen. Los objetos incorporan a su clave el C++ materializado, la cabecera compartida, el runtime, el compilador y sus flags. Véase [`docs/transpilation-cache.md`](./docs/transpilation-cache.md).

`--unity` fuerza la salida histórica de un único `.cpp`, útil para inspección y depuración. Un archivo de entrada y `-o` continúan disponibles para compilaciones puntuales y usan ese modo unitario.

Desde v48, los programas dentro de la cobertura escalar pueden restaurar los cuerpos de funciones ya comprobados en módulos intactos, tanto en el checker fuente como en el final. Cambiar una implementación conserva los consumidores cuando el entorno de firmas y globals es idéntico. Clases, arrays, genéricos, closures, ownership y generación estática conservan el checker completo. Los contadores y motivos de fallback aparecen en `--verbose` y en el informe de build; véase [`docs/semantic-cache.md`](./docs/semantic-cache.md). El codegen continúa siendo global.

En perfiles de release se separan funciones y datos por sección, el enlazador elimina secciones y bibliotecas no utilizadas y el binario se entrega sin símbolos internos. Tree-sitter y la gramática TypeScript solo se enlazan cuando el ejecutable utiliza las APIs de sintaxis o AST; una aplicación normal no incorpora el parser del compilador. Para conservar símbolos durante la depuración, utilice el perfil `debug` y retire `-s` de `linkFlags`.

## Librerías: `etsc install`

```bash
etsc install https://github.com/usuario/mi-libreria 1.2.0   # etiqueta v1.2.0 (o 1.2.0, o una rama)
etsc install https://gitlab.com/usuario/otra                # sin versión: la última vX.Y.Z
etsc install https://github.com/usuario/comun 2.0.0 -g      # en la carpeta global
etsc install                                                # descarga lo que falte (otra máquina, CI)
```

Vale cualquier servidor git (GitHub, GitLab, Gitea, propio, `file://`). La
librería se descarga en `.build/deps/<nombre>@<versión>/` del proyecto o, con
`-g`/`--global`, en `~/.local/share/estatic/deps/` (`$XDG_DATA_HOME`), y se
apunta en `estatic.config.json`:

```json
"aliases": { "mi-libreria": "/ruta/absoluta/.build/deps/mi-libreria@v1.2.0" },
"dependencies": {
  "mi-libreria": { "url": "https://github.com/usuario/mi-libreria", "version": "v1.2.0", "commit": "…", "global": false }
}
```

- **Sin punto de entrada:** una librería se importa módulo a módulo:
  `import { parse } from "mi-libreria/parser"`. Solo se compilan los módulos
  importados.
- **Su `estatic.config.json`:** da el nombre (`name`; si no, el de la URL), sus
  alias internos (rutas relativas a su carpeta; solo valen para sus propios
  ficheros, así que dos librerías pueden usar el mismo nombre de alias) y sus
  `linkFlags` / `linkLibraries`, que se añaden al enlazar el proyecto.
- **Sus dependencias:** las `dependencies` de la librería se instalan también y
  se apuntan en el proyecto con `"indirect": true`. Una sola versión por nombre:
  manda la instalada directamente; entre indirectas, la más alta (con aviso).
- **Compilada una vez:** cada librería tiene su propia cabecera C++
  (`lib_<nombre>_<hash>.hpp`, solo sus tipos, prototipos y globales) y sus
  unidades no incluyen `program.hpp`. Sus `.o` se guardan en
  `<librería>/.estatic-cache/objects/` con una clave que solo depende de su
  cabecera, su C++, el compilador y los flags: cambiar tu proyecto no la
  recompila y, instalada con `-g`, la comparten todos tus proyectos. (Si la usas
  con tipos tuyos, p. ej. `Pila<MiClase>` o una interfaz que implementan tus
  clases, esa parte cambia con tu proyecto y se recompila, como en C++.)
- **Editor:** en cada `build`, `run` y `--check` los alias se copian a
  `compilerOptions.paths` de `tsconfig.json` (`"mi-libreria/*"`), conservando
  los `paths` escritos a mano y sin tocar el archivo si no cambia nada.
- La ruta absoluta es de esta máquina: en otra, `etsc install` sin argumentos
  vuelve a descargar desde `url` + `version` y reescribe el alias. Si falta una
  descarga, `etsc build` lo dice. Nunca se ejecuta código de la librería al
  instalarla.

### Crear una librería

```bash
etsc init lib mi-libreria
```

```
mi-libreria/
├── estatic.config.json   name, aliases internos, dependencies, linkFlags
├── tsconfig.json
├── saludo.ts             público: import { saludar } from "mi-libreria/saludo"
├── internal/formato.ts   interno (alias @interno)
├── types/estatic.d.ts
├── README.md
└── .gitignore            .build/ y build/
```

La raíz del repositorio es la raíz de los imports y no hay punto de entrada.
Las dependencias de la librería van en su `dependencies` (`{ "url", "version" }`)
y se importan por su nombre. Cada versión es una etiqueta git:
`git tag v0.1.0 && git push --tags`. No subas `.build/` ni rutas absolutas.

## Lenguaje implementado

- Tipos `number`, `string`, `boolean` y `void`.
- `let` y `const`, con anotación explícita o inferencia desde el inicializador.
- Funciones tipadas, bloques, `return`, `if/else` y `while`.
- Bucles `for`, junto con `break` y `continue` validados por contexto.
- Operadores aritméticos, relacionales, igualdad y lógica booleana.
- Incremento y decremento prefijo/postfijo: `++i`, `i++`, `--i`, `i--` sobre
  destinos numéricos mutables, también en `for (let i=0; i<3; i++)`.
- Salida variádica separada por `stdout` y `stderr`.
- Diagnósticos con archivo, línea, columna y fragmento de código.
- Biblioteca estándar mínima para strings, archivos y argumentos de proceso.
- Interfaces estructurales emitidas como conceptos de C++20, sin herencia ni vtables.
- Clases por valor emitidas como `struct`; se relacionan mediante composición de campos.
- Arrays homogéneos `T[]` emitidos como `std::vector<T>`.
- Tuplas heterogéneas `[A, B, ...]` emitidas como `std::tuple<A, B, ...>`.
- Funciones flecha y closures emitidas como lambdas y `std::function`.
- Funciones y clases genéricas emitidas como templates de C++20.
- Sobrecargas de funciones libres y métodos resueltas estáticamente por firma.
- Constraints genéricos `T extends Interface` emitidos como concepts.
- Packs genéricos heterogéneos y parámetros rest emitidos como parameter packs de C++20.
- Funciones `async`, `Promise<T>` y `await` emitidos como corutinas C++20.
- Event loop cooperativo, temporizadores, tareas desacopladas y sockets TCP no bloqueantes.
- Parámetros `ref<T>` y `constRef<T>` emitidos como `T&` y `const T&` (V22).
- Parámetros `ptr<T>` y `constPtr<T>` emitidos como `std::unique_ptr<T>` y `std::unique_ptr<const T>` (V22).
- `T` significa copia (V22): el dialecto no aplica lowering implícito a `const T&`.
- Errores explícitos mediante `Result<T>`.
- Imports relativos, roots y aliases resueltos mediante un grafo de módulos.
- Visibilidad nominal entre módulos mediante `export` e imports explícitos.
- Informe JSON cronológico de cada transpilación y compilación.

```typescript
interface Named {
  name(): string;
}

function show(value: Named): void {
  print(value.name());
}
```

La interfaz anterior se convierte en un `concept Named` y `show` en una función plantilla restringida. `interface` no admite `extends`: la reutilización de comportamiento se diseña mediante composición.

## Valores que pueden faltar: `T | undefined`

Como en TypeScript, un valor que puede no existir se escribe `T | undefined`. Por
debajo es un `Optional<T>` (`std::optional` en C++): no hay valor especial ni
excepciones.

```ts
let x: number | undefined;            // empieza sin valor
x = 5;                                // se asigna un number sin más
if (x !== undefined) print(x + 1);    // dentro del if, x es number
function buscar(n: number): string | undefined { return n > 0 ? "sí" : undefined; }
print(buscar(-1) ?? "nada");          // ?? da el valor por defecto
function f(a: number, b?: number): number { return b === undefined ? a : a + b; }
```

- `===` y `!==` son `==` y `!=` (el dialecto no convierte tipos al comparar).
- Solo un `T | undefined` se compara con `undefined`; fuera de la comprobación
  sigue siendo `T | undefined` y el checker exige comprobarlo (o usar `??`).
- Una variable sin valor inicial solo puede ser `T | undefined`.
- Los errores con motivo (leer un fichero, parsear) siguen yendo por `Result<T, E>`.

## Tipos objeto: `{ a: T; b?: U }`

Un tipo objeto se puede escribir en el sitio, como en TypeScript: en variables,
parámetros, retornos, arrays y alias (`type Punto = { x: number; y?: number }`).

```ts
function suma(p: { x: number; y?: number }): number { return p.x + (p.y ?? 0); }
suma({ x: 1 }); suma({ x: 1, y: 2 });
const lista: { n: string; v: number }[] = [{ n: "a", v: 1 }];
```

- Cada forma (nombres y tipos de los campos, sin importar el orden) es un struct
  con nombre (`__Obj_x_y_<hash>`), y la misma forma se reutiliza en el módulo.
- Un campo opcional (`b?: T`) es `T | undefined`, también en las interfaces.
- Un literal sin tipo (`const p = { x: 1, nombre: "a" }`) deduce su forma;
  dos literales con los mismos campos y tipos comparten tipo
  (`[{ v: 1 }, { v: 2 }]` es un array).
- Parámetros desestructurados, con valores por defecto que se aplican en la
  función cuando el campo llega vacío:

```ts
function crear({ nombre, edad = 18 }: { nombre: string; edad?: number } = { nombre: "anon" }): string { ... }
crear({ nombre: "Ana" }); crear();
function opciones({ a = 1, b = "x" }) { ... }   // sin anotación: campos opcionales con el tipo del valor
const { a, b = "def" } = objeto;                 // también en declaraciones
```

- Patrones anidados (`const { dir: { ciudad = "Madrid" } } = u`, también en
  parámetros y en `for...of`), resto de array (`const [a, ...resto] = xs`, que
  es `xs.slice(1)`) y huecos (`const [, b] = xs`). Dentro de un patrón,
  `{ a: { ... } }` y `{ a: [ ... ] }` son patrones anidados, como en
  TypeScript.
- Un objeto con campos de más que viene de una variable se acepta donde se
  pide una forma con menos campos; en un literal escrito en el sitio, un campo
  de más es un error, como en TypeScript.
- Pendiente: el resto de objeto (`{ a, ...resto }`), que necesita tipos
  derivados (`Omit`) y va con la tanda de `Record`/`Partial`/`Pick`/`Omit`.

## Métodos de `string`

Mismas firmas que en TypeScript, argumentos opcionales incluidos:

```ts
const s = "hola mundo";
s.indexOf("o", 2);        // 9       s.lastIndexOf("o", 5);  // 1
s.slice(5);               // "mundo" s.substring(5); s.substr(-5);
s.split("", 3);           // ["h", "o", "l"]
s.startsWith("mundo", 5); // true    s.endsWith("hola", 4);  // true
s.at(-1) ?? "";           // "o"     (at y codePointAt dan T | undefined)
s.concat("!", "?");       // "hola mundo!?"
"7".padStart(3);          // "  7"
String(42); String(true); String.fromCharCode(72, 105); String.fromCodePoint(241);
```

También `charAt`, `charCodeAt`, `includes`, `trim`/`trimStart`/`trimEnd`
(y los alias `trimLeft`/`trimRight`), `toUpperCase`, `toLowerCase`, `repeat`,
`padEnd`, `replace`, `replaceAll` y `localeCompare`.

- Los índices cuentan bytes UTF-8, no unidades UTF-16 como en JavaScript: en
  texto ASCII coinciden. `charCodeAt` fuera de rango da `NaN`.
- Aún faltan `normalize` y los métodos que usan `RegExp` (`match`, `matchAll`,
  `search`, y `replace`/`split` con expresión regular).

## Métodos de `Array`

Mismas firmas que en TypeScript. Los callbacks reciben `(valor)` o `(valor, índice)`:

```ts
let a: number[] = [3, 1, 2];
a.reduce((s: number, x: number): number => s + x);       // 6 (sin valor inicial)
a.reduce((s: string, x: number): string => s + x, "r");  // "r312"
a.reduceRight((s: number, x: number): number => s - x);  // -2
a.map((x: number, i: number): number => x * i);          // [0, 1, 4]
a.at(-1) ?? 0;                 // 2   (at, find, findLast, pop y shift dan T | undefined)
a.indexOf(2); a.lastIndexOf(3, -1); a.includes(3, 1);
a.findIndex(...); a.findLast(...); a.findLastIndex(...);
a.push(4, 5);                  // 5: push y unshift devuelven la nueva longitud
a.pop(); a.shift(); a.unshift(0);
a.join(); [true, false].join("|");   // join con cualquier tipo de elemento
a.toSorted(); a.toReversed(); a.with(0, 9);   // copias
a.reverse(); a.fill(7, 1, -1);                // modifican el array
a.splice(1, 2, 9, 8);          // quita y devuelve los 2 elementos; toSpliced(...) sobre una copia
[[1], [2, 3]].flat();          // [1, 2, 3]; flat(2), flat(3)... con profundidad literal
a.keys(); a.values(); a.entries();   // arrays: sirven en for...of y en Array.from
Array.isArray(a); Array.of(1, 2); Array.from("ab"); Array.from(set, (x, i) => x * i);
```

`print` y `console.log` muestran arrays, tuplas, `Map`, `Set` y `T | undefined`
como Node (`util.inspect`): `[ 1, 2, 3 ]`, `[ 'a', "it's" ]`,
`Map(1) { 'a' => 1 }`, `Set(2) { 1, 2 }`; en una línea si cabe en 80 columnas,
en columnas con más de 6 elementos, hasta 100 elementos y profundidad 2. Si el
argumento es un array literal de constantes (enteros, strings, booleanos) y cabe
en una línea, el texto se genera ya al compilar.

- `reduce` sin valor inicial sobre un array vacío, o `with` fuera de rango,
  terminan el programa con el mismo mensaje que lanzaría JavaScript (`TypeError`
  / `RangeError`): el dialecto no tiene excepciones.
- `sort()` y `toSorted()` sin comparador ordenan números por valor (JavaScript
  los ordena como texto).
- `keys()`, `values()` y `entries()` devuelven arrays, no iteradores (no hay
  `.next()`); `print(a.keys())` muestra el array.
- Aún no se puede desestructurar en `for (const [i, x] of a.entries())`: usa
  `e[0]` y `e[1]` (va en la tanda de Map/Set).

## Librerías del runtime: `estatic:math`, `estatic:number`, `estatic:date`, `estatic:json` y `estatic:regexp`

`Math` y `Number` de TypeScript son librerías escritas en Estatic
(`runtime/lib/*.ts`), no builtins: se importan.

```ts
import Math, { floor, PI } from "estatic:math";     // las dos formas
Math.floor(2.7); floor(2.7); Math.max(1, 5, 3); Math.hypot(3, 4); Math.PI;

import Number, { parseInt, parseFloat, toFixed, toPrecision, toExponential, toString } from "estatic:number";
Number.isInteger(5); Number.MAX_SAFE_INTEGER; Number.EPSILON;
parseInt("ff", 16); parseFloat("3.14abc");
toFixed(1.005, 2);        // "1.00"   (x.toFixed(2) en TypeScript)
toPrecision(123.456, 4);  // "123.5"
toString(255, 16);        // "ff"
```

- `Math` tiene todas las funciones y constantes de TypeScript, con sus
  resultados (`round(-2.5)` es `-2`, `min(0, -0)` es `-0`, `pow(1, NaN)` es
  `NaN`, `max()` es `-Infinity`).
- Los métodos de `number` (`x.toFixed(2)`, `x.toString(16)`...) son funciones
  que reciben el número: `toFixed(x, 2)`, `toString(x, 16)`. Dan el mismo texto
  que JavaScript, redondeo de empates incluido (comparado con Node en 27.000
  casos).
- Lo que necesita C++ (`<cmath>`, el redondeo decimal exacto) está en
  `runtime/lib/numeric.hpp` y se enlaza con `@cpp_native`.
- El `Math` global sigue existiendo de momento; `import Math from
  "estatic:math"` lo sustituye en el módulo que lo importa.

```ts
import Date, { parse, UTC } from "estatic:date";
const d = new Date(2024, 0, 15, 10, 30);      // hora local
d.getFullYear(); d.getHours(); d.toISOString(); d.setDate(31);
new Date("2024-01-15T10:30:00Z"); new Date(1705314605123); new Date();
Date.now(); Date.UTC(2024, 0, 15); Date.parse("2024-01-15");
```

- `Date` sigue la especificación de ECMAScript: getters y setters locales y UTC,
  `toISOString`, `toUTCString`, `toDateString`, `toString`, `toJSON`, fechas no
  válidas (`NaN`, `"Invalid Date"`, `RangeError` en `toISOString`) y el formato
  ISO de `Date.parse`. Comparado con Node, también con horario de verano.
- La zona local es la del sistema (`TZ`); en `toString` el nombre entre
  paréntesis es la abreviatura del sistema (`CET`), no el nombre largo de Node.
- El calendario está escrito en Estatic; solo el reloj y la zona salen de C++
  (`runtime/lib/date.hpp`).

```ts
import JSON from "estatic:json";
JSON.stringify(usuario);                  // {"nombre":"Ana","edad":30,...}
JSON.stringify(usuario, undefined, 2);    // con sangría
const r = JSON.parse<Usuario>(texto);     // Result<Usuario, Error>
if (r.isOk()) print(r.value().nombre); else print(r.error().message);
const v = JSON.parse(texto);              // Result<JsonValue, Error>
```

- `JSON.parse<T>` rellena la clase o el tipo pedido por estructura: comprueba
  cada campo (`se esperaba string en $.nombre y hay number`), un campo
  `T | undefined` puede faltar o ser `null`, los demás son obligatorios y los
  campos de más se ignoran. Admite números, strings, booleanos, arrays, tuplas,
  clases, `Map<string, T>`, uniones (la primera alternativa que encaja) y
  `JsonValue`. Sin excepciones: el error es un `SyntaxError` dentro del `Result`.
- `JSON.stringify` escribe como JavaScript: los campos `undefined` se omiten,
  `NaN` e `Infinity` son `null`, `Map` y `Set` son `{}` y `space` es un número de
  espacios o un texto. Todavía no admite `replacer` ni llama a `toJSON` (un
  `Date` se escribe con su campo interno; usa `d.toISOString()`).
- Las clases se recorren por los nombres de sus campos, que el generador emite
  en cada struct (`ets_fields`); el resto está en `runtime/lib/json.hpp`.

```ts
import RegExp from "estatic:regexp";
const fecha = /(\d{4})-(\d{2})-(\d{2})/;          // o new RegExp("...", "flags")
const m = fecha.exec("hoy es 2024-01-15");         // string[] | undefined
if (m !== undefined) print(m[1]);
/^a+b$/i.test("AAAb");
"a1b22".replace(/\d+/g, "#"); "x-y".replace(/(\w)-(\w)/, "$2-$1");
"a, b;c".split(/\s*[,;]\s*/); "a1b22".match(/\d+/g); "k=v".search(/=/);
for (const par of "k1=v1&k2=v2".matchAll(/(\w+)=(\w+)/g)) print(par[1]);
```

- El motor es `std::regex` con la gramática ECMAScript: flags `g`, `i`, `m` e
  `y`, con `lastIndex` en `exec`/`test`. No hay lookbehind, grupos con nombre
  ni los flags `s`, `u`, `v` y `d`. Un patrón que `std::regex` no acepta
  termina el programa (el runtime se compila sin excepciones).
- `exec` devuelve `string[] | undefined` (un grupo que no participa es `""`);
  el índice del match está en `re.lastMatchIndex`. `match` devuelve
  `string[] | undefined` y `matchAll` un array de matches. Los índices cuentan
  bytes, como el resto de strings.
- El literal `/patrón/flags` es `new RegExp("patrón", "flags")` con el `RegExp`
  importado de `estatic:regexp`.
- Con un texto constante, `JSON.parse` trabaja en compilación (#273):
  - sin tipo, `JSON.parse('{"a":1,"b":["x"]}')` deduce el tipo del texto (un
    tipo objeto con nombre por forma, `{ a: number; b: string[] }`), así que
    `r.value().b.length` se comprueba en compilación;
  - con tipo, `JSON.parse<Usuario>('{...}')` comprueba el texto al compilar: si
    no encaja es un error (`E3010: ... se esperaba number en $.edad y hay
    string`), y un JSON mal formado también;
  - el resultado sigue siendo `Result<T, Error>`, con la misma firma que con un
    texto que solo se conoce al ejecutar. Por ahora el objeto se construye
    parseando el texto al ejecutar (ya comprobado).

## Errores: `Error` sin excepciones

`Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError` y
`URIError` existen como en TypeScript, pero sin `throw`/`try`/`catch`: se
devuelven dentro de `Result<T, Error>`.

```ts
function dividir(a: number, b: number): Result<number, Error> {
  if (b == 0) return resultErr<number, Error>(new RangeError("división por cero"));
  return resultOk<number, Error>(a / b);
}
const r = dividir(1, 0);
if (!r.isOk()) print(r.error().toString());     // RangeError: división por cero
const e = new TypeError("tipo malo", { cause: new Error("origen") });
```

Como el dialecto no tiene herencia, `Error` es una **interfaz** (`name`,
`message`, `cause: Error | undefined`, `toString()`) y cada clase de error la
implementa con los mismos miembros; una clase tuya con esos miembros también es
un `Error`. `new Error(…)` construye la implementación base. Están escritas en
ETS en `runtime/prelude/error.ts`.

## Prelude: código disponible sin import

Los módulos del prelude se ven en todos los demás sin `import`, como los
builtins: el del runtime (`runtime/prelude/*.ts`, por ejemplo `Error`) y el del
proyecto:

```json
// estatic.config.json
"prelude": ["src/std/fetch.ts"]
```

Una declaración local o un import explícito tapan al prelude; si dos módulos del
prelude exportan el mismo nombre es un error. Entre ellos, los módulos del
prelude se importan a mano.

## Clases mediante composición

Las clases son tipos concretos por valor. Sus argumentos de construcción corresponden, en orden, a sus campos. No existe `extends`, clase base, método virtual ni conversión descendente.

```typescript
class Motor {
  power: number;
}

class Car {
  motor: Motor;
  name: string;

  power(): number {
    return this.motor.power;
  }
}

let motor: Motor = new Motor(120);
let car: Car = new Car(motor, "Coupe");
print(car.power());
```

El backend genera `struct Motor` y `struct Car`, donde `Car` contiene un `Motor`. Una clase satisface una interfaz automáticamente cuando sus métodos coinciden; no se escribe `implements`.

## Control de flujo

```typescript
let total: number = 0;
for (let index: number = 0; index < 10; index = index + 1) {
  if (index == 2) { continue; }
  if (index == 8) { break; }
  total = total + index;
}
```

El inicializador del `for` tiene su propio scope. El analizador rechaza `break` y `continue` fuera de `for` o `while`.

Las operaciones que pueden fallar devuelven `Result<T>`:

```typescript
const contents: Result<string> = readFile("input.ets");
if (contents.isOk()) {
  print(contents.value());
} else {
  printError(contents.error());
}
```

## Archivos, consola y errores nativos

Las funciones de archivo tienen sobrecargas que devuelven `Result<T>`. `isOk()` indica éxito, `value()` entrega el valor y `error()` contiene el diagnóstico. No lanzan excepciones. Las firmas anteriores con `out error` se conservan para compatibilidad y para el frontend autoalojado.

| Función | Resultado |
| --- | --- |
| `fileExists(path)` | Indica si existe un archivo regular. |
| `readFile(path)` | Lee en binario y retorna `Result<string>`. |
| `writeFile(path, contents)` | Crea o reemplaza y retorna `Result<boolean>`. |
| `appendFile(path, contents)` | Crea o añade y retorna `Result<boolean>`. |
| `copyFile(source, destination)` | Copia y retorna `Result<boolean>`. |
| `moveFile(source, destination)` | Mueve o renombra y retorna `Result<boolean>`. |
| `removeFile(path)` | Elimina y retorna `Result<boolean>`. |

Todas las operaciones disponen además de una variante que se ejecuta en el pool de trabajo del runtime y devuelve una corutina:

| API asíncrona | Tipo de retorno |
| --- | --- |
| `readFileAsync(path)` | `Promise<Result<string>>` |
| `writeFileAsync(path, contents)` | `Promise<Result<boolean>>` |
| `appendFileAsync(path, contents)` | `Promise<Result<boolean>>` |
| `fileExistsAsync(path)` | `Promise<Result<boolean>>` |
| `copyFileAsync(source, destination)` | `Promise<Result<boolean>>` |
| `moveFileAsync(source, destination)` | `Promise<Result<boolean>>` |
| `removeFileAsync(source, destination)` | `Promise<Result<boolean>>` |

```typescript
async function load(path: string): Promise<Result<string>> {
  return readFileAsync(path);
}

const contents: Result<string> = await load("input.txt");
```

Estas variantes no ejecutan una llamada de disco bloqueante en el hilo del event loop. El trabajo se envía a un pool acotado de 2 a 4 workers y su finalización despierta el `poll` mediante una tubería interna.

Las variantes compatibles añaden sus salidas al final, pasadas por referencia: `readFile(path, contents, error)` (con `contents` y `error` variables `string`) y, para las demás, `operación(..., error)`. Retornan `boolean` y limpian `error` cuando tienen éxito.

`Result<T>` también puede utilizarse en cualquier función síncrona propia. `ok(value)` infiere `T` desde el valor; `err(message)` lo infiere desde el retorno o la variable destino. Sin contexto debe indicarse el tipo: `err<number>("mensaje")`.

```typescript
function divide(left: number, right: number): Result<number> {
  if (right == 0) { return err("division by zero"); }
  return ok(left / right);
}
```

La salida de consola está separada por canal y por uso de salto de línea:

- `print(...)` escribe en `stdout` y termina la línea.
- `write(...)` escribe en `stdout` sin salto y vacía el buffer.
- `printError(...)` escribe en `stderr` y termina la línea.
- `writeError(...)` escribe en `stderr` sin salto y vacía el buffer.

El proceso sigue una superficie familiar de Node para las streams estándar y los hijos. `process.stdin` emite eventos `"data"` y `"end"`; `process.stdout.write(...)` y `process.stderr.write(...)` escriben sin añadir salto de línea. `child_process.spawn(command, args)` inicia un hijo de forma asíncrona y devuelve streams `stdin`, `stdout` y `stderr`, además de eventos `"exit"`, `"close"` y `"error"`. `child_process.spawn` es distinto del builtin global `spawn(task)`, que agenda una tarea del event loop.

```typescript
process.stdin.on("data", (chunk: string): void => { process.stdout.write(chunk); });

const child = child_process.spawn("cat", []);
child.stdout.on("data", (chunk: string): void => { process.stdout.write(chunk); });
child.stdin.write("hola\n");
child.stdin.end();
child.on("close", (code: number): void => print(code));
```

El subconjunto inicial entrega chunks como `string` UTF-8 (no `Buffer`) y aún no expone opciones de `spawn`, señales ni backpressure avanzado. Los listeners retenidos no pueden escapar capturando variables locales mutables por referencia; el checker los rechaza para evitar referencias colgantes. Los callbacks se procesan en el event loop de libuv.

Las utilidades `fail(message, error)`, `hasError(error)` y `clearError(error)` (con `error` por referencia) permiten construir errores explícitos en funciones propias.

### API estilo Node (`console.*`)

El identificador global `console` expone la misma forma que en Node, mapeado por debajo a las funciones planas de arriba:

| API | Canal | Implementación |
| --- | --- | --- |
| `console.log(...)` | stdout (con salto de línea) | `print(...)` |
| `console.info(...)` | stdout (con salto de línea) | `print(...)` |
| `console.debug(...)` | stdout (con salto de línea) | `print(...)` |
| `console.trace(...)` | stdout (con salto de línea) | `print(...)` |
| `console.warn(...)` | stderr (con salto de línea) | `printError(...)` |
| `console.error(...)` | stderr (con salto de línea) | `printError(...)` |

Todas las firmas son variádicas y aceptan `string`, `number` y `boolean` mezclados en una sola llamada. El analizador rechaza cualquier otro método con un diagnóstico explícito. Ver [examples/console-demo.ts](examples/console-demo.ts).

```typescript
console.log("Hola desde console.log");
console.info("Info:", 42, true);
console.warn("Esto sale por stderr");
console.error("Error grave:", "fallo X");
```

### API estilo Node (`fs.*`)

El identificador global `fs` agrupa las operaciones de archivo bajo la misma forma que en Node. Las versiones sin sufijo son asíncronas y devuelven `Promise<Result<T>>`; las versiones `Sync` son síncronas y devuelven `Result<T>` (o `boolean` para `existsSync`). Por debajo delegan en las funciones libres de `runtime/ets_file.hpp`.

| API | Firma | Equivalente interno |
| --- | --- | --- |
| `fs.readFile(path)` | `Promise<Result<string>>` | `readFileAsync(path)` |
| `fs.writeFile(path, contents)` | `Promise<Result<boolean>>` | `writeFileAsync(path, contents)` |
| `fs.appendFile(path, contents)` | `Promise<Result<boolean>>` | `appendFileAsync(path, contents)` |
| `fs.copyFile(source, destination)` | `Promise<Result<boolean>>` | `copyFileAsync(source, destination)` |
| `fs.rename(oldPath, newPath)` | `Promise<Result<boolean>>` | `moveFileAsync(oldPath, newPath)` |
| `fs.unlink(path)` | `Promise<Result<boolean>>` | `removeFileAsync(path)` |
| `fs.readFileSync(path)` | `Result<string>` | `readFile(path)` (overload `Result`) |
| `fs.writeFileSync(path, contents)` | `Result<boolean>` | `writeFile(path, contents)` (overload `Result`) |
| `fs.appendFileSync(path, contents)` | `Result<boolean>` | `appendFile(path, contents)` (overload `Result`) |
| `fs.copyFileSync(source, destination)` | `Result<boolean>` | `copyFile(source, destination)` (overload `Result`) |
| `fs.renameSync(oldPath, newPath)` | `Result<boolean>` | `moveFile(oldPath, newPath)` (overload `Result`) |
| `fs.unlinkSync(path)` | `Result<boolean>` | `removeFile(path)` (overload `Result`) |
| `fs.existsSync(path)` | `boolean` | `fileExists(path)` |

El analizador rechaza cualquier otro método con un diagnóstico que lista las APIs válidas. Ver [examples/fs-demo.ts](examples/fs-demo.ts).

```typescript
if (fs.existsSync("/tmp/cache.txt")) {
  const removed: Result<boolean> = fs.unlinkSync("/tmp/cache.txt");
  if (removed.isOk() == false) { console.error(removed.error()); }
}
const written: Result<boolean> = fs.writeFileSync("/tmp/cache.txt", "v1");
if (written.isOk()) {
  const contents: Result<string> = fs.readFileSync("/tmp/cache.txt");
  if (contents.isOk()) console.log(contents.value());
}

const asyncRead: Promise<Result<string>> = fs.readFile("/tmp/cache.txt");
const data: Result<string> = await asyncRead;
```

`await` a nivel superior se traduce a `ets::syncWait` porque la función `main` de C++ no puede ser corutina. Dentro de una `async function` se convierte en `co_await` como cualquier otra promesa.

## Paso de parámetros

**V22 — `T` significa copia**. El dialecto ya no convierte automáticamente
un parámetro `T` a `const T&` para "optimizar" el ABI. Si quieres evitar
la copia, declara el parámetro con `ref<T>` o `constRef<T>`.

```typescript
class Counter { value: number; constructor(v: number) { this.value = v; } }

function inspect(c: constRef<Counter>): number {
  return c.value;  // lectura, no copia
}

function increment(c: ref<Counter>): void {
  c.value = c.value + 1;  // muta el valor del caller
}
```

```cpp
double inspect(const Counter& c);
void increment(Counter& c);
```

| Parámetro fuente | C++ generado |
| --- | --- |
| `T` (sin modifier) | Por valor (copia) |
| `number`, `boolean` (primitivos) | Por valor |
| `ref<T>` | `T&` con lectura y escritura |
| `constRef<T>` | `const T&` (solo lectura) |
| `ptr<T>` | `std::unique_ptr<T>` (ownership exclusivo) |
| `constPtr<T>` | `std::unique_ptr<const T>` (ownership readonly) |

> **Importante**: Estatic **nunca** cambia implícitamente un parámetro `T`
> por una referencia para optimizar el ABI. Si se quiere evitar una copia,
> debe expresarse mediante `ref<T>` o `constRef<T>`.

Las funciones `async` rechazan parámetros `ref<T>` y `constRef<T>` hasta
disponer de análisis de lifetimes (PR#7). Si la corutina necesita el
objeto, debe recibirlo por valor o tomar ownership con `ptr<T>`.

## Arrays y tuplas

```typescript
let values: number[] = [10, 20, 30];
values[1] = 25;

const metadata: [string, boolean] = ["active", true];

print(length(values));
print(values[1]);
print(metadata[0]);
```

Los arrays requieren un único tipo de elemento y admiten índices numéricos. Las tuplas conservan el tipo de cada posición; por eso su índice debe ser un literal entero conocido durante la compilación. Los arrays vacíos necesitan anotación, por ejemplo `let values: number[] = [];`.

## Funciones flecha y closures

```typescript
function makeAdder(amount: number): (value: number) => number {
  return (value: number): number => value + amount;
}

function makeCounter(start: number): () => number {
  let count: number = start;
  return (): number => {
    count = count + 1;
    return count;
  };
}

const addTen = makeAdder(10);
const counter = makeCounter(100);

print(addTen(5));
print(counter());
print(counter());
```

Los tipos de función usan la sintaxis TypeScript `(parametro: Tipo) => Retorno` y se emiten como `std::function`. Las variables externas se capturan por valor en una lambda `mutable`, por lo que una closure puede conservar estado privado entre llamadas. Una función flecha con cuerpo de bloque necesita declarar su retorno; las de expresión pueden inferirlo.

## Genéricos

```typescript
function identity<T>(value: T): T {
  return value;
}

function first<T>(values: T[]): T {
  return values[0];
}

class Box<T> {
  value: T;

  get(): T {
    return this.value;
  }
}

const inferred = identity("hello");
const explicit = identity<number>(7);
const box: Box<number> = new Box<number>(42);
```

Los argumentos de tipo de funciones se infieren recorriendo arrays, tuplas, firmas de función y clases genéricas anidadas. También pueden indicarse explícitamente. El analizador detecta conflictos de inferencia y aridad incorrecta. El backend genera `template <typename T>` y deja que C++ realice la instanciación.

Actualmente los genéricos declarables se limitan a funciones y clases. Aún no existen parámetros predeterminados, especializaciones ni restricciones genéricas escritas por el usuario; las interfaces continúan funcionando como `concepts` estructurales sobre las instancias resultantes.

## Sobrecargas y genéricos variádicos

```typescript
function describe(value: number): string {
  return "number=" + numberToString(value);
}

function describe(value: string): string {
  return "string=" + value;
}

function describe<T>(value: T): string {
  return "generic";
}

function logAll<...T>(...values: T): void {
  print(values);
}

print(describe(42.0));       // elige number
print(describe("hello"));    // elige string
print(describe(true));       // elige T
logAll("mixed: ", 10, true);
logAll<number, string>(7, " explicit");
```

Una función puede tener varias declaraciones con el mismo nombre si sus parámetros forman firmas distintas; el tipo de retorno no basta para sobrecargar. Las firmas concretas tienen prioridad sobre las genéricas y el compilador informa cuando no hay coincidencia, existe ambigüedad o se repite una firma equivalente. La sintaxis `<...T>` declara un pack de tipos y `...values: T` su parámetro rest, que debe ser el último. En C++ se generan `template <typename... T>` y `T... values`; al usar el pack como argumento se emite `values...`.

Las clases e interfaces pueden declarar varias firmas del mismo método. Los constraints usan una interfaz estructural y no introducen herencia:

```typescript
function display<T extends Named>(value: T): string {
  return value.name();
}
```

En C++ se genera `template <Named T>`. Limitaciones actuales: no hay sobrecargas de closures, los packs solo pueden declararse en funciones y no hay valores genéricos predeterminados ni especializaciones. La resolución es estática y no introduce coerciones implícitas.

## Async/await con corutinas C++20

```typescript
async function loadValue(): Promise<number> {
  return 21;
}

async function calculate(): Promise<number> {
  const value: number = await loadValue();
  return value * 2;
}

async function notify(message: string): Promise<void> {
  print(message);
  return;
}

const pending: Promise<number> = calculate();
const result: number = await pending;
await notify("async complete");
print(result);
```

`Promise<T>` se emite como el tipo move-only `ets::Task<T>` del runtime. Una función `async` genera una corutina con `co_return`; dentro de ella, `await` genera `co_await`. El retorno puede ser un valor `T` o directamente otro `Promise<T>`, que se aplana mediante `co_await`. En el nivel superior, `await` utiliza `ets::syncWait` porque la función `main` de C++ no puede ser una corutina.

El analizador rechaza `await` dentro de funciones síncronas, operandos que no sean `Promise<T>`, retornos incompatibles y funciones `async` sin retorno `Promise<T>`. El runtime sigue compilándose con `-fno-exceptions` y no emplea `throw` ni `try/catch`.

Las corutinas se integran con un event loop, temporizadores, red TCP no bloqueante y un pool acotado para operaciones de archivos. Las continuaciones vuelven al hilo del event loop. `CancellationSource`/`CancellationToken` permiten cancelar esperas y las APIs `*Until` reciben un deadline relativo en milisegundos. Todavía no existe `Promise.all`; métodos y funciones flecha asíncronos quedan para una extensión posterior.

## Rendimiento de strings y archivos

- Una cadena `a + b + c + d` se emite como `ets::concat(a, b, c, d)`: calcula el tamaño total, reserva una vez y evita las cadenas temporales intermedias.
- `numberToString` utiliza `std::to_chars` en lugar de construir un stream.
- `readFile` consulta el tamaño del archivo, dimensiona directamente el `string` final y lee sobre su buffer. Conserva un camino por bloques de 64 KiB para pipes y archivos cuyo tamaño cambia durante la lectura.
- `writeFile` y `appendFile` manejan escrituras parciales e interrupciones; append utiliza `O_APPEND`.
- Las APIs síncronas siguen siendo apropiadas para herramientas secuenciales. En servidores debe preferirse la variante `Async` para no detener sockets, timers ni otras corutinas.
- En Linux, lectura, escritura y append asíncronos intentan usar `io_uring` mediante syscalls directas y anillos reutilizados por worker. `ioUringAvailable()` permite consultar la capacidad; si el kernel o sandbox la bloquea, el runtime usa automáticamente las operaciones POSIX del pool.

## Servidores y red asíncrona

El runtime incorpora un event loop cooperativo basado en `poll`. Las corutinas se suspenden cuando un socket no está listo y se reanudan únicamente cuando el descriptor permite continuar. `spawn` mantiene tareas concurrentes dentro del mismo hilo sin crear un thread por conexión.

```typescript
async function handleClient(connection: TcpConnection): Promise<void> {
  const request: Result<string> = await readTcp(connection, 16384);
  if (request.isOk()) {
    const response: string = "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nHello";
    const written: Result<number> = await writeTcp(connection, response);
    if (written.isOk() == false) { printError(written.error()); }
  }
  closeTcp(connection);
  return;
}

async function serve(): Promise<void> {
  const opened: Result<TcpListener> = listenTcp("0.0.0.0", 8080);
  if (opened.isOk() == false) { printError(opened.error()); return; }
  const listener: TcpListener = opened.value();
  while (true) {
    const accepted: Result<TcpConnection> = await acceptTcp(listener);
    if (accepted.isOk()) { spawn(handleClient(accepted.value())); }
    else { printError(accepted.error()); }
  }
}

await serve();
```

| API | Función |
| --- | --- |
| `listenTcp(host, port)` | Abre un listener no bloqueante y devuelve `Result<TcpListener>`. |
| `acceptTcp(listener)` | Espera una conexión sin bloquear el hilo. |
| `readTcp(connection, maxBytes)` | Lee hasta 1 MiB por operación. |
| `writeTcp(connection, data)` | Escribe todo el buffer respetando backpressure del socket. |
| `closeTcp(resource)` | Cierra una conexión o listener compartido. |
| `sleep(milliseconds)` | Suspende una corutina mediante temporizador. |
| `spawn(task)` | Desacopla un `Promise<void>` para atender trabajo concurrente. |

Las variantes `acceptTcpUntil`, `readTcpUntil` y `writeTcpUntil` añaden timeout y `CancellationToken`. La cancelación despierta inmediatamente el `poll`; no necesita esperar actividad del socket.

## TLS

El módulo `runtime/ets_tls.hpp` usa OpenSSL, exige como mínimo TLS 1.2 y conserva sockets/contextos mediante RAII. Solo se incluye cuando el AST utiliza tipos o funciones TLS, por lo que un programa normal no necesita enlazar OpenSSL.

| API | Función |
| --- | --- |
| `createTlsServer(certificate, privateKey)` | Carga el contexto de servidor. |
| `acceptTls(listener, context, timeout, token)` | Acepta TCP y completa el handshake sin bloquear. |
| `readTls(connection, bytes, timeout, token)` | Lee respetando WANT_READ/WANT_WRITE. |
| `writeTls(connection, data, timeout, token)` | Escribe con backpressure, deadline y cancelación. |
| `closeTls(connection)` | Cierra la sesión y el socket RAII. |

Compilación manual de un programa TLS:

```bash
g++ -std=c++20 -O3 -pthread -fno-exceptions -I. server.cpp -o server -lssl -lcrypto
```

El compilador configurado añade estas dos librerías automáticamente al detectar TLS.

Los fallos síncronos y asíncronos utilizan el mismo `Result<T>` en lugar de excepciones. Antes de llamar a `value()` debe comprobarse `isOk()`; `error()` contiene el diagnóstico. Los handles TCP son valores RAII compartidos: el descriptor se cierra explícitamente con `closeTcp` o cuando desaparece su último propietario.

El backend está dirigido a POSIX. `poll`, TLS y el pool funcionan en Linux/macOS; `io_uring` se activa únicamente en Linux. Por decisión de diseño actual no se incluye backend Windows/IOCP. La capa HTTP ya está entregada en V28 (servidor Express-style + cliente fetch; backend dual cpp-httplib / Drogon; ver `docs/TUTORIAL.md` §16-17). Los ejemplos [http-server.ets](examples/http-server.ts) y [tls-server.ets](examples/tls-server.ts) muestran ambos transportes.

## Imports y grafo de módulos

Los imports con `as` se resuelven en el AST: `{ X as Y }` conserva ámbitos y
`* as model` permite miembros y tipos estáticos. Los helpers genéricos privados
de `etsDefinition` ya se enlazan entre módulos. Alcance, ejemplos y limitaciones
en [docs/import-aliases.md](./docs/import-aliases.md). Default, reexports y listas
multilínea se describen en [docs/module-exports.md](./docs/module-exports.md).

```typescript
import { sumRange, Calculator } from "./math.ts";
import "@core/runtime.ts";
```

El CLI recorre dependencias en orden topológico, analiza el programa completo y genera una unidad C++ independiente por módulo. La cabecera común contiene declaraciones, tipos y cuerpos de plantillas que necesitan los consumidores. También puede incluir tipos privados y declaraciones de helpers alcanzados por `etsDefinition` o plantillas compartidas. Esto no los convierte en exports del dialecto. Las funciones privadas restantes conservan linkage interno en su módulo. Después, el compilador nativo crea un `.o` cacheado para cada unidad y el linker construye el ejecutable final. Los imports no relativos se resuelven mediante `aliases` y después `moduleRoots` de la configuración.

Las funciones, clases, interfaces y variables son privadas al módulo por defecto. Para utilizarlas desde otro archivo deben marcarse con `export` e importarse por nombre:

```typescript
// math.ts
export const base: number = 10;
export function sum(value: number): number { return base + value; }
function internalCheck(): boolean { return true; }

// main.ts
import { base, sum } from "./math.ts";
print(sum(base));
```

Importar `internalCheck`, usar `sum` sin incluirlo en el import o importar un nombre inexistente produce un diagnóstico en el archivo y línea del import. Todas las sobrecargas de una función deben compartir la misma visibilidad. Un import sin nombres únicamente incorpora y ejecuta el módulo por sus efectos laterales.

El frontend todavía utiliza un AST combinado. Los nombres top-level repetidos
entre módulos reciben identidades internas distintas antes del checker,
`comptime` y `@etsgen`, incluidos los privados. Se conservan sobrecargas,
scopes locales y restricciones de visibilidad. Los exports generados deben
anunciarse con `export { nombre }`; las publicaciones no anunciadas conservan
una protección contra colisiones. Ver [símbolos modulares](docs/module-symbols.md).

Cuando hay `@etsgen`, el CLI guarda el ETS original y emite `#line` y
`.map.json` para relacionar tramos C++ con la expansión y su llamada. La
precisión por token y los stacks runtime siguen pendientes. Ver
[mapas de origen C++](docs/etsgen-cpp-source-maps.md).

El objeto global `console` ofrece salida, colores, cursor, limpieza y dimensiones
sin imports. Su header de terminal se incluye solo al usar los controles;
el logging habitual no lo activa. El backend no necesita
bibliotecas de terceros. Ver [terminal](docs/terminal.md) y
`examples/terminal/main.ts`. Teclado y sesiones quedan pendientes.


Un cambio interno que conserva las firmas públicas solo recompila el módulo modificado. Como las declaraciones C++ todavía residen en una cabecera común, un cambio de API pública invalida conservadoramente todos los objetos. Cuando existan cabeceras C++ individuales por módulo, esa invalidación podrá limitarse a sus dependientes transitivos. Las sentencias de nivel superior se ejecutan una sola vez en orden topológico; las variables compartidas deben marcarse con `export` e importarse explícitamente.

## Informe de compilación

Cada ejecución configurada actualiza `build/.estatic/transpiler-report.json`. Es JSON estándar y queda disponible aunque la compilación falle. Su estructura principal es:

```json
{
  "schemaVersion": 1,
  "build": { "id": "...", "status": "succeeded", "durationMs": 29 },
  "dependencyGraph": { "entry": "...", "modules": [] },
  "summary": { "compiled": [], "reused": [], "linked": false },
  "error": null,
  "timeline": []
}
```

El timeline registra resolución de dependencias e imports, parseo por módulo, validación de visibilidad, análisis semántico, generación de la cabecera y los `.cpp`, claves y aciertos de caché, comandos del compilador, `stdout`, `stderr`, código de salida y enlace. `level` puede ser `debug`, `info` o `error`; el nivel mínimo y la ruta se controlan desde `logging` en la configuración.

Estatic admite `.ts` y `.ets`. Los proyectos nuevos usan `.ts`; `.ets` se mantiene para compatibilidad y para distinguir explícitamente Estatic de TypeScript convencional. En imports sin extensión se busca primero `.ts` y después `.ets`; una extensión escrita explícitamente siempre se respeta. Aunque use `.ts`, no se intenta aceptar todo TypeScript: cada feature se incorpora explícitamente al lexer, AST, parser, análisis semántico y backend.

## Arquitectura

```text
src/
├── lexer/       # texto → tokens
├── parser/      # tokens → AST
├── ast/         # contratos neutrales del árbol
├── types/       # representación y operaciones de tipos compuestos
├── semantic/    # símbolos, scopes y comprobación de tipos
├── modules/     # imports, aliases, grafo y detección de ciclos
├── config/      # carga tipada de estatic.config.ts
├── build/       # unidades C++, caché de objetos y enlace incremental
├── codegen/     # AST válido → C++20, tipos y política aislada de parámetros
├── core/        # posiciones, diagnósticos e informe JSON de compilación
├── compiler.ts  # fachada/pipeline
└── cli.ts       # interfaz de línea de comandos
runtime/
├── ets_runtime.hpp # fachada y utilidades C++ compartidas
├── ets_syntax.hpp  # puente Tree-sitter, arena y serialización
├── ets_ast.hpp     # API agregada y compatibilidad del AST
├── ast/            # nodos, tipos, builder, inferencia y serialización
├── ets_async.hpp   # Result, Task, event loop, workers, timers y spawn
├── ets_file.hpp    # archivos síncronos optimizados y corutinas de archivo
├── ets_io_uring.hpp # backend Linux y fallback por capacidad
├── ets_string.hpp  # strings, concat con reserva y conversiones
├── ets_tls.hpp     # TLS 1.2+ mediante OpenSSL
└── ets_net.hpp     # sockets TCP POSIX no bloqueantes
scripts/
├── build-tree-sitter.sh # objetos C cacheados, sin CMake
└── build-ast-dump.sh    # herramienta de inspección del AST
third_party/
├── tree-sitter/            # runtime C fijado y licencia MIT
└── tree-sitter-typescript/ # gramática y parser generado fijados
```

Cada fase depende de contratos de la fase anterior, y el generador solo recibe un AST que ya pasó el análisis semántico. Esto permite añadir arrays, clases o módulos sin mezclar parsing con emisión C++.

Las reglas de arrays, tuplas, firmas de función e instancias genéricas están centralizadas en `src/types/type-system.ts`. Su representación C++ vive en `src/codegen/cpp-types.ts`; el parser solo construye tipos, el analizador semántico valida firmas, capturas, sustituciones e inferencia, y el backend únicamente emite las construcciones C++ correspondientes. Esto permite reparar o ampliar cada responsabilidad por separado.

## Añadir una feature

1. Agregar tokens, si hacen falta, en `src/lexer`.
2. Modelar nodos sin lógica de backend en `src/ast/nodes.ts`.
3. Reconocer la sintaxis en `src/parser/parser.ts`.
4. Definir reglas de tipos y scopes en `src/semantic`.
5. Traducir únicamente nodos válidos en `src/codegen/cpp-generator.ts`.
6. Añadir pruebas positivas y negativas para validar el cambio.

## Editor

- `editors/neovim`: filetype `.ts`/`.ets`, registro del parser y queries de resaltado, scopes, folding, indentación y text objects.
- `editors/vscode`: extensión de lenguaje, resaltado TypeScript con `mut`, configuración de edición y snippets.

Las instrucciones de instalación se encuentran en el `README.md` de cada integración. Diagnósticos, navegación y autocompletado se compartirán más adelante mediante `estatic-lsp`.

El AST de cualquier archivo puede inspeccionarse sin Node:

```bash
scripts/build-ast-dump.sh
build/tools/ets-ast-dump examples/hello.ts
build/tools/ets-ast-dump examples/hello.ts --records
build/tools/ets-ast-dump examples/hello.ts --syntax
```

## Próximas extensiones recomendadas

- Validar con sanitizers el lifetime de libuv y añadir cancelación cooperativa
  a `race` antes de ampliar el runtime concurrente.
- Consolidar `comptime` sobre símbolos resueltos y AST tipado.
- Optimizar cadenas inmutables de `string` y `Array<T>` reutilizando solo
  temporales exclusivos; ver
  [`docs/chained-method-optimization.md`](docs/chained-method-optimization.md).
- Completar límites, backpressure y parsing de bodies en la capa HTTP.
- Cabeceras individuales por módulo para invalidación ABI precisa de dependientes transitivos.
- Cancelación dura de trabajos de archivo ya iniciados mediante `IORING_OP_ASYNC_CANCEL`.
- Source maps entre `.ets` y C++.
- Backend abstracto para generar C++ u otros destinos.

## Estado del dialecto

Esta sección resume lo que **ya está implementado** en el dialecto "Estatic" más allá del subconjunto mínimo documentado arriba. Cada bloque se documentó en su commit correspondiente; aquí solo se listan con un ejemplo.

### Operador ternario `cond ? then : else`

```ets
const grade: string = score >= 90 ? "A" : score >= 70 ? "B" : "F";
```

Right-associative. La condición debe ser `boolean`; las dos ramas deben tener tipos compatibles.

### Literales numéricos no decimales y bitwise

```ets
const hex: number = 0xFF;
const bin: number = 0b1010;
const sep: number = 1_000_000;

const mask: number = 0b1111 | 0b0101;
const shift: number = 0x10 << 2;
```

El dialecto acepta `0x`/`0X`, `0o`/`0O`, `0b`/`0B` (TS estándar) y separadores `_` entre dígitos. Los operadores bitwise `|`, `&`, `^`, `<<`, `>>` y el unario `~` están soportados. `>>>` (logical shift right de JS) **no** se incluye porque no existe en C++ estándar.

### Array destructuring

```ets
const arr: number[] = [10, 20, 30];
const [a, b, c] = arr;
print(a + b + c);  // 60
```

Se desazucara a una variable temporal + N bindings indexados. Cada binding hereda el tipo del elemento (no del array). No hay rest patterns ni default values (esos quedan para una iteración futura).

### `readonly` en campos y constructores

```ets
class Point {
  readonly x: number;
  readonly y: number;
  label: string;
  constructor(x: number, y: number, label: string) {
    this.x = x;
    this.y = y;
    this.label = label;
  }
}
```

Los campos `readonly` solo pueden asignarse dentro del constructor; el semantic checker rechaza asignaciones posteriores con un mensaje claro.

### Math, Date y JSON.parse (stdlib mínima)

```ets
print(Math.floor(3.7));        // 3
print(Math.sqrt(16));           // 4
print(Math.pow(2, 10));         // 1024
print(Date.now() > 0);          // true
const s: string = JSON.parse('"hello"');
print(s);                       // hello
```

`Math` cubre `floor/ceil/round/abs/sqrt/pow/min/max`. `Date` expone `now()` y `utc(year, month, day)` (timestamps numéricos). `JSON.parse` solo maneja literales JSON escalares (`string`/`number`/`true`/`false`/`null`) y devuelve su representación canónica como `string`.

## Limitaciones conocidas

Esta sección documenta **explícitamente** features de TypeScript estándar que el dialecto **rechaza** con diagnóstico claro, y por qué. Para una lista completa de lo que el dialecto NO soporta (incluyendo posposiciones justificadas de Fase 1), consultar [`LIMITATIONS.md`](./LIMITATIONS.md).

**Rechazos irreversibles** (decisiones de diseño del dialecto):

- **`Object`, `any`, `unknown` como tipos dinámicos generales**: los datos
  dinámicos deben modelarse con `JsonValue` o tipos explícitos.
- **`throw` / `try` / `catch`**: el dialecto usa `Result<T, E>` para propagar errores (preserva RAII).
- **Herencia** (`extends`, `implements`): sin polimorfismo dinámico ni vtable.
- **`>>>`** (logical right shift): C++ no tiene equivalente directo.
- **BigInt**: `number` se modela como `double`; no hay un tipo de precisión
  arbitraria del dialecto. La ruta `comptime` i64/u64 usa BigInt internamente
  para conservar sus 64 bits; ver [`docs/comptime-exact64.md`](docs/comptime-exact64.md).
  Las conversiones numéricas, callbacks y promociones se describen en
  [`docs/comptime-numeric-callbacks.md`](docs/comptime-numeric-callbacks.md).
- **`eval`, `arguments`, `with`**: prohibidos por seguridad/rendimiento.

**Features reabiertas o añadidas en Fase 1** (ya soportadas):

- `??` (nullish coalescing) sobre `Optional<T>` (1.3).
- `?.` (optional chaining) sobre `Optional<T>` (1.4).
- Decoradores TC39 stage 3 (1.5).
- Parámetros opcionales `name?: T` (1.6).
- Template literals con `${expr}` (1.7).
- `for await...of` sobre `Promise<T>[]` (1.8).
- `using name = expr` con RAII automático (1.9).
- Match expressions con `when (pattern) => result` (1.10) — **eliminado en V23**, ver `docs/match-syntax.md`.
- **`export default` y `export { x as y }`** (1.15).
- `satisfies` operator con cast implícito (1.11).
- `Promise.all`, `Promise.race`, `Promise.any`, `Promise.allSettled` y
  `Promise.resolve` sobre `Promise<T>[]` (1.13; any, allSettled y resolve en
  v1.10x). Sin excepciones una promesa no se rechaza: `any` se comporta como
  `race` y `allSettled` devuelve `Result<T, Error>[]`, todos correctos.

Cualquier PR que intente reintroducir un rechazo irreversible debe reconsiderar primero la decisión de diseño.

## Productividad del compilador (Fase 2)

Más allá del dialecto en sí, el compilador incluye herramientas que mejoran la experiencia de uso:

### Error reporting legible

```bash
$ etsc src/broken.ts
error[semantic]: Función no definida 'gret'
  --> src/broken.ts:4:1
4 | gret();
  | ^^^^^^
  = hint: ¿Quisiste decir 'greet'?
```

Salida en color cuando stdout es un TTY. Se desactiva con `NO_COLOR=1` y se fuerza en CI con `FORCE_COLOR=1`. Mensajes multi-línea con carets extendidos sobre el span exacto. Sugerencias automáticas cuando hay un identificador similar (Levenshtein ≤ 2).

### Build incremental con `--verbose`

```bash
$ etsc build --verbose
Cargando grafo de módulos...
       1 módulo(s) cargado(s); sintaxis: 0 hit(s), 1 miss(es)
       Calculando digests (runtime + flags)... 0.01s
       Cache miss: no existe el objeto cacheado
       Regenerando .cpp (frontend incremental + type-check + codegen)... 0.04s
       AST cache: 0 reutilizado(s), 1 parseado(s)
       Compilando a objeto (g++)... 0.38s
       Enlazando binario (g++)... 5.62s
       Binario: /tmp/inc-build/build/app (28,000 bytes)
Build incremental (miss): 1 módulo(s) compilado(s), 0 reutilizado(s), re-enlazado, 6305ms
```

`--verbose` imprime las duraciones medidas de lectura del grafo, restauración/parseo, resolución, checker fuente/final, `comptime`, expansión `@etsgen`, generación de cabecera/unidades, escritura, compilación y enlace. Cada build exitoso guarda `build/.estatic/cache/build-profile.json`, con los tiempos de esta ejecución, contadores de caché y motivos de cambio por módulo. `-v` queda reservado para mostrar la versión.

Desde v47 no se genera el PCH que el incremental no utilizaba, se conservan los archivos generados idénticos y los hits no sobrescriben la cabecera común. El manifiesto `module-interfaces.json` registra huellas de interfaces, implementaciones y dependencias como base del futuro checker incremental; todavía no omite validaciones semánticas. Para medir un proyecto reproducible: `node --experimental-strip-types scripts/benchmark-incremental.ts` (acepta la ruta de otro checkout para comparar).

### Página web de demos auto-generada

```bash
$ npm run demos
Generando docs/demos.html (50 ejemplos, 13 categorías)...
Listo.
```

[`docs/demos.html`](./docs/demos.html) muestra todos los ejemplos con su código fuente y salida esperada, organizados por categoría y con búsqueda visual. Se regenera desde `examples/` y `test/golden/` en cada ejecución.

## Productividad del desarrollo (Fase 3)

### Watch mode

```bash
$ npm run watch
watch: vigilando /mi-proyecto
cambio: src/main.ts
→ re-compilando
Build incremental (hit): 0 módulo(s) compilado(s), 2 reutilizado(s), 45ms
✓ ok en 0.39s
```

Debounce 100ms para agrupar cambios rápidos. Filtra `.ets`/`.ts`. Spawn del CLI en subproceso para aislar el watcher del build.

### Tests en paralelo con worker pool

```bash
$ npm test
✔ examples (50/50)
✔ checker (78/78)
ℹ tests 128
ℹ pass 128
ℹ duration_ms 88042
```

El runner usa un pool de workers (default = `cpus().length`) configurable con `TEST_CONCURRENCY=N`. Cada worker tiene su scratch dir (`test/scratch/wN/`) para evitar colisiones. Speedup medido: **2.85x** (5:00 → 1:44 sobre la suite completa).

Para CI sin acceso a red:

```bash
$ SKIP_NETWORK=1 npm test
ℹ skip-network: solo transpile + compile + link
ℹ tests 128
ℹ pass 128
```

Los ejemplos marcados como `network` en `test/skip-network.json` se compilan pero no se ejecutan.

## Ejemplos disponibles

El directorio `examples/` contiene 50 ejemplos cubriendo todas las features del dialecto. Cada uno tiene su golden file en `test/golden/`.

**Página web auto-generada**: [`docs/demos.html`](./docs/demos.html) muestra todos los ejemplos con su código fuente y salida esperada, organizados por categoría y con búsqueda visual. Para regenerarla después de añadir ejemplos:

```bash
npm run demos
```

| Categoría | Ejemplos |
|---|---|
| **Hello world** | `hello.ts` |
| **Constructores y clases** | `constructor-demo.ts`, `complete-demo.ts`, `composition.ts`, `interface.ts`, `mutable-borrows.ts`, `default-args-demo.ts` |
| **Genéricos y tipos** | `generics.ts`, `overloads-variadics.ts`, `union-demo.ts`, `intersection-demo.ts`, `type-aliases.ts`, `default-type-params.ts`, `typeof-type.ts`, `typeof-value.ts`, `function-type-demo.ts` |
| **Colecciones y arrays** | `collections.ts`, `map-set-demo.ts`, `spread-array-demo.ts`, `destructuring-demo.ts`, `destructuring-default.ts` |
| **Async y promesas** | `async-await.ts`, `async-files.ts`, `cancellation.ts`, `for-await-demo.ts` |
| **Closures y funciones** | `closures.ts`, `for-of-demo.ts`, `for-in-demo.ts`, `match-demo.ts`, `using-demo.ts` |
| **Stdlib runtime** | `math-date-demo.ts`, `numeric-literal.ts`, `enum-demo.ts`, `delete-demo.ts`, `instanceof-demo.ts` |
| **JSON y strings** | `json-tree-demo.ts`, `template-strings-demo.ts` |
| **Tipos nullish** | `optional-demo.ts`, `nullish-coalescing-demo.ts`, `optional-chaining-demo.ts`, `optional-parameter-demo.ts` |
| **Decoradores** | `decorator-demo.ts` |
| **Módulos** | `exports-demo.ts` |
| **I/O nativo** | `native-io.ts`, `fs-demo.ts`, `result-files.ts`, `node-api-demo.ts`, `console-demo.ts` |
| **Red y TLS** | `http-server.ts`, `tls-server.ts` |

Para ejecutar un ejemplo:

```bash
node --experimental-strip-types src/cli.ts examples/hello.ts -o hello.cpp --unity
g++ -std=c++20 -fno-exceptions -pthread -I. hello.cpp -o hello
./hello
```

O directamente con `npm start -- examples/<nombre>.ts -o <salida>.cpp` y luego compilar con `g++`.

## Dirección y estado del proyecto

- [`docs/vision.md`](./docs/vision.md) describe la filosofía a largo plazo.
- [`status.md`](./status.md) mantiene el estado verificable y el orden de
  trabajo actual.
- [`LIMITATIONS.md`](./LIMITATIONS.md) es la referencia de compatibilidad.
- Los planes antiguos se conservan únicamente en
  [`docs/historical/`](./docs/historical/).

El runtime usa libuv como backend async. La capa HTTP ofrece cpp-httplib y
Drogon. El antiguo servidor HTTP experimental se ha retirado. Consulta el estado antes de
usar estos componentes en producción: falta validación nativa completa y
persisten límites de cancelación y crecimiento de memoria documentados en
[`docs/MEMORY-AUDIT.md`](./docs/MEMORY-AUDIT.md).

## Tests

```bash
# Suite del proyecto: unitarias y ejemplos deterministas
npm test

# Auditoría nativa de memoria; requiere libuv y sanitizers disponibles
npm run test:memory

# Límites HTTP: cola y rechazo de cuerpos grandes en loopback (sin libuv)
npm run test:http-limits

# Routing HTTP: parametros por ruta y busqueda case-insensitive de cabeceras
npm run test:http-routing

# E2E por buckets
npm run test:e2e
```

La última verificación del conjunto estable registrada en `status.md` pasó 1899 pruebas
unitarias. El número puede cambiar al añadir casos; no se mantiene como una
constante manual en este README.

## Autoalojamiento

El frontend nativo de [`compiler/`](./compiler/README.md) ya ejecuta lexer,
parser, resolución de módulos, expansión @etsgen, binder, tipos,
seguridad/efectos, comptime y procedencia por archivo. `src/` sigue siendo stage 0:
construye los ejecutables nativos y conserva el CLI/codegen actual. El binario
ETS analiza las fuentes solicitadas sin delegar ese análisis al checker TS.

```bash
npm run bootstrap:lexer -- 'const x: number = 1;'
npm run bootstrap:frontend -- --file examples/hello.ts
npm run bootstrap:checker -- examples/hello.ts
npm run audit:bootstrap
npm run audit:bootstrap:syntax
npm run audit:bootstrap:self
```

La [revisión reproducible de 2026-10-24](./compiler/audit/FRONTEND-REVIEW.md)
pasa **2182/2182** pruebas del frontend, **83/83** obligaciones de referencia y
**75/75** contratos de sintaxis. Ambos pipelines parsean **132/132** archivos del
corpus; el checker acepta 131 y rechaza el ejemplo privado inválido esperado.
El autoanálisis nativo termina con **23 módulos, 6594 símbolos y cero diagnósticos**.
Estas muestras no certifican por sí solas cierre completo ni equivalencia formal.

La salida actual contiene un AST por archivo y tablas semánticas laterales.
Los enums internos del AST conservan nombres legibles en JSON. Los tipos del
checker siguen siendo strings canónicos; la caché persistente nativa almacena
sintaxis, no resultados semánticos. El [IR nativo `ets-ir-2`](./compiler/ir/README.md)
consume estas tablas y añade lowering/verificación de agregados, clases,
genéricos, closures, variantes, recursos, préstamos y async. El backend C++ del IR tiene una entrada separada; siguen pendientes scheduler
concurrente y compilación completa del compilador por sí mismo.

El [CLI general de bootstrap](./compiler/CLI.md) conecta el frontend nativo,
el IR verificado y C++, reutilizando el runtime existente:

```sh
npm run bootstrap -- examples/interface.ts --run
```

Incluye métodos de interfaces/intersecciones y HTTP con cpp-httplib/Drogon y
cliente libcurl. La selección `@cpp_drogon` y los wrappers son los existentes.

El backend C++20 del IR ya está disponible mediante `npm run bootstrap:ir:cpp --
examples/hello.ts --run`. Consume las tablas verificadas de `ets-ir-2` y
reutiliza el runtime de `src/`, con capacidades y límites documentados en
[`compiler/ir/CPP.md`](./compiler/ir/CPP.md). El CLI histórico permanece
separado durante la validación de este recorrido.

El [inventario vigente](./compiler/PENDING.md) separa implementación ejercitada,
restricciones explícitas y obligaciones y límites del [IR común](./compiler/checker/IR.md).
Los checkpoints anteriores están archivados; los límites de stage 0 no se
atribuyen automáticamente al frontend ETS. La arena actual del parser puede
alimentar el IR sin un rediseño previo del almacenamiento de nodos.

## Licencia

MIT — ver [`LICENSE`](LICENSE).
