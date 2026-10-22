# Parser aislado: expresiones, declaraciones, módulos y control de flujo

Este módulo está escrito en Estatic y se ejecuta como C++20 generado. No importa
el lexer, el checker, el sistema de tipos ni otros módulos ETS. Todavía no cubre
toda la gramática del parser TypeScript de stage 0.

## Ejecutarlo

```bash
npm run bootstrap:parser
npm run bootstrap:parser -- 'function add(a:number,b:number):number{return a+b;}'
npm run bootstrap:parser -- 'enum Color{Red,Green} switch(color){case Color.Red:break;default:break;}'
npm run bootstrap:parser -- 'import {value as local} from "./values"; export {local as publicValue};'
npm run bootstrap:parser -- 'const greeting=`Hola ${name}, total=${1+2*3}`;'
npm run bootstrap:parser -- 'const [first:number=1,second]=values; const {name:alias="guest"}=user;'
npm run test:bootstrap:parser
```

El primer comando compila y ejecuta una demostración con tokens preparados para
`1 + 2 * 3;`. No interviene ningún lexer en esa demostración. Al dar un texto como
argumento, `run.ts` usa el lexer de stage 0 exclusivamente para preparar los tokens.
En ambos casos, el análisis sintáctico lo realiza el parser ETS compilado.

El adaptador necesita Node y g++ con C++20, o un `CXX` compatible con sus flags.
Genera `build/bootstrap/parser/demo.cpp` y el ejecutable. No requiere libuv.
Los tokens del adaptador se pasan por argumentos del proceso: un argumento por
token, con ocho campos prefijados por su longitud en bytes UTF-8. El empaquetado
reduce el número de argumentos y permite analizar el fuente del parser ampliado.
El driver valida los frames y sus coordenadas decimales (hasta 2^31-1). Sigue
siendo una herramienta de demostración/pruebas, sujeta al límite de argumentos
del sistema, al tamaño máximo por argumento y sin NUL embebido. La API ETS
recibe directamente un array y no depende de ese transporte ni de esos límites.

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
Los literales numéricos ordinarios conservan `raw` para resolver su valor y
precisión en una fase futura. Enum y discriminadores numéricos de union usan
`value` como texto decimal canónico exacto; los incrementos de enum se calculan
con operaciones sobre dígitos, sin convertirlos a double.
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
- Templates con segmentos vacíos, multilínea, escapes crudos e interpolaciones
  de expresiones, incluidas llamadas, objetos y templates anidados; strings y
  comentarios dentro de las interpolaciones protegen sus delimitadores.
- Operadores unarios, binarios y sus precedencias; shifts contiguos, asignación
  simple y compuesta, ternarios, `as`, `satisfies`, `await` e `instanceof`.
- Llamadas por nombre, argumentos con nombre y spread, genéricos, miembros,
  llamadas encadenadas, acceso opcional e índices.
- Variables simples, `using`, aliases de tipo, funciones, firmas sin cuerpo,
  flechas tipadas y funciones/flechas async. Parámetros con tipo y valor por
  defecto; funciones con `out`, opcionales y rest.
- Destructuring plano de variables en arrays/objetos, aliases, tipos por
  binding o patrón completo, defaults, patrones vacíos y coma final.
- Clases con campos, valores iniciales, constructor, métodos y acceso/static;
  interfaces con campos y firmas. Genéricos básicos con constraint y default.
- Tipos primitivos y nominales, namespace, genéricos, arrays dinámicos y fijos,
  tuplas, funciones, readonly, typeof, unions e intersecciones de tipos.
- Bloques, `if/else`, `while`, `for` clásico, `for of/in/await of`, `return`,
  `break`, `continue` y `delete` por índice. Terminadores significativos y `;`.
- Export de declaraciones y decoradores previos a declaraciones compatibles.
- Enum numérico o de cadena, valores implícitos, explícitos, prefijos
  hexadecimal/binario/octal, separadores numéricos y fracciones no negativas.
- Union con variantes nominales o de objeto, payloads simples/compuestos,
  genéricos y discriminadores literales de cadena, número o booleano.
