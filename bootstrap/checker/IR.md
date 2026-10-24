# Contrato del IR común

La primera implementación ejecutable vive en [`../ir/`](../ir/README.md):
modelo, lowering, verificador y salida `ets-ir-1`, escritos en ETS. Cubre el
núcleo escalar, funciones libres y control de flujo; las partes de recursos,
préstamos, agregados y closures descritas abajo siguen siendo diseño pendiente.

El lowering exige un proyecto sin diagnósticos de una misma carga y rechaza
operaciones fuera de sus capacidades. No certifica el cierre global de
[PENDING.md](../PENDING.md), no cuenta `COMPTIME_UNSUPPORTED` como soporte y
no conecta todavía el backend C++ del CLI productivo. Los contratos X02 y
B02/M01/M05 permanecen abiertos para ampliar esa cobertura.

El AST de entrada seguirá pudiendo ser la arena actual `nodes[]`: no hace falta
convertirlo primero en un árbol de objetos propietarios. El IR tendrá sus propias
identidades y representación. Tampoco se exige que el frontend ya genere un CFG
o instrucciones de limpieza: producirlas es trabajo del lowering descrito aquí.

El IR debe expresar la semántica de Estatic que compartan todos los backends.
Cada codegen consumirá ese IR y hará su propio lowering de representación,
ABI y runtime. Así no necesitará volver a resolver nombres o inferir tipos
recorriendo el AST sintáctico.

## Primera entrega implementable

Empezar por un IR tipado con funciones, bloques básicos, valores temporales y
places (local/global, campo e índice). Usar temporales de asignación única
para resultados y places explícitos para memoria; no exigir todavía convertir
todas las variables mutables a SSA ni implementar optimizaciones.

| Parte | Contrato común |
|---|---|
| Proyecto | Módulos, orden de inicialización y funciones de entrada |
| Identidad | Tablas propias de tipos, funciones, globals y símbolos |
| Valores | Constantes, operaciones aritméticas, comparación y conversiones explícitas |
| Memoria | Places, load/store, copy/move, borrow y fin de préstamo |
| Recursos | Inicialización, destrucción y limpieza en todas las salidas |
| Control | Bloques con jump, branch, return y argumentos/resultados tipados |
| Llamadas | Firma concreta y destino directo o conjunto/contrato indirecto |
| Closures | Entorno tipado, capturas y modo de transporte explícitos |
| Diagnósticos | Archivo/span original y relación con símbolos de origen |

El orden de evaluación del fuente debe quedar fijado en instrucciones:
argumentos y defaults, cortocircuito, construcción y efectos laterales.
La limpieza de recursos debe abarcar retorno, break/continue y cada salida
soportada. Las operaciones y destinos opacos no se convertirán en instrucciones
aparentemente puras. Las obligaciones callback se verificarán al especializar
la llamada o se conservarán como contratos exigibles, nunca se descartarán.

La tabla actual `borrows` usa intervalos de fuente conservadores. No basta con
emitir `endBorrow` al alcanzar un offset: el lowering debe determinar sus salidas
en el grafo de control y un verificador debe comprobar que cada ruta las respeta.
Los resúmenes `effects` describen efectos posibles; no sustituyen el cuerpo ni
justifican eliminar instrucciones.

## Separación por backend

El IR común conserva tipos y operaciones lógicas. El layout físico, tamaños,
alineación, convención de llamada, nombres del runtime, representación de strings,
closures y dispatch pertenecen al lowering del backend. Una capa de capacidades
rechazará operaciones no soportadas antes de emitir código. La primera conexión
será C++20, manteniendo el CLI actual hasta validar el recorrido completo.
Otros backends se incorporarán con un codegen propio sobre el mismo contrato.

El contrato de entrada deberá distinguir nodos sintácticos sin tipo de valor,
nodos huérfanos y operaciones que sí requieren tipos, firmas o conversiones.
No se exige que todas las celdas de `types[]` sean no vacías. La identidad de
entrada es módulo/nodo de una carga; la procedencia persistente conserva además
`moduleId` y `sourceHash`, según [MODULES.md](./MODULES.md).

Antes del primer codegen habrá un verificador del IR: tipos de operandos y
terminadores, destinos existentes, definición/uso de temporales, accesos a places
y transferencias de ownership/préstamos. Los tests cubrirán lowering y errores
del verificador; después se comparará el comportamiento del C++ generado con
programas de referencia. No se anuncia portabilidad de todos los runtimes ni
se introducen optimizaciones antes de fijar estas invariantes.
