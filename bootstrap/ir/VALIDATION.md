# Validación de `ets-ir-2`

Ejecución local: 2026-10-24. Base: `9723590` (main, PR escalar #32 fusionada).
La ampliación está implementada en bootstrap; no conecta un backend productivo.

| Comprobación | Resultado |
|---|---|
| `npm run test:bootstrap:ir` | 90/90; cero fallos, cancelaciones y skips |
| Auditoría nativa de `examples/` | 131/132 aceptados; los 131 fuentes válidos producen IR verificado |
| Ejemplo negativo esperado | `expected-errors/private-bad.ets` se rechaza |
| Autoanálisis nativo de `bootstrap/ir/demo.ets` | 35 módulos, 8164 símbolos, 97285 nodos tipados, cero diagnósticos |
| `npm test` | 3524/3612; 88 fallos, cero cancelaciones y skips; 691946 ms |
| `git diff --check` | Sin errores |

Las pruebas focalizadas construyen y ejecutan el lowering/verificador ETS nativo.
Comprueban determinismo y resultados con un oráculo que consume sólo el IR;
los casos negativos alteran sus contratos para comprobar que se rechacen.

La auditoría del corpus comprueba lowering y verificación. No ejecuta los
programas de ejemplo ni demuestra equivalencia formal o cobertura universal.
El autoanálisis comprueba las fuentes del IR con el frontend nativo; tampoco
significa que un backend ya pueda compilar el compilador desde el IR.

La suite general no está verde en este entorno. Sus 84 ejemplos fallan al
compilar/enlazar: cada caso registra ausencia de `uv.h` o de `-luv`. El grupo
padre de ejemplos suma otro fallo. Tres pruebas nativas de almacenamiento
modular (Result, Task y helpers de archivos) fallan por la misma dependencia.
No se registraron fallos de las pruebas del IR. No se modificó el runtime ni
se omitieron pruebas para ocultar esos errores del entorno.

Ver [README.md](./README.md) para el contrato, capacidades y límites actuales.
