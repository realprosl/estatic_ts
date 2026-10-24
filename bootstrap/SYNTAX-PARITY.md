# Sintaxis: frontend ETS frente a stage 0 TypeScript

Esta matriz compara la gramática del frontend ETS con el pipeline de carga y
parseo de stage 0. El parser TS aislado no representa por sí solo ese pipeline:
los imports, exports y cabeceras también se procesan en el cargador antiguo.
El informe JSON conserva ambas medidas para stage 0.

No se confunde aceptación sintáctica con resolución de nombres, tipado, seguridad
de memoria o generación de código. Los casos que prueban sólo gramática pueden
ser rechazados después por el checker; por ejemplo, los packs de clases.

El binario ETS se construye mediante el adaptador de stage 0. No hay todavía
compilación completa del compilador por sí mismo: IR y backends quedan fuera
de esta entrega.

Reproducir: `npm run audit:bootstrap:syntax`. Actualizar este documento y
`bootstrap/audit/syntax-parity.json`: añadir `-- --write`.

Casos nombrados: **75/75** con el resultado esperado.
Corpus físico: **131/131** archivos aceptados por el
parser ETS, **131/131** por el cargador/parser TS.
Archivos aceptados antes y rechazados ahora: **0**.
Estas muestras no constituyen una equivalencia formal para cualquier entrada.

## Resumen de compatibilidad

- Formas aceptadas antes y rechazadas ahora en la matriz: **0**.
- Adiciones observadas en el parser nativo: **7**: grouped-types, typeof-qualified, typeof-suffixes, typeof-static, switch, enum-newline, union-trailing-separator.
- Se conservan declaraciones, clases por composición, interfaces, genéricos,
  funciones/packs, destructuring plano, ownership/préstamos, async, módulos,
  match, comptime y generadores en el frontend.
- La escritura histórica `union<T> U = Some(T)|None;` también se conserva;
  sus parámetros se retienen en el AST, corrigiendo una pérdida de stage 0.
- Herencia, excepciones, imports dinámicos, regex, tagged templates,
  destructuring anidado/rest, object spread, exponentes numéricos, ===/!== y
  >>> se rechazan en ambos. No son funcionalidades eliminadas en la migración.

## Matriz reproducible

