# CLI del compilador bootstrap

`bootstrap/cli.ts` conecta el frontend nativo ETS (carga de módulos, lexer,
parser, expansión, binder, checker, seguridad, efectos y comptime), el lowering
con verificador `ets-ir-2` y el backend C++ de `src/codegen/ir/`. El driver y el
emisor C++ siguen escritos en TypeScript. Stage 0 sólo construye la herramienta
nativa del frontend; no analiza el programa solicitado ni emite su C++.

```sh
npm run bootstrap -- examples/interface.ets --run
npm run bootstrap -- examples/hello.ets --check
npm run bootstrap -- examples/hello.ets -o build/hello.cpp --emit-ir build/hello.ir.json --build
npm run bootstrap -- --from-ir build/hello.ir.json --run
npm run bootstrap -- --config estatic.config.ts --run
npm run bootstrap -- app.ets --run -- argumento1 argumento2
```

El ejecutable npm es `etsc-bootstrap`. `--help` enumera todas las opciones.
El CLI histórico `etsc` y la entrada `etsc-ir-cpp` siguen disponibles.

## Proyecto y compilación

Se reutilizan `loadConfig`, la versión y los comandos `init`/`update-types` de
`src/`. La configuración resuelve `entry`, aliases, raíces, rutas de C++/binario,
compilador, flags y bibliotecas. Las opciones de la línea de comandos prevalecen
sobre sus equivalentes de configuración. Sin entrada explícita se busca
`estatic.config.ts` en el directorio actual. Las opciones de logging e
incremental del CLI histórico todavía no se aplican a este recorrido.

`--root`, `--alias` y `--cache` se envían al cargador nativo. La caché es de
sintaxis; no se anuncia caché persistente de resultados semánticos. El driver
reutiliza el ejecutable del frontend mientras su huella de fuentes, runtime,
configuración del paquete, plataforma y nombre del compilador no cambie.
`--frontend ruta` permite seleccionar un ejecutable ya construido.

El enlace reutiliza el runtime existente y detecta libuv, curl y el wrapper
HTTP seleccionado. Se prefieren las instalaciones locales de libuv y Drogon
bajo `build/libs/`; en su ausencia se utilizan las bibliotecas del sistema.
Las dependencias no se descargan ni se instalan al compilar un programa.
Drogon requiere soporte de excepciones en sus headers C++, por lo que sólo
ese backend añade `-fexceptions`; esto no introduce excepciones en ETS.

## Diagnósticos y alcance

`--check` comprueba el frontend y el IR sin emitir C++. La generación comprueba
además las capacidades del backend; por eso un programa puede pasar `--check`
y requerir una capacidad C++ pendiente. `--from-ir` presupone un productor
nativo de confianza que haya verificado el proyecto; los chequeos estructurales
del host no sustituyen esa verificación ni validan entradas hostiles.

Los errores incluyen el archivo, offset y código del diagnóstico. Los códigos
de salida son 0 en éxito, 1 en error de compilación y 2 en uso inválido del CLI.
`--run` propaga el código de salida del programa. Si el generador rechaza una
capacidad, no escribe C++ ni el JSON solicitado mediante `--emit-ir`.

El recorrido de unidades múltiples, los perfiles y el caché incremental del
backend histórico no se sustituyen: se genera una unidad C++ del proyecto.
La cobertura y los límites están en [ir/CPP.md](./ir/CPP.md).
