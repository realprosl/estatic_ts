# Mapa del repositorio

Revisión del frontend bootstrap: **2026-10-24**, sobre `24e32ac`.

| Carpeta | Qué contiene | Más detalle |
|---|---|---|
| `src/` | Compilador stage 0 en TypeScript: CLI, análisis, evaluación estática y codegen C++ actual. | [src/README.md](src/README.md) |
| `bootstrap/` | Frontend nativo en Estatic: lexer, parser, cargador, expansión, binder, checker, seguridad, efectos y comptime. | [bootstrap/README.md](bootstrap/README.md) |
| `runtime/` | Runtime C++ consumido por los programas y por los ejecutables de bootstrap. | [runtime/README.md](runtime/README.md) |
| `test/` | Regresiones unitarias y proyectos de ejecución. Las pruebas nativas del frontend también viven junto a sus capas en `bootstrap/`. | [package.json](package.json) |
| `examples/` | Programas de ejemplo y casos negativos explícitos. | [examples/README.md](examples/README.md) |
| `scripts/` | Herramientas de build, auditoría de documentación, generación y benchmarks. | [scripts/README.md](scripts/README.md) |
| `third_party/` | Tree-sitter y fuentes vendorizadas. | [third_party/README.md](third_party/README.md) |
| `editors/` | Soporte de editor y grammar Estatic. | [editors/README.md](editors/README.md) |
| `docs/` | Contratos técnicos e historial marcado como histórico. | [docs/README.md](docs/README.md) |
| `build/` | Salidas generadas, cachés, C++, objetos y ejecutables; no describe una entrega versionada. | [docs/build-system.md](docs/build-system.md) |

## Recorridos actuales

| Recorrido | Entrada y salida |
|---|---|
| CLI stage 0 | Fuentes Estatic → `src/` → C++/cabecera → compilador C++/runtime → ejecutable |
| Construcción de bootstrap | Fuentes ETS de `bootstrap/` → stage 0/C++ → ejecutable nativo de una capa o del frontend |
| Análisis nativo solicitado | Fuentes del proyecto → frontend ETS → grafo de archivos, ASTs y tablas semánticas `ets-checked-2` |
| IR/backend del frontend ETS | Diseño propuesto; todavía sin implementación ni conexión al codegen del programa |

Bootstrap no está pospuesto ni vive en `/selfhost/`. Su estado verificable está
en [FRONTEND-REVIEW.md](bootstrap/audit/FRONTEND-REVIEW.md); el inventario antes del
IR está en [PENDING.md](bootstrap/PENDING.md). La revisión no anuncia cierre del
lenguaje a partir de los totales de pruebas ni rediseña el almacenamiento del AST.
