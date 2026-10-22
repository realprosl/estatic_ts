# Cargador nativo y registro sintáctico por archivo (v60)

```bash
npm run bootstrap:modules -- examples/todo-project/main.ets --cache build/project-cache
npm run bootstrap:modules -- examples/todo-project/main.ets --cache build/project-cache
npm run test:bootstrap:modules
```

La primera ejecución analiza cada archivo alcanzable. La segunda muestra
`cache.misses: 0`: recupera los tokens y las arenas AST de los registros.
Node construye el ejecutable; **el proyecto solicitado se abre, analiza y resuelve
en el binario**. No se importa el lexer/parser TS para analizar sus fuentes.
`build.ts` usa stage 0 para compilar el propio cargador ETS, como en los pasos previos.

## Contrato

`ModuleLoader(options).load(entry)` devuelve `ModuleGraph`: entry canónico,
archivos en orden DFS de dependencias antes que consumidores, diagnósticos y
contadores `hits`, `misses`, `writes`. `success` exige cero diagnósticos. Cada
archivo mantiene su `SourceResult` independiente; no se combinan ámbitos.
Ante errores se devuelve un grafo parcial, inutilizable para compilar, y se
continúan las otras dependencias para conservar diagnósticos útiles.

`LoaderOptions` admite `roots`, `aliases` (`PathAlias`), `cacheDirectory` y
`syntaxKey`. Esta última separa namespaces de opciones sintácticas del caller;
no habilita una nueva gramática. Configurar las opciones antes de crear el loader.
La demo admite `--root directory`, `--alias name target`, `--cache directory`,
`--syntax-key key` y `--twice` (dos cargas dentro del mismo proceso).
No ejecuta el programa analizado. Devuelve código 1 ante diagnósticos, 2 ante
argumentos incompletos, y JSON de grafo/tokens/AST por stdout.

## Reglas de resolución

- Solicitudes desde declaraciones directas del Program: imports ordinarios,
  default, namespaces, efecto lateral y type-only; reexports de nombres,
  estrellas y namespaces. Los specifiers vacíos producen error de resolución.
  Los aliases de símbolos permanecen en el AST; no configuran rutas.
- Relativos respecto al directorio del importador. Absolutos admitidos.
  Aliases por coincidencia exacta o prefijo con `/`, prefiriendo el más largo.
  Sin alias, raíces en el orden configurado. Targets relativos se normalizan
  respecto al cwd. Un alias seleccionado no cae a raíces cuando falta su archivo.
- Sin extensión: `.ts` antes de `.ets`. Con extensión: sólo el candidato exacto.
  No hay búsqueda de `index`, paquetes npm ni lectura automática de configuración.
  Estas reglas coinciden con stage 0 para rutas relativas/aliases/raíces.
- Se admiten sólo archivos regulares. `realpath` resuelve symlinks y proporciona
  la identidad única. Se conserva cada solicitud, pero las dependencias y los
  análisis se deduplican por archivo. Ciclos, incluidos type-only, se diagnostican
  con su recorrido y la posición de la declaración que cierra el ciclo.
- Recorrido secuencial con pila explícita; no hay promesas/tareas que puedan
  esperar unas a otras. No incorpora paralelismo ni deduplicación concurrente.

## Reutilización y persistencia

`SyntaxCache.getOrParseModule(file, source, metadata)` consulta memoria/disco
antes de `parseSource`. La unidad es **un archivo**, también en un módulo lógico
formado por varios archivos. Cada `.record` está identificado por SHA-256 de la
ruta canónica y contiene identidad del build/esquema/opciones, ruta, SHA-256 del
contenido exacto, metadatos, tokens, arena AST y dependencias canónicas resueltas.

Los metadatos se conservan como strings: tamaño en bytes, mtime y ctime con
nanosegundos, dispositivo e inode. Evitamos perder precisión por convertir épocas
o inodes a `number`. Se compara metadata antes y después de leer; una diferencia
produce error recuperable y evita publicar esa lectura. **Siempre se lee y hashea
el contenido**: las fechas no autorizan un hit por sí solas. Una modificación de
igual tamaño con mtime preservado sigue siendo un miss; tocar timestamps con
contenido idéntico conserva el AST y actualiza sólo el registro.

