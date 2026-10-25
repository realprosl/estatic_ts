# Validación de `ets-ir-2`

Este registro corresponde al cierre del IR anterior al backend. La validación
del consumidor C++ y sus límites están en [CPP.md](./CPP.md).

Revisión de implementación: **2026-10-25**, sobre `07ac5ec` (main, PR #33).
El alcance es el lowering y verificador nativos. El backend productivo sigue
sin estar conectado a estas tablas.

| Comprobación | Resultado |
|---|---|
| `npm run test:bootstrap:ir`, repetida sobre el código final | **128/128**, cero fallos, cancelaciones y skips |
| `node --experimental-strip-types bootstrap/ir/audit.ts` | **131/132**; todos los ejemplos válidos producen IR verificado |
| Autoanálisis nativo de `bootstrap/ir/demo.ets` | **36 módulos, 8296 símbolos, 99626 nodos tipados, cero diagnósticos** |
| Ejemplo negativo esperado | `expected-errors/private-bad.ets` rechazado |
| `npm test` | **3558/3646**, 88 fallos, cero cancelaciones y skips; 517962 ms |
| `git diff --check` | Sin errores |

La suite general se lanzó durante la revisión e incluyó 124 pruebas del IR.
Después se añadieron cuatro regresiones de composición y se repitió la suite
focalizada completa de 128 pruebas sobre la implementación final. No se presenta
3646 como el total de pruebas de una nueva ejecución global del árbol final.

Los 88 fallos generales corresponden a los 84 ejemplos, su grupo padre y tres
pruebas nativas de almacenamiento modular. La compilación/enlace registra la
ausencia de `uv.h` o `-luv`, igual que en el registro anterior. No se modificó
el runtime, instalaron dependencias del sistema ni omitieron pruebas.

El autoanálisis se construyó con el adaptador `buildLoader`, entrada
`bootstrap/audit/self.ets`, unity y `-O2`; el ejecutable recibió
`bootstrap/ir/demo.ets`. Se puede repetir desde la raíz:

```sh
node --experimental-strip-types --input-type=module <<'JS'
import { buildLoader, root } from "./bootstrap/modules/build.ts";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const binary = await buildLoader(join(root, "build/ir-self"), "bootstrap/audit/self.ets", true, "-O2");
execFileSync(binary, [join(root, "bootstrap/ir/demo.ets")], { stdio: "inherit" });
JS
```

## Contratos ejercitados en esta revisión

- Sustituciones concretas en defaults de funciones, campos y constructores,
  incluyendo closures que capturan un argumento anterior.
- Calls indirectas de campos callable normales, estáticos y opcionales.
- Argumentos de constructor prestados, parameter properties con owners y
  observación de colecciones propietarias mediante préstamos.
- Evaluación única de destinos indexados que también son receptores.
- Representación canónica de constantes de enums string.
- Rechazo de tablas de entrada incompletas, IDs fuera de rango, shapes y bits de
  recurso incompatibles, capturas/leases mal formadas y arrays fijos truncados.
- Préstamos disponibles en todas las rutas de un join, frames lógicos completos,
  reanudación única y orden inverso de finalización.

Las regresiones de comportamiento ejecutan el IR con el oráculo independiente;
las del verificador alteran un proyecto inicialmente válido. La auditoría del
corpus sólo comprueba lowering/verificación, sin ejecutar servidores ni red.
Los resultados no equivalen a una certificación exhaustiva ni a un backend.

# Registro anterior (2026-10-24)

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
