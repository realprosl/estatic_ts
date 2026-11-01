# Migración: semilla C++ congelada y separación del runtime

Estado: propuesta de implementación; **no activar ni eliminar Stage 0 hasta validar la cadena**.

## Objetivo
- Generar una sola vez, con el Stage 0 actual, el C++ de `bootstrap/` y congelarlo en `seed/generated/`.
- Construir esa semilla con un compilador C++20, sin Node, y usar el ejecutable para recompilar las fuentes Estatic de Bootstrap.
- Mantener el runtime C++ compartido, independiente de los compiladores.
- Conservar versiones anteriores y un rollback de activación, sin alterar proyectos de usuarios.

## Dependencias observadas en main
`bootstrap/cli.ts` importa `src/codegen/ir/cpp-generator.ts`, `src/codegen/ir/model.ts`, `src/config/project-config.ts`, `src/project/init-project.ts` y `src/core/ts2cpp-version.ts`. `package.json` todavía ejecuta rutas de desarrollo con Node. Es necesario auditar todas las dependencias transitivas antes de mover archivos.

## Límites de módulos
- `runtime/`: cabeceras, implementaciones y ABI C++ compartidos; no importa compiladores.
- `bootstrap/`: frontend, IR, backend y CLI nativo de producción; solo consume APIs públicas del runtime.
- `seed/`: snapshot C++ generado, manifiesto de hashes y script de construcción; no depende de Node ni del antiguo compilador.
- `tools/legacy/`: Stage 0 archivado para reconstrucción histórica, no invocado en producción.
- Los archivos `src/` existentes se migran por consumidor y se eliminan solo después de probar equivalencia.

## Orden de implementación
1. **Inventario**: grafo de imports, includes, enlaces, símbolos ABI y entradas de compilación. Registrar commit base, tests y artefactos.
2. **Contratos**: definir interfaz runtime y ownership, versionar ABI, impedir dependencias circulares con comprobaciones CI.
3. **Extracción runtime**: mover sin modificar comportamiento, añadir compatibilidad temporal de includes y probar ambos compiladores.
4. **Semilla**: generar C++ de Bootstrap con Stage 0, guardar snapshot con hashes de fuentes, versión de compilador y flags; comprobar que compila y enlaza sin Node.
5. **Self-hosting**: seed C++ → compilador Stage 1 → C++ de Bootstrap → Stage 2; ejecutar corpus positivo y negativo y comparar resultados funcionales.
6. **Desacoplamiento**: migrar generador IR, configuración, CLI y herramientas compartidas fuera de `src/`; prohibir imports desde Bootstrap a legacy.
7. **Activación**: modo shadow, canary, cambio de predeterminado y retirada controlada de Node en el camino de construcción distribuido.
8. **Limpieza**: archivar Stage 0, conservar manifiestos, semilla y releases anteriores; actualizar instalación y documentación.

## Paralelización
- A1 inventario y límites de módulos.
- A2 extracción de runtime y ABI.
- A3 separación de backend/IR.
- A4 generación y build de semilla.
- A5 CLI, instalador y selección de versiones.
- A6 pruebas de self-hosting, compatibilidad y rollback.
- A7 integración y contratos compartidos.
No editar archivos compartidos en paralelo; los cambios de ABI/IR requieren revisión cruzada.

## Puertas de aceptación
- Build limpio del runtime y del compilador nativo.
- Semilla C++ reconstruible sin Node y sin dependencias ocultas del Stage 0.
- Stage 1 compila Stage 2 y ambos superan corpus y diagnósticos.
- No hay dependencias circulares ni imports de producción hacia legacy.
- Un cambio de versión activa restaura el último compilador estable.
- Instalación y pruebas de rollback automatizadas.

## Rollback
Mantener snapshot C++ y binarios de cada versión estable, checksums, toolchain y artefactos de runtime ABI-compatible. Separar instalación versionada de activación (puntero o wrapper). No borrar Stage 0 hasta superar las pruebas de recuperación. El rollback de binario no debe reutilizar cachés de IR/ABI incompatibles.

## Riesgos
El C++ generado solo es una semilla válida si implementa realmente el compilador necesario y no necesita servicios Node. Una semilla antigua puede dejar de aceptar sintaxis futura; conservar compiladores intermedios y una política de compatibilidad de fuentes.

## Pendiente de esta PR inicial
Este documento fija el contrato de trabajo. **Todavía no implementa** la extracción, la generación de semilla ni las pruebas; esas modificaciones requieren inspección y validación del árbol completo.