La identidad del build es SHA-256 de las fuentes de stage 0, runtime, bootstrap
y package, embebida al compilar C++. El adaptador no usa fechas como versión.
Un build ad hoc sin esa identidad sólo reutiliza dentro de su proceso.
Los hashes nativos se contrastan con SHA-256 de Node, incluyendo NUL y Unicode.

Se persisten únicamente resultados sintácticos correctos. Cada registro tiene
checksum; el lector valida framing, contadores, coordenadas, EOF, raíz Program,
índices de aristas y ausencia de ciclos de la arena. Entradas truncadas,
incompatibles o corruptas vuelven al parser. La publicación usa temporal único
por proceso/contador y rename en el mismo directorio. Fallar al guardar es una
optimización perdida, no un error del proyecto. Registros idénticos no se reescriben.
Los temporales no se leen. No hay compactación/GC ni garantía frente a pérdida de
energía (`fsync` no está implementado).

Cada hit hidrata objetos nuevos; el AST de una carga no es el objeto cacheado
compartido por otra. La información persistida es sintáctica: un checker futuro
necesitará su propia capa y deberá preservar esta separación.

**Las rutas se resuelven de nuevo en cada carga**, también con hit sintáctico.
Así se detectan nuevos `.ts` con precedencia, eliminaciones, cambios de roots,
aliases y symlinks sin reparsear importadores intactos. Las dependencias del
registro son observaciones de la última carga, no prueba para omitir el resolver.

## Límites de este bloque

`platform.hpp` es una frontera de plataforma POSIX (Linux): lectura binaria,
metadatos, realpath, SHA-256, publicación atómica e identidad del build. No
contiene lexer/parser, reglas de imports, recorrido ni política de caché.
No necesita libuv ni librerías criptográficas externas. `platform.ets` enlaza
estas operaciones con los escapes C++ existentes del dialecto.

Todavía no se calculan interfaces públicas semánticas ni se enlazan nombres,
comprueban tipos o producen C++/objetos para el proyecto cargado. Por ello el
registro no declara artefactos de esas fases como válidos. Cambiar el cuerpo o
la interfaz de una dependencia mantiene la caché sintáctica de sus importadores;
el checker posterior deberá distinguir sus invalidaciones. La reutilización de
`.o`, las dependencias de cabeceras y flags y los trabajos concurrentes permanecen
en el diseño documentado en `../frontend/README.md`.

La caché evita lexer/parser, pero mantiene lectura/hash e hidratación; no implica
una mejora de rendimiento medida. El grafo usa búsquedas lineales para identidad;
se prioriza corrección y recorrido acotado por archivos sobre optimización.

## Validación

42 pruebas con compilación C++20 obligatoria de siete módulos ETS y comparación
del orden de archivos con stage 0. Se comprueban formas de import/reexport,
aliases/raíces, identidad canónica, diamantes, ciclos y una cadena de 181 archivos.

La persistencia se valida entre procesos: segunda carga con cero parseos y cero
escrituras, edición de un archivo en un módulo lógico, timestamps cambiados sin
edición, tamaño/mtime preservados tras editar, configuración/versiones distintas,
archivos nuevos/eliminados y symlinks retargeteados. Se comparan tokens/AST y
diagnósticos exactos con/sin caché. Unicode, CRLF y templates anidados verifican
que el framing cuenta bytes y los spans mantienen sus unidades UTF-16.

La corrupción incluye envelopes inválidos y también checksums recalculados con
identidad, archivo, hash, coordenadas, raíz, aristas, ciclos o framing inválidos.
La imposibilidad de persistir es recuperable. El binario analiza además
su propio proyecto. Las 663 regresiones anteriores de bootstrap siguen pasando.

La demo pública con `examples/todo-project/main.ets` carga seis archivos sin
diagnósticos: primera ejecución `{hits:0,misses:6,writes:6}` y otro proceso
`{hits:6,misses:0,writes:0}` usando los mismos registros.

Conjunto estable completo: **1941/1941**, por bloques (1236 stage 0 + 64 lexer +
542 parser + 57 puente + 42 cargador), sin skips. No incluye `test/runner.ts`
ni E2E/libuv. `--version` y `-v` muestran `estatic 1.22.0 (v60)`;
`git diff --check` correcto.
