# Caché incremental de transpilación

Desde v46, el build incremental conserva trabajo anterior a la generación del
objeto nativo. La caché vive bajo `incremental.cacheDirectory` y se divide en
tres niveles independientes.

| Nivel | Clave | Evita repetir | Invalidación |
|---|---|---|---|
| Sintaxis | contenido + versión de Ts2cpp | escaneo de imports, exports y source normalizado | cambia el archivo o el compilador |
| AST | source normalizado + versión de Ts2cpp | lexer y parser del módulo | cambia el módulo o el compilador |
| Snapshot | grafo, rutas, imports, hashes y versión | parse, type-check, `comptime`, `@etsgen` y codegen completos | cambia cualquier módulo o la topología |
| Objeto | C++ materializado + cabecera común + entorno nativo | compilación C++ de esa unidad | cambia su salida, el header, runtime, compilador o flags |

El incremental carga el grafo una sola vez. En un build idéntico, el manifiesto
permite reutilizar binario y objetos sin abrir la snapshot. Si falta un
artefacto, o cambian sólo las flags/runtime nativos, la snapshot reconstruye las
fuentes generadas sin ejecutar otra vez el frontend.

Al editar un módulo, su snapshot de programa deja de ser válida. El compilador
restaura los AST de los módulos intactos y sólo lexea/parsea el modificado. El
checker actual trabaja sobre un AST combinado para preservar imports, tipos,
sobrecargas y expansiones entre módulos; por eso el type-check y el codegen del
nuevo programa siguen siendo globales. Aun así, la comparación de C++ y header
recompila únicamente los `.o` realmente afectados. Convertir el checker a
interfaces semánticas por módulo sería el siguiente nivel de granularidad.

v48 añade una primera restauración de cuerpos semánticos para programas dentro
de una cobertura escalar cerrada. Las demás construcciones conservan el análisis
global descrito arriba. Véase [`semantic-cache.md`](./semantic-cache.md) para
las claves, contadores, fallbacks y mediciones reales.

## Diagnóstico

`etsc build --verbose` muestra hits/misses del escaneo, ASTs reutilizados y si
la snapshot completa fue restaurada. La API `buildIncremental` expone:

- `transpilationCache`: `hit`, `partial` o `miss`.
- `parsedModules.reused`: módulos cuyo AST se restauró.
- `parsedModules.parsed`: módulos que se volvieron a parsear.

Las entradas son content-addressed y llevan versión de formato y de compilador.
Una entrada ausente, antigua o corrupta se trata como miss: nunca sustituye las
validaciones semánticas ni convierte un error en un build válido.

## Perfil de cada ejecución (v47)

`build-profile.json`, junto a los manifests de la caché, contiene el resultado
del build, `profile.phases`, `profile.totalsMs` y `moduleChanges`. Las fases
se miden con reloj monotónico. Los eventos `codegen-module`, `write-artifacts`
y `native-compile` incluyen la ruta del módulo cuando corresponde. El JSON
se publica atómicamente tras un build exitoso; si el build falla, el informe
anterior sigue describiendo el último éxito.

Se distinguen carga del grafo, AST, resolución de exports, huellas, bindings,
checker fuente, comprobaciones adicionales de expansión, comptime, @etsgen,
checker final, preparación de codegen, header, módulos, escrituras, C++ y enlace.
La fase @etsgen incluye los checks internos de su expansión. Una fase omitida
por caché no aparece: nunca se reproducen tiempos guardados de otro build.

La API `buildIncremental` devuelve `profile` y `moduleChanges`. Un hit completo
sólo mide la carga del grafo y el digest del runtime; `durationMs` incluye
también comprobaciones de manifests y artefactos. Por eso la suma de fases
no representa necesariamente toda la duración del build.

## Huellas de módulos y siguientes invalidaciones

`module-interfaces.json` guarda el hash de la fuente, interfaz, implementación,
contenido sensible a evaluación estática y rutas de dependencias. Se calculan
antes de renombrar bindings o ejecutar comptime y sin coordenadas ni anotaciones
del checker. El hash público conserva firmas y exports resueltos; incluye de
forma conservadora constantes, layouts y declaraciones locales que puedan
afectar a consumidores. Para genéricos, @comptime, @cppgen y @etsgen se conserva
el cuerpo del módulo completo, incluidos helpers privados y globals capturados.

Los cambios se clasifican como `new`, `implementation`, `interface`,
`compile-time`, `dependency` o `removed`. Una firma, constante, tipo o cuerpo
estático cambiado propaga la marca a consumidores transitivos, incluidos barrels
y diamantes. Una implementación runtime importada por un módulo con generadores
también propaga el cambio. Las funciones runtime ordinarias conservan su hash
de interfaz cuando sólo cambia el cuerpo.

Estas huellas son metadatos iniciales de planificación, no interfaces tipadas
serializadas ni una prueba de independencia entre módulos. El checker y codegen
siguen siendo globales tras editar una fuente: aún falta representar todas las
dependencias por identidad de símbolo, incluyendo inferencia, capturas y ETS
publicado. No se usa este manifiesto para saltar comprobaciones.

## Trabajo evitado y benchmark

El incremental ya no construye un PCH que después no utilizaba. Las verificaciones
de existencia consultan metadatos en vez de cargar objetos y binarios completos.
Los C++, fragmentos ETS y mapas de contenido idéntico conservan su fecha de
modificación. Los hits conservan la cabecera real en lugar de reemplazarla con
un placeholder; si se borra, se restaura desde la snapshot.

```bash
node --experimental-strip-types scripts/benchmark-incremental.ts
# Comparar con otro checkout sin modificarlo:
node --experimental-strip-types scripts/benchmark-incremental.ts /ruta/v46
```

El script necesita g++ y Node compatibles con el proyecto. Crea un proyecto
temporal de dos módulos, compila/ejecuta cada escenario y elimina el fixture
al terminar; no requiere las librerías async de libuv. Cada línea JSON informa
duración, objetos reutilizados y fases. En una ejecución local con g++/O0:

| Escenario | v46 | v47 |
|---|---:|---:|
| Frío | 6313 ms | 3033 ms |
| Sin cambios | 10 ms | 4 ms |
| Cambio de cuerpo | 1726 ms | 1392 ms |
| Flags nativos | 6206 ms | 2879 ms |

Son resultados de una sola ejecución con cachés del sistema/JIT no controladas;
no son un factor de aceleración garantizado ni una medición aislada del frontend.
La reducción en frío y con flags evita principalmente el PCH no usado. El perfil
por fase permite comparar el frontend por separado en proyectos más grandes.

