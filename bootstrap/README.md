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

Las 44 pruebas transpilan el módulo y su driver a dos unidades C++, compilan
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
  contienen texto crudo para un parser futuro. No se evalúa interpolación.
- `LexerResult` sustituye las excepciones: siempre contiene tokens, `eof` y
  un array de diagnósticos. El caller decide cómo tratar los errores.
- Un comentario de bloque sin cerrar produce diagnóstico, mientras stage 0
  lo acepta silenciosamente. Un escape final no avanza más allá de EOF.
- Un carácter astral inesperado produce un solo diagnóstico, conservando un
  span UTF-16 de dos unidades, en vez de separar sus dos sustitutos.
- La API usa `string` para `kind`; todavía no hay una unión tipada de tokens.
- Este paso demuestra el lexer escrito y ejecutado mediante el dialecto.
  El compilador completo aún no se autoaloja.

## Paso 2: parser (en curso)

El [parser](./parser/README.md) tiene su propio AST local, tokens de entrada,
driver y pruebas nativas. No importa el lexer. `npm run bootstrap:parser`
ejecuta el ejemplo con tokens preparados; `npm run test:bootstrap:parser`
valida este módulo por separado. Analiza expresiones, declaraciones enum/union,
funciones, clases y control de flujo con switch, incluidos los fuentes ETS
del lexer y del propio parser. Quedan construcciones pendientes documentadas;
todavía no se integra una cadena nativa entre fases ni se añade el checker.
