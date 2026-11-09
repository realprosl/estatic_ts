# Análisis nativo en paralelo

El frontend ETS acepta `--jobs N` (1–32), o `ESTATIC_ANALYSIS_JOBS=N`.
El valor predeterminado es 1. La opción explícita tiene prioridad sobre la
variable de entorno. Funciona en el compilador ETS completo y en el frontend
generado desde estas fuentes; los snapshots de instalación anteriores necesitan
regenerarse para incorporar las opciones nuevas.

```sh
ESTC_ROOT="$PWD" build/ets-compiler/etsc programa.ets --check --jobs 2 --profile-analysis
```

El análisis de efectos, capturas, procedencia y flujo global se completa antes de
crear procesos. Cada trabajador hereda una instantánea privada mediante `fork`
y comprueba un lote de definiciones. Las comprobaciones recursivas, sensibles al
contexto, siguen recorriendo los cuerpos y resúmenes que necesitan: no se
suprimen llamadas entre funciones ni se comparten estados mutables. Hay hasta
ocho lotes por trabajador para repartir módulos de costes distintos.

El padre reúne los diagnósticos en el orden original de las definiciones y usa
la misma deduplicación que el recorrido secuencial. Ningún resultado se reúne
hasta haber terminado todos los trabajadores, por lo que los procesos creados
más tarde heredan la misma instantánea. Los errores de creación de procesos,
salidas anormales o resultados ausentes/inválidos invalidan la compilación. Los
temporales se crean en un directorio privado bajo `TMPDIR` y se eliminan al
terminar. `--jobs 1` evita procesos y temporales de análisis.

## Perfil

`--profile-analysis` o `ESTATIC_PROFILE_ANALYSIS=1` escribe en stderr líneas
`frontend: profile ...`. No añade campos al IR ni cambia stdout. Incluye:

- Ensamblaje del grafo, enlace de llamadas y propagación por ronda; vértices,
  aristas, visitas y rondas, además de la construcción de resúmenes.
- Contratos de memoria/capturas, procedencia, flujo global y definiciones;
  funciones, llamadas precisas, lotes y caracteres transferidos.
- Lowering, finalización de préstamos y verificación de IR; funciones, tipos
  y bloques.

`wall_ms` mide tiempo monotónico. `cpu_ms` suma CPU del padre y de los hijos ya
recogidos, incluidos los trabajadores; puede superar el tiempo de pared.
`self_peak_rss_kib` es el máximo del proceso padre y `worker_peak_rss_kib` el
máximo individual de sus hijos, en Linux. Son máximos acumulados del proceso,
no incrementos por fase ni memoria agregada del árbol. El coste adicional de
memoria depende de las páginas modificadas tras `fork`; no se debe sumar el RSS
de las instantáneas como si todas sus páginas fueran exclusivas.

## Comparación reproducible

```sh
python3 scripts/benchmark-analysis.py \
  --compiler build/ets-compiler/etsc-stage2 \
  --output build/analysis-benchmark --repetitions 3
```

El script utiliza exactamente el ejecutable indicado, registra su SHA-256,
commit, entrada, flags de optimización declarados, compilador C++, afinidad y
núcleos disponibles. Calienta la caché de sintaxis; el análisis semántico se
repite en procesos nuevos. Alterna las parejas de 1 y 2 procesos, compara el
SHA-256 del IR en todas las ejecuciones y conserva logs, muestras, medianas,
rango y desviación estándar de tiempos, CPU y máximo RSS individual. Se puede
usar `--entry ruta.ets` para medir una entrada real; sus dependencias deben
permanecer iguales durante el experimento. El workload predeterminado es
sintético y no sustituye la medición del compilador completo.

CI compara además el IR del compilador completo con 1 y 2 procesos, las dos
generaciones de autocompilación y el round-trip del lector. Las suites completas
del checker e IR se ejecutan con 2 procesos y comparan cada resultado con 1.
Las expectativas positivas, negativas y de corrupción de IR se conservan.

El grafo de efectos y el lowering permanecen secuenciales: todavía modifican
tablas y descubren dependencias globales. El perfil permite decidir el siguiente
cambio con datos. La finalización de préstamos (~1 segundo en la referencia de
#111) tampoco se reparte por ahora: su coste no compensa priorizarla sobre el
flujo de definiciones. El beneficio final depende de la entrada, la afinidad,
las cuotas de CPU, las copias de páginas y la memoria disponible.
