# #66: correcciones publicadas y validación pendiente

Estado del 6 de noviembre de 2026. Fuentes: `9659aec42bac46d06f11880138f0a73dd6a79ad2`. PR #71 permanece en borrador y #66 abierta. **No se ha confirmado el ciclo completo en estas fuentes.** El entorno de ejecución dejó de estar disponible durante la última ejecución y no fue posible recuperar su resultado ni publicar sus informes crudos.

## Correcciones implementadas

- Cache de rutas de places por función en el verificador de inicialización; evita buscar repetidamente las definiciones de índices dentro de cada store y pasada de punto fijo.
- Índice de símbolos por propietario en seguridad; conserva orden, receptores, ámbitos anidados y restauración de llamadas precisas.
- Índice de tipos resueltos, manteniendo el orden de IDs y reservándolos antes de construir hijos.
- Consulta directa de firmas de funciones en el proyecto inmutable, sin copiar sus cuerpos por cada llamada/closure/dispatch.
- Consulta directa de las tablas CheckFile mediante el índice del módulo llamador; evita copiarlas en cada llamada y conserva el contexto de defaults entre módulos.
- Índice de places locales por identidad de símbolo, reiniciado por función y conservando la primera coincidencia.
- Predecesores CFG calculados una vez por función, ordenados y sin duplicados, utilizados en el punto fijo y la validación final.

## Pruebas terminadas

Se observaron **1.534 pruebas seleccionadas correctas**: checker 1.381 existentes y 2 nuevas; IR 136; trazas 7; escalado de lowering 2; colecciones/temporales 5; metadatos 1. Las dos pruebas nuevas del checker se ejecutaron separadamente con el mismo binario de su suite. Las modificaciones posteriores afectan a IR, sin cambiar las fuentes del checker. No se afirma haber ejecutado npm test completo.

Las pruebas cubren IR inválido, dominancia e inicialización, genéricos, defaults y argumentos nombrados entre módulos, shadowing y reinicio de identidades por función, recursión/out, movimientos, snapshots de colecciones, temporales y ambos generadores C++.

Las guardias de escalado fallan en las versiones anteriores y pasan tras las correcciones. Mediciones locales observadas, mismo g++ 13.3.0 y -O1, mediana de tres muestras:

| Trabajo | Tamaño | Antes | Con corrección |
| --- | ---: | ---: | ---: |
| Lowering de escrituras indexadas | 512 | 693,57 ms | 49,00 ms |
| Lowering de escrituras indexadas | 1024 | 4202,34 ms | 132,86 ms |
| Cuerpos IR con llamadas repetidas | 512 | 183,73 ms | 6,85 ms |
| Cuerpos IR con llamadas repetidas | 1024 | 741,22 ms | 13,36 ms |

En una entrada fija con 256 llamadas precisas y 2048 locales ajenos, safety.flow de segunda generación pasó de 214,09 a 128,58 ms. Las comparaciones completas de 10 entradas conservaron el mismo IR, incluidos errores de nombres/tipos. Ocho casos comparados entre generaciones también coincidieron en el candidato anterior a los últimos índices.

Para la corrección de CheckFile, sobre las mismas fuentes completas, los cuerpos IR del seed pasaron de 10,409 a 2,744 s y se comprobó igualdad byte a byte de unos 82 MB de IR. Esta comparación corresponde a la corrección anterior a los índices CFG/locales; no sustituye la validación del último candidato.

## Ciclos completos y bloqueo actual

Los límites se mantuvieron en 300 s por análisis y 600 s por compilación, con -O1 en ambos frontends. No se restauraron workflows.

El último resultado completo recuperado corresponde a `0094f8763ab7062220fb6a4b8c08757540aec466`: la segunda generación completó análisis, los cuerpos de las 789 funciones IR, contratos y préstamos, y agotó 300 s dentro de `lower.verify`. Los cuerpos finalizaron a los 290,706 s y la verificación comenzó a los 292,364 s. Por ello se añadieron los índices CFG/locales del commit actual.

Un candidato intermedio recibió SIGKILL a los 253,361 s (profiler -9, wrapper 137), antes del límite. No se conoce de forma confirmada la causa; no se presenta como timeout ni éxito. Los intentos anteriores con 124 y el fallo histórico con -O0 siguen siendo fallos, no quedan resueltos por las pruebas pequeñas.

Se reconstruyó el seed del candidato actual y se inició scripts/verify-native-self-generation.py; el entorno se desconectó antes de recuperar el resultado. **Pendientes:** IR del propio frontend idéntico entre generaciones, finalización satisfactoria de todos los pasos del verificador y control final en este candidato. El driver/backend siguen siendo C++ de referencia.

## Procedencia y reanudación

El commit local probado `ca5ebb90f59f4a6b19e9e3de3011e296b56f23ee` y el publicado `9659aec42bac46d06f11880138f0a73dd6a79ad2` tienen el mismo árbol `3d6264c6e8dad5b2d63662fe55696f1476f492de`. Los argumentos de procedencia de la última ejecución se pasaron como HEAD; el checkout de inicio fue el commit local indicado. Los binarios y nuevos informes quedaron en el entorno que dejó de estar disponible; las cifras anteriores son una síntesis de salidas observadas, no un nuevo paquete de trazas publicado.

Para reanudar desde las fuentes publicadas, usar una salida nueva y mantener los límites:

```sh
mkdir -p build/repro66/tmp
export TMPDIR="$PWD/build/repro66/tmp"
bash native-compiler-mini/build-all.sh
node --experimental-strip-types --input-type=module -e '
import {buildLoader} from "./bootstrap/modules/build.ts";
console.log(await buildLoader(process.cwd()+"/build/repro66/seed", "bootstrap/ir/demo.ets", true));'
g++ -std=c++20 -O1 -pthread -fno-exceptions -I. \\
  -Ibuild/repro66/seed build/repro66/seed/unity.cpp -o build/repro66/seed/frontend-O1
python3 scripts/verify-native-self-generation.py \\
  --frontend build/repro66/seed/frontend-O1 \\
  --seed-source-commit 9659aec42bac46d06f11880138f0a73dd6a79ad2 \\
  --target-source-commit 9659aec42bac46d06f11880138f0a73dd6a79ad2 \\
  --compiler native-compiler-mini/native/etsc \\
  --native-root native-compiler-mini --output build/repro66/cycle
```

No marcar lista para mergear ni cerrar #66 sin success=true, selfIrIdentical=true y todos los pasos con exitCode=0. #64 y #65 se completaron antes de #66.
