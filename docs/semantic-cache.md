# Caché de comprobación semántica (v48)

El incremental puede restaurar comprobaciones de cuerpos de funciones de un
módulo intacto cuando cambia únicamente la implementación de otro. La caché
es persistente, funciona entre procesos y se aplica por separado al checker
fuente y al checker final.

Las declaraciones, firmas, defaults y sentencias de nivel superior se vuelven
a validar. Se reconstruyen los scopes y tablas globales en cada ejecución.
La caché restaura las anotaciones del cuerpo sobre los nodos del AST actual,
incluyendo tipos de expresiones, constantes, nombres que chocan con el runtime
y selección de sobrecargas. Nunca se restauran coordenadas del build anterior.

## Primera cobertura

La ruta está activada para programas compuestos por funciones de parámetros
`number`, `string` y `boolean`, con retornos de esos tipos o `void`, variables
escalares, bloques, `if`, retornos, operaciones escalares, llamadas entre esas
funciones y `print`. Las variables inferidas se limitan a literales escalares.
Las sobrecargas escalares, imports con alias, reexports y recursión se mantienen
en el pipeline modular ordinario.

Si cualquier construcción del programa queda fuera de ese conjunto cerrado,
el checker completo se ejecuta para todo el programa. Esto incluye clases,
arrays, aliases de tipos, genéricos, closures, referencias, movimientos,
funciones async, asignaciones/bucles, decoradores, `comptime`, `@etsgen` y otras
llamadas builtin. Es una ruta inicial conservadora, no un checker incremental
completo del dialecto. El codegen sigue siendo global.

## Claves e invalidación

Las entradas se guardan en `transpilation/semantic/` dentro de la caché de build.
La clave incluye versión de compilador y formato, identidad/ruta del módulo,
fuente e imports resueltos, y el entorno ligado de declaraciones del programa.
Este último conserva firmas, parámetros/defaults y todos los globals y sus
inicializadores; sólo omite cuerpos de las funciones runtime cubiertas.

- Cambio de cuerpo en un módulo: se comprueban sus funciones y se restauran
  cuerpos de consumidores intactos si el entorno de declaraciones no cambia.
- Cambio de firma, constante, global, import o topología que altere el entorno:
  se invalidan las entradas afectadas por esa clave; puede invalidarse todo el
  programa. Todavía no se reduce la clave a los símbolos realmente utilizados.
- Construcción fuera de cobertura: checker completo, sin restaurar cuerpos.
- Caché ausente, incompatible, truncada o con checksum inválido: comprobación
  completa de los cuerpos que no pueden restaurarse.
- Errores: no se publican resultados semánticos de una transpilación fallida.

Los hashes de `module-interfaces.json` de v47 siguen siendo metadatos para
planificar invalidaciones más finas. Esta ruta usa un contexto más conservador,
sin tomar esas huellas como prueba de independencia semántica.

## Observación y comparación

`build-profile.json` y la API `compileFile`/`buildIncremental` exponen
`semanticCache` cuando el checker se ejecuta con esta caché:

```json
{
  "enabled": true,
  "stages": {
    "source": { "reusedBodies": 1, "checkedBodies": 1,
      "reusedModules": ["/project/main.ets"], "checkedModules": ["/project/lib.ets"] },
    "final": { "reusedBodies": 1, "checkedBodies": 1,
      "reusedModules": ["/project/main.ets"], "checkedModules": ["/project/lib.ets"] }
  }
}
```

Un fallback informa `enabled: false` y `fallbackReason`. `--verbose` imprime
estos contadores. Un hit de snapshot/binario omite por completo el checker y
no reproduce estadísticas semánticas históricas.

En la API modular, `semanticCache: false` permite comparar con el checker
completo conservando la caché de lexer/parser:

```typescript
await compileFile(entry, {
  transpilationCacheDirectory: cache,
  semanticCache: false
});
```

El benchmark reproducible usa 13 módulos, 241 funciones y cinco muestras por
modo después de dos rondas de calentamiento, alternando el orden:

```bash
node --experimental-strip-types scripts/benchmark-semantic-cache.ts
```

En una ejecución local, las medianas fueron 28,47 ms de checker completo frente
a 20,56 ms con cuerpos restaurados. La transpilación completa fue 606,55 frente
a 601,06 ms: las demás fases dominan ese fixture, y esa diferencia total pequeña
no establece una aceleración general. El coste de cargar/hidratar la caché
también cuenta; los resultados dependen de proyecto, máquina, JIT y filesystem.

La siguiente ampliación debe modelar explícitamente efectos de ownership,
closures y dependencias estáticas antes de permitir restauración en esos casos.
