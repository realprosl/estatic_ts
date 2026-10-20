# Caché incremental de transpilación

Desde v46, el build incremental conserva trabajo anterior a la generación del
objeto nativo. La caché vive bajo `incremental.cacheDirectory` y se divide en
tres niveles independientes.

| Nivel | Clave | Evita repetir | Invalidación |
|---|---|---|---|
| Sintaxis | contenido + versión de Ts2cpp | escaneo de imports, exports y source normalizado | cambia el archivo o el compilador |
| AST | source normalizado + versión de Ts2cpp | lexer y parser del módulo | cambia el módulo o el compilador |
| Snapshot | grafo, rutas, imports, hashes y versión | parse, type-check, `comptime`, `@etsgen` y codegen completos | cambia cualquier módulo o la topología |
| Objeto | C++ materializado + cabecera común + entorno nativo | compilación C++ de esa unidad | cambia su salida, el header, runtime, compilador o flags |

El incremental carga el grafo una sola vez. En un build idéntico, el manifiesto
permite reutilizar binario y objetos sin abrir la snapshot. Si falta un
artefacto, o cambian sólo las flags/runtime nativos, la snapshot reconstruye las
fuentes generadas sin ejecutar otra vez el frontend.

Al editar un módulo, su snapshot de programa deja de ser válida. El compilador
restaura los AST de los módulos intactos y sólo lexea/parsea el modificado. El
checker actual trabaja sobre un AST combinado para preservar imports, tipos,
sobrecargas y expansiones entre módulos; por eso el type-check y el codegen del
nuevo programa siguen siendo globales. Aun así, la comparación de C++ y header
recompila únicamente los `.o` realmente afectados. Convertir el checker a
interfaces semánticas por módulo sería el siguiente nivel de granularidad.

## Diagnóstico

`etsc build --verbose` muestra hits/misses del escaneo, ASTs reutilizados y si
la snapshot completa fue restaurada. La API `buildIncremental` expone:

- `transpilationCache`: `hit`, `partial` o `miss`.
- `parsedModules.reused`: módulos cuyo AST se restauró.
- `parsedModules.parsed`: módulos que se volvieron a parsear.

Las entradas son content-addressed y llevan versión de formato y de compilador.
Una entrada ausente, antigua o corrupta se trata como miss: nunca sustituye las
validaciones semánticas ni convierte un error en un build válido.