- Switch con casos, default, cláusulas vacías, bloques, anidamiento y control
  de flujo dentro de sus cuerpos. El AST preserva el orden de las cláusulas.
- Imports por efecto lateral, default, listas con `as`, namespaces y formas
  combinadas; marcas type-only completas o por specifier.
- Exports de listas locales, reexports de listas/estrella/namespace y default
  de expresiones, funciones/clases con nombre o anónimas, incluidas async.

Las 382 pruebas compilan dos unidades C++, enlazan y ejecutan el binario; también
comprueban el adaptador léxico host. Incluyen
comparaciones estructurales con stage 0, precedencia fijada independientemente,
spans con Unicode, errores y límites de profundidad/diagnósticos, y 30 entradas
malformadas deterministas. El parser analiza el fuente completo del lexer y su
propio fuente ETS y ambos drivers, incluidos sus imports; los tokens los prepara
el host, no el lexer ETS. No es aún una
cadena nativa lexer-parser ni demuestra autoalojamiento del compilador completo.

## Enum, union y switch: contrato de este bloque

Enum y union se comparan estructuralmente con el parser TypeScript para la
cobertura compartida. Sus diferencias se prueban por separado:

- Los contadores de enum preservan enteros más allá de 2^53 y fracciones
  decimales exactas. Por ejemplo, tras `9007199254740992` se guarda
  `9007199254740993`. Esta fase no valida rangos ni selecciona representación
  numérica C++; esa tarea corresponde al futuro checker.
- Se rechaza la mezcla de miembros de cadena y numéricos, incluidos los
  numéricos implícitos anteriores a una cadena. También se diagnostican
  nombres duplicados y separadores numéricos inválidos.
- Enum admite saltos de línea internos. Las variantes de objeto admiten
  separador final `;`/`,` y saltos de línea internos. Son extensiones respecto
  al comportamiento actual de stage 0, no paridad literal de todos sus casos.
- Las variantes de union preservan cada binding como nodo `Binding` con
  nombre, tipo y span, además del payload agregado. Stage 0 descarta esos
  nombres; las pruebas de comparación omiten sólo estas aristas adicionales
  y pruebas independientes comprueban el contenido preservado.
- `Discriminator` tiene atributos `field`, `literalType` y `value`; los
  discriminadores numéricos usan el mismo texto decimal exacto que enum.
- Se admite la forma canónica `union Nombre<T> = Variante(T) | Otra;`.
  La forma histórica con parámetros antes del nombre no está soportada.

Switch se comprueba contra árboles esperados independientes: stage 0 tiene un
tipo AST `SwitchStatement`, pero su parser no lo reconoce y su codegen omite
el nodo. Este bloque implementa únicamente el análisis sintáctico del bootstrap,
no la comprobación semántica ni la ejecución de programas con switch.

El nodo `SwitchStatement` tiene aristas `discriminant` y `clauses`. Cada
cláusula es `CaseClause` con `labels`/`body` o `DefaultClause` con `body`.
Se conserva su orden, incluido un default inicial o intermedio. Casos
consecutivos sin sentencias son cláusulas separadas con cuerpo vacío; no se
insertan breaks. Default repetido, case sin expresión, `:` ausente y cláusulas
fuera de switch producen diagnósticos. Duplicación de etiquetas, exhaustividad
y validez contextual de break/continue se dejan al futuro checker.

## Imports y exports: contrato de este bloque

El parser trabaja sólo con tokens. Un nombre de módulo inexistente no produce
error sintáctico: no abre archivos, no crea un grafo ni resuelve aliases a
declaraciones. Tampoco cambia la carga o el borrado de tipos de stage 0.

- `ImportDeclaration` guarda `source` y, cuando procede, `typeOnly` o
  `sideEffect`. Sus aristas `specifiers` apuntan a nodos `ImportSpecifier`
  con `imported`, `local`, `form` (named/default/namespace) y una marca
  `typeOnly` efectiva. Namespace usa `imported: "*"`.
- `ExportNamedDeclaration` guarda `source` para reexports y `typeOnly`
  cuando procede. Cada `ExportSpecifier` contiene `name`, `alias` opcional
  y su marca `typeOnly`. Se conservan listas vacías y comas finales.
