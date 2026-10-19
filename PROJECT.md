# Ts2cpp — Guía de desarrollo

Este documento contiene las reglas técnicas para trabajar en el repositorio.
El estado actual se mantiene en [`status.md`](./status.md) y las limitaciones
del lenguaje en [`LIMITATIONS.md`](./LIMITATIONS.md).

## Objetivo

Ts2cpp implementa **Estatic**, un lenguaje de sintaxis inspirada en TypeScript
que se transpila a C++20. No pretende aceptar TypeScript arbitrario: prioriza
tipado estático, ownership explícito, RAII y costes visibles.

Principios que deben conservarse:

- Sin excepciones en el código generado; los errores recuperables usan
  `Result<T>`.
- Clases por valor y composición, sin herencia ni vtables implícitas.
- `T` significa valor; `ptr<T>` ownership exclusivo; `ref<T>` y
  `constRef<T>` préstamos.
- El grafo de módulos y los backends utilizados se resuelven durante la
  compilación.
- El runtime se compila con C++20 y `-fno-exceptions`.
- El frontend no tiene dependencias npm de ejecución y usa el soporte de
  TypeScript erasable de Node.js.

## Requisitos

- Node.js 22.6 o posterior.
- Un compilador C++20, preferiblemente GCC 13+ o Clang equivalente.
- `libuv` para las funciones async y de red.
- OpenSSL y libcurl únicamente para las funcionalidades que los requieren.
- Drogon únicamente cuando se selecciona el backend HTTP `drogon`.

La detección e instalación se explica en
[`docs/build-system.md`](./docs/build-system.md).

## Comandos habituales

```bash
# Ejecutar la suite declarada por el proyecto
npm test

# Pruebas nativas de memoria (requieren libuv y sanitizers)
npm run test:memory

# Crear un proyecto de ejemplo
npm run init -- ./mi-proyecto

# Transpilar un archivo a una unidad C++ inspeccionable
node --experimental-strip-types src/cli.ts examples/hello.ets \
  -o build/hello.cpp --unity
```

No se debe codificar una ruta absoluta del checkout en fuentes, pruebas o
documentación. Los scripts deben derivar la raíz desde su ubicación o desde
la configuración del proyecto.

## Arquitectura

| Área | Ruta | Responsabilidad |
|---|---|---|
| Lexer | `src/lexer/` | Texto a tokens |
| Parser y AST | `src/parser/`, `src/ast/` | Tokens a árbol sintáctico |
| Semántica | `src/semantic/` | Símbolos, tipos, moves y borrows |
| Módulos | `src/modules/` | Grafo, visibilidad, identidad y backends |
| Comptime | `src/codegen/comptime-evaluator.ts` | Evaluación controlada durante compilación |
| Codegen | `src/codegen/` | AST comprobado a C++20 |
| Build y CLI | `src/build/`, `src/cli.ts` | Caché, compilación nativa y UX |
| Runtime | `runtime/` | Tipos y operaciones usadas por el C++ generado |
| Pruebas | `test/` | Unitarias, integración, E2E y regresiones |

El pipeline actual combina los AST de los módulos antes del análisis
semántico. Es una implementación funcional, pero no debe confundirse con un
sistema de símbolos completamente aislado por módulo. La evolución prevista
es resolución de nombres por identidad de símbolo y una IR tipada antes del
backend C++.

## Flujo para un cambio

1. Reproducir el comportamiento con la prueba más pequeña posible.
2. Cambiar una sola capa cuando sea suficiente; si el cambio cruza lexer,
   parser, checker y codegen, mantener pruebas en cada frontera.
3. Ejecutar las pruebas unitarias específicas.
4. Ejecutar `npm test` antes de entregar el cambio.
5. Para cambios de runtime, ejecutar sanitizers y pruebas nativas cuando las
   dependencias estén disponibles.
6. Actualizar `README.md`, `LIMITATIONS.md` o el documento técnico afectado.

No se deben incluir credenciales, identificadores personales, rutas de una
máquina concreta ni instrucciones de servicios privados en el repositorio.

## Política de pruebas

Una prueba de transpilación que solo compara strings C++ no demuestra que el
programa sea correcto. Según el cambio, cubrir:

- diagnóstico negativo del lexer/parser/checker;
- forma del C++ generado;
- compilación con GCC y, cuando sea posible, Clang;
- ejecución del binario y comparación de stdout/stderr;
- ASan/UBSan/LeakSanitizer para ownership y runtime;
- TSan o pruebas de estrés para concurrencia;
- límites y entradas hostiles para HTTP, parsing y `comptime`.

Las pruebas de red deben poder ejecutarse en puertos locales efímeros y no
depender de servicios externos.

## Reglas para `comptime`

`comptime` es un intérprete de AST deliberadamente restringido. Debe seguir
siendo determinista y no obtener acceso implícito a archivos, red, reloj,
procesos o aleatoriedad.

Todo cambio en este subsistema debe preservar:

- límites de instrucciones, recursión y memoria;
- diagnósticos con el span del código fuente;
- separación entre símbolos de módulos;
- semántica numérica compatible con los tipos del dialecto;
- cortocircuito de `&&`, `||` y `??`: no evaluar ramas que no se ejecutan,
  tampoco sus efectos ni errores;
- ausencia de ejecución de JavaScript arbitrario.

`@cppgen` es un escape inseguro porque inyecta C++ literal. Su uso debe ser
explícito, auditable y limitado. `@etsgen` debe evolucionar hacia generación
de AST tipado, no manipulación de C++ mediante expresiones regulares.

## Riesgos abiertos que condicionan el desarrollo

Consultar [`status.md`](./status.md) y
[`docs/MEMORY-AUDIT.md`](./docs/MEMORY-AUDIT.md). En particular, antes de
declarar el runtime listo para producción deben resolverse:

- validación con sanitizers del nuevo lifetime estable de handles libuv;
- cancelación cooperativa de las tareas perdedoras de `race` (el drenaje y el
  ownership seguro ya están implementados);
- límites de memoria y backpressure de los backends HTTP;
- validación de requests y política de recursos equivalente entre cpp-httplib
  y Drogon.

## Documentación

- [`README.md`](./README.md): instalación, sintaxis y uso.
- [`status.md`](./status.md): fotografía verificable del estado actual.
- [`LIMITATIONS.md`](./LIMITATIONS.md): soporte y límites conocidos.
- [`docs/README.md`](./docs/README.md): índice técnico.
- [`CHANGELOG.md`](./CHANGELOG.md): historial de versiones.
- [`docs/historical/`](./docs/historical/): planes antiguos, no normativos.

Si la documentación y el código discrepan, el comportamiento probado del
código tiene prioridad y la documentación debe corregirse en el mismo cambio.
