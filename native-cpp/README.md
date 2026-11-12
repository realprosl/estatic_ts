# native-cpp — semilla C++ del compilador Estatic

La semilla es **el C++ que el propio compilador de `compiler/` genera de sí
mismo**: `compiler/unity.cpp`. Compilada con cualquier compilador C++20 es un
`etsc` completo, y su único trabajo es compilar `compiler/` para obtener el
compilador que se instala. No hace falta Node ni `src/` (stage 0) para
construirla, usarla ni regenerarla.

## Qué contiene

| Ruta | Contenido |
|---|---|
| `compiler/unity.cpp` | **Generado**: el C++ del compilador de `compiler/`, emitido por él mismo en su punto fijo |
| `templates/` | Plantillas de proyecto que escribe `etsc init` |
| `build-all.sh` | Construye la semilla (`native/etsc`) o copia la precompilada |
| `build-compiler.sh` | Construye el compilador de `compiler/` (generación 2) con la semilla, o copia el precompilado |
| `regenerate.sh` | Regenera `compiler/unity.cpp` con el propio compilador, hasta el punto fijo |
| `fetch-prebuilt.sh` | Descarga los precompilados de la rama `prebuilt` en `prebuilt/` |
| `files.txt` | Manifiesto de ficheros |
| `prebuilt/<plataforma>/` | **No está en git** (lo descarga `fetch-prebuilt.sh`): semilla y, en `compiler/`, el compilador de `compiler/`, con la huella de sus fuentes |

El C++ escrito a mano **no se copia aquí**: `runtime/` (runtime único) y
`compiler/modules/*.hpp` (cabeceras de frontera) se usan desde su sitio con
`-I<repo>`.

## Construir

```bash
bash native-cpp/build-all.sh          # usa la precompilada si vale; si no, compila
bash native-cpp/build-all.sh --force  # recompila siempre desde las fuentes
export ESTC_ROOT="$(pwd)"             # raíz del repositorio: runtime/ está aquí
native-cpp/native/etsc build /ruta/proyecto/main.ets --no-progress
```

Opciones de `build-all.sh`: `--out DIR`, `--cxx CXX`, `--static` (enlace
autocontenido), `--force` (ignora la precompilada; alias `--no-prebuilt`),
`--update-prebuilt` (compila estático y guarda la semilla precompilada) y
`--help`.

`build-compiler.sh --seed DIR --out BIN` construye el compilador de
`compiler/`: la semilla analiza `compiler/driver/main.ets` y después compila
el C++, en dos pasos para que el análisis (varios GB) y la compilación C++ no
estén en memoria a la vez. Opciones: `--static`, `--force`, `--update-prebuilt`
(estático, `-O2`) y `--help`. `install.sh` lo invoca; `--force-compiler` le
pasa `--force`.

## Precompilados (`prebuilt/`)

Los precompilados **no se guardan en `main`**, para no acumular binarios en el
historial de git: viven en la rama `prebuilt`, que `seed-prebuilt.yml`
sobrescribe con un único commit en cada actualización y que nunca se fusiona.
`fetch-prebuilt.sh` (lo llama `install.sh`) la clona con `--depth 1` en un
directorio temporal —sin tocar el repositorio— y la copia en `prebuilt/`, que
git ignora. Sin git, sin red o sin esa rama, no pasa nada: se compila.

`prebuilt/<plataforma>/` (`linux-x86_64`, `darwin-arm64`) guarda la semilla
(`etsc`) con `inputs.sha256` y, en `compiler/`, el compilador de `compiler/`
con la suya. `build-all.sh` y `build-compiler.sh` los copian en vez de compilar
**solo si la huella coincide** con el checkout y el binario arranca; si no,
compilan. Un precompilado desfasado nunca se usa.

Son autocontenidos y solo llevan la librería estándar de C++ y pthread (nada de
libuv, curl ni TLS):

- **Linux:** binarios totalmente estáticos (`ldd`: *not a dynamic executable*).
- **macOS:** solo `libSystem` y `libc++`, que forman parte del sistema (Apple no
  admite binarios 100 % estáticos). Requieren macOS 13.3 o posterior.

La Action `seed-prebuilt.yml` los compila en Ubuntu y en macOS cuando cambian
sus fuentes, comprueba con `file`/`otool -L` que no dependen de librerías
dinámicas de terceros, los prueba y los publica en la rama `prebuilt`. Sigue
haciendo falta un compilador C++ en la máquina: el compilador lo invoca para
construir cualquier programa.

## Regenerar la semilla

```bash
bash native-cpp/regenerate.sh                 # parte de la semilla actual
bash native-cpp/regenerate.sh --compiler ETSC # parte de otro compilador
```

Cada ronda: el compilador actual analiza `compiler/driver/main.ets`, emite su
IR y su C++, y ese C++ se compila para la ronda siguiente. **Solo se publica
cuando dos rondas seguidas emiten exactamente el mismo IR y el mismo C++**
(punto fijo del self-hosting); si no se alcanza en `--max-rounds` (3), la
semilla no se toca.

La regeneración solo reescribe lo generado (`compiler/unity.cpp` y `files.txt`)
y borra la copia local de `prebuilt/`, que deja de corresponder a las fuentes.
Cuando la regeneración llega a main, `seed-prebuilt.yml` recompila la semilla y
el compilador en Linux y macOS y publica los nuevos precompilados.

Hay que regenerarla cuando cambia el lowering o el backend de `compiler/` de
forma que el IR que emite la semilla deja de coincidir con el del compilador
nuevo: lo detecta el `cmp stage1.ir.json stage2.ir.json` de `selfhost-O2`.

La Action `regenerate-native-cpp.yml` ejecuta `regenerate.sh`, comprueba que los
scripts y las plantillas no cambian y que aquí no aparecen copias de `runtime/`,
`compiler/`, `src/` ni `types/`, reconstruye la semilla, la prueba con
`hello.ets` y, si se lanzó a mano, abre una PR.
