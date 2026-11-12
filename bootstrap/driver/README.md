# Compilador completo en ETS

`main.ets` reúne el cargador de módulos, expansión, binder, checker, análisis de
seguridad, lowering a `ets-ir-2`, backend C++ y coordinador de construcción. El
proceso no ejecuta Node, `src/`, el frontend auxiliar ni el generador C++ anterior.
Invoca el compilador C++ del sistema para construir el programa final.

Las fuentes canónicas permanecen en `bootstrap/`. `native-cpp/` es la semilla C++
y contiene únicamente el C++ generado (frontend, tablas y plantillas); no alberga
una segunda copia de los módulos ETS ni del runtime. El runtime (`runtime/`), el
coordinador (`bootstrap/native/`) y el emisor IR (`src/codegen/ir/native/`) se
comparten desde su ubicación canónica. `src/` se conserva como implementación de
referencia.

Desde la raíz del repositorio:

```sh
bash scripts/build-ets-compiler.sh stage1
bash scripts/check-ets-compiler.sh
build/ets-compiler/etsc build examples/modules/main.ets --binary build/example --verbose
```

Para que el compilador ETS se compile a sí mismo:

```sh
bash scripts/build-ets-compiler.sh stage2
bash scripts/check-ets-compiler.sh build/ets-compiler/etsc-stage2
cmp build/ets-compiler/stage1.ir.json build/ets-compiler/stage2.ir.json
```

La primera generación necesita la semilla de `native-cpp/`; la segunda usa el
compilador ETS completo. No hace falta regenerar la semilla para probar cambios
ETS. El workflow **ETS compiler self-hosting** ejecuta las dos generaciones.

El backend consume exclusivamente IR tipado y verificado. `--from-ir` utiliza un
decodificador explícito para ese mismo modelo, leyendo las tablas elemento a
elemento para evitar un segundo DOM JSON completo; `--codegen-json` mantiene la
interfaz del banco de pruebas del backend anterior. Se conservan las primitivas
`@include` y `@cppgen`, que permiten compilar también la frontera con el sistema.

`host.ets` y `runtime/ets_compiler_host.hpp` delimitan las operaciones del sistema:
archivos, entorno, procesos, reloj y terminal. La configuración, las decisiones
sobre flags/bibliotecas, generación y progreso se implementan en ETS. Los runtimes
propios del destino C++ siguen siendo parte del destino C++.

El modo verbose actualiza una línea en terminal y conserva cada fase completada
con ✓. Sin terminal imprime las fases terminadas sin secuencias de control. No se
inventan porcentajes para el análisis: el detalle indica el módulo o paso real.

Esta entrada es independiente de la instalación actual. No sustituye los binarios
de `~/.local/bin` ni cambia `install.sh`. Admite configuración JSON y objetos
literales `export default`, incluidos el import de tipos y `satisfies` de la
configuración del repositorio; nunca ejecuta configuración JavaScript.

La caché de sintaxis se puede activar con `--cache` o `incremental.cacheDirectory`.
El coordinador ETS compila/enlaza directamente y todavía no reutiliza los objetos
o archivos de runtime del coordinador C++ anterior. Tampoco incluye su opción
`--frontend`: el frontend está integrado en el mismo ejecutable.

Para exportar una nueva semilla C++ del compilador entero, después de verificar
ambas generaciones:

```sh
bash scripts/regenerate-ets-native.sh
```

El snapshot generado queda en `native-cpp/compiler/unity.cpp`. La orden construye
`native-cpp/native/etsc-ets` usando únicamente C++ y el soporte de `native-cpp/`. No
copia fuentes ETS a ese directorio ni sobrescribe la semilla anterior. El snapshot se
genera de forma explícita; no se incluye como un segundo árbol de fuentes manuales.
