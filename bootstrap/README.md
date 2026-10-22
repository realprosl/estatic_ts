# Autoalojamiento: módulos aislados

Este directorio se ha reiniciado. Los ocho archivos del intento anterior se
han retirado; siguen recuperables en el historial de Git. La implementación
TypeScript de `src/` continúa siendo el compilador de arranque (stage 0).

Trabajaremos un módulo cada vez: implementar en Estatic, darle una función de
entrada observable, transpilarlo con stage 0, compilar su C++ y ejecutarlo.
No se añadirá el siguiente módulo hasta validar el anterior por separado.

## Paso 1: lexer

```
bootstrap/
  lexer/
    lexer.ets       implementación y tipos locales del lexer
    demo.ets        driver que llama a demonstrateLexer(source)
    run.ts          adaptador host: transpilar, compilar y ejecutar
    lexer.test.ts   pruebas del ejecutable nativo y comparación con stage 0
```

`lexer.ets` no tiene imports, código C++ inyectado ni dependencias del parser,
AST o checker. Define `Lexer`, `LexerToken`, `LexerDiagnostic`, `LexerResult`,
`tokenize(source)` e `inspectTokens(source)`. Esta última función produce JSON
con tokens, lexemas, posiciones y diagnósticos. Cada llamada a `tokenize` crea
un scanner nuevo y devuelve también los tokens recuperados cuando hay errores.

### Compilar y ver el resultado

Requiere Node compatible con el proyecto y g++ con C++20 (o `CXX` compatible).
No necesita objetos precompilados de libuv ni descargar librerías adicionales.

```bash
npm run bootstrap:lexer
npm run bootstrap:lexer -- 'let total: number = 42;'
```

El comando genera `build/bootstrap/lexer/demo.cpp`, compila el ejecutable y
ejecuta la función de prueba. En el segundo ejemplo se obtienen los tipos de
token `let, identifier, :, type, =, number, ;, eof`, con sus lexemas y spans.

También se puede hacer cada paso explícitamente:

```bash
mkdir -p build/bootstrap/lexer
node --experimental-strip-types src/cli.ts bootstrap/lexer/demo.ets -o build/bootstrap/lexer/demo.cpp
g++ -std=c++20 -O0 -pthread -fno-exceptions -I. build/bootstrap/lexer/demo.cpp -o build/bootstrap/lexer/demo
./build/bootstrap/lexer/demo 'const answer: number = 42;'
```

### Comprobaciones

```bash
npm run test:bootstrap:lexer
```

Las 64 pruebas transpilan el módulo y su driver a dos unidades C++, compilan
y enlazan con g++ y ejecutan el binario. Incluyen palabras clave, comentarios,
cadenas/escapes, números, operadores, templates crudos, newline significativo,
CRLF, whitespace Unicode, recuperación tras errores y posiciones. Hay 40
fuentes ASCII generadas de forma determinista dentro de una de las pruebas.
Otra prueba tokeniza el propio `lexer.ets` y compara todos sus tokens con el
lexer TypeScript de arranque. La prueba de aislamiento exige exactamente dos
fuentes ETS en su carpeta: lexer y demo. El grafo compilado sigue teniendo
exactamente esos dos módulos aunque haya otros pasos en `bootstrap/`.

El uso de TypeScript aquí se limita a arrancar la compilación y verificar el
resultado. El algoritmo que reconoce los tokens se ejecuta como código nativo
generado desde Estatic, no como una copia JavaScript del lexer.

### Contrato y diferencias conocidas

- La fuente debe ser UTF-8 válido. Los índices internos son bytes; offsets y
  columnas públicos usan unidades UTF-16 como stage 0. Las líneas empiezan en
  1 y avanzan con LF. Identificadores ASCII, igual que el lexer actual.
- Se conserva la tokenización de stage 0: `<<`/`>>` son dos símbolos; números
  con prefijos y `_` se recogen sin validación numérica completa; templates
  contienen texto crudo. Una pila de hasta 128 contextos distingue texto,
  interpolaciones y templates anidados; strings/comentarios protegen sus
  llaves y backticks. El lexer no evalúa las interpolaciones.
- `LexerResult` sustituye las excepciones: siempre contiene tokens, `eof` y
  un array de diagnósticos. El caller decide cómo tratar los errores.