| Caso | Área | TS: cargador + parser | Parser ETS | Resultado observado |
|---|---|---|---|---|
| declarations | Básicos | Sí | Sí | conservada |
| newlines | Básicos | Sí | Sí | conservada |
| unicode-comments | Básicos | Sí | Sí | conservada |
| numeric-bases | Literales | Sí | Sí | conservada |
| numeric-types | Tipos | Sí | Sí | conservada |
| arrays-tuples | Tipos | Sí | Sí | conservada |
| aliases-union-intersection | Tipos | Sí | Sí | conservada |
| readonly | Tipos | Sí | Sí | conservada |
| function-types | Tipos | Sí | Sí | conservada |
| grouped-types | Tipos | No | Sí | adición nativa |
| typeof-simple | Consultas | Sí | Sí | conservada |
| typeof-qualified | Consultas | No | Sí | adición nativa |
| typeof-suffixes | Consultas | No | Sí | adición nativa |
| typeof-static | Consultas | No | Sí | adición nativa |
| interfaces | Declaraciones | Sí | Sí | conservada |
| classes | Declaraciones | Sí | Sí | conservada |
| parameter-properties | Declaraciones | Sí | Sí | conservada |
| composition | Declaraciones | Sí | Sí | conservada |
| generic-classes | Genéricos | Sí | Sí | conservada |
| generic-functions | Genéricos | Sí | Sí | conservada |
| generic-aliases | Genéricos | Sí | Sí | conservada |
| function-packs | Genéricos | Sí | Sí | conservada |
| class-pack-grammar | Genéricos | Sí | Sí | conservada |
| functions-arrows | Funciones | Sí | Sí | conservada |
| nested-functions | Funciones | Sí | Sí | conservada |
| optional-default-parameters | Funciones | Sí | Sí | conservada |
| out-parameters | Funciones | Sí | Sí | conservada |
| overloads | Funciones | Sí | Sí | conservada |
| named-arguments | Funciones | Sí | Sí | conservada |
| rest-spread | Funciones | Sí | Sí | conservada |
| destructuring-arrays | Bindings | Sí | Sí | conservada |
| destructuring-objects | Bindings | Sí | Sí | conservada |
| using | Bindings | Sí | Sí | conservada |
| if-while-for | Control | Sí | Sí | conservada |
| for-of-in | Control | Sí | Sí | conservada |
| switch | Control | No | Sí | adición nativa |
| enum-numeric-string | Uniones y enums | Sí | Sí | conservada |
| enum-newline | Uniones y enums | No | Sí | adición nativa |
| union-canonical | Uniones y enums | Sí | Sí | conservada |
| union-named-payload | Uniones y enums | Sí | Sí | conservada |
| union-object | Uniones y enums | Sí | Sí | conservada |
| union-trailing-separator | Uniones y enums | No | Sí | adición nativa |
| union-legacy | Uniones y enums | Sí | Sí | conservada. Se conserva la forma histórica y sus parámetros; el parser TS descartaba los parámetros anteriores al nombre. |
| match | Expresiones | Sí | Sí | conservada |
| match-type | Expresiones | Sí | Sí | conservada |
| optional-nullish | Expresiones | Sí | Sí | conservada |
| as-satisfies | Expresiones | Sí | Sí | conservada |
| typeof-instanceof | Expresiones | Sí | Sí | conservada |
| template | Expresiones | Sí | Sí | conservada |
| array-spread | Expresiones | Sí | Sí | conservada |
| object-spread | Fuera del dialecto | No | No | rechazada en ambos |
| numeric-exponent | Fuera del dialecto | No | No | rechazada en ambos |
| delete | Expresiones | Sí | Sí | conservada |
| async-await | Async | Sí | Sí | conservada |
| async-arrow | Async | Sí | Sí | conservada |
| for-await | Async | Sí | Sí | conservada |
| imports-exports | Módulos | Sí | Sí | conservada |
| namespace-import | Módulos | Sí | Sí | conservada |
| type-only-import | Módulos | Sí | Sí | conservada |
| type-only-namespace | Módulos | Sí | Sí | conservada |
| default-reexport | Módulos | Sí | Sí | conservada |
| export-namespace | Módulos | Sí | Sí | conservada |
| decorators | Metaprogramación | Sí | Sí | conservada |
| etsgen | Metaprogramación | Sí | Sí | conservada |
| cppgen | Metaprogramación | Sí | Sí | conservada |
| abi-decorators | Metaprogramación | Sí | Sí | conservada |
| inheritance | Fuera del dialecto | No | No | rechazada en ambos |
| exceptions | Fuera del dialecto | No | No | rechazada en ambos |
| dynamic-import | Fuera del dialecto | No | No | rechazada en ambos |
| regex | Fuera del dialecto | No | No | rechazada en ambos |
| tagged-template | Fuera del dialecto | No | No | rechazada en ambos |
| strict-equality | Fuera del dialecto | No | No | rechazada en ambos |
| unsigned-shift | Fuera del dialecto | No | No | rechazada en ambos |
| nested-destructuring | Fuera del dialecto | No | No | rechazada en ambos |
| rest-destructuring | Fuera del dialecto | No | No | rechazada en ambos |

## Diferencias que no son de sintaxis

- Const, readonly, ref, constRef, ptr y move conservan su escritura. El checker
  nativo rechaza ciertas mutaciones y préstamos de const aceptados por stage 0.
- Las capturas y callbacks conservan su sintaxis; el nuevo análisis comprueba
  escapes, efectos, préstamos activos, suspensión y usos después de move.
- Los tipos privados en constraints/defaults exportados se comprueban como
  parte de la superficie pública, también tras @etsgen.
- @cppgen se conserva como contrato opaco del frontend. Aquí no se ejecuta
  la emisión C++; eso pertenece al backend que el usuario ha aplazado.
- Las consultas typeof y los tipos compuestos tienen identidades y metadatos
  nativos; el formato añade procedencia persistente y claves por módulo.
- Unq/unSome no se reintroducen. Las aceptaciones heredadas del checker TS
  directo se distinguen de la sintaxis y del contrato público vigente.

La aceptación semántica completa se prueba separadamente con el checker: el
corpus actual acepta 130 ejemplos y rechaza expected-errors/private-bad.ets por
acceso privado. El estado de cierre y sus obligaciones están en [PENDING.md](PENDING.md).
