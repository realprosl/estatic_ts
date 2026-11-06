# #64: diagnóstico anterior a la corrección del binder

Orden obligatorio: resolver #64 antes de retomar #65; resolver #65 antes de #66.
La PR #70 está en borrador. Este trabajo no modifica el compilador.
Todos los workflows se eliminaron de main y de las tres ramas de trabajo activas
por petición del usuario. El perfilador se ejecuta directamente, sin Actions nuevas.

## Evidencia original de Actions

- Ejecución: https://github.com/realprosl/estatic_ts/actions/runs/42087571288
- Artefacto: https://github.com/realprosl/estatic_ts/actions/runs/42087571288/artifacts/13443707570
- SHA-256 del ZIP: `e013b10b070a663eea6e43aed7a1e1fae9d578a251caff9c7963cbdb4e96bf6b`.
- Head de la PR #69: `4656024326cdb68eef15e712659ad78712adc06c`.
- Commit realmente compilado (merge sintético de Actions):
  `fe555ada9f05aaa82d3acd60fdb12aa102f50909`.
- Runner: Ubuntu 24.04.5; paquete g++ 13.2.0; compilador de referencia reconstruido
  con `bash native-compiler-mini/build-all.sh`; frontend recompilado desde Bootstrap.
- Entrada: `bootstrap/ir/demo.ets --trace`, límite de 300 segundos.
- 1448/1448 pruebas de binder/checker correctas; contrato de trazas correcto.

| Métrica original | Resultado |
| --- | ---: |
| Tiempo total | 300,19 s |
| CPU usuario | 298,77 s |
| CPU sistema | 1,39 s |
| CPU | 99 % |
| RSS máximo | 2.766.964 KiB (2,64 GiB) |
| Código de salida | 124 (timeout) |
| Eventos | 276 |
| Última fase abierta | `analyze.binding.uses.19` |
| IR stdout | vacío |

Los archivos originales se conservan en [actions-baseline](issue-64/actions-baseline).
La ejecución original no asignaba tiempos individuales a los eventos: su fase
abierta no demuestra que los 300 segundos se consumieran dentro de ella.
Checker, seguridad, comptime, registros, lowering y formato no se alcanzaron.

## Inspección del C++ original

En `frontend.cpp` del artefacto, la marca `binding.uses` llama a `ir_f333`
(líneas 46737–46749). Dentro de esa función, `b62` recorre los nodos del módulo
y `b75` vuelve a recorrer el vector de referencias por cada expresión miembro
(líneas 65017–65091). Ese recorrido existe en el C++ ejecutado, no solo en ETS:

```cpp
b75:
v197.set(v196.get()<(((ets::ir::view(*(p0.get())).get()).f1.get()).f2.get()).size());
if(v197.get())goto b76;else goto b77;
b76:
v198.set((((ets::ir::view(*(p0.get())).get()).f1.get()).f2.get()).at(v196.get()++));
```

Corresponde al bucle `for (const reference of this.result.references)` de
`Binder.uses()`, en `bootstrap/binder/binder.ets`. Para M expresiones miembro y R
referencias, realiza O(M×R) inspecciones. Es una operación candidata respaldada
por el código generado; su contribución exacta requiere las duraciones de fase
y la comparación posterior de #65. No se atribuye todo el tiempo a ese bucle.

## Reproducción con tiempos por fase

Desde la raíz del repositorio, con el frontend original extraído del artefacto:

```sh
python3 scripts/profile-analyze-project.py \
  --frontend /ruta/al/frontend \
  --frontend-source-commit fe555ada9f05aaa82d3acd60fdb12aa102f50909 \
  --output /ruta/nueva/al/perfil
```

Linux, Python 3 y GNU `timeout`. Registra el commit de fuentes, identidad SHA-256
del binario, comando, stdout y stderr originales, eventos con reloj monotónico,
duraciones de intervalos completados, intervalos abiertos, CPU y RSS mediante
`wait4`. Un timeout devuelve 124; los artefactos se conservan. El directorio de
salida debe ser nuevo para no mezclar ejecuciones.