- Un comentario de bloque sin cerrar produce diagnóstico, mientras stage 0
  lo acepta silenciosamente. Un escape final no avanza más allá de EOF.
- Un carácter astral inesperado produce un solo diagnóstico, conservando un
  span UTF-16 de dos unidades, en vez de separar sus dos sustitutos.
- La API usa `string` para `kind`; todavía no hay una unión tipada de tokens.
- Este paso demuestra el lexer escrito y ejecutado mediante el dialecto.
  El compilador completo aún no se autoaloja.

## Paso 2: parser aislado (etapa cerrada en v58)

El [parser](./parser/README.md) tiene su propio AST local, tokens de entrada,
driver y pruebas nativas. No importa el lexer. `npm run bootstrap:parser`
ejecuta el ejemplo con tokens preparados; `npm run test:bootstrap:parser`
valida este módulo por separado. Analiza expresiones, declaraciones enum/union,
funciones con packs genéricos, clases con propiedades de parámetros de constructor, destructuring
plano de variables, imports/exports con alias, templates mediante tokens
preparados, cabeceras include/link, decoradores de declaraciones/miembros y
control de flujo con switch. Sus 542 pruebas incluyen los fuentes ETS del lexer,
del propio parser y ambos drivers, y una auditoría de 120 ejemplos que acepta
el parser TS directo. La cobertura y las formas excluidas están documentadas;
el cierre de esta etapa no certifica equivalencia formal con todo stage 0.
La integración se mantiene en el puente siguiente; este módulo no añade el checker.
Los nodos de import/export conservan metadatos; este parser no busca archivos
ni vincula los símbolos de otros módulos.

## Paso 3: puente nativo por archivo (v59)

El [puente](./frontend/README.md) conecta lexer ETS y parser ETS mediante una
conversión explícita de tokens. También expande templates dentro del lexer ETS.
`npm run bootstrap:frontend -- --file examples/todo-project/main.ets` lee el
archivo en el host y entrega el texto al binario, que produce tokens, AST y
diagnósticos con archivo/posición. No resuelve sus imports ni ejecuta ese código.
Lexer y parser continúan sin importarse entre sí y conservan sus suites aisladas.

Por prioridad del proyecto, el próximo módulo será **resolución de módulos**, antes
del checker: descubrir imports/reexports, resolver rutas e identidad, construir
el grafo y detectar dependencias ausentes/ciclos. Ese grafo permitirá organizar
trabajos independientes por archivo y añadir paralelismo acotado. El puente ya
devuelve resultados por archivo, pero no implementa todavía esa planificación.
El cargador deberá incorporar un helper `getOrParseModule` que consulte una caché
por hash de contenido y versión/opciones del frontend antes de ejecutar lexer y
parser. Reutilizará AST/imports sin cambios y compartirá trabajos en curso entre
solicitantes concurrentes. La invalidación de rutas/símbolos será independiente
de la caché sintáctica; el [plan detallado](./frontend/README.md) registra ese requisito.
La unidad mínima de ese registro será cada archivo de un módulo lógico: tamaño,
mtime y otros metadatos, hash, dependencias y referencias a AST/C++/`.o`. Se
consultará antes del trabajo costoso para reutilizar desde frontend hasta objeto
nativo, propagando cambios de interfaz y respetando cabeceras/flags del backend.
Editar un archivo no deberá invalidar indiscriminadamente el módulo completo.

## Paso 4: cargador y registro por archivo (v60)

[`modules/README.md`](./modules/README.md) documenta el grafo nativo, resolución
de rutas y reutilización sintáctica persistente antes de lexer/parser.

```bash
npm run bootstrap:modules -- examples/todo-project/main.ets --cache build/project-cache
npm run test:bootstrap:modules
```

Node construye el binario. Ese binario abre los fuentes del proyecto, ejecuta
el frontend ETS, resuelve sus dependencias y publica registros por archivo.
El checker ETS sigue siendo el siguiente bloque funcional.

## Paso 5: binding del proyecto (v61)

[`binder/README.md`](./binder/README.md) documenta ámbitos, símbolos y vínculos
de nombres/imports/exports como tablas independientes del AST sintáctico.

```bash
npm run bootstrap:binder -- examples/todo-project/main.ets
npm run test:bootstrap:binder
```

El checker y su inferencia se implementarán después, en otro módulo.
