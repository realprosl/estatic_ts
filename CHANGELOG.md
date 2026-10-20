# Changelog

Todas las versiones siguen [Semantic Versioning](https://semver.org/).

## Sin publicar (2026-10-20)

### Added

- Caché persistente anterior al `.o`: escaneo de imports/exports y AST por
  contenido de módulo, más snapshots completas de transpilación. El incremental
  carga el grafo una sola vez; cambiar un archivo sólo vuelve a escanear y
  parsear ese módulo, y cambiar únicamente flags/runtime reutiliza parse,
  type-check, `comptime`, `@etsgen` y codegen. La API informa `hit`, `partial` o
  `miss` y el número de AST restaurados/parseados.
- Los manifests de objeto incluyen ahora el hash de la cabecera común además
  del C++ de la unidad y el entorno nativo, evitando reutilizar un `.o`
  incompatible cuando cambia una declaración compartida. Dos regresiones
  cubren invalidación por módulo, restauración de snapshot y recompilación de
  un único objeto. Suite estable acumulada: 1127/1127. Versión
  `estatic 1.8.0 (v46)`. Ver `docs/transpilation-cache.md`.

### Removed

- Retirado el servidor HTTP experimental antiguo y su parser en desarrollo.
  Se mantienen cpp-httplib por defecto y Drogon con `@cpp_drogon`. Actualizadas
  las referencias de documentación, ejemplos y scaffolding.

### Changed

- Añadido `types/estatic.d.ts` como fuente canónica de las declaraciones del
  editor. `etsc init` copia sus bytes y `etsc update-types [directorio]`
  actualiza proyectos existentes conservando `.bak`. Sincronizados `Console`,
  timers, watchers, DNS, filesystem async, red/TLS, cancelación, io_uring,
  cliente HTTP async y todas las funciones del registro builtin. Una prueba
  falla si se registra una función, interfaz o clase sin declaración. Suite
  estable acumulada: 1125/1125.
- `etsc --version` y `etsc -v` muestran la versión semántica y la revisión:
  `Ts2cpp 1.7.0 (v45)`. `-v` deja de significar verbose; esa modalidad conserva
  el nombre explícito `--verbose`.

- Los 17 controles de terminal pasan al objeto global existente `console`;
  se retira el builtin `term`. Se conservan log/info/debug/trace/warn/error y
  los handles pueden usar ambos grupos. El header especializado solo se incluye
  para métodos de terminal; `console` no fuerza el runtime async completo.
  Soporte de consola en `--minimal` y corrección de una declaración JSON
  prematura/duplicada en ese runtime. Se unifica también el backend C++ en `ets_console`, con declaraciones comunes
  y definiciones inline bajo demanda. Seis regresiones adicionales, cuatro
  nativas. Suite: 1118/1118. Ver docs/terminal.md.

### Added

- Objeto global ETS `term` con 17 métodos para salida, estilos, cursor,
  limpieza y dimensiones. Backend C++ propio sin bibliotecas de terceros;
  inclusión semántica del header solo al usarlo, incluidos aliases y `@etsgen`.
  Pipes sin ANSI, NO_COLOR, TERM=dumb, límites de coordenadas y restauración
  normal best effort. Declaraciones del editor y ejemplo incluidos.
- 47 pruebas, ocho nativas y cuatro con PTY Linux; cabecera standalone con
  warnings como errores. Suite estable: 1112/1112. Windows/macOS implementados
  sin validación nativa; teclado y sesiones pendientes. Ver docs/terminal.md.

### Fixed

- Reanclado de las líneas C++ seguras a la línea del nodo ETS generado: las
  firmas con `template` ya no desplazan el diagnóstico. El seguimiento léxico
  preserva raw strings, comentarios, macros, CRLF y splices, y evita interpretar
  marcadores dentro de sus payloads. Caché incremental invalidada por versión
  del materializador. Añadidas 15 pruebas, dos nativas; suite: 1065/1065.
  Siguen pendientes tokens/columnas y tramos opacos. El siguiente bloque de
  terminal queda definido como objeto global `term`, sin dependencias de terceros.

- Mapas de origen C++ para `@etsgen`: comentarios ligados al span AST se
  materializan como `#line` tras el layout final en unity, multi e incremental.
  ETS original automático, sidecars de rangos, aliases y llamada local al módulo,
  cadenas de expansión y retorno al archivo/línea C++ física. El incremental
  reconstruye mapas/fuentes borrados y los hashes usan C++ materializado.
  Añadidas 18 pruebas, cinco nativas con g++. Suite: 1050/1050. Es un mapa por
  tramos; faltan tokens/columnas, cobertura total, enlace y stacks de runtime.
  Ver docs/etsgen-cpp-source-maps.md.

- Aislamiento de homónimos fuente entre módulos, incluidos privados, mediante
  bindings de AST antes de combinar y evaluar. Se conservan sobrecargas,
  capturas, aliases y diagnósticos originales. Los constructores C++ de unions
  normalizadas reciben nombres distintos; los bindings de destructuring modular
  tienen almacenamiento accesible desde funciones y se inicializan en el init.
  Actualizadas 18 regresiones y añadidas nueve, cinco nativas. Suite: 1032/1032.
  Ver docs/module-symbols.md. Siguen pendientes identidades universales y source maps.

- Imports de nombres publicados por `@etsgen`: reservas explícitas mediante
  `export { nombre }`, aliases, default, reexports y namespaces. Se comprueba
  que la expansión publique cada nombre, incluso sin consumidores, y se conserva
  la visibilidad de llamadas generadoras eliminadas. El parser conserva las
  llaves literales de plantillas ETS fuera de `${...}`. Añadidas 28 pruebas,
  cinco con compilación/enlace/ejecución C++20. Suite: 1023/1023. Ver
  docs/generated-module-exports.md. Próximo: aislamiento universal y source maps C++.

- Tabla pública de exports con identidad de declaración: defaults de funciones,
  clases y expresiones, exports locales/imports reenviados, cadenas y diamantes,
  estrellas con ambigüedad explícita y namespaces estáticos anidados. Los defaults
  de expresión se evalúan en su sentencia; los exports nombrados conservan el
  binding vivo. Las funciones/clases default admiten nombres y formas anónimas.
- El descubrimiento de dependencias usa tokens y preserva offsets, CRLF y líneas:
  imports mixtos, listas multilínea y comentarios. El AST modular se parsea una
  vez por módulo y se combina tras normalizar exports, sin perder sus bindings.
  Añadidas 29 pruebas, cinco con compilación/enlace/ejecución C++20 entre módulos.
  Suite validada: 995/995. Ver docs/module-exports.md. Siguen pendientes imports
  de nombres generados, aislamiento universal y source maps C++.

- Imports `{ X as Y }` con binding real en AST: el grafo conserva nombre
  exportado/local y se actualizan destinos y referencias respetando scopes,
  espacios de tipos, propiedades y etiquetas. Namespaces `* as model` admiten
  miembros y tipos estáticos. Se aíslan exports homónimos normalizados, se
  conservan aliases en generación ETS y `etsDefinition`, y se invalida la caché
  al cambiar solo los imports. Las pruebas previas solo comprobaban la regex.
- Funciones genéricas exportadas y helpers de `etsDefinition` entre módulos
  emiten cuerpos en el header; sus dependencias privadas reciben el linkage
  necesario, también las genéricas transitivas. Añadidas 31 pruebas, cinco
  compilan y ejecutan C++ con unidades separadas. Suite: 966/966. Ver
  docs/import-aliases.md. Re-exports/default completos, descubrimiento multilínea,
  imports de nombres generados y source maps C++ siguen pendientes.

- `@etsPublish` conserva nombres públicos en declaraciones ETS generadas para
  usarlos desde el caller. Los chequeos intermedios y el punto fijo de expansión
  permiten publicaciones hijas sin borrar errores fuente antes de comptime.
  `etsDefinition` selecciona variables y funciones top-level del módulo del
  generador, con linkage C++ para helpers privados entre unidades sin exportarlos
  semánticamente. Se revalidan visibilidad y colisiones tras expandir.
  `--emit-etsgen` guarda ETS original y procedencia en disco. Corregida la pérdida
  de decoradores de clases y destructuring y de etiquetas inválidas de argumentos
  durante revalidaciones. Añadidas 26 pruebas; suite de 935/935 y dos pruebas
  nativas nuevas, incluida compilación con dos unidades. Ver docs/etsgen-publication.md.
  Siguen pendientes los
  imports de nombres generados, la higiene modular completa y los source maps C++.

- Higiene léxica de bindings privados en Estatic generado por @etsgen: se
  asignan identidades y nombres frescos al AST parseado y se actualizan sus
  referencias sin sustituir strings ni nombres de campos. Registra bindings
  y capturas por fragmento, conserva referencias externas legacy y añade
  etsCapture("nombre") para elegir explícitamente una captura del caller.
  Las expansiones hijas preservan el entorno renombrado del padre. La fase
  expande llamadas generadas con selección semántica de sobrecargas y límites
  por árbol de profundidad, cantidad y bytes. Los diagnósticos conservan fuente
  y muestran nombres originales. Añadidas 20 pruebas, 15 fallan contra v34;
  tres verificaciones nativas incluyen ámbitos, tipos, capturas hijas y módulos
  enlazados. Ver docs/etsgen-hygiene.md. El bloque posterior añade publicación
  y referencias de definición explícitas; no higiene modular completa.

- `@etsgen` conserva Estatic como salida: se parsea y sus sentencias se
  incorporan al AST normal, se validan en contexto y se emiten por el backend
  ordinario. Eliminada la extracción de cuerpos C++ y su salida RawCpp.
  Cada expansión conserva fuente, identificador y coordenadas; los diagnósticos
  muestran la llamada y una segunda ubicación en el fragmento Estatic, incluido
  parseo, módulos y revalidación. Las posiciones primarias se atribuyen al módulo
  del caller. Añadidas 12 regresiones, todas fallan contra v33; una ejecuta una
  función generada con C++20. Actualizadas las aserciones antiguas que esperaban
  RawCpp en `@etsgen`; `@cppgen` conserva su comportamiento. Ver docs/etsgen-ast-pipeline.md.

- Bloque conjunto de callbacks, flotantes y promociones de comptime. Una tabla
  compartida define promociones C++20 para los tipos numéricos modelados;
  i8/u8/i16/u16 ascienden a i32, se combinan ancho/signo y f32/f64/number.
  El evaluador opera enteros promovidos exactamente, comprueba overflow firmado,
  envuelve unsigned y aplica el ancho del operando izquierdo en shifts.
  Los destinos flotantes redondean f32, incluido u64 sin doble redondeo;
  el backend conserva casts directos a destino, -0.0 y literales exponenciales.
  Los callbacks arrow convierten parámetros, retornos, resultados map y
  acumuladores reduce. Corregidos reduce(init, callback), comparadores sort
  binarios, flatMap y deducción de map sin tipo explícito. La compatibilidad
  de firmas permite adaptar componentes numéricos por valor y mantiene
  invariantes los no numéricos. Añadidas 50 pruebas (41 fallan contra v32),
  matriz de 121 pares y tres verificaciones nativas. Ver docs/comptime-numeric-callbacks.md.

- Los literales agregados comptime convierten sus elementos numéricos al
  destino tipado (vectores, arrays fijos, tuplas y campos de interfaces).
  El checker conserva el tipo destino del campo, incluidos aliases, sin
  reemplazar el tipo fuente usado para validar conversiones desde flotantes.
  Los arrays anidados ya no se aplanan sin spread. El backend C++ emite casts
  numéricos para elementos de vectores y tuplas y evita narrowing implícito.
  Añadidas 23 regresiones; 22 fallan contra v31. Una verifica arrays y tuplas
  mediante C++20 con -Werror=narrowing. Ver docs/comptime-aggregate-integers.md.

- Las conversiones implícitas a enteros del intérprete principal se aplican
  en declaraciones escalares, asignaciones simples y compuestas, parámetros
  de funciones nombradas y retornos de funciones/arrows. También se normalizan
  globals capturados y escrituras en campos/índices escalares tipados. El tipo
  de retorno se restaura al salir de llamadas anidadas. Añadidas 23 regresiones,
  todas fallan contra v30; una compara el resultado con ejecución C++20.
  Quedan pendientes promociones, inicializadores agregados, parámetros de
  callbacks y conversiones de destino flotante. Ver docs/comptime-implicit-integers.md.

- Los casts explícitos comptime i8/u8/i16/u16/i32/u32/i64/u64 aplican
  conversión modular C++20 entre enteros sin perder los 64 bits. Las entradas
  flotantes truncan hacia cero y rechazan valores no finitos o fuera de rango.
  Añadidas 18 regresiones, incluida comparación nativa de 14 conversiones.
  La cobertura de conversiones implícitas escalares se amplía en la entrada anterior.

- La ruta i64/u64 del intérprete principal almacena BigInt, lee literales
  desde el token y sintetiza metadatos decimales exactos serializables en AST.
  Conserva resultados e intermedios fuera de 53 bits. El backend emite
  constantes enteras tipadas, opera y compara i64/u64 sin double y conserva
  sus argumentos, print y concatenación. Math y @etsgen rechazan conversiones
  grandes no soportadas mediante códigos estables. Añadidas 28 regresiones;
  25 fallan contra v28 y una ejecuta C++20. La tabla de conversiones, el
  mini-evaluador y la contabilidad real de recursos siguen incompletos.
- El intérprete principal calcula operadores i64/u64 con BigInt interno:
  división truncada, bits de 64 posiciones y wrap unsigned. Rechaza overflow
  signed, shifts fuera de 0..63 y resultados no almacenables exactamente en
  su representación JS actual. Conserva i64/u64 a través de unarios; el parser
  reconoce <<, >> y ~ sin cambiar tokens de cierres genéricos. Añadidas 21
  regresiones, 19 fallan contra v27 y una ejecuta C++. No implementa todavía
  almacenamiento exacto de todo i64/u64 ni unifica el mini-evaluador @etsgen.
- La expansión de aliases desciende bajo todas las dimensiones de arrays
  dinámicos y conserva la ruta activa de aliases al expandir y validar.
  Ciclos a través de arrays producen diagnósticos en lugar de RangeError.
  Añadidas 12 regresiones, 11 fallan contra v27 y una ejecuta C++.
- E4210 sigue procedencia de closures en arrays dinámicos por literales,
  spread, aliases, push, índices, destructuring, for..of y métodos con resultado
  portador de closures. Las escrituras se agregan sin distinguir índices;
  sigue siendo conservador e incompleto. `push` ahora valida el tipo del
  argumento y registra mutación capturada. Añadidas 17 regresiones; 15 fallan
  contra v26 y una compila y ejecuta C++20. No cubre campos, otros contenedores,
  efectos interprocedurales ni callbacks retenidos.
- Protección parcial `CLOSURE_REFERENCE_RETURN` (`E4210`): rechaza retornos
  de tipo función con procedencia conocida de closures capturadas por
  referencia. Un grafo por identidad propaga inicializadores, aliases,
  reasignaciones, condicionales y dependencias transitivas; las llamadas que
  devuelven funciones propagan callee y argumentos conservadoramente. Incluye
  retornos implícitos de arrows y diagnósticos modulares. Añadidas 19 pruebas;
  13 fallan contra v25, una compila y ejecuta C++20. No cubre contenedores,
  campos, callbacks retenidos ni escapes completos y puede rechazar casos
  seguros por su análisis insensible al flujo.
- Las capturas de lambdas se registran durante la resolución semántica por
  identidad de símbolo, incluyendo callees locales y dependencias transitivas.
  Parámetros y bindings interiores ya no se confunden con capturas del padre;
  el sombreado de globales y bloques conserva los usos externos reales. Las
  mutaciones se propagan a las lambdas exteriores, incluida asignación
  compuesta, y cada referencia explícita recibe su propio `&`. El backend
  aplica sus renombrados a las capturas sin descartar locales homónimos de
  namespaces. Añadidas 16 regresiones, cinco nativas; nueve fallan contra v24.
  No añade análisis de escape ni garantiza lifetime de closures mutables.
- Retirada la fusión insegura de `filter().map().reduce()`: intercalaba efectos
  de callbacks entre etapas y generaba una lambda sin capturas que no compilaba
  con arrays locales, parámetros y valores capturados. Se usan los helpers
  eager por `const&`, sin mover la fuente. Añadidas nueve regresiones, tres de
  compilación y ejecución C++20. Se recuperan vectores intermedios; no se afirma
  mejora de rendimiento ni fusión segura, que continúa pendiente.
- El código de sentencias producido por `@etsgen` pasa una validación semántica
  en el contexto léxico de cada llamada antes de emitir C++. Se conservan las
  capturas del caller y se detectan tipos incompatibles, nombres inexistentes,
  mutaciones de `const` y colisiones del mismo bloque. El emisor usa tipos
  reales y ya no convierte excepciones en comentarios C++. Los errores de
  parseo, semántica, contexto y emisión son diagnósticos estructurados. El AST
  generado se conserva como metadatos para detectar cabeceras y backends sin
  emitirlo dos veces. Añadidas 22 regresiones; 16 fallan contra v22. No
  implementa higiene completa ni expansión recursiva del texto generado.
- El mini-evaluador de `@etsgen` tiene presupuestos por generación para
  instrucciones, profundidad de evaluación y valores UTF-8, más un límite del
  texto generado antes de parsearlo. Las llamadas anidadas comparten esos
  contadores; las generaciones independientes no los acumulan. Recursión
  directa y mutua producen diagnósticos estructurados en vez de `RangeError`.
  Opciones inválidas se rechazan; las limitaciones de sintaxis y el fallback
  runtime no cambian. Añadidas 20 regresiones; 16 fallan contra v21. El
  intérprete sigue separado y no hay un límite global de compilación.
- Los diagnósticos de `comptime` conservan el `Span` completo del parser en
  lugar de usar línea cero y convertir offsets en columnas. Los límites de
  instrucciones y valores reciben el nodo que se estaba evaluando; `Math` y
  `@cppgen` ya no descartan sus coordenadas al delegar. `compileFile` remapea
  también los offsets al texto del módulo, además de líneas, archivo y fuente.
  Añadidas 17 regresiones; todas fallaban antes. No añade source maps de C++
  ni del texto generado por `@etsgen`.
- El presupuesto de valores de `comptime` cuenta payload UTF-8 de strings y
  claves, comprueba argumentos y resultados, y factura crecimiento por `push`,
  índices y campos. Concatenación, templates y `join` comprueban el tamaño antes
  de construir el string final. Las mutaciones rechazan ciclos antes de
  introducirlos; ya no terminan en `RangeError` al emitir literales. Nuevos
  códigos `COMPTIME_VALUE_LIMIT` y `COMPTIME_CYCLIC_VALUE`. Corregido también
  `array.length`, cuya rama quedaba detrás de un guard inalcanzable. Añadidas
  28 regresiones; 24 fallan contra v19. El contador sigue siendo conservador y
  acumulativo, no una medición del heap real.
- El intérprete principal de `comptime` aplica instrucciones, profundidad y
  estimación de valores por evaluación raíz, no por programa. Los intentos
  preliminares de calcular inicializadores tienen presupuesto independiente y
  lo limpian incluso al fallar. Helpers, callbacks y llamadas anidadas siguen
  consumiendo el presupuesto del caller. Añadidas 16 regresiones; 10 fallan
  contra v18. Ejemplo nativo con cuatro evaluaciones independientes y salida
  verificada `1400`. La estimación de memoria sigue siendo aproximada.
- Los evaluadores de `comptime`, `@comptime`, `@cppgen` y `@etsgen` reutilizan
  la sobrecarga elegida por el checker en cada llamada. Las declaraciones ya
  no se sobrescriben por nombre ni se adivinan a partir de valores JavaScript.
  Los decoradores se consultan en la firma seleccionada, de modo que una
  sobrecarga runtime homónima no se transforma accidentalmente. Las APIs
  directas sin resolución semántica rechazan sobrecargas desconocidas con
  `COMPTIME_OVERLOAD_UNRESOLVED`. Añadidas 25 regresiones y un ejemplo nativo;
  en la reproducción inicial fallaban 17 de 19 casos.
- `compileFile` rechaza colisiones de símbolos top-level entre módulos antes
  de combinar sus AST. Dos funciones privadas de distinta firma podían
  mezclarse como sobrecargas y `comptime`/`@comptime`/`@etsgen` elegían la última
  declaración. El diagnóstico `MODULE_SYMBOL_COLLISION` señala el módulo
  actual y la primera declaración. Cubre también tipos, destructuring y
  `using`, sin rechazar nombres locales ni sobrecargas del mismo módulo.
  Añadidas 18 regresiones. Es una protección conservadora, no aislamiento
  completo de símbolos; se requiere renombrar los top-level homónimos.
- El compilador valida semánticamente el AST fuente antes de ejecutar
  `comptime` y vuelve a validar el AST transformado. Ya no desaparecen junto
  con el arrow errores de tipos, argumentos, callbacks, arrays o mutaciones de
  `const`. La llamada conserva además el tipo de retorno declarado del arrow,
  incluidos aliases. Añadidas siete regresiones; cinco fallaban antes.
- El visitor de `comptime` ya no clasifica errores inspeccionando frases del
  mensaje. Los valores todavía no disponibles usan el código estable
  `COMPTIME_VALUE_UNAVAILABLE`; TDZ, división por cero y límites continúan como
  errores fatales. Añadidas seis regresiones de clasificación y aplazamiento.
- Las entradas anidadas de `comptime`, `@comptime`, `@cppgen` y `@etsgen`
  restauran el ámbito capturado anterior en vez de borrarlo. Las llamadas entre
  funciones `@comptime` que dependen de parámetros o locales de la función
  exterior ya no se evalúan antes de que esos valores existan. Añadidas ocho
  regresiones de composición, recursión, capturas y call sites independientes;
  cuatro reproducían el fallo anterior.
- `comptime` implementa la zona muerta temporal de `let` y `const`: los nombres
  se reservan al entrar en el bloque y una lectura o escritura anterior a la
  declaración ya no alcanza por error un binding exterior homónimo. Incluye
  destructuring, inicializadores de `for`, callbacks, funciones y capturas
  top-level. Añadidas 12 regresiones; 10 reproducían el fallo anterior.
- `comptime` distingue `return`, `break` y `continue`. Los controles de bucle
  afectan solo al bucle más cercano; `continue` conserva el incremento de `for`
  y un control que intenta escapar de una función genera un diagnóstico.
  Añadidas 16 regresiones de bucles, anidamiento y límites de instrucciones.
- `comptime` usa ámbitos léxicos para bloques, ramas y bucles: las declaraciones
  interiores ya no sobrescriben bindings exteriores ni escapan de su bloque.
  Las asignaciones actualizan el binding más cercano y los callbacks conservan
  el acceso a sus ámbitos padres.
- Los `return` de bloques anidados se propagan hasta la función en vez de
  consumirse prematuramente. El recorrido del AST también aísla bloques y
  contadores de `for`. Añadidas 21 regresiones sin dependencias nativas.
- El evaluador `comptime` aplica cortocircuito real a `&&`, `||` y `??`: ya no
  ejecuta el AST derecho cuando su valor no es necesario. Quince regresiones
  cubren efectos secundarios, errores, evaluación única y el pipeline completo.
- `@cpp_drogon` selecciona el wrapper por el tipo `Server`, explícito o
  inferido, sin exigir que la variable se llame `server`. Cubiertos nombres
  alternativos, `let`/`const`, variables locales y decoradores ajenos.
- cpp-httplib aísla los nombres de parámetros por ruta. Registrar rutas nuevas
  ya no reutiliza nombres de las anteriores ni duplica su historial en handlers.
- `http.header` en cpp-httplib busca sin distinguir mayúsculas y minúsculas,
  igual que el wrapper Drogon. Nueva regresión HTTP real con seis casos en
  `npm run test:http-routing`.
- cpp-httplib aplica por defecto 8 workers fijos, cola de 128 conexiones,
  cuerpos de hasta 1 MiB y timeouts explícitos. La cola saturada cierra la nueva
  conexión; los cuerpos excesivos reciben `413`. Configuración C++ mediante
  `HttplibServerLimits`; API del dialecto pendiente.
- Nueva prueba `npm run test:http-limits` con saturación de cola y HTTP real
  en loopback, sin dependencias de libuv ni Drogon.
- Eliminada la caché ilimitada de query strings del backend Drogon. El lookup
  no conserva estado entre peticiones y mantiene la semántica previa.
- Nueva regresión C++ standalone de queries, sin dependencias de Drogon/libuv,
  integrada en las pruebas unitarias y en `npm run test:memory`.
- `Promise.race` ya no destruye los frames perdedores mientras timers, polls o
  trabajos bloqueantes conservan sus handles. El event loop toma ownership y
  los libera al terminar.
- `timeout<T>` vuelve a instanciar correctamente: construye el vector de
  candidatos y devuelve directamente el valor ganador.
- Nueva regresión nativa `test_race_lifetime.cpp`, integrada en
  `npm run test:memory`, para `race<T>`, `race<void>` y `timeout`.

## v1.6.0 (2026-10-11) — V30.6.0 install declarativo + AST detection

V30.6.0 cierra la cadena de bugs de "clone fresco no compila" (PRs
#169, #170, #171) con un rediseño basado en tres piezas:

### Added

- **`scripts/postinstall.sh`**: nuevo script ejecutado por npm al
  instalar el paquete. Detecta la distro (debian/ubuntu/fedora/arch/
  alpine/macos), comprueba que `libuv-dev`, `libcurl-dev`, `libssl-dev`
  están instaladas (instruye al usuario o las instala con `--with-sysdeps`),
  y pre-compila el runtime a `.o` cacheados en `build/`. Sin este paso,
  el primer build del usuario (sobre un clon fresco) fallaba con errores
  crípticos de linker porque `build/` está en `.gitignore`.

- **`src/modules/runtime-backends.ts`**: nuevo módulo con
  `detectRuntimeBackends(program)` que recorre el AST y declara
  qué backends runtime necesita el programa (libuv, curl, tls,
  io_uring). Reemplaza la heurística de "escanear includes del
  cpp" (PRs #169, #170, #171) que era frágil y se rompía con
  bundles como `runtime/ets_runtime_full.hpp`.

- **`etsc` global**: comandos binarios renombrados de `estatic*`
  a `etsc*` (incluyendo el principal). El postinstall ofrece
  `npm link` (con confirmación interactiva) para que `etsc` esté
  disponible globalmente.

- **Shebangs con `--experimental-strip-types`**: los 7 entrypoints
  (`src/cli.ts` + `src/tools/*.ts`) usan
  `#!/usr/bin/env -S node --experimental-strip-types --no-warnings`
  para que el symlink global funcione sin flags manuales.

### Changed

- **`ModuleCompilationResult.runtimeBackends`**: nuevo campo con
  la info de qué backends necesita el programa. `cli.ts` y
  `incremental-builder.ts` lo consultan en vez de escanear
  el cpp.

- **`incremental-builder.ts`**: ya no intenta compilar el
  runtime. Si los `.o` no existen, falla con un mensaje claro
  apuntando a `npm install`. El pre-compile de #171 se elimina
  (es responsabilidad del postinstall).

- **Detección de TLS y curl**: además de libuv, el cli detecta
  desde el AST si el programa usa TLS (y añade `-lssl -lcrypto`)
  o curl (y añade `-lcurl`).

### Tests

- **`test/unit/runtime-backends.test.ts`** (nuevo): 13 tests
  unitarios que verifican la detección de libuv, tls, curl y
  io_uring, incluyendo llamadas dentro de lambdas, if/else,
  bucles y awaits.

- Suite estable: 72 OK / 4 FAIL pre-existentes (async-files,
  match-union-demo, match-v2-demo, template-strings-demo).
  0 regresiones. `etsc` global probado en un proyecto nuevo
  desde otra carpeta: rc=0, binario linkeado contra `libuv.so.1`.

## v1.5.1 (2026-10-11) — V30.5.2 match: V23 con discriminator sobre union compila

V30.5.2 cierra dos limitaciones pre-existentes que V30.5.1 (PR #167)
dejo documentadas:

1. **V23 con discriminator sobre tagged union no compilaba**: el
   codegen emitia `r.kind == std::string("Success")` cuando deberia
   emitir `r.kind == R_Kind::Success`. Ahora el type-checker anota
   `matchedDiscriminatorType = R_Kind` cuando el subject es una union
   y el discriminator es el campo `kind`, y el codegen emite el
   pattern como miembro del enum del union. Compila out-of-the-box.

2. **`whenType<T>(cb)` ya narrowaba y pasaba el valor al callback**:
   la documentacion de V30.5.1 (incluyendo `docs/match-syntax.md`)
   decia incorrectamente que el callback se invocaba sin args. En
   realidad, el codegen ya emitia
   `auto narrowed = std::get<T>(subj); return cb(narrowed);`. La
   limitacion 2 no existia; era un bug de documentacion. V30.5.2
   corrige la doc para reflejar la realidad: `whenType<T>(cb)` SI
   narrowa y SI pasa el valor al callback (cuando el callback tiene
   1 parametro). Esto se verifica con el test e2e match-type-pattern.

### Fixed

- **Match con discriminator sobre tagged union** (V30.5.2,
  `src/semantic/type-checker.ts:2270-2284` y
  `src/codegen/cpp-generator.ts:1616-1631`): el type-checker anota
  el tipo del discriminator (e.g. `R_Kind`) cuando el subject es
  una union declarada; el codegen emite el pattern como
  `R_Kind::Success` en vez de `std::string("Success")`. La
  comparacion `r.kind == R_Kind::Success` compila.

- **Documentacion `whenType<T>(cb)`** (V30.5.2,
  `docs/match-syntax.md`): se elimino la afirmacion incorrecta
  de que el callback se invoca sin args. La realidad es que el
  callback SI recibe el valor narrowed (cuando tiene 1 parametro).
  Sin este fix, los usuarios escribian codigo incorrecto basandose
  en la doc.

### Test coverage

- **`test/unit/type-checker.test.ts`**: 2 tests nuevos
  (`V30.5.2: match con discriminator sobre tagged union es valido`
  y `V30.5.2: match con discriminator sobre struct no-union es valido`).
- **`test/e2e/basics/match-exhaustive-union/`**: reescrito a
  V23 con discriminator sobre union. Verifica end-to-end que el
  codegen emite el pattern como miembro del enum y que el binario
  compila y ejecuta correctamente. Output: `ok:yes\nerr:7\n`.

## v1.5.0 (2026-10-11) — V30.5.1 match: V23 unica forma, eliminada V2 destructurada

V30.5.1 elimina la sintaxis de match destructurada V2
(`match (r) { case { kind: "X", x }: ...; case _: ...; }`) y unifica
todo a la forma V23 (`match(value, [when(pat, cb), otherwise(cb)])`).
Razon principal: la sintaxis V2 NO era TypeScript estandar, y el
LSP de TS subrayaba `match`, `case`, y `{ kind: ... }` con errores
rojos aunque el codigo compilara. V23 es la unica forma
TS-compatible: el dialecto la emite como una `CallExpression`
regular que el LSP entiende sin subrayados rojos.

### Breaking changes

- **Eliminado: forma V2 destructurada**.
  - El parser rechaza `match (subject) { case ... }` con **E4410**
    "Forma V2 (match(r) { case ... }) eliminada en V30".
  - El type-checker ya no soporta `MatchExpression` con `variantMatch`.
  - El codegen ya no emite el `emitV2Match` (switch sobre `kind_Kind`).
  - Los tests V2 se migraron a V23.
  - Los ejemplos `match-v2-demo.ets` y `match-union-demo.ets` se
    reescribieron a V23.

### Migration

```ets
// Antes (V2, eliminado):
return match (r) {
  case { kind: "Ok", v }: "ok:" + v;
  case { kind: "Err", e }: "err:" + e;
};

// Despues (V30, V23 unica forma valida):
return match(r, "kind", [
  when("Ok",  (x: R): string => "ok"),
  when("Err", (x: R): string => "err"),
]);
```

Para acceder al valor narrowed del payload de una union, usa
`whenType<T>` o un `if (x.kind === "S")` dentro del callback con
discriminador.

### Changed

- **`docs/match-syntax.md`**: reescrito para reflejar la unica forma
  V23. Se elimino la seccion "V2: match (subject) { case ...; }".
  Tabla de evolucion historica: V1.10 → V2 → V23 → V30.

- **`src/project/init-project.ts`**: el shim `types/estatic.d.ts` se
  actualizo el comment del bloque "Match intrinsics" para indicar
  que V23 es la unica forma valida en V30. Las declaraciones TS
  de `when`/`whenType`/`otherwise`/`match` no cambiaron (ya eran
  V23 desde V23.0).

### Fixed

- **Type-checker: el binding de variantes en match V2 sobre
  `Result<T, E>` daba "E" literal en vez del argumento del subject**
  (V30.5.1). El fix aplica `substituteType(payloadType, variantSubs)`
  con los type parameters del subject mas los defaults del union.
  Como V2 se elimino en V30.5.1, el fix ya no es necesario para
  el match, pero los tests unit verifican que `Result<T>.value()` y
  `Result<T>.isOk()` se siguen tipeando correctamente.

## v1.4.0 (2026-10-11) — V30 dialecto async: timers, fs watchers, DNS, await http

V30 expone al dialecto `.ets` las APIs asíncronas que V29 dejó
como wrappers C++ de runtime. Cada feature se entregó en un PR
pequeño para mantener la suite verde en cada paso:

| PR | Feature | Resumen |
|----|---------|---------|
| #160 | V30.1 timers | `setTimeout`/`setInterval`/`cancelTimer` al dialecto |
| #161 | V30.2 fs watchers | `watchFs`/`unwatchFs`/`stopLoop` al dialecto |
| #162 | V30.4 DNS async | `resolveDns` sobre `uv_getaddrinfo` |
| #163 | V30.3 cliente HTTP async | `await http.get/post` con corutinas C++20 |

### Added

- **Timers al dialecto `.ets`** (`runtime/ets_timer.hpp` +
  `src/codegen/cpp-generator.ts`): `setTimeout(cb, ms)`,
  `setInterval(cb, ms)`, `cancelTimer(handle)`. El tipo retornado
  es `Timer` con método `cancel()`. Mapea 1:1 a los wrappers
  C++ de V29.4 sobre `uv_timer_t`. Link con `-luv`.

  ```ets
  let t: Timer = setTimeout(() => print("hola"), 200)
  // ... más tarde:
  cancelTimer(t)
  ```

- **Filesystem watchers al dialecto** (`runtime/ets_fs_watcher.hpp`):
  `watchFs(path, callback, recursive?)` retorna un `FsWatcher`.
  `unwatchFs(handle)` lo cancela. El callback recibe un
  `FsEvent { path: string, flags: number }` con cada cambio.
  Usa `uv_fs_event_t` (inotify/FSEvents/ReadDirectoryChangesW).
  Helper `stopLoop()` para parar el event loop desde un callback.

  ```ets
  let w: FsWatcher = watchFs("/tmp", (ev: FsEvent) => {
    print("cambio: " + ev.path)
  })
  // ... más tarde:
  unwatchFs(w)
  ```

- **DNS asíncrono** (`runtime/ets_dns.hpp`): `resolveDns(host) -> Promise<Result<string, string>>`
  sobre `uv_getaddrinfo`. No bloquea el event loop. Devuelve la
  primera IP del resultado o un string vacío si falla.

  ```ets
  let ip: string = await resolveDns("localhost")
  if (ip == "127.0.0.1") print("ok")
  ```

- **Cliente HTTP async con corutinas** (`runtime/ets_http_curl_async.hpp`):
  `await http.get(url)` y `await http.post(url, body, contentType?)`.
  API del dialecto: `http.get/post` ahora retornan
  `Promise<Result<HttpClientResponse, string>>` (antes `Result<...>`
  síncrono). El wrapper async usa `BlockingAwaiter` + worker thread
  del `blockingExecutor` para que `curl_easy_perform` (bloqueante)
  no bloquee el event loop. La corutina se suspende, el worker
  hace el HTTP request, y cuando termina hace `loop->post(handle)`
  para reanudar la corutina en el event loop.

  ```ets
  let r: Result<HttpClientResponse, string> = await http.get(
    "https://api.github.com/repos/realprosl/Ts2cpp"
  )
  match (r) {
    Result.Ok(v) => print("status=" + numberToString(v.status()))
    Result.Err(e) => print("error: " + e)
  }
  ```

  **Implementación clave**: `BlockingAwaiter` captura
  `loop = &defaultEventLoop` en el thread principal (el que llama
  `await_suspend`), NO en el worker. Esto es crucial porque
  `defaultEventLoop` es `thread_local`: cada thread tiene su
  propia instancia, y postear al loop equivocado perdería la
  corutina.

- **Fix runtime V30.3 prep** (parte de #163): `LibuvEventLoop::runOne()`
  ahora añade un `uv_timer` dummy de 1s al loop cuando no hay
  timers ni polls. Esto fuerza a libuv a entrar en `epoll_wait`
  cuando se hace `uv_run(UV_RUN_ONCE)` con solo `uv_async_t`
  activo (sin esto, libuv retorna inmediatamente por una
  optimización que evita bloquearse sin fds lentos). También se
  eliminó el `uv_async_send(&wake_)` + `uv_run(UV_RUN_NOWAIT)`
  al final de `runOne` que consumía el eventfd signal del thread
  worker antes de que `posted_` estuviera listo. Sin este fix,
  el patrón `syncWait` + `BlockingAwaiter` no funcionaba.

### Changed

- **Type-checker y codegen**: `http.get`/`http.post` ahora
  retornan `Promise<Result<HttpClientResponse, string>>` y se
  traducen a `co_await ::ets::httpClientGetAsync(url)` /
  `co_await ::ets::httpClientPostAsync(url, body, ct)`. El
  include cambió de `runtime/ets_http_curl_client.hpp` a
  `runtime/ets_http_curl_async.hpp` (que arrastra el primero).
  Esto es **breaking** para cualquier código que use
  `http.get`/`http.post` sin `await` (ahora el resultado es
  una `Task<...>`, no un `Result<...>` directo). Solución:
  añadir `await` o usar `ets::syncWait` para esperar.

- **Bugfix pre-existente** (parte de #163): `runtime/ets_async.hpp`
  no tenía `#ifndef ETS_RESULT_DEFINED` antes de `class Result`,
  causando redefinition cuando se incluía junto con
  `ets_http_curl_client.hpp`.

- **Bugfix pre-existente** (parte de #163): `runtime/ets_http_curl_client.hpp`
  tenía `namespace ets` abierto incorrectamente — `HttpClientResponse`
  y `detail::*` estaban en un namespace, y `httpClientGet`/`httpClientPost`
  en otro, con un cierre duplicado. Reestructurado: tres bloques
  `namespace ets { ... }` correctamente cerrados.

### Tests

- `test/e2e/timers/` (V30.1): tests e2e para `setTimeout`,
  `setInterval`, `cancelTimer`. 3/3 verde.
- `test/e2e/filesystem/` (V30.2): tests e2e para `watchFs`/
  `unwatchFs`/`stopLoop`. 2/2 verde.
- `test/e2e/dns/resolve-basic/` (V30.4): test e2e para
  `resolveDns` (loopback + localhost + host inválido).
  1/1 verde.
- `test/e2e/http/async-get/` (V30.3): test e2e del dialecto
  que valida que `await http.get` se transpila a
  `co_await ::ets::httpClientGetAsync(url)`, compila con
  `-lcurl -luv`, y ejecuta el codepath completo. 1/1 verde.
- `runtime/libuv/tests/test_http_async_get.cpp` (V30.3):
  roundtrip real con server cpp-httplib local en :18090,
  3 awaits (basico, json, fallo) validando status/body/headers.
  PASA.
- Suite completa: 63 OK, 28 FAIL pre-existentes, 0 regresiones.

### Documentation

- `docs/TUTORIAL.md`: nueva §19 cubre V30 (timers, fs watchers,
  DNS async, await http.get/post) con ejemplos y referencias.
- Roadmap V30+ actualizado: V30.1-V30.4 marcados como entregados.

## v1.3.0 (2026-10-10) — V29 runtime async sobre libuv + cliente HTTP sobre libcurl

### Added

- **Cliente HTTP sobre libcurl** (`runtime/ets_http_curl_client.hpp`):
  sustituye al cliente sobre TCP plano de V28 (#147). Misma API del
  dialecto (`http.get`/`http.post` -> `Result<HttpClientResponse, string>`);
  el codegen no nota la diferencia. HTTPS, HTTP/2, redirects,
  decompression, connection pooling y timeouts llegan built-in.
  Link con `-lcurl`.

- **Wrappers de timers sobre libuv** (`runtime/ets_timer.hpp`):
  `setTimeout(cb, ms)`, `setInterval(cb, ms)`, `cancelTimer(handle)`.
  Equivalentes JS-style sobre `uv_timer_t`. Son **runtime C++**
  (no se exponen al dialecto en este PR; sera V30+ si se quiere).

- **Wrappers de filesystem watchers sobre libuv**
  (`runtime/ets_fs_watcher.hpp`): `watchFs(path, callback, recursive)`,
  `unwatchFs(handle)`. Usa `uv_fs_event_t` que abstrae inotify (Linux),
  FSEvents (macOS) y ReadDirectoryChangesW (Windows). Runtime C++,
  pendiente exponer al dialecto en V30+.

### Changed

- **libuv es ahora el unico backend de red soportado**. V28
  mantenia dos backends (poll + libuv) seleccionables via
  `-DETS_EVENT_BACKEND_LIBUV`. V29.3 (#157) elimina el backend
  poll y consolida. 17 archivos cambiados, 5 borrados, neto -326
  lineas. Suite e2e pasa identica (67/67 sin red, 64/65 con red,
  1 flake pre-existente). Benchmarks: libuv 32x mas rapido idle,
  430x con 50 pipes.

- `test/e2e/_shared/runner.ts` ya no tiene fallback poll: detecta
  libuv en el sistema y linka los `.o` cacheados (`build/runtime_ets_libuv.o`
  + `build/runtime_ets_net_libuv.o` + `-luv`).

### Removed

- `runtime/runtime_ets_poll.cpp`, `runtime_ets_net.cpp`,
  `runtime/ets_event_loop_poll.hpp`,
  `runtime/ets_event_loop_poll_api.hpp`,
  `runtime/ets_net_poll_api.hpp`: backend poll eliminado.
- `runtime/ets_http_httplib_client.hpp`: cliente sobre cpp-httplib,
  sustituido por libcurl.

### Documentation

- `docs/TUTORIAL.md`: nueva seccion §18 cubre V29 (libuv + libcurl)
  con benchmarks, ejemplos de uso, y roadmap V30+.
- `runtime/libuv/README.md`: actualizado para reflejar que libuv
  es el unico backend desde V29.3.

### Tests

- `runtime/libuv/tests/test_wrappers_v29.cpp`: 5 tests nuevos para
  los wrappers de timers y watchers (setTimeout, setInterval,
  cancelTimer, watchFs, mix). 5/5 verde.
- Suite e2e del dialecto: 67/67 verde sin red, 64/65 con red
  (1 flake pre-existente con SO_REUSEADDR en `tcp-port-error`).

## v1.2.0 (2026-10-10) — V28 cierre del ciclo HTTP

### Added

- **API de string estilo TypeScript** (24 métodos sobre `string`,
  byte-level): `charAt`, `charCodeAt`, `indexOf`, `lastIndexOf`,
  `includes`, `startsWith`, `endsWith`, `slice`, `substring`,
  `substr`, `split`, `trim`/`trimStart`/`trimEnd`, `toLowerCase`/
  `toUpperCase`, `repeat`, `padStart`/`padEnd`, `replace`/`replaceAll`,
  `localeCompare`, `toString`. Implementado en `runtime/ets_string.hpp`
  como funciones libres `ets::string_*`. **PR #145**.
- **Servidor HTTP Express-style** (HTTP/1.1): `http.createServer()`,
  `server.get/post/put/patch/delete/listen`, handlers
  `(req: Request, res: Response) => void`, path params con `:name`,
  query string, body, response encadenable
  `res.status().header().send()/.json()`. Helpers `http.param/query/header`.
  **PR #144**.
- **Cliente HTTP estilo fetch**: `http.get(url) -> Result<HttpClientResponse, string>`
  y `http.post(url, body, contentType?) -> Result<HttpClientResponse, string>`.
  Accesores: `v.status()` (number), `v.body()` (string), `v.header(name)`.
  **PR #147**. Se sustituye por libcurl multi en V29+.
- **Backend HTTP dual: cpp-httplib + Drogon**:
  - **PR #150**: cpp-httplib v0.60.1 vendoreado en
    `runtime/external/httplib/`. Wrapper `runtime/ets_http_httplib.hpp`
    con la misma API. Default.
  - **PR #151**: wrapper `runtime/ets_http_drogon.hpp` sobre Drogon
    1.8.7+ (instalado vía `apt install libdrogon-dev`). Mismo API
    que el wrapper httplib. ~150-200k req/s vs ~25-50k de httplib.
  - **PR #152**: dispatch en el codegen con decorator `@cpp_drogon`
    sobre `let server: Server = ...`. AST: `VariableDeclaration.decorators?`.
    Parser: `leadingDecorators` propagados a `variable()`.
  - **PR #153**: tests e2e en `test/e2e/http-server-drogon/` con
    skip automático si libdrogon-dev no está instalado.
- **Parser fixes pre-existentes** (PR #148): `block()` y
  `classDeclaration()` ahora `skipNewlines()` antes del `while`
  para que `if (x) { print("a"); } else { ... }` parsee correctamente.
- **Test fixes pre-existentes** (PR #149): 3 bugs en
  `optionalValueOr` (T inference), renombrado de variables
  reasignadas con `fromRuntime`, linkado de `runtime_ets_poll.cpp`
  / `runtime_ets_net.cpp` + `-lstdc++fs` en el runner.
- **Codegen `length(x)` builtin**: el type-checker reconocía
  `length(x)` (string | array | tuple) -> number, pero el codegen
  no lo emitía. Ahora traduce a `::ets::string_length(x)` o
  `(arr).size()` según el tipo. Suite e2e vuelve a 65/65 verde.
- **Tutorial §17 (backend dual)**: tabla comparativa cpp-httplib vs
  Drogon, uso de `@cpp_drogon`, instalación, limitaciones, ejemplo
  de bench, roadmap V29+ (libuv + libcurl multi).
- **Bucket `http-server-drogon`** en el runner e2e: skipea
  automáticamente si libdrogon-dev no está instalado con mensaje
  claro. Compilación condicional de las libs de Drogon cuando el
  cpp incluye `runtime/ets_http_drogon.hpp`. `-fno-exceptions`
  desactivado para builds con Drogon (usa try/catch).

### Fixed

- **Parser `if (x) { stmt; } else { ... }`** fallaba: `block()` no
  saltaba newlines después de statements con `;` dentro. PR #148.
- **`optionalValueOr` no propagaba T** en `total + optionalValueOr(a, 0)`
  (el contexto se perdía a través del `+`). PR #149.
- **`length(array)` no se traducía** en el codegen. Fix: dispatch
  en `CallExpression` keyed on `node.callee === "length"`.

### Performance

Sin cambios. Las optimizaciones de rendimiento fueron en V26
(v1.1.0).

### Documentation

- `docs/TUTORIAL.md` §15 (string API completa).
- `docs/TUTORIAL.md` §16 (servidor HTTP Express-style).
- `docs/TUTORIAL.md` §17 (backend dual: cpp-httplib vs Drogon).
- `docs/roadmap.md`: nueva sección "V28 — Cierre del ciclo HTTP
  (entregado)" y avance V29+ (libuv + libcurl multi).
- `docs/TUTORIAL.md` "Resumen de versiones" actualizado.
- `CHANGELOG.md`: entrada v1.2.0.

## v1.1.0 (2026-10-08) — V26 reactor async optimizations

### Added

- **Cleanup event-driven O(activos)** en `LibuvEventLoop` (V26.2):
  callbacks (`onPoll`, `onTimerForPoll`, `onTimerForWait`, `onWake`)
  pushean a colas `*_to_reap_` cuando marcan fired. `runOne` ya no
  scan O(N) sobre timers/polls/detached. ~10% mejora hot path,
  escala bien a N=10k polls.
- **Bugfix memory leak** en `detach()`: si el handle ya está done,
  ahora se llama `handle.destroy()` en lugar de retornar sin liberar.
- **Buffer pool reutilizable** (V26.3): `runtime/ets_buffer_pool.hpp`
  singleton thread_local con buckets de potencia-2 (1K..1M).
  `readTcp()` lo usa. **Speedup 2.21x** medido en
  `runtime/libuv/tests/benchmark_buffer_pool.cpp`.
- **accept4 + SOCK_NONBLOCK** (V26.4): `socketNonBlocking()` y
  `acceptNonBlocking()` envuelven `socket(..., SOCK_NONBLOCK |
  SOCK_CLOEXEC, ...)` y `accept4(fd, NULL, NULL, SOCK_NONBLOCK |
  SOCK_CLOEXEC)` en Linux. Fallback a socket+fcntl/accept+fcntl en
  otros UNIX. `listenTcp`, `acceptTcp`, `acceptTcpUntil` usan los
  wrappers. -1 syscall por accept.
- **MultiLoopRunner** (V26.5): `runtime/ets_multi_loop.hpp` arranca
  n `LibuvEventLoop` en n threads, cada uno con su `run()`.
  API: `start()`, `stop()`, `join()`, `nextLoop()` round-robin.
  Validado en `runtime/libuv/tests/test_multi_loop.cpp` (4 loops,
  19 ticks cada uno en 200ms).
- **`LibuvEventLoop::run()` / `stop()`** (V26): bucle bloqueante
  que ejecuta `uv_run(UV_RUN_ONCE)` hasta que `stop()` (thread-safe)
  lo solicite.

### Performance

| Bench                          | V25     | V26    | Speedup |
|--------------------------------|---------|--------|---------|
| 1000 timers dispatch           | 197 ns  | 178 ns | 1.10x   |
| readTcp buffer allocation      | 137 ns  | 62 ns  | 2.21x   |
| accept (10k connects+accepts)  | 74.2 us | 71.7 us | 1.04x  |
| MultiLoopRunner (4 loops, 200ms) | 1 loop | 4 loops | 4x   |

### Documentation

- `docs/reactor-async.md` (nuevo, ~300 lineas): guía completa del V26.
- `runtime/README.md`: seccion "Reactor async V26" con resumen.
- `docs/build-system.md`: sin cambios (V26 no toco build system).
- `CHANGELOG.md`: entrada v1.1.0.
- `status.md`: seccion final V26.

## v1.0.0 (2026-10-07) — V25 Build System: "transpilador en un solo bloque"

### Added

- **Build system con `.a` estáticas vendoreadas**: libuv, BoringSSL
  (OpenSSL-compatible), libcurl. El usuario ya no necesita
  `apt install libuv-dev libssl-dev libcurl4-openssl-dev`; solo
  `g++`, `cmake` y `make`.
- **Tres librerías como submódulos git** (`third_party/libuv/`,
  `third_party/boringssl/`, `third_party/curl/`). Cada una con
  `VENDORED-NOTES.md` específico.
- **Cuatro scripts de build** (`scripts/build-{libuv,boringssl,curl,runtime}.sh`)
  con cache HIT/MISS. Cold compile ~3 min total; warm cache <5s.
- **Pre-compilación del runtime a `.o`** (`runtime/runtime_ets_*.cpp` →
  `build/runtime_ets_*.o`). 150x speedup warm cache. Header ligero
  `*_api.hpp` con solo declaraciones para el code que va a `.cpp`.
- **Cache global** del usuario en `~/.cache/etsc/runtime/<ver>/<backend>/<hash>/`.
  Compartido entre proyectos del mismo usuario.
- **Integración transparente en el CLI** (`src/cli.ts`):
  - Detección automática de librerías vendoreadas en `linkLibraries`.
  - Auto-ejecución de `scripts/build-<lib>.sh` cuando faltan `.a`.
  - Auto-ejecución de `scripts/build-runtime.sh` cuando faltan `.o`.
  - Auto-poblamiento del cache global.

### Changed

- `runtime/ets_event_loop_libuv.hpp` y `runtime/ets_event_loop_poll.hpp`
  son ahora **wrappers back-compat** que incluyen los `_api.hpp`. Las
  definiciones no-template se movieron a los `.cpp`.
- El CLI ya no requiere que el usuario ejecute los scripts de build
  manualmente.

### Performance

| Escenario | Antes (V24) | Ahora (V25) | Speedup |
|---|---|---|---|
| Cold compile (primer build) | ~5s | ~10s (con cache miss de vendoring) | 0.5x (penalty de 5s) |
| Warm cache (libs + runtime) | ~2s | ~100ms | **20x** |
| Cache global hit (proyecto nuevo) | N/A | ~100ms | nuevo |

### Documentation

- `docs/build-system.md` (nuevo, ~280 líneas): guía completa del
  build system V25.
- `scripts/README.md`: documenta los 4 scripts de V25.
- `third_party/libuv/README.md`, `third_party/boringssl/VENDORED-NOTES.md`,
  `third_party/curl/VENDORED-NOTES.md`: docs de cada librería vendoreada.
- `runtime/libuv/README.md`: nota sobre pre-compilación.
- `CHANGELOG.md`, `README.md`, `status.md`: actualizados a V25.

## v0.29.0 (2026-10-07) — Backend alternativo de EventLoop basado en libuv

### Added

- **Backend libuv para `ets::EventLoop`**: nueva implementación
  `LibuvEventLoop` basada en libuv 1.48, seleccionable con
  `-DETS_EVENT_BACKEND_LIBUV`. Activar con `-luv` al enlazar.

  ```bash
  # Default (poll(2), sin cambios):
  g++ -std=c++20 programa.cpp -o programa -pthread

  # Con backend libuv:
  g++ -std=c++20 -DETS_EVENT_BACKEND_LIBUV programa.cpp -o programa -luv -pthread
  ```

- **`UvFdAwaiter` / `UvCancellableFdAwaiter`**: drop-in libuv de
  `FdAwaiter` / `CancellableFdAwaiter`. Bajo
  `-DETS_EVENT_BACKEND_LIBUV`, `ets::listenTcp` / `acceptTcp` /
  `readTcp` / `writeTcp` y versiones `*Until` usan `uv_poll_t`
  internamente. La API pública es **idéntica**.

- **Benchmarks medidos** (`runtime/libuv/tests/benchmark_*.cpp`):
  - dispatcher idle (1 fd): **libuv 32x más rápido** (17 ns vs 544 ns).
  - dispatcher 50 pipes: **libuv 430x más rápido** (23 ns vs 9883 ns).
  - 1000 timers dispatch: 197 ns/timer.
  - Wake roundtrip cross-thread: 23.7 µs.
  - HTTP fetch end-to-end (libcurl): funciona con status 200, body
    correcto.

- **Tests añadidos (no se inyectan al código generado)** en
  `runtime/libuv/tests/`:
  - `test_wait_until.cpp` (Fase 2B.1, PR #103)
  - `test_notify_post.cpp` (Fase 2B.2, PR #104)
  - `test_wait_for.cpp` (Fase 2B.3, PR #105)
  - `test_detach.cpp` (Fase 2B.4, PR #106)
  - `test_integration.cpp` (Fase 2B.5, PR #107, 12 tests)
  - `test_tcp_server.cpp` (Fase 3.1, PR #108)
  - `test_dns_resolve.cpp` (Fase 3.1.1, PR #109)
  - `test_uv_fd_awaiter.cpp` (Fase 3.2, PR #110)
  - `test_tcp_client.cpp` (Fase 4, PR #112)
  - `test_tcp_client_loop.cpp` (Fase 4.2, PR #113)
  - `test_cancel_network.cpp` (Fase 5, PR #115)
  - `test_curl_fetch.cpp` (Fase 7, PR #116)
  - `benchmark_poll_vs_libuv.cpp` (Fase 6, PR #114)
  - `benchmark_libuv_hotpath.cpp` (Fase 8, PR #117)

  Total: **13 tests + 2 benchmarks, 94/94 escenarios verde**. Más
  **202/202 unit Ts2cpp sin regresión**.

- **Nuevos headers en runtime**:
  - `runtime/ets_event_loop_iface.hpp` — interfaz `IEventLoop` común.
  - `runtime/ets_event_loop_poll.hpp` — backend poll(2) (default).
  - `runtime/ets_event_loop_libuv.hpp` — backend libuv (opt-in).
  - `runtime/ets_event_loop.hpp` — selector por macro.
  - `runtime/ets_net_libuv.hpp` — drop-in de awaitables de red.

### Changed

- `runtime/ets_async.hpp` — `EventLoop` ahora es un alias
  (`PollEventLoop` o `LibuvEventLoop` según macro).
- `runtime/ets_net.hpp` — `NetFdAwaiter` y `NetCancellableFdAwaiter`
  son alias que apuntan al awaitable libuv bajo la macro.

### Compatibility

- **100% backwards compatible**: bajo default (sin macro), todo se
  comporta exactamente igual.
- **Cero cambios al código generado** (Ts2cpp no necesita modificarse).
- **Cero Dockerfile**, integración por flag de compilación.
- **Cero dependencias npm** añadidas.

### Known Limitations

- Los tests standalone en `runtime/libuv/` se compilan con `-O0` por
  un bug latente con `-O2` en `test_integration` test 3
  (waitUntil). El runtime real compila con `-O2` y funciona sin
  issues. No es bloqueante.

## v0.28.0 (2026-10-04) — V23 BREAKING: TS-compatible match() syntax

### Breaking

- **V23 — Sintaxis TC39 de `match` eliminada**: la forma
  `match (subject) { when (pattern) => result; }` ya NO se acepta. El
  parser la diagnostica con `E4400`. Migración:

  ```ets
  // Antes (V1.10, eliminado en V23):
  return match (x) {
    when (0) => "zero";
    when (_) => "many";
  }

  // Ahora (V23):
  return match(x, [
    when(0, (v: number): string => "zero"),
    otherwise((): string => "many"),
  ]);
  ```

  La forma V2 destructurada (`match (r) { case { kind: "X", x }: ...; }`)
  **se mantiene** y sigue siendo la única con enforcement de
  exhaustividad.

### Added

- **V23 — `match(value, [when(pattern, callback), ...])`**: nueva
  forma de pattern matching compatible con TypeScript. El codegen
  intercepta la `CallExpression` con `matchedKind === "match"` y emite
  un IIFE con if/else chain en lugar de una llamada a función. Tres
  intrinsics:
  - `when(pattern, callback)`: compara con `==` y ejecuta el callback
    pasando el subject. El callback puede tener 0 o 1 parámetros.
  - `whenType<T>(callback)`: tipo-based dispatch. **V23.2 narrowa el
    subject cuando es una union**: el codegen emite
    `if (std::holds_alternative<T>(v)) { auto narrowed = std::get<T>(v);
    ... }` encadenado. El callback se invoca SIN argumentos (no se le
    pasa el `narrowed`); si necesitas acceder al valor narrowed, usa
    la forma V2 destructurada. Si el subject NO es una union, cae al
    comportamiento legacy: solo el primer `whenType` es la rama
    activa, los siguientes se marcan como `unreachable`.
  - `otherwise(callback)`: default, siempre se ejecuta si ningún
    `when` previo matcheó. Si no hay `otherwise` (ni `whenType`), el
    else final hace `std::abort()`.

- **V23 — forma con discriminator**: `match(value, "key", [when(...)])`
  compara `value.key` contra los patrones. Útil para pattern matching
  estilo "tagged" sobre clases con campo `kind`.

- **V23 — declaraciones para el editor** en `types/estatic.d.ts`:
  interfaces `MatchValueCase`, `MatchTypeCase`, `MatchDefaultCase`; type
  union `MatchCase`; type helper `MatchResult<Cases>`; funciones
  `when`, `whenType`, `otherwise`, `match` con inferencia condicional
  del tipo de retorno. El LSP puede hacer hover y completions sobre la
  nueva sintaxis.

- **V23 — `match` y `when` dejan de ser keywords del lexer**: ahora
  son identificadores normales. La distinción entre la forma V2
  (`match (x) { ... }`, con `{`) y la nueva (`match(x, [...])`, con
  `[`) la hace el parser por lookahead. Esto permite que `when` y
  `match` vuelvan a ser nombres de variable válidos (raro pero
  legal).

- **V23 — trailing commas en arrays literales**: `[a, b,]` ya no
  emite error. Necesario para que la nueva sintaxis admita el estilo
  idiomático TS.

- **V23 — tests**: 7 nuevos unit tests del codegen + 3 nuevos e2e
  (`match-value-pattern`, `match-type-pattern`, `match-exhaustive-union`)
  + migración de `examples/match-demo.ets` y
  `test/e2e/basics/switch-when/source.ets`.

### Removed

- **V23 — forma TC39 `when (p) => r` dentro de `match`**: ya no
  compila. El parser reporta `E4400`.

### Fixed

- **V23 — `match` con `match` anidado**: la nueva forma usa
  `match(x, [...])` en vez de `match (x) {...}`, así que el problema
  de anidamiento de la forma TC39 con wildcard `_` desaparece.

## v0.27.1 (2026-10-04) — V22 subtareas: make_unique, move(), diagnósticos de borrows

### Added

- **V22 — `std::make_unique<T>(...)` automático**: cuando una declaración
  `let`/`const` tiene `declaredType = ptr<T>` (o `constPtr<T>`) y el
  initializer es un `new T(...)`, el codegen emite
  `std::make_unique<T>(args)` automáticamente. Antes era obligatorio
  llamar al helper manualmente. Ver test e2e `ownership/ptr-from-new`.
- **V22 — `move<T>(x)` global helper**: transfiere ownership de un
  `ptr<T>`. El codegen emite `std::move(x)` y el checker marca la
  variable como `moved`/`maybe-moved` para rechazar usos posteriores.
  El receptor (sea un parámetro `ptr<T>` o una variable local) recibe
  el unique_ptr por valor con la semántica correcta. Ver test e2e
  `ownership/move-transfer`.
- **V22 — diagnósticos de borrows**:
  - **E4102**: uso de un `ptr<T>` después de haber sido movido.
  - **E4103**: uso de un `ptr<T>` que *puede* haber sido movido en una
    rama de `if/else`.
  - **E4203**: `ref<T>` / `constRef<T>` almacenado en un campo de clase.
  - **E4204**: `ref<T>` / `constRef<T>` como parámetro de una función
    `async`.
  - **E4205**: `ref<T>` / `constRef<T>` como argumento de tipo en una
    instanciación genérica.
  - **E42xx**: `ref<T>` / `constRef<T>` como tipo de retorno (en
    `FunctionDeclaration`, métodos de clase y métodos de interface).
- **V22 — `identifierTypes` map en el codegen**: para que el acceso a
  miembros (`p.value`) sobre un identificador de tipo `ptr<T>` se
  emita como `p->value` (no `p.value`).
- **V22 — inferencia de `declaredType` en `NewExpression`**: el
  codegen propaga el `declaredType` de la declaración al `NewExpression`
  para que el helper `make_unique` use el target ownership correcto.

### Fixed

- **V22 — `argumentExpectsPtrPointer` ya no añade `&` automático**:
  antes buscaba `genericBase === "ptr"` y añadía `&` al lvalue, lo que
  en V22 rompía la compilación porque `ptr<T>` se traduce a
  `std::unique_ptr<T>` (por valor), no a `T*`. La función ahora
  devuelve `false` siempre y se documenta como hook histórico.
- **V22 — `examples/constructor-demo.ets` migrado**: usaba la sintaxis
  legacy `function increment(mut counter: Counter)`. Ahora usa
  `counter: ref<Counter>` (consistente con `mut-demo.ets`).
- **V22 — `init-project` template**: el `estatic.d.ts` generado ahora
  declara los 4 modificadores (`ptr<T>`, `constPtr<T>`, `ref<T>`,
  `constRef<T>`) + el global `move(x: ptr<T>)`. Antes declaraba los
  tipos legacy (`Mut<T>`, `MutRef<T>`, `Unq<T>`, `Rc<T>`) que V22
  rechaza.

### Tests

- Unit tests: **194/194 verde**. Dos tests nuevos en `type-checker`:
  - `type-checker V22: uso de variable movida genera E4102`
  - `type-checker V22: move en if sin else deja la variable como
    maybe-moved (E4103)`
- E2E bucket `ownership`: **7/7 verde** (los 4 V22 originales +
  `move-transfer` + `ptr-from-new` + `un-none` reorganizado).

## v0.27.0 (2026-10-04) — BREAKING: Memory Model v2

### Breaking

- **V22 — `T` significa copia**. El dialecto ya no convierte automáticamente
  un parámetro `T` a `const T&`. Si quieres evitar la copia, declara el
  parámetro con `ref<T>` o `constRef<T>`.
- **V22 — `mut` eliminado**. `function foo(mut x: T)` ya no se acepta; usa
  `function foo(x: ref<T>)`.
- **V22 — `Mut<T>`, `MutRef<T>`, `Unq<T>` eliminados**. Reemplazos:
  - `Mut<T>` → `ptr<T>` (unique ownership) o `ref<T>` (mutable borrow)
  - `MutRef<T>` → `ref<T>` (T&)
  - `Unq<T>` → `ptr<T>` (std::unique_ptr<T>)
- **V22 — `Rc<T>` deprecado**. El checker emite warning. Reemplazo: `ptr<T>`
  para ownership exclusivo; shared ownership se rediseñará con `weak<T>`.
- **V22 — `out` deprecado** (soft). `out T` se mantiene por compatibilidad
  con el mecanismo de resultados; se prefiere `Result<T>`.

### Added

- **V22 — `ptr<T>`**: ownership exclusivo mutable. Se traduce a
  `std::unique_ptr<T>`.
- **V22 — `constPtr<T>`**: ownership exclusivo readonly. Se traduce a
  `std::unique_ptr<const T>`.
- **V22 — `ref<T>`**: préstamo mutable no-null. Se traduce a `T&`.
- **V22 — `constRef<T>`**: préstamo readonly no-null. Se traduce a
  `const T&`.
- **V22 — diagnósticos E4400-E4406**: rechazo de `mut`, `Mut<T>`, `MutRef<T>`,
  `Unq<T>`, `Rc<T>` (warning) y `out` (warning).
- **V22 — `docs/memory-model.md`**: especificación canónica del modelo de
  memoria.
- **V22 — ejemplos**: `memory-values.ets`, `memory-borrows.ets`,
  `memory-ownership.ets`. Los ejemplos legacy (`mut-demo`, `mutref-demo`,
  `rc-demo`, `un-demo`) se migraron a las nuevas APIs.

### Changed

- `ParameterPassing` reducido a `"value" | "out"`. Los valores legacy
  `"automatic"`, `"mut"`, `"move"` se eliminan.
- `cppInputType` ya no aplica lowering implícito a `const T&`.
- `parameterIsMutableReference` simplificado: solo `ref<T>` califica.
- `cppMemoryType(name, inner)`: helper centralizado para mapear los 4
  modificadores a sus tipos C++.

### Migration

Migración mecánica de código existente:

```diff
- function foo(mut x: User): void {}
+ function foo(x: ref<User>): void {}

// MutRef<T> → ref<T>
- function bar(x: MutRef<Counter>): void {}
+ function bar(x: ref<Counter>): void {}

// Mut<T> — depende del caso:
//   si era valor mutable → ref<T>
//   si era puntero (transferencia) → ptr<T>
- function baz(x: Mut<Counter>): void {}
+ function baz(x: ptr<Counter>): void {}

// Unq<T> → ptr<T>
- function make(): Unq<Counter> { return unSome<Counter>(new Counter(42)); }
+ function make(): ptr<Counter> { return new Counter(42); }

// Rc<T> → ptr<T> (deprecation warning por ahora)
- function share(): Rc<Counter> { return rcShare<Counter>(new Counter(7)); }
+ function share(): ptr<Counter> { return new Counter(7); }
```

## v0.26.0 (2026-09-27) — Features TS completas + productividad del compilador

### Added (Fase 1 — features TypeScript)

- **1.2 `Optional<T>`**: runtime en `ets_optional.hpp` + helpers globales (`optionalSome`, `optionalNone`, `optionalValueOr`, `optionalAndThen`, `optionalMap`).
- **1.3 `??`**: nullish coalescing sobre `Optional<T>` con propagación contextual.
- **1.4 `?.`**: optional chaining sobre `Optional<T>`.
- **1.5 Decoradores**: `@deprecated` (warning) + `@sealed` (rechaza herencia).
- **1.6 Parámetros opcionales `name?: T`**: en funciones y métodos.
- **1.7 Template literals**: ya implementados, ahora documentados formalmente.
- **1.8 `for await...of`**: desazucarado a loop con `co_await` por elemento.
- **1.9 `using`**: declaración TC39 stage 3 con RAII automático.
- **1.10 Match expressions**: TC39 stage 2 (`match (expr) { when (pat) => res; ... }`) con wildcard `_`.
- **1.11 `satisfies`**: type-check con cast implícito (TS 4.9).
- **1.13 `Promise.all/race`**: helpers sobre `Promise<T>[]` (`Task<T>[]`).
- **1.15 Named/default exports**: `export { x as y }` y `export default function/class/const/...`.

### Added (Fase 2 — productividad del compilador)

- **2.1 Error reporting legible**: colores ANSI, multi-line spans con carets extendidos, did-you-mean (Levenshtein ≤ 2). Respeta `NO_COLOR` y `FORCE_COLOR`.
- **2.2 Documentación**: `LIMITATIONS.md` (149 líneas) con rechazos exhaustivos + reorganización de `README.md`.
- **2.3 Build incremental pulido**: `--verbose`/`-v` flag, timings por fase, diagnóstico claro de cache miss, resumen final con tamaño del binario.
- **2.4 Página web de demos**: `scripts/build-demo-page.ts` (337 LOC) + `docs/demos.html` (2587 líneas, 50 demos en 13 categorías). Comando `npm run demos`.

### Added (Fase 3 — productividad del desarrollo)

- **3.1 Watch mode**: `scripts/watch.ts` (120 LOC) con debounce 100ms y spawn del CLI. Comando `npm run watch`.
- **3.2 Skip tests de red**: `SKIP_NETWORK=1` para CI.
- **3.3 Worker pool paralelo**: `TEST_CONCURRENCY=N` (default `cpus().length`). 2.85x speedup (5:00 → 1:44).

### Changed

- `KEYWORDS`, `JSON_HELPERS`, `OPTIONAL_HELPERS`, `ASYNC_PRIMITIVE_HELPERS` usan `Object.create(null)` para evitar herencia de `Object.prototype`.
- `match`/`when`/`satisfies` añadidos como keywords.

### Discarded (no aplican al dialecto)

- **1.12 `abstract` classes** y **1.14 `override` modifier**: requieren herencia, que el dialecto prohíbe.

### Performance

| Métrica | Antes (v0.25) | Ahora (v0.26) | Speedup |
|---|---|---|---|
| Suite tests | 5:00 | 1:44 | 2.85x |
| Tests | 117 | 133 | +14% |
| Demos | 34 | 50 | +47% |

## v0.25.0 (anterior)

Baseline de features TS estándar + suite de tests golden.
