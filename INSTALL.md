# Instalación y trabajo con estc

```sh
git clone https://github.com/realprosl/estatic_ts.git
cd estatic_ts
./install.sh
estc init mi-proyecto
cd mi-proyecto
estc build
estc run
```

`install.sh` instala `/usr/local/bin/estc` y sus archivos privados bajo
`/usr/local/lib/estc/`. Se necesitan permisos sobre ese prefijo. Para una
instalación personal:

```sh
./install.sh --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

## Bootstrap y ejecución nativa

Durante la instalación se usa Node >=22.6 y el compilador de stage 0 en `src/`
para construir el frontend ETS. El driver y el emisor C++ se compilan también
a código máquina. Después, `estc` ejecuta el frontend nativo y emite, compila y
enlaza C++ sin Node, npm, intérprete JavaScript ni los fuentes TypeScript de
stage 0. El frontend es ETS compilado; el driver y el backend son C++20. Esto
no afirma que todo el compilador esté escrito en ETS o sea autoalojado.

El ejecutable instalado es `estc`. La distribución contiene el frontend nativo,
plantillas, tipos del editor, cabeceras y runtime precompilado; no instala el
antiguo launcher que ejecutaba Node. Al actualizar una instalación anterior,
se retira `nativo` sólo si el comando pertenece a esa instalación. Un comando
ajeno no se sobrescribe. El prefijo completo puede trasladarse.

Requisitos de construcción: C++20 (GCC/Clang), `ar`, OpenSSL/libcrypto y las
cabeceras/bibliotecas de los servicios usados (libuv, libcurl, TLS). Se prefieren
las dependencias locales bajo `build/libs/`; Drogon necesita además sus
bibliotecas cuando se selecciona `@cpp_drogon`. No se descargan dependencias
ni se modifican paquetes del sistema implícitamente. Node sólo hace falta
para el bootstrap/instalación y las herramientas de desarrollo.

`--cxx clang++`, `CXX` y `AR` seleccionan herramientas. `NODE` selecciona Node
para el instalador. `--frontend ruta` permite reutilizar un frontend ya construido.
Una actualización prepara una distribución nueva antes de publicar el comando.

## Proyectos y configuración

`estc init` genera `src/main.ts`, los tipos del editor y `estatic.config.json`.
`build` usa esa configuración; `run` construye y ejecuta, pasando los argumentos
y conservando el código de salida:

```sh
estc run -- argumento1 argumento2
estc build src/main.ets -o build/main.cpp --binary build/main
estc run src/main.ets -- argumento1
estc update-types .
estc --help  # también -h y -H
estc --version  # también -version, -v, -V y /V
```

El driver admite también `estatic.config.ts` cuando contiene un objeto
`export default` declarativo (claves, arrays, strings y valores JSON).
**No ejecuta configuraciones JavaScript dinámicas.** Éstas se rechazan con un
diagnóstico; deben expresarse mediante JSON u opciones del comando. También
se admiten `--config`, `--check`, `--emit-ir`, `--from-ir`, aliases, raíces de
módulos, flags del compilador/enlazador y un frontend alternativo. El IR JSON
presupone un productor de confianza que lo haya verificado.

## Tipos y caché del proyecto

`estc init` admite un directorio existente y conserva sus archivos: si alguno
colisiona con una plantilla, aborta antes de escribir. Copia las declaraciones
canónicas a `types/estatic.d.ts` y genera un `tsconfig.json` que las carga para
que el editor conozca los globales del dialecto sin imports. `estc update-types`
permite refrescarlas conservando un respaldo de las anteriores.

Los proyectos nativos nuevos crean `.build/` (ignorado por Git):

- `.build/cache/syntax`: caché del frontend nativo.
- `.build/cache/objects`: objetos C++ de compilaciones anteriores, con hashes de
  contenido, compilador, flags, entorno de includes y dependencias de cabeceras.
- `.build/generated`: versiones del C++ generado identificadas por contenido.
- `.build/runtime`: archivos estáticos del runtime, reutilizados desde la
  distribución instalada cuando son compatibles.

Los resultados finales siguen en `build/app.cpp` y `build/app`. Los proyectos
existentes conservan sus rutas `incremental.cacheDirectory` y
`incremental.generatedDirectory`, relativas al archivo de configuración.
`incremental.enabled: false` desactiva la caché de objetos y fuentes generadas
del proyecto. El runtime mantiene su caché compartida en ese caso. Cada build
vuelve a verificar el programa y enlaza el ejecutable; reutiliza la compilación
a objeto cuando sus entradas siguen siendo válidas. Los archivos corruptos o
las cabeceras modificadas invalidan los objetos correspondientes.

## Runtime preparado

La instalación precompila libuv/red y cpp-httplib. Los builds enlazan esos
archivos estáticos, validando compilador, arquitectura, flags de ABI, fuentes,
dependencias e integridad. La optimización del runtime es `-O2`; los perfiles
normales reutilizan los mismos archivos aunque el programa use `-O0`.

En proyectos con caché incremental, los perfiles distintos se construyen en
`.build/runtime`. Sin caché de proyecto, se construyen bajo
`$XDG_CACHE_HOME/estc/runtime` o `~/.cache/estc/runtime`, sin escribir en el
prefijo instalado.
`ESTC_RUNTIME_CACHE` permite seleccionar otra caché compartida (`ESTATIC_RUNTIME_CACHE`
continúa admitido). Cabeceras modificadas o archivos corruptos invalidan la
caché. `npm run bootstrap:runtime` prepara la misma caché en el clon.

## Verificación

`npm run test:bootstrap:ir:native` ejecuta la suite del backend con emisión y
build nativos. `npm run test:bootstrap:install` prueba la instalación aislada,
creación de proyecto, async, actualización, traslado del prefijo, argumentos,
códigos de salida y perfiles de runtime. En esa prueba, Node/nodejs/npm se
sustituyen por comandos que fallan: cualquier intento de ejecutarlos se detecta.
También se comprueba que no se instalan `src/` ni el driver TypeScript.

Validación: **75/75** pruebas del backend, **4/4** de instalación/caché y
migración de nombre, **19/19** regresiones de proyectos, versión y documentación.
El [audit nativo](bootstrap/ir/audit-native.ts) compila **126/131 ejemplos válidos**
(los mismos cinco rechazos explícitos de capacidades pendientes), sin ejecutar
servidores ni operaciones de red. No se anuncia un total global nuevo.