- `ExportAllDeclaration` conserva `source`, `namespace` opcional para
  `export * as Nombre`, y `typeOnly` cuando corresponde.
- `ExportDefaultDeclaration` contiene una arista `declaration`. Funciones
  y clases anónimas tienen `anonymous: "true"` y carecen de `name`; no se
  inyecta un identificador global sintético. La fase de vinculación futura
  deberá dar identidad al default dentro de su módulo.
- Los spans de import/export de listas empiezan en la palabra clave y
  terminan en `;` o en el último token significativo si hay ASI. El span de
  default termina en la declaración/expresión hija, como stage 0; sus
  expresiones no incluyen el terminador. Los alias guardan sus propios spans.

Las pruebas comparan los requests/exports con `scanModuleSyntax` de stage 0,
porque éste extrae esa sintaxis antes del parser y no conserva esos nodos.
Además fijan ASTs y marcas type-only independientemente. Los exports default
con nombre se comparan con el parser TS; los anónimos se comprueban según su
contrato nuevo, sin los nombres `ets_default_*` que inventa stage 0.

Se diagnostican nombres duplicados dentro de una lista, aliases incompletos,
orígenes no literales, delimitadores ausentes e import/export fuera del nivel
superior. Los decoradores previos a default se pasan a la función/clase o
variable compatible; no se admiten en imports, listas ni default expresiones.
Se conserva por compatibilidad del dialecto `export default let/const`.
Las marcas type-only expresan intención; no se aplica aquí todo el conjunto de
restricciones de TypeScript sobre combinaciones de imports de tipos.

Los nombres admitidos son identificadores y los contextuales default/type en
las posiciones de origen/export; el nombre local importado debe ser un
identificador del dialecto. Nombres entre comillas, otros nombres reservados,
atributos `with`/`assert`, import dinámico y la forma `import x = ...` quedan
fuera de esta cobertura y producen diagnósticos. Duplicados entre statements,
múltiples default y existencia/visibilidad de símbolos quedan para el futuro
vinculador/checker.

## Templates: contrato de entrada

`template-tokens.ts` es un adaptador léxico host, sin uso del parser TS ni
construcción de AST. `transportTokens` lo aplica automáticamente a los tokens
crudos de stage 0. La API ETS recibe este protocolo plano:

`template-start`, `template-text`, cero o más grupos de `interpolation-start`,
tokens ordinarios de expresión, `interpolation-end`, `template-text`, y por
último `template-end`. Se preservan los segmentos vacíos. Los templates
anidados usan el mismo protocolo dentro de una interpolación. El parser ETS
analiza las expresiones con su precedencia habitual y diagnostica expresiones
vacías, contenido sobrante y marcadores ausentes. Un token crudo `template`
sin preparar se diagnostica, no se acepta silenciosamente.

El AST `TemplateLiteralExpression` tiene aristas ordenadas `parts` a nodos
`TemplatePart` con atributo `value`, y `expressions` hacia las expresiones.
En una entrada válida hay una parte más que expresiones. Los escapes del texto
se conservan crudos, como en stage 0; no se introduce una decodificación nueva.
Los spans del template incluyen las comillas; los de las partes las excluyen,
y los de las expresiones mantienen offset/línea/columna absolutos UTF-16.
Una prueba suministra directamente tokens preparados al binario, sin lexer.

Ambos lexers delimitan el template completo con una pila explícita que distingue
texto e interpolaciones y cuenta las llaves de objetos/bloques. Strings y
comentarios protegen sus llaves y backticks; las comillas dentro del texto son
texto ordinario. El adaptador y el parser de stage 0 comparten el recorrido
léxico host de delimitadores; el lexer ETS implementa el mismo contrato sin
imports. El límite léxico es 128 contextos activos (texto/interpolación),
independiente del presupuesto de profundidad del parser.

