# Migración: semilla C++ congelada y separación del runtime

Estado: fase 1 de separación implementada parcialmente y cubierta por CI; **no activar ni eliminar Stage 0 hasta validar la cadena de autoalojamiento**.

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

## Alcance actual de la PR #52
La fase 1 ya ha extraído los contratos IR, backend TypeScript, mapas de llamadas, configuración y utilidades compartidas hacia `shared/` y `backend/`, conservando fachadas de compatibilidad en `src/`. La caché del runtime reside en `runtime/build/`. Las comprobaciones de CI cubren contratos, límites de imports, regresión de IR/CLI y una instalación nativa aislada que funciona sin Node en tiempo de ejecución. **No se ha generado una semilla `seed/`, ni se ha demostrado Stage 1 → Stage 2, ni se ha archivado Stage0.**

## Hallazgo de la fase 1

La carpeta `runtime/` **ya existe** y contiene el runtime C++ compartido (`runtime/ets_runtime.hpp`, `runtime/runtime_ets_libuv.cpp`, etc.). No se debe crear otra ni moverla a ciegas. La separación pendiente afecta principalmente a dependencias de `bootstrap/` hacia `src/`, a los drivers de build y a la delimitación de los servicios del runtime. `bootstrap/build/runtime-cache.ts` ya compila unidades desde `runtime/` y `src/codegen/ir/cpp-generator.ts` incluye cabeceras `runtime/`.

La primera implementación de aislamiento es `scripts/check-runtime-boundaries.sh`: detecta includes C++ desde `runtime/` hacia `bootstrap/`, `src/`, `seed/` o legacy. Este control es limitado: no verifica dependencias transitivas, enlazado, includes relativos sin prefijo ni equivalencia funcional. Debe ampliarse antes de declarar completa la fase 1.

## Implementación incremental añadida

La lógica de construcción y caché de archivos `.a` del runtime se trasladó de `bootstrap/build/runtime-cache.ts` a `runtime/build/runtime-cache.ts`. La ruta antigua se conserva como fachada de reexportación para no romper consumidores existentes. El nuevo módulo calcula la raíz del repositorio desde su propia ubicación y ya no importa `bootstrap/root.ts`. No se alteraron intencionadamente las claves de caché ni los algoritmos de compilación. **Pendiente:** ejecutar tests de runtime, bootstrap y builds reales; la refactorización no se considera validada solo por los commits.

## Estado de dependencias y siguientes puertas (noviembre de 2026)

- `bootstrap/stage0/build-loader.ts` es el adaptador explícito de construcción con Stage0: importa `src/modules/module-loader.ts` para generar el frontend inicial. `bootstrap/modules/build.ts` se mantiene únicamente como fachada de compatibilidad y `bootstrap/ir/cpp.ts` delega dinámicamente en `bootstrap/stage0/build-frontend.ts` tanto la caché como la compilación inicial, únicamente cuando no hay frontend precompilado o instalado. No es una dependencia del ejecutable nativo instalado.
- `bootstrap/build/native-compiler.ts` compila `backend/ir/native/generator.cpp` y el host incluye `backend/ir/native/model.hpp`; las rutas históricas de `src/codegen/ir/native/` permanecen como fachadas de compatibilidad.
- Las herramientas de auditoría de lexer, parser, binder y checker pueden importar Stage0 para pruebas comparativas. No deben confundirse con módulos de producción.
- `scripts/check-runtime-boundaries.sh` protege imports directos de Stage0 desde los módulos de producción enumerados de `bootstrap/` y desde `backend/ir/` y `shared/`. La CI inyecta imports prohibidos temporalmente para comprobar que el guard falla. Esta comprobación textual **no demuestra** la ausencia de dependencias transitivas.
- El test `bootstrap/install.test.ts` valida instalación y ejecución del compilador nativo fuera del checkout. Superarlo no demuestra que la construcción inicial sea independiente de Stage0.

**Próximos hitos:** auditar dependencias transitivas y la cadena de construcción; definir después el procedimiento de semilla reproducible. El generador C++ nativo ya está en `backend/ir/native/`. No fusionar ni iniciar `seed/` solo por tener la CI en verde.

## Construcción sin invocar Stage0 (frontend nativo precompilado)

El compilador nativo puede construirse e instalarse sin volver a ejecutar el compilador histórico si se dispone de un frontend nativo compatible, previamente construido y verificado:

```bash
ESTATIC_BOOTSTRAP_FRONTEND=/ruta/al/frontend node --experimental-strip-types bootstrap/cli.ts --help
node --experimental-strip-types bootstrap/install.ts --prefix /ruta/instalacion --frontend /ruta/al/frontend
```

`buildIrFrontend()` consulta `ESTATIC_BOOTSTRAP_FRONTEND` antes de buscar una instalación o construir mediante Stage0. En ausencia de esta variable, conserva el comportamiento histórico. `--frontend` del instalador permite el mismo desacoplamiento explícito. **Esta vía consume un artefacto nativo preexistente; todavía no constituye una semilla reproducible ni demuestra self-hosting.**

### Integridad del frontend precompilado

Para fijar la identidad del artefacto de entrada, se puede definir `ESTATIC_BOOTSTRAP_FRONTEND_SHA256` con los 64 caracteres hexadecimales del SHA-256 del binario. Tanto `ESTATIC_BOOTSTRAP_FRONTEND` como `install.ts --frontend` verifican la huella antes de consumir el artefacto y fallan si no coincide. Si no se proporciona una huella, se conserva el comportamiento anterior, sin verificación criptográfica de identidad. Esto no sustituye una futura cadena de procedencia y reconstrucción de `seed/`.
\n### Integridad del frontend instalado\n\nLas instalaciones nuevas guardan `frontendSha256` en `installation.json`. Al resolver el frontend instalado, `buildIrFrontend()` verifica su contenido frente a esa huella antes de ejecutarlo. Las instalaciones antiguas que no incluyen ese campo siguen siendo compatibles. Esta comprobación detecta modificaciones posteriores a la instalación; no acredita por sí sola la procedencia de la versión inicial.\n