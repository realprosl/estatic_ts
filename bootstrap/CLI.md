# Driver nativo estc

[`install.sh`](../INSTALL.md) construye e instala `estc`. El frontend ETS se
compila usando `src/` durante el bootstrap. El driver y el emisor C++ se compilan
a código máquina; el recorrido instalado funciona sin Node ni TypeScript de
stage 0. Node sólo participa en el bootstrap, en la instalación y en las
herramientas de desarrollo/pruebas.

```sh
estc init proyecto
cd proyecto
estc build
estc run -- argumento1
estc --check src/main.ts
estc src/main.ts -o build/main.cpp --emit-ir build/main.ir.json --build
estc --from-ir build/main.ir.json --run
```

`estc --help` enumera las opciones. El driver reutiliza la configuración de
entry, aliases, raíces, outputs, compilador, flags y bibliotecas. `init` genera
`estatic.config.json`; se admiten configuraciones TS de objeto declarativo,
pero no ejecución de configuraciones JavaScript dinámicas. `--root`, `--alias`
y `--cache` llegan al cargador nativo. `--cache` es de sintaxis, no una caché
semántica persistente. El perfil instalado puede ser de sólo lectura.

El enlace reutiliza el runtime preparado y comprueba sus dependencias/ABI.
Los perfiles diferentes usan la caché del usuario. Se respetan los wrappers
HTTP existentes: httplib por defecto y Drogon con `@cpp_drogon`, además del
cliente libcurl. No se descargan dependencias durante los builds.

Códigos de salida: 0 en éxito, 1 en error de compilación y 2 en uso inválido.
`run` propaga el código del programa. La generación fallida no escribe C++ ni
el JSON de `--emit-ir`. La entrada `--from-ir` presupone IR verificado de un
productor de confianza; la frontera del host no sustituye al verificador.

El compilador de stage 0 y el driver TypeScript de referencia permanecen en
el clon para bootstrap y pruebas diferenciales. La implementación nativa del
backend está en `src/codegen/ir/native/` y la del driver en `bootstrap/native/`.
Las tablas runtime/tipos se generan desde las definiciones compartidas de
`src/` durante la construcción, y se integran en el binario. Los perfiles,
logging y caché incremental del CLI histórico no se anuncian como portados:
este recorrido emite una unidad C++ del proyecto.
