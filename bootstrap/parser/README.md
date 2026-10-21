# Parser aislado: primer bloque

Este módulo está escrito en Estatic y se ejecuta como C++20 generado. No importa
el lexer, el checker, el sistema de tipos ni otros módulos ETS. Todavía no cubre
toda la gramática del parser TypeScript de stage 0.

## Ejecutarlo

```bash
npm run bootstrap:parser
npm run bootstrap:parser -- 'function add(a:number,b:number):number{return a+b;}'
npm run test:bootstrap:parser
```

El primer comando compila y ejecuta una demostración con tokens preparados para
`1 + 2 * 3;`. No interviene ningún lexer en esa demostración. Al dar un texto como
argumento, `run.ts` usa el lexer de stage 0 exclusivamente para preparar los tokens.
En ambos casos, el análisis sintáctico lo realiza el parser ETS compilado.

El adaptador necesita Node y g++ con C++20, o un `CXX` compatible con sus flags.
Genera `build/bootstrap/parser/demo.cpp` y el ejecutable. No requiere libuv.
Los tokens del adaptador se pasan por argumentos del proceso: es una herramienta
de demostración y pruebas, sujeta al límite de argumentos del sistema y sin NUL
embebido. La API ETS recibe directamente un array y no depende de ese transporte.

## API y AST

`ParserToken` contiene `kind`, `lexeme` y las seis coordenadas de inicio y fin
(offset, línea y columna). Offsets y columnas son unidades UTF-16; el parser
preserva las posiciones recibidas. El caller debe proporcionar un único `eof`
al final. Un array vacío, un EOF intermedio o un EOF ausente produce diagnóstico.

`parseTokens(tokens)` devuelve `ParseResult`: índice `root`, array `nodes` y
`diagnostics`. `inspectAst(tokens)` devuelve esos datos en JSON. Cada llamada
crea un parser nuevo; una instancia de `Parser` se usa para un único parseo.

El AST es una arena: cada `AstNode` tiene `kind`, span, atributos escalares y
aristas `{role,node}` hacia índices de la misma arena. No utiliza fragmentos de
código ni referencias circulares. Los atributos se almacenan como strings;
`mutable`, por ejemplo, vale `"true"` o `"false"`. `typeArgument` puede repetirse.
Los números conservan `raw` para resolver su valor y precisión en una fase futura.
El árbol se recorre desde `root`; puede haber nodos intermedios sin aristas de
entrada, como el identificador que se convierte en una llamada por nombre.

Este AST local todavía no es una entrada para el checker de stage 0. Las pruebas
comparan estructura y atributos con una proyección explícita de su AST, omitiendo
metadatos ausentes y valores por defecto equivalentes. Las posiciones tienen
pruebas propias: por ejemplo, las clases empiezan en `class`, mientras el parser
actual suele empezar su span en el nombre. Propiedades y decoradores tienen
spans locales aunque stage 0 no los almacene como nodos independientes.

Un resultado con diagnósticos es parcial y no debe pasar a compilación como si
fuera válido. La recuperación garantiza avance del cursor en programa y bloques.
La profundidad recursiva se limita a 128 y el almacenamiento de diagnósticos a
100 entradas; no son garantías de tiempo o memoria constante para cualquier
tamaño de entrada.

## Cobertura comprobada

- Literales, identificadores, arrays y objetos con shorthand, spread y `new`.
- Operadores unarios, binarios y sus precedencias; shifts contiguos, asignación
  simple y compuesta, ternarios, `as`, `satisfies`, `await` e `instanceof`.
- Llamadas por nombre, argumentos con nombre y spread, genéricos, miembros,
  llamadas encadenadas, acceso opcional e índices.
- Variables simples, `using`, aliases de tipo, funciones, firmas sin cuerpo,
  flechas tipadas y funciones/flechas async. Parámetros con tipo y valor por
  defecto; funciones con `out`, opcionales y rest.
- Clases con campos, valores iniciales, constructor, métodos y acceso/static;
  interfaces con campos y firmas. Genéricos básicos con constraint y default.
- Tipos primitivos y nominales, namespace, genéricos, arrays dinámicos y fijos,
  tuplas, funciones, readonly, typeof, unions e intersecciones de tipos.
- Bloques, `if/else`, `while`, `for` clásico, `for of/in/await of`, `return`,
  `break`, `continue` y `delete` por índice. Terminadores significativos y `;`.
- Export de declaraciones y decoradores previos a declaraciones compatibles.

Las 105 pruebas compilan dos unidades C++, enlazan y ejecutan el binario. Incluyen
comparaciones estructurales con stage 0, precedencia fijada independientemente,
spans con Unicode, errores y límites de profundidad/diagnósticos, y 30 entradas
malformadas deterministas. El parser analiza el fuente completo del lexer y su
propio fuente ETS; los tokens los prepara el host, no el lexer ETS. No es aún una
cadena nativa lexer-parser ni demuestra autoalojamiento del compilador completo.

## Pendiente antes de completar el módulo

- Declaraciones `enum` y `union`, y `switch`.
- Imports, reexports, export default y cabeceras `@include`/`@link`.
- Templates e interpolaciones: deben recibir una entrada tokenizada adecuada,
  manteniendo el parser independiente del lexer.
- Destructuring, parameter properties, genéricos variádicos y decoradores sobre
  miembros o colocados después de `export`/`function`.
- Paridad de todas las posiciones y mensajes de diagnóstico con stage 0, y
  validación completa de streams de tokens suministrados por callers externos.

Esas construcciones producen diagnósticos; no se aceptan como implementaciones
completas. Hay casos históricos que se preservan como límites de stage 0: por
ejemplo, tras un tipo genérico hace falta separar `>` y `=` para evitar `>=`.
La integración con el lexer ETS y el checker se pospone hasta completar y validar
este módulo.
