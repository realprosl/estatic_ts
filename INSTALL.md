# Instalación y trabajo con etsc

```sh
git clone https://github.com/realprosl/estatic_ts.git
cd estatic_ts
./install.sh
etsc init mi-proyecto
cd mi-proyecto
etsc build
etsc run
```

`install.sh` instala `/usr/local/bin/etsc` y sus archivos privados bajo
`/usr/local/lib/estc/`. Se necesitan permisos sobre ese prefijo. Para una
instalación personal:

```sh
./install.sh --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

## Bootstrap y ejecución nativa

La instalación **no usa Node.js**. Primero compila el frontend y el emisor de
la semilla C++ de `native-cpp/`. Con esa semilla analiza las fuentes actuales de
`bootstrap/driver/main.ets`, genera su C++ y construye el compilador completo
escrito en ETS (frontend, backend y coordinador). Ese resultado se publica como
`bin/etsc`, junto con las cabeceras, tipos, plantillas y archivos estáticos del
runtime de libuv y cpp-httplib. La semilla y el C++/IR del compilador se conservan
como artefactos privados para recuperación e inspección.

El runtime se precompila y el compilador se prueba **antes** de cambiar el comando
instalado. Un fallo conserva la instalación anterior. El compilador instalado
encuentra su distribución aunque se mueva el prefijo completo; no requiere el
checkout ni `ESTC_ROOT`. Los archivos estáticos llevan un manifiesto de hashes e
identidad de compilador; se reutilizan cuando coinciden. Flags personalizados
que puedan cambiar el ABI fuerzan la compilación desde los fuentes del runtime.

Para actualizar reconstruyendo desde las fuentes actuales:

```sh
git switch main
git pull --ff-only
sudo bash install.sh
# Alternativa sin sudo:
# bash install.sh --prefix "$HOME/.local"
hash -r
etsc --version
```

La distribución incluye `bootstrap/modules/platform.hpp`, necesaria para
compilar los fuentes de bootstrap con el compilador instalado. La cabecera
mantiene su ruta de inclusión también al mover la instalación.

Node sólo hace falta para **regenerar la semilla** cuando cambian las fuentes de
`bootstrap/*.ets`:

```sh
node --experimental-strip-types scripts/generate-native-cpp-snapshot.mjs
```

Ese paso es de desarrollo, no de despliegue: `install.sh` nunca lo invoca.

El ejecutable instalado es `etsc`. La distribución contiene el frontend nativo,
plantillas, tipos del editor, cabeceras y runtime precompilado; no instala el
antiguo launcher que ejecutaba Node. Al actualizar una instalación anterior,
se retiran `estc` y `nativo` sólo si sus hashes prueban que pertenecen a esa
instalación. Un enlace npm de `etsc` al CLI de este mismo clon se sustituye
por el binario nativo. Un comando
ajeno no se sobrescribe. El prefijo completo puede trasladarse.

Requisitos de construcción: C++20 (GCC/Clang), `ar`, OpenSSL/libcrypto y las
cabeceras/bibliotecas de los servicios usados (libuv, libcurl, TLS). Se prefieren
las dependencias locales bajo `build/libs/`; Drogon necesita además sus
bibliotecas cuando se selecciona `@cpp_drogon`. No se descargan dependencias
ni se modifican paquetes del sistema implícitamente. Node sólo hace falta para
regenerar la semilla y para las herramientas de desarrollo.

`--cxx clang++`, `CXX` y `AR` seleccionan herramientas. `--frontend ruta`
permite reutilizar un frontend ya construido en vez de compilar la semilla.
Una actualización prepara una distribución nueva antes de publicar el comando.

## Proyectos y configuración

`etsc init` genera `src/main.ts`, los tipos del editor y `estatic.config.json`.
`build` usa esa configuración; `run` construye y ejecuta, pasando los argumentos
y conservando el código de salida:

```sh
etsc run -- argumento1 argumento2
etsc build src/main.ets -o build/main.cpp --binary build/main
etsc run src/main.ets -- argumento1
etsc update-types .
etsc run --verbose  # fases, comandos, cachés y tiempos
etsc build --verbose --no-progress  # progreso sin animaciones
etsc --help  # también -h y -H
etsc --version  # también -version, -v, -V y /V
```

El driver admite también `estatic.config.ts` cuando contiene un objeto
`export default` declarativo (claves, arrays, strings y valores JSON).
**No ejecuta configuraciones JavaScript dinámicas.** Éstas se rechazan con un
diagnóstico; deben expresarse mediante JSON u opciones del comando. También
se admiten `--config`, `--check`, `--emit-ir`, `--from-ir`, aliases, raíces de
módulos, flags del compilador/enlazador y un frontend alternativo. El IR JSON
presupone un productor de confianza que lo haya verificado.

## Tipos y caché del proyecto

`etsc init` admite un directorio existente y conserva sus archivos: si alguno
colisiona con una plantilla, aborta antes de escribir. Copia las declaraciones
canónicas a `types/estatic.d.ts` y genera un `tsconfig.json` que las carga para
que el editor conozca los globales del dialecto sin imports. `etsc update-types`
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

La instalación precompila libuv/red y cpp-httplib con el propio compilador
recién instalado, y deja los archivos estáticos en la distribución para que el
primer build no tenga que compilarlos. Los builds enlazan esos archivos
estáticos, validando compilador, arquitectura, flags de ABI, fuentes,
dependencias e integridad.

Si el entorno no tiene las cabeceras de libuv, el instalador avisa y deja que
el compilador construya el runtime en el primer uso: la instalación nunca
falla por esto. La optimización del runtime es `-O2`; los perfiles
normales reutilizan los mismos archivos aunque el programa use `-O0`.

Los perfiles distintos se construyen bajo `$XDG_CACHE_HOME/estc/runtime` o
`~/.cache/estc/runtime`, sin escribir en el prefijo instalado.
`ESTC_RUNTIME_CACHE` permite seleccionar otra caché (`ESTATIC_RUNTIME_CACHE`
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
