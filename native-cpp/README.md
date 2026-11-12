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
| `build-all.sh`, `files.txt` | Script de construcción y manifiesto de ficheros |

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

Desde un clon completo, en Linux, con G++ C++20 y OpenSSL de desarrollo:

```bash
bash native-cpp/build-all.sh          # -I<repo> para runtime/, bootstrap/ y src/
export ESTC_ROOT="$(pwd)"             # raíz del repositorio: runtime/ está aquí
native-cpp/native/etsc build /ruta/proyecto/main.ets --no-progress
```

`native/frontend` analiza fuentes Estatic y emite IR verificado.
`native/etsc` es el coordinador/backend C++ que genera y compila programas.
No hace falta Node para construirlos ni para usarlos.

## Regenerar

```bash
node --experimental-strip-types scripts/generate-native-cpp-snapshot.mjs
```

La Action `regenerate-native-cpp.yml` hace lo mismo, valida que aquí no
aparezcan copias de `runtime/`, `bootstrap/`, `src/` ni `types/`, reconstruye
la semilla desde el artefacto descargado, la prueba y solo entonces publica la
instantánea.