El adaptador usa el lexer host para tokenizar cada expresión y no modifica los
tokens originales. Los errores léxicos de esas expresiones conservan la fase
lexer y se reubican a sus coordenadas originales. El parser de stage 0 hace lo
mismo y exige consumir toda la expresión, rechazando `${a b}`, `${}` y otros
fragmentos incompletos. Los tests comprueban el AST nativo y la salida C++ de
programas con templates anidados, comentarios y delimitadores en strings.

Con esto se cierra el soporte sintáctico de templates ordinarios del dialecto.
Se conserva su semántica de escapes crudos: `\n` dentro del texto representa
barra y letra, y `\${name}` es texto literal. No se pretende adoptar toda la
semántica de escapes de JavaScript. Tagged templates y regex literals no son
construcciones soportadas del dialecto. Los módulos ETS siguen aislados;
su futura conexión nativa no forma parte del análisis de templates de este paso.

## Destructuring: AST y alcance sintáctico

Se reconocen declaraciones `let`/`const` con patrones planos, también dentro
de funciones, bloques y el inicializador de un `for` clásico. Los exports y
decoradores se conservan como en las variables simples. Ejemplos:

```ts
const [first:number=1, second]:number[] = values;
const {name:alias="guest", count:number=0, total:sum:number=1}:Source = source;
```

La declaración sigue siendo `VariableDeclaration`, con `name: ""`, `mutable`,
atributo `pattern` (`array`/`object`) y una arista `initializer`. Las aristas
ordenadas `arrayBindings`/`objectBindings` apuntan a nodos `ArrayBinding` o
`ObjectBinding`. Guardan `name`, `declaredType` opcional, `property` en objetos
y arista `defaultValue` opcional. Un patrón vacío conserva su forma mediante
`pattern`, aunque no tenga aristas de bindings. El initializer aparece una
sola vez en el AST; este módulo no determina cómo se evalúa ni copia.

Cada binding conserva un span desde su nombre/propiedad de origen hasta el
final de su tipo/default, excluyendo comas y saltos de línea posteriores.
Los spans de expresiones por defecto son absolutos UTF-16. Se diagnostican
bindings locales repetidos, separadores/identificadores ausentes, patrones
incompletos e inicializadores ausentes; la recuperación conserva la sentencia
siguiente cuando encuentra un `;`. Repetir la propiedad con aliases distintos
es válido: `{x:a,x:b}` introduce dos bindings distintos.

La sintaxis de tipos mantiene la desambiguación del dialecto: `{x:number}`
declara el tipo de `x`, `{x:alias}` renombra y `{x:alias:Box<T>}` permite un
tipo nominal en el alias. `{x:[Y]}` declara el tipo tupla `[Y]` de `x`; no
introduce un binding anidado `Y`. El futuro checker resolverá ese tipo.
Los genéricos necesitan separar `>` y `=` para no formar el token `>=`.

Se rechazan rest, huecos de arrays, bindings anidados y claves de objeto
calculadas/entre comillas/numéricas. No se añaden patrones de parámetros,
asignaciones destructuradas, `using` destructurado ni patrones de `for of/in`.

Stage 0 ahora conserva defaults tras aliases y propiedades tipadas, y admite
patrones de objeto multilínea. La comparación contra su AST incluye todos
los bindings y defaults; no los omite. Esta verificación es sintáctica:
el checker y el backend no se migran en este bloque. En particular, el
lowering de defaults de objetos de stage 0 sigue usando el campo presente,
sin aplicar una semántica de campo ausente/undefined como JavaScript. Esa
semántica y la validación de los defaults requieren una auditoría aparte.

## Pendiente antes de completar el módulo

- Cabeceras `@include`/`@link` y las formas de módulo excluidas arriba.
- Parameter properties, genéricos variádicos y decoradores sobre
  miembros o colocados después de `export`/`function`.
- Paridad de todas las posiciones y mensajes de diagnóstico con stage 0, y
  validación completa de streams de tokens suministrados por callers externos.

Esas construcciones producen diagnósticos; no se aceptan como implementaciones
completas. Hay casos históricos que se preservan como límites de stage 0: por
ejemplo, tras un tipo genérico hace falta separar `>` y `=` para evitar `>=`.
La integración con el lexer ETS y el checker se pospone hasta completar y validar
este módulo.
