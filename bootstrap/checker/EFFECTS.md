# Resúmenes nativos de efectos y préstamos (v64)

`effects.ets` consume el grafo, binding y tipos de la misma carga, junto a las
capturas y préstamos locales de `safety.ets`. Construye tablas independientes;
no modifica el AST, los símbolos ni la caché de sintaxis. Los IDs sólo tienen
sentido dentro de ese resultado. `CheckResult.effects` y el JSON del driver
publican resúmenes por función, arrow, método o constructor comprobado. Las
funciones async añaden un resumen separado de creación.

## Contenido

| Campo | Significado |
|---|---|
| `module`, `node` | Declaración en el AST original |
| `phase`, `creation` | Fase body/creation e índice de creación de un cuerpo async (-1 si no corresponde) |
| `parameters` | Identidades de los parámetros |
| `reads`, `writes`, `moves` | Efectos posibles por símbolo, también transitivos |
| `invokes` | Parámetros callback que pueden invocarse, incluidos wrappers |
| `retains` | Orígenes de parámetros que pueden guardarse fuera de la llamada |
| `returned` | Orígenes de parámetros transportados por el resultado |
| `callees` | Índices de resúmenes que pueden ser llamados |
| `borrows` | Obligaciones `{call,callback,root,mode}` al invocar callbacks |
| `unknown` | Algún efecto no tiene implementación/resumen suficiente |
| `external` | Puede realizar I/O, consultar tiempo o aleatoriedad; también transitivo |
| `recursive` | La función pertenece a un ciclo de llamadas |

`reads/writes/moves` no son una secuencia de instrucciones ni una lista de
operaciones obligatorias: conservan alternativas y raíces locales. Al componer
llamadas se proyectan parámetros prestados y receptores a los argumentos;
los parámetros por valor y las capturas por copia no se confunden con la fuente.
`retains` y `returned` son distintos: devolver un callback recibido permite
seguir su procedencia en el llamador, sin considerarlo siempre almacenado.
Las obligaciones de préstamo incluyen parámetros y préstamos locales activos,
y se propagan por wrappers. El nodo `call` pertenece al módulo del resumen.

## Construcción y consumo

Un grafo finito de valores enlaza declaraciones, aliases/asignaciones, callbacks
pasados como argumentos, retornos, arrays y campos. Una worklist por puntos fijos
acumula destinos y orígenes. Otro punto fijo compone efectos, retención e
invocación. Los ciclos no se resuelven mediante una profundidad de recursión
arbitraria. Las búsquedas son lineales; no se anuncia una mejora de rendimiento.

La seguridad mantiene el recorrido de flujo preciso de llamadas conocidas.
Para callables reasignados combina los estados de todos los destinos posibles.
Conserva préstamos del llamador y añade préstamos temporales de parámetros,
por lo que un callback no puede escribir a una fuente prestada a su consumidor.
El acceso autorizado a través del parámetro prestado sigue permitido.
Los préstamos temporales de llamadas no se añaden a la tabla pública de leases
léxicos. Los efectos sobre globals conservan el archivo/nodo del acceso real.

Una llamada recursiva, o que alcance el límite de expansión precisa de 64
frames, usa el resumen transitivo. Un move observable produce un estado
posiblemente movido; las lecturas posteriores se vuelven a comprobar.
La recursión pura ya no falla por la mera presencia de un owner global ajeno.
Si ese resumen contiene efectos opacos o una invocación callback simbólica
pendiente, se rechaza explícitamente con E4104.

Los consumidores conocidos que sólo invocan un callback permiten closures con
captura por referencia durante la llamada. Guardarlas globalmente, devolverlas
fuera de su ámbito o pasarlas a un consumidor opaco conserva E4210. No hace falta
cambiar la sintaxis ni añadir una anotación pública en esta etapa.
Una definición sin llamadores concretos puede conservar obligaciones simbólicas;
no debe interpretarse su tabla como autorización para invocar cualquier callback
externo sin comprobar esas obligaciones en un futuro linker/codegen.

## Límites

El análisis es conservador, insensible al orden de asignaciones y al contexto
entre llamadas. Puede mezclar destinos de varias instancias del mismo campo,
elementos de un array o argumentos de distintos llamadores. Una reasignación
segura no borra un destino peligroso anterior. No demuestra disjunción por campo.
Los resúmenes no certifican terminación ni expresan multiplicidad de efectos.
Los inicializadores de campos no literales vuelven opaco el resumen de una función
que construye esa clase, aunque el recorrido preciso todavía los comprueba.

No introduce lifetime parameters, retornos prestados, contratos de C++ externo
ni semántica incremental. Permanecen las
restricciones de [SAFETY.md](./SAFETY.md). No implementa aún el [IR](./IR.md)
ni conecta estas tablas al codegen del programa. Las pruebas nativas verifican
invariancia/repetición, casos aceptados/rechazados y reutilización de la caché;
no equivalen a paridad completa con el checker TypeScript.

## Argumentos y contenedores

La proyección de argumentos consulta `argumentParameters`, incluyendo argumentos
nombrados y rest. Los consumidores de arrays y match enlazan sus entradas con
los parámetros de callbacks mediante entradas sintéticas; los resultados,
retención e invocaciones conservan sus orígenes. El conjunto de destinos de una
unión se transporta desde el payload hasta la extracción e invocación, incluso
cuando el campo no tiene identidad de símbolo propia. La mezcla entre elementos
y variantes sigue siendo conservadora.


## Efectos diferidos de tareas

Los defaults pertenecen a la fase creation. Las operaciones del cuerpo pertenecen
a body; crear una tarea compone únicamente creation y await compone body. Un
grafo separado de orígenes de tareas se propaga por variables, moves, retornos,
campos y contenedores. Una fábrica síncrona que devuelve una tarea transporta
su origen, sin inventar un segundo frame ni ejecutar el cuerpo diferido.

Los retornos de callbacks de un cuerpo async se enlazan al resultado de await,
no al valor de la tarea. Las capturas almacenadas en el frame mantienen su propia
procedencia para comprobar retención y escapes. Las declaraciones externas sin
cuerpo y las tareas recibidas sin un origen conocido conservan efectos opacos.
La composición es insensible al contexto de cada invocación: puede mezclar
argumentos de llamadores diferentes y rechazar programas que un contrato de
efectos polimórficos más preciso permitiría.
