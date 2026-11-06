# #66: prueba completa de segunda generación

Validación local del commit `c75a1af04ba66700354aa5fd707e6bdcb65df33e`,
el 6 de noviembre de 2026. #64 y #65 se completaron antes de esta prueba.
No se han restaurado workflows. La PR #71 permanece en borrador.

## Resultado

El frontend actualizado puede analizar sus fuentes, emitir IR válido y producir
un frontend de segunda generación que compila, enlaza y ejecuta el programa de
control. **El verificador completo falla**: la segunda generación agota los
300 segundos al volver a construir el IR de sus propias fuentes. No se ha
verificado la igualdad de ese IR ni se declara completado el ciclo completo.

| Comprobación | Resultado |
| --- | --- |
| Compilador de referencia reconstruido desde C++ | Correcto |
| Frontend inicial sin optimización (`-O0`) sobre sus fuentes | Timeout 124 a 300,058 s, en `safety.flow` |
| Frontend inicial con `-O1` sobre las mismas fuentes | IR válido en 84,296 s, `success=true`, cero diagnósticos |
| IR utilizado para generar la segunda generación | 81.824.515 bytes, 789 funciones |
| Generación de C++, compilación y enlace con `-O1` | Correcto, 105,060 s |
| Segunda generación sobre sus fuentes | Análisis completo; timeout 124 a 300,138 s durante `lower` |
| Igualdad del IR del propio frontend entre generaciones | Pendiente: la segunda ejecución no llega a emitirlo |
| IR del programa de control entre generaciones | Idéntico y válido |
| Compilación, enlace y ejecución del control | Correcto: `Hola, mundo` y `120` |

El segundo intento cambia explícitamente la optimización del frontend inicial;
no cambia fuentes ni amplía el límite. No se presenta como solución del timeout
de `-O0`. Los resultados de ambos intentos se conservan separados.

## Fases y recursos

El frontend inicial con `-O1` completa carga en 2,085 s, tipos en 4,091 s,
seguridad en 47,570 s (incluye flujo: 42,547 s), construcción de IR en
25,976 s y formato en 2,068 s. RSS máximo: 2.089.768 KiB.

La segunda generación completa carga en 13,092 s, tipos en 22,684 s y
seguridad en 168,104 s (incluye flujo: 146,018 s). Completa el análisis del
proyecto a los 209,011 s. `analyze.lower` queda abierto al menos 91,127 s
hasta el timeout. RSS máximo: 5.485.956 KiB. Este intervalo abierto es un
límite inferior; no representa la duración de una fase completada. La traza
no permite atribuir todavía el coste a una operación concreta de `lower`.

Los intervalos anidados no se suman. Los tiempos de fases son llegadas de
stderr, con latencia de tubería y planificación. Todos los límites de análisis
se mantienen en 300 s y los de compilación en 600 s. El fallo no se excluye
ni se convierte en éxito por pasar el programa de control.

## Alcance del bootstrap

El frontend inicial se construye mediante el compilador TypeScript de etapa
cero y g++. Después, ese ejecutable nativo analiza `bootstrap/ir/demo.ets` y
produce el IR usado para crear la segunda generación. La generación de C++ y
el driver siguen siendo los de referencia C++; no se afirma que se hayan
regenerado desde ETS. El nuevo ejecutable nativo procesa realmente el control.

## Evidencia

[issue-66](issue-66/) contiene procedencia y hashes de los cuatro binarios,
informes de los dos intentos, métricas, trazas completas y verificación del
control. El IR válido tiene SHA-256
`ce72a675ac908272753d79e39479b9785976d4bd80c3bc7eeecfd7659c7afc24`.
El IR compartido del control tiene SHA-256
`51ca8cf09f020d9ef93eaa394fe06633084af9160fff57ca450835860ab782a2`.
Los IR completos y binarios generados permanecen en `build/full-validation/`
en el entorno de ejecución; los datos pequeños de diagnóstico se versionan.

## Regresiones

Se ejecutaron 1.465 pruebas seleccionadas: binder/checker 1.448, tokens y
miembros 3, escalado de seguridad 1, trazas 7, colecciones y temporales 5,
metadatos 1. Las pruebas de IR usan el frontend de segunda generación;
colecciones y metadatos comprueban ambos generadores C++.

La primera ejecución dio 1.464 correctas y un fallo de entorno: el test de
metadatos no pudo crear su directorio temporal porque `/tmp` no existe en
este entorno. Se repitió únicamente ese test con `TMPDIR` dentro del workspace
y pasó 1/1. No se cambió código ni se excluyó el test. Los 1.465 casos
seleccionados quedan validados; no se afirma haber ejecutado `npm test`
completo. Se conservan ambos TAP comprimidos y `regressions.json`, incluidos
el fallo inicial y la corrección de entorno. Ninguna prueba quedó cancelada
ni omitida. El fallo 124 del ciclo completo sigue siendo independiente de
estas regresiones y no queda resuelto por ellas.

## Reproducción

Desde el commit indicado, en Linux con g++ 13.3.0 y Node 24.22.1:

```sh
bash native-compiler-mini/build-all.sh
node --experimental-strip-types --input-type=module -e '
import {buildLoader} from "./bootstrap/modules/build.ts";
console.log(await buildLoader(process.cwd()+"/build/full-validation/seed", "bootstrap/ir/demo.ets", true));'
g++ -std=c++20 -O1 -pthread -fno-exceptions -I. \
  -Ibuild/full-validation/seed build/full-validation/seed/unity.cpp \
  -o build/full-validation/seed/frontend-O1
python3 scripts/verify-native-self-generation.py \
  --frontend build/full-validation/seed/frontend-O1 \
  --seed-source-commit c75a1af04ba66700354aa5fd707e6bdcb65df33e \
  --target-source-commit c75a1af04ba66700354aa5fd707e6bdcb65df33e \
  --compiler native-compiler-mini/native/etsc \
  --native-root native-compiler-mini --output build/full-validation/cycle-O1
```

Usar un directorio de salida nuevo en cada ejecución. Para reproducir el
intento sin optimización, pasar `seed/modules-demo` como frontend.

El verificador se detiene al fallar la repetición. El control se comprobó
adicionalmente con ambos frontends sobre `examples/hello.ets`, se exigió
igualdad byte a byte del IR y `success=true` sin diagnósticos, se compiló
ese IR mediante `etsc build --from-ir ... --cxx-flag -O1` y se exigió la
salida exacta de las dos líneas indicadas. Los códigos, tiempos y salida
se conservan en [control](issue-66/control/).
