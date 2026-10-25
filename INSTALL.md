# Instalación y trabajo con nativo

El recorrido habitual es clonar el repositorio y ejecutar su instalador:

```sh
git clone https://github.com/realprosl/estatic_ts.git
cd estatic_ts
./install.sh
```

El prefijo predeterminado es `/usr/local`. Se necesitan permisos de escritura
sobre ese prefijo. Para instalar en el prefijo personal sin privilegios:

```sh
./install.sh --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

Requisitos del host: Node >=22.6, un compilador C++20 (GCC/Clang), `ar`, y las
cabeceras/bibliotecas de libuv, libcurl y OpenSSL para los servicios utilizados.
Se prefieren dependencias locales existentes bajo `build/libs/`. Drogon y sus
dependencias son necesarios cuando se selecciona `@cpp_drogon`; el instalador
no los descarga ni modifica paquetes del sistema. Los fallos de compilación
se propagan y una instalación publicada se sustituye sólo después de preparar
la nueva distribución.

## Qué prepara install.sh

1. Construye el frontend nativo ETS mediante el compilador de stage 0 en `src/`.
2. Precompila libuv/red y cpp-httplib en bibliotecas estáticas del runtime.
3. Compila el ejecutable de entrada `nativo` e instala una distribución con
   frontend, driver, emisor, tipos del editor, cabeceras y runtime precompilado.
4. Publica el comando en `<prefix>/bin/nativo`, conservando las distribuciones
   anteriores. Reinstalar actualiza la distribución; un comando ajeno no se
   sobrescribe.

`--cxx clang++` selecciona el compilador. `CXX` y `AR` permiten seleccionar las
herramientas; `NODE` selecciona Node para ejecutar el instalador. El comando
instalado busca Node en `PATH`; `NATIVO_NODE` permite seleccionar otro ejecutable. La opción
avanzada `--frontend ruta` permite instalar un frontend ya construido.

La distribución puede usarse desde cualquier proyecto y moverse con todo su
prefijo: el comando resuelve sus archivos con respecto a `bin/`. No ejecuta el
CLI histórico ni recompila el frontend mediante `src/` durante el uso normal.
El frontend es un binario nativo; el driver y el emisor C++ actuales siguen
siendo TypeScript y necesitan Node. El ejecutable de entrada los coordina;
esta instalación no anuncia autoalojamiento completo del emisor.

## Crear, compilar y ejecutar proyectos

```sh
nativo init mi-proyecto
cd mi-proyecto
nativo build
nativo run
```

`init` crea el proyecto con `estatic.config.ts`, fuente, declaraciones para el
editor y documentación del flujo instalado. `build` lee la configuración y
produce C++ y el ejecutable. `run` construye y ejecuta el proyecto, pasa sus
argumentos y conserva su código de salida:

```sh
nativo run -- argumento1 argumento2
nativo build src/main.ts -o build/main.cpp --binary build/main
nativo run src/main.ts -- argumento1
nativo update-types .
```

Se mantienen las opciones del [driver de bootstrap](bootstrap/CLI.md), incluidas
`--check`, `--emit-ir`, `--from-ir`, aliases y raíces de módulos.

## Reutilización del runtime

Las compilaciones enlazan las bibliotecas ya preparadas. Sus perfiles comprueban
compilador, arquitectura, flags de ABI/instrumentación, contenido de las fuentes
y todas las cabeceras detectadas por el compilador. Se valida también la
integridad del archivo. La optimización del runtime es `-O2`, independiente
de la optimización del programa. `-O0` y el perfil normal de `init` reutilizan
las mismas bibliotecas cuando los flags de ABI coinciden.

Un perfil diferente, por ejemplo sanitizers u otro compilador, genera una caché
del usuario bajo `$XDG_CACHE_HOME/nativo/runtime` o `~/.cache/nativo/runtime`.
`ESTATIC_RUNTIME_CACHE` permite elegir otro directorio. El prefijo instalado
puede ser de sólo lectura para el usuario que compila proyectos. En el clon,
`npm run bootstrap:runtime` prepara la misma caché bajo `build/runtime-cache/`.

## Verificación del flujo

La prueba `npm run test:bootstrap:install` verifica la instalación en un prefijo
independiente, creación de proyecto, build/run async, actualización, traslado del
prefijo, argumentos y códigos de salida. Comprueba que los builds normales no
crean una caché nueva, y que un perfil distinto usa la caché del usuario. Incluye
invalidación por cabeceras/flags y recuperación de archivos estáticos corruptos.

Validación de esta implementación: **3/3** pruebas de instalación/caché,
**75/75** del backend/HTTP/CLI, **15/15** de creación de proyectos y **4/4** de
versión/documentación. También se ejecutó el instalador sin `--frontend`,
construyendo el frontend mediante stage 0 dentro de un prefijo de prueba.
