# Fase 2: desacoplamiento del generador C++

Rama: `migration/bootstrap-codegen-decoupling`.
Punto de partida: `7f0555c08ac4b8bfe56ae02ad10415909bcd815d` (fase 1 validada).

## Dependencias existentes que deben eliminarse sin duplicar el backend

- `bootstrap/cli.ts` y `bootstrap/ir/cpp.ts` importan directamente `src/codegen/ir/cpp-generator.ts`.
- `src/codegen/ir/cpp-generator.ts` importa `src/codegen/cpp-types.ts`, `src/codegen/ir/runtime-calls.ts` y tipos de `src/modules/runtime-backends.ts`.
- El contrato IR canónico ya está en `shared/ir/model.ts`; `src/codegen/ir/model.ts` es una fachada compatible.
- `bootstrap/cli.ts` también depende de utilidades históricas de configuración, inicialización y versión.

## Orden y criterios de aceptación

1. Inventariar las dependencias transitivas del backend y distinguir contratos puros de utilidades Stage0.
2. Extraer un módulo coherente de generación C++ fuera de `src/`, dejando fachadas de compatibilidad para las rutas antiguas.
3. Redirigir Bootstrap al nuevo módulo y verificar identidad de exportaciones y equivalencia de C++ generado.
4. Mantener la regresión de CI de la fase 1 y añadir pruebas de dependencia de Bootstrap respecto de Stage0.
5. Demostrar que el compilador nativo se construye y ejecuta sin importar el compilador Stage0 en tiempo de ejecución.

No crear `seed/` ni fusionar ramas antes de superar los controles de esta fase.
