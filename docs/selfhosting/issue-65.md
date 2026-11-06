# #65: índice de referencias del binder

Se retoma después de resolver #64 e integrar #69, merge
`287ab9b034c130b33f944a805acdf2f9cfa23941`. No se restablecen workflows.

## Corrección

`Binder.uses()` recorría todas las referencias por cada expresión miembro para
obtener el símbolo del receptor. Ahora crea un índice por nodo en una pasada,
conservando la última referencia de valor no diferida del módulo. Las cadenas
de namespace actualizan el índice al resolverse, para que el siguiente miembro
vea el resultado de la expresión anterior. Los miembros ordinarios continúan
pendientes del checker; las referencias de tipo no sustituyen a las de valor.

La preparación y resolución pasan de O(M×R) a O(N+R+M) por módulo: N nodos,
R referencias acumuladas, M expresiones miembro; memoria adicional O(N).
Esto describe ese recorrido concreto, no la complejidad de todo el compilador.
No se modifican `types/estatic.d.ts`, Promise ni el catálogo de builtins.

## Regresión y comparación antes/después

El driver `bootstrap/binder/reference-profile.ets` carga la entrada y después
ejecuta el binder con trazas. Los tiempos de `binding.uses` excluyen carga y
formato. Se compilaron las versiones anterior y corregida con el mismo snapshot
de referencia, g++ 13.3.0 y opciones C++20/O0/pthread/fno-exceptions.

Se ejecuta la misma prueba con tres muestras por tamaño y se toma la mediana.
Cada sentencia contiene dos expresiones miembro (`ns.inner.value`).

| Expresiones miembro | Antes | Con índice |
| ---: | ---: | ---: |
| 256 | 313,94 ms | 60,30 ms |
| 512 | 806,90 ms | 126,73 ms |
| 1024 | 3812,53 ms | 260,13 ms |

La versión anterior **falla** la guardia de escalado; la corregida pasa 4/4
pruebas. No se excluyen fallos en el head. La guardia permite ruido de
planificación/tubería y comprueba crecimiento al duplicar la carga, sin medir
la compilación, carga ni serialización como si fueran resolución de miembros.
El mismo test con el backend de referencia TypeScript también pasa 4/4.
La prueba se incluye en `npm test` y `npm run test:bootstrap:binder`.

Se compararon además los resultados completos de seis entradas compartidas:
namespaces de módulos distintos, genéricos, miembro inexistente, import de
solo tipo, consultas typeof y 256 sentencias con miembros. **Símbolos,
referencias y diagnósticos son idénticos** antes/después, incluidos los errores.

Los frontends completos, reconstruidos con g++ local, también procesan la
misma entrada de 256 sentencias: ambos generan exactamente el mismo IR,
con `success=true`. La suma de sus dos intervalos `binding.uses.2` pasa de
1,546 s a 0,287 s. El total del proceso pasa de 6,708 s a 5,397 s;
la carga y el checker tienen costes independientes.

## Validación

- Suite completa de binder/checker: **1448/1448**, cero fallos/cancelaciones.
- Contrato de trazas sobre el frontend IR reconstruido: **7/7**.
- Nueva regresión con frontend IR: **4/4**; con referencia TypeScript: **4/4**.
- La misma regresión sobre la base: tres casos semánticos pasan y el de
  escalado falla, demostrando que detecta el comportamiento anterior.
- Comparación completa de bindings: **6/6 idénticos**.
- Comparación de IR completo: idéntico y válido; SHA-256
  `b3a91123d4fa7b0701fa0340e8bef54c94491a4ce2b0dbd7e04a578e2ede5ad8`.

TAP, procedencia, hashes y métricas están en [issue-65](issue-65).
`semantics.tap.gz` conserva la salida completa de las 1448 pruebas.
Los datos nuevos son locales; la ejecución histórica de Actions de #64 se
conserva separadamente. Los tiempos son de llegada de stderr y los intervalos
anidados no deben sumarse entre sí.

La compilación original del candidato se hizo desde el merge local `e5471f8`.
El commit publicado `6a90facb500dd890015f7986dbb4cbb2153c4d0c` tiene exactamente
el mismo árbol `07efc09e721f995e45201429f901d0530c69b693`.
Los hashes del binario y del driver permiten identificar las mediciones aunque
posteriormente se añadan tests/documentación.

## Caso real de autocompilación

El frontend corregido se ejecutó sobre `bootstrap/ir/demo.ets --trace` con el
mismo límite de 300 segundos. Completó las dos rondas de binding: la primera
en 24,685 s y la final en 25,176 s. En la primera, `binding.uses.15` completó
en 0,924 s y `binding.uses.16` en 0,600 s. La medición anterior de #64 tenía
uses.15 en 62,831 s y se agotaba durante uses.16. Las versiones completas no
se comparan como si todo el proceso hubiera terminado: ambas agotan el límite.

La nueva ejecución registra 633 eventos y agota el límite a los 300,213 s
con `checker.types` abierto desde el segundo 177,943. El binding ha terminado;
el siguiente bloqueo está en el checker. IR, C++ y enlace de segunda generación
siguen sin verificarse. Los datos completos están en
[project-head](issue-65/project-head); el código 124 se conserva como fallo.

Esta evidencia resuelve el recorrido cuadrático del binder de #65. La
investigación del siguiente bloqueo y la verificación del ciclo continúan
en #66, después de integrar esta corrección.

## Reproducción

```sh
bash native-compiler-mini/build-all.sh
ESTC_ROOT="$PWD/native-compiler-mini" native-compiler-mini/native/etsc build \
  bootstrap/binder/reference-profile.ets -o build/binder-profile.cpp \
  --binary build/binder-profile --no-progress
ESTATIC_BINDER_PROFILE="$PWD/build/binder-profile" node --experimental-strip-types \
  --test --test-reporter=tap bootstrap/binder/reference-index.test.ts
```

Para la base, utilizar el mismo driver y fuentes de #64 anteriores al índice,
sin cambiar compiler/flags. El comparador acepta ambos binarios y crea entradas
compartidas en un directorio nuevo:

```sh
python3 scripts/compare-binder-reference-index.py \
  --baseline /ruta/binder-base --candidate /ruta/binder-head --output /ruta/nueva
```

La verificación de segunda generación sigue correspondiendo a #66. Esta
corrección del binder no declara completo el self-hosting.