Los tiempos corresponden a la llegada de stderr e incluyen latencia de tubería
y planificación. Los intervalos son inclusivos y anidados: no deben sumarse.
Los intervalos abiertos solo tienen un tiempo observado mínimo.

Validación del perfilador: una entrada de control conserva stdout JSON y mide
un intervalo completo; una entrada que excede un segundo conserva el intervalo
abierto y devuelve 124. Ambas conservan recursos y stderr. El frontend original
también procesa `examples/hello.ets` con éxito en este entorno.

## Medición complementaria ejecutada el 2026-11-06

Se reutilizó exactamente el frontend del artefacto anterior, sin recompilarlo ni
aplicar #65. Fuentes del checkout: `84fec848ffd60d1e214141809cefc52ec3079b80`;
respecto a la PR #69 original solo elimina el workflow. Las fuentes ETS no cambian.
SHA-256 del frontend: `e0d5579f3c2e51f1f1517c793d22da4ca8ce6948da4b0b4020ca0bcb0663e576`.
SHA-256 del C++ original: `ed2edcb1b1489e62b07ca2c495639261bfd51f0760c7b0bce85d52fbd921ea0d`.

| Métrica local | Resultado |
| --- | ---: |
| Tiempo total | 300,093 s |
| CPU usuario | 297,285 s |
| CPU sistema | 2,722 s |
| CPU | 99,97 % |
| RSS máximo | 2.750.424 KiB |
| Código de salida | 124 |
| Eventos | 270 |
| Última fase abierta | `analyze.binding.uses.16` |

| Intervalo | Duración observada |
| --- | ---: |
| loader, completo | 115,669 s |
| binding.uses.1, completo | 19,588 s |
| binding.uses.9, completo | 15,227 s |
| binding.uses.12, completo | 7,332 s |
| binding.uses.15, completo | 62,831 s |
| binding.uses.16, abierto | al menos 44,275 s |

Los datos completos están en [local-profile](issue-64/local-profile). La fase
project comenzó a los 115,678 s y la primera ronda de binding no terminó.
No se alcanzaron checker, seguridad, comptime, registros, lowering ni formato.
El IR quedó vacío. El timeout es el resultado observado y se conserva como fallo.

La medición local y Actions usan el mismo binario pero entornos diferentes.
Sus duraciones no se presentan como un antes/después: no se ha aplicado ninguna
corrección. En particular, la fase activa pasó de uses.19 en Actions a uses.16
localmente; no implica una regresión del compilador.

El control real `examples/hello.ets` completó en 0,502 s: 86 eventos, 42
intervalos completos, ninguno abierto, código 0 e IR con `success=true`.
Sus resúmenes están en [control](issue-64/control).

## Estado de aceptación

El informe reúne ejecución histórica de Actions, identidad del compilador,
CPU/RSS, duraciones locales de fases y comprobación de la operación anidada
en C++ original. La evidencia permite investigar el binder en #65 cuando se
resuelva #64, sin afirmar que sea el único coste: loader también es significativo.

La revisión de evidencia comprueba los 270 eventos, la consistencia aritmética
de todos los intervalos, el timeout explícito y el control de 42 intervalos.
El diagnóstico de #64 está completo: existe una reproducción identificada,
medición de CPU/RSS y subfases, distinción entre fases completas/abiertas/no
alcanzadas y una operación O(M×R) comprobada en el C++ ejecutado.

El 2026-11-06 el usuario solicitó eliminar todos los workflows y continuar
resolviendo el problema. En consecuencia, el lugar de ejecución del criterio
se adapta a validación local reproducible, conservando las referencias originales
de Actions. Esto sustituye la exigencia de una nueva ejecución de Actions;
no se presenta la medición local como CI. No se restablece ningún workflow.

Tras integrar este informe y cerrar #64 se puede retomar #65: aplicar la
corrección, añadir regresión y medir antes/después en el mismo entorno.
El timeout esperado del diagnóstico no certifica self-hosting completo;
la segunda generación sigue reservada para #66.
