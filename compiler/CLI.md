# Driver nativo etsc

[`install.sh`](../INSTALL.md) construye e instala `etsc`. Compila la semilla C++
de `native-cpp/` —el C++ que el compilador genera de sí mismo— y con ella compila
`compiler/`. El recorrido instalado funciona sin Node ni TypeScript de stage 0, y
la semilla se regenera con `native-cpp/regenerate.sh`. Node solo participa en las
herramientas de desarrollo/pruebas.

```sh
etsc init proyecto
cd proyecto
etsc build
etsc run -- argumento1
etsc --check src/main.ts
etsc src/main.ts -o build/main.cpp --emit-ir build/main.ir.json --build
etsc --from-ir build/main.ir.json --run
```

`etsc --help` enumera las opciones. El driver reutiliza la configuración de
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
backend está en `src/codegen/ir/native/` y la del driver en `compiler/native/`.
Las tablas runtime/tipos se generan desde las definiciones compartidas de
`src/` durante la construcción y se integran en el binario. El logging
estructurado y los perfiles del CLI histórico no se anuncian como portados.
Este recorrido emite una unidad C++ del proyecto y reutiliza su objeto cuando
las entradas y dependencias de la caché siguen siendo válidas.

## Progreso del CLI de bootstrap

El driver TypeScript `compiler/cli.ts` admite `--verbose` para mostrar en
stderr las fases reales, sus duraciones, la entrada, el frontend, las opciones
de módulos, las rutas generadas y el compilador con sus flags:

```sh
npm run bootstrap -- run examples/hello.ets --verbose
npm run bootstrap -- examples/hello.ets --check --verbose
npm run bootstrap -- build --config estatic.config.ts --verbose --no-progress
```

La preparación del frontend, el análisis/verificación del IR, la generación
C++ y la compilación/enlace usan una única línea de progreso en terminales interactivas.
La línea cambia con la tarea actual y muestra el tiempo transcurrido. Al terminar
cada sección, queda una línea con ✓, su nombre y duración; la siguiente sección
empieza en una nueva línea dinámica. Los detalles internos se reemplazan sobre
esa línea activa, y los errores permanecen visibles. Los contadores comunicados por el
frontend, como `[19/36]`, aparecen sin inventar un porcentaje global. La
animación continúa durante las herramientas bloqueantes porque el trabajo se
ejecuta en un worker y el renderizado permanece en el hilo principal. La fase
nativa de análisis muestra las tareas que comunica el frontend, incluido el
archivo actual, tipos, seguridad, comptime y generación del IR. `--check` sigue comprobando el IR y omite C++.

`--no-progress`, `NO_COLOR`, `TERM=dumb` y `CI` desactivan las animaciones.
Al redirigir stderr se usa texto plano con `--verbose`; sin verbose el progreso
es silencioso. Stdout conserva el JSON de `init` o la salida del programa.
Los argumentos situados después de `--` pertenecen al programa, incluidos
`--verbose` y `--no-progress`. `-v` continúa mostrando la versión.

El ejecutable nativo instalado `etsc` admite también `--verbose` y
`--no-progress`. Muestra las fases, los comandos reales del compilador, los
aciertos/fallos de caché y sus tiempos, sin utilizar Node. La animación se
actualiza mientras espera al frontend y al compilador, y termina antes de
ceder el terminal al programa:

```sh
etsc run --verbose
etsc build --verbose --no-progress
```

En ambos drivers, stdout se reserva para los resultados y el programa; el
progreso se escribe por stderr y se desactiva en pipes salvo con verbose.

Con `--verbose`, la preparación del frontend indica si se reutiliza la caché
o se reconstruye, y muestra la transpilación y el comando C++ antes de ejecutarlo.
El runtime informa de la caché, cada unidad que compila y la creación del archivo
estático. También se imprime el comando de análisis y el de compilación/enlace
del programa. En terminales interactivas estos detalles actualizan la línea activa en stderr.
Usa `--verbose --no-progress` para conservar el historial completo de mensajes.

Durante «Analizando fuentes y verificando IR», `--verbose` transmite los
mensajes del frontend en tiempo real: lectura y análisis de cada archivo,
expansión y binding, comprobación de tipos por módulo (con contador),
seguridad, comptime, lowering y serialización del IR. El JSON sigue reservado
a stdout; las trazas se escriben en stderr.
