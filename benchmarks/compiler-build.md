# Coste de construir `etsc` (línea base, fase 0)

Medición de partida de la épica #174 (compilador modular). Issue: #175.
Se repite con `scripts/compiler-build-bench.sh` al cerrar cada fase.

## Entorno

- Commit `742f0cd` (main, v1.70.0), 14 nov 2026.
- linux-x86_64, **2 CPU**, 8 GB, g++ 13.3.0 (Ubuntu 24.04).
- Semilla precompilada de la rama `prebuilt` (`native-cpp/prebuilt/linux-x86_64/etsc`).
- Análisis con `--jobs 1`. g++ con `-O1`, igual que `build-compiler.sh` por defecto.

Las cifras absolutas son de una máquina pequeña. Lo que cuenta para los objetivos
es la **proporción** entre el build en frío y el build tras un cambio. Más abajo
está la referencia del CI.

## Build completo de `compiler/` (`scripts/compiler-build-bench.sh`)

| Fase | En frío | Tras cambiar 1 línea de `safety.ets` |
|---|---|---|
| Análisis (`--check --emit-ir`) | 15 min 39 s | 15 min 51 s |
| Codegen IR → C++ (`--from-ir`) | 1 min 59 s | 2 min 02 s |
| g++ + enlace (`-O1`) | 2 min 42 s | 2 min 42 s |
| **Total** | **20 min 20 s** | **20 min 35 s** |
| Tamaño del `.cpp` | 8,4 MB | 8,4 MB |
| Tamaño del IR (`--emit-ir`) | 90 MB | 90 MB |

- El cambio de una línea es una sentencia sin efecto en el cuerpo de `SafetyAnalyzer.owner()`, un método no genérico.
- Con `-O2`, g++ + enlace tarda **3 min 56 s** (codegen igual).
- **Hoy un cambio de una línea cuesta lo mismo que un build en frío**: la caché de sintaxis apenas se nota y el programa es un único `.cpp`.

## Reparto del análisis (`--check --verbose`, 15 min 19 s)

| Subfase | Tiempo | % del análisis |
|---|---|---|
| Lectura y parseo (48 módulos) | 19 s | 2 % |
| Expansión y binding | 89 s | 10 % |
| Tipos y checking por módulo | 65 s | 7 % |
| Memoria y capturas | 101 s | 11 % |
| Efectos (grafo de 109 367 aristas, 24 rondas, y resúmenes) | 14 s | 2 % |
| Procedencia y visibilidad | 15 s | 2 % |
| **Flujo preciso** (préstamos, moves y efectos entre funciones; >60 000 llamadas) | **536 s** | **58 %** |
| Bajada al IR (1088 funciones) | 65 s | 7 % |
| Verificación del IR | 16 s | 2 % |

**Dónde está el coste:**
- El análisis es el **77 %** del build, y dentro de él el flujo preciso es más de la mitad. Por eso la caché del análisis por módulo (fase 4, #179) es la que más ahorra. Para que valga, el flujo preciso tiene que poder reutilizar los resúmenes de las funciones de módulos limpios.
- g++ es el **13 %**. El C++ por módulo (fase 3, #178) reduce sobre todo esta parte y el codegen (10 %).
- La verificación del IR es marginal (2 %).

## Referencia del CI

Workflow *Seed and compiler prebuilt*, run 43449518479 (commit `7563e83`): build completo del compilador con `--update-prebuilt` (`-O2`, estático).

| Runner | Compilador (`build-compiler.sh`) | Semilla (`build-all.sh`) |
|---|---|---|
| ubuntu-24.04 (linux-x86_64) | 15 min 21 s | 1 min 45 s |
| macos-latest (darwin-arm64) | 12 min 32 s | 4 min 49 s |

## Objetivos (épica #174)

Con la base de esta máquina (20 min 20 s en frío, `-O1`):

| Escenario | Hoy | Objetivo |
|---|---|---|
| Build en frío | 20 min 20 s | ≤ 20 min 20 s (no más lento) |
| Cambio de una línea en el cuerpo de una función no genérica | 20 min 35 s | **≤ 3 min 03 s** (≤ 15 %): reanalizar 1 módulo, compilar 1 unidad C++ y enlazar |
| Cambio de firma de una función exportada | 20 min 35 s | reanalizar y recompilar solo el módulo y sus importadores |
