# native-cpp — semilla C++ del compilador Estatic

Instantánea **generada** compilando `bootstrap/ir/demo.ets` y sus dependencias
con el compilador de referencia `src/` (stage 0). Su único trabajo es construir
el primer compilador, que después compila `bootstrap/`.

## Qué contiene (y qué no)

Aquí solo vive lo que se genera desde `bootstrap/`:

| Ruta | Contenido |
|---|---|
| `frontend/` | Frontend ETS traducido a C++ (`unit-*.cpp`, `unity.cpp`, `estatic_common.hpp`) |
| `build/bootstrap/etsc/` | Tablas nativas y configuración de instalación generadas |
| `templates/` | Plantillas de proyecto que escribe `etsc init` |
| `build-all.sh`, `files.txt` | Construcción de la semilla y manifiesto de ficheros |
| `build-compiler.sh` | Construcción del compilador de `bootstrap/` (generación 2) con la semilla |
| `prebuilt/<plataforma>/` | Semilla ya compilada (Linux y macOS) y, en `compiler/`, el compilador de `bootstrap/`, con la huella de sus fuentes; los genera el CI |

Las piezas C++ escritas a mano **no se copian aquí**. Tienen una única ubicación
en el repositorio y las usan por igual la semilla, `bootstrap/`, `install.sh`,
el CI y los programas generados:

| Ruta canónica | Contenido |
|---|---|
| `runtime/` | Runtime C++ único |
| `bootstrap/native/` | Coordinador nativo (`driver.cpp`, `platform.hpp`, `progress.*`) |
| `bootstrap/modules/*.hpp` | Cabeceras de frontera nativa |
| `src/codegen/ir/native/` | Emisor IR → C++ |
| `types/` | Declaraciones canónicas (`estatic.d.ts`) |

Por eso un cambio en el runtime o en el coordinador **no** obliga a regenerar la
semilla: basta con editar el fichero canónico (siempre que no rompa la API que
usa el frontend generado, como `runtime/ets_compiler_host.hpp`). Solo hay que regenerarla cuando
cambian las fuentes `bootstrap/*.ets` que forman el frontend.

## Construir

`build-all.sh` es el **único** sitio que construye la semilla; `install.sh` y el
CI lo llaman. Compila a la vez el frontend y el coordinador/emisor (son
independientes). El frontend se compila como un único `unity.cpp` a propósito:
compilar las 39 unidades por separado cuesta ~7 veces más CPU, porque cada una
vuelve a procesar las cabeceras del runtime.

```bash
bash native-cpp/build-all.sh          # usa la precompilada si vale; si no, compila
bash native-cpp/build-all.sh --force  # recompila siempre desde las fuentes
export ESTC_ROOT="$(pwd)"             # raíz del repositorio: runtime/ está aquí
native-cpp/native/etsc build /ruta/proyecto/main.ets --no-progress
```

Opciones: `--out DIR`, `--cxx CXX`, `--frontend BIN` (reutiliza un frontend),
`--static` (enlace autocontenido), `--force` (ignora la precompilada y compila
siempre; alias `--no-prebuilt`) y
`--update-prebuilt` (compila estático y guarda la semilla precompilada).

`native/frontend` analiza fuentes Estatic y emite IR verificado.
`native/etsc` es el coordinador/backend C++ que genera y compila programas.
No hace falta Node para construirlos ni para usarlos.

## Semilla precompilada (`prebuilt/`)

`prebuilt/<plataforma>/` (`linux-x86_64`, `darwin-arm64`) guarda `frontend` y
`etsc` ya compilados y `inputs.sha256`, la huella de todas sus fuentes
(`frontend/unity.cpp`, `build/bootstrap/etsc/`, `bootstrap/native/`,
`src/codegen/ir/native/` y `runtime/`). `build-all.sh` (y por tanto
`install.sh`) los copia en vez de compilar **solo si la huella coincide** con el
checkout y el binario arranca; si no, compila desde las fuentes. Una semilla
precompilada desfasada nunca se usa.

Son autocontenidas y solo llevan lo que la semilla necesita: libcrypto, la
librería estándar de C++ y pthread (nada de libuv, curl ni TLS):

- **Linux:** binarios totalmente estáticos (`ldd`: *not a dynamic executable*).
- **macOS:** libcrypto estática dentro; solo quedan `libSystem` y `libc++`, que
  forman parte del sistema (Apple no admite binarios 100 % estáticos).

### Compilador precompilado (`prebuilt/<plataforma>/compiler/`)

`build-compiler.sh --seed DIR --out BIN` construye el compilador de `bootstrap/`
(la semilla analiza `bootstrap/driver/main.ets` y compila el C++). Igual que la
semilla, por defecto copia `prebuilt/<plataforma>/compiler/etsc` si su huella
coincide (semilla + `bootstrap/` + `runtime/`); `--force` lo recompila y
`--update-prebuilt` lo regenera (estático, `-O2`). `install.sh` lo invoca;
`--force-compiler` le pasa `--force`.

La Action `seed-prebuilt.yml` las compila en Ubuntu y en macOS cuando cambia
alguna de esas fuentes (también el compilador de `bootstrap/`), comprueba con `file`/`otool -L` que no dependen de
librerías dinámicas de terceros, las prueba y las sube a main. Siguen haciendo
falta un compilador C++ en la máquina: la semilla lo invoca para construir
`bootstrap/`.

## Regenerar

```bash
node --experimental-strip-types scripts/generate-native-cpp-snapshot.mjs
```

La regeneración **solo borra y reescribe lo generado**: `frontend/`, `build/`,
`templates/` y `files.txt`. También borra `prebuilt/`, porque esos binarios ya
no corresponden a las fuentes nuevas. Los ficheros escritos a mano
(`build-all.sh`, `build-compiler.sh`, `README.md`) no se tocan nunca.

Cuando la regeneración llega a main, `seed-prebuilt.yml` vuelve a compilar la
semilla y el compilador en Linux y macOS y sube los nuevos precompilados, que
quedan así listos para la siguiente versión.

La Action `regenerate-native-cpp.yml` hace lo mismo: comprueba que los ficheros
escritos a mano no cambian, que aquí no aparecen copias de `runtime/`,
`bootstrap/`, `src/` ni `types/` y que `prebuilt/` se ha retirado, reconstruye
la semilla desde el artefacto descargado, la prueba y solo entonces publica la
instantánea.
