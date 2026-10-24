# Puente nativo por archivo: lexer ETS → parser ETS

Este bloque conecta los dos módulos validados. El binario recibe texto, ejecuta
el lexer ETS, convierte sus tokens y ejecuta el parser ETS. La preparación de
templates también ocurre en ETS; Node no tokeniza ni construye ASTs.

```bash
npm run bootstrap:frontend
npm run bootstrap:frontend -- 'const greeting=`Hola ${name}, total=${1+2}`;'
npm run bootstrap:frontend -- --file examples/todo-project/main.ets
npm run test:bootstrap:frontend
```

`run.ts` sólo construye el binario y hace I/O: con `--file` lee UTF-8 en el host
y entrega el texto y su ruta al programa nativo. No carga los imports de ese
archivo. El driver usa argumentos del proceso, con sus límites de tamaño y sin
NUL embebido; `parseSource` recibe strings directamente y no depende de argv.
La demostración no ejecuta el programa analizado: muestra tokens, AST y errores.

## Contrato de la integración

`parseSource(source, file = "<input>")` devuelve `SourceResult` con:

- `file`: identificador facilitado por el caller, conservado sin canonicalizar.
- `tokens`: formato `ParserToken`, conservando los lexemas y spans UTF-16.
- `ast`: el `ParseResult` del parser aislado, sin mezclar módulos o símbolos.
- `diagnostics`: errores con archivo, fase (`lexer`/`parser`), mensaje y posición.
  Usan el contrato común [ets-diagnostic-1](DIAGNOSTICS.md), con código,
  severidad, intervalo UTF-16 y procedencia generada cuando corresponda.
- `parsed`: indica si se ejecutó el parser. Ante errores léxicos es false y
  `ast` contiene `{root:-1,nodes:[],diagnostics:[]}`. Se evita una cascada de
  errores sintácticos sobre tokens incompletos.
- `success`: sólo true sin diagnósticos. Un AST parcial con errores del parser
  no es un módulo válido para las fases posteriores.

`inspectSource` serializa ese resultado para la demostración. El nuevo
`formatAst(result)` del parser serializa una arena existente sin analizarla otra
vez. Las API anteriores `parseTokens`/`inspectAst` se conservan.

El lexer ofrece `tokenizeExpanded`: emite `template-start`, `template-text`,
`interpolation-start`, tokens de expresiones, `interpolation-end` y `template-end`.
Reutiliza su scanner de delimitadores, strings y comentarios; cada interpolación
se tokeniza con un lexer local y se rebasa al origen. Los templates anidados se
expanden dentro de ese recorrido. Se conservan segmentos vacíos y escapes crudos.
La representación anterior `tokenize`/`inspectTokens` sigue emitiendo un token
`template` crudo y mantiene sus pruebas. Los scanners continúan sin importar al
parser. El límite léxico de 128 contextos y los límites del parser se conservan.

Cada llamada crea sus propios objetos y resultados. Se prueban llamadas a varios
archivos en un mismo proceso, incluidos errores entre archivos correctos. Este
bloque todavía ejecuta las llamadas secuencialmente; no añade un scheduler ni
certifica rendimiento concurrente.

## Validación

Las 57 pruebas compilan obligatoriamente dos ejecutables C++20: la integración
de cuatro módulos ETS (lexer, parser, puente y driver), y el parser aislado.
Para las fuentes comprobadas se compara cada token con lexer TS + adaptador
léxico host, y la arena completa, sus posiciones y errores con el parser ETS
aislado alimentado por esos tokens. El ejecutable integrado sólo recibe texto;
el host se usa como referencia de prueba.

Se cubren templates anidados con Unicode, comentarios y strings, declaraciones,
imports/exports con alias, decoradores, tipos, control de flujo, errores léxicos
y sintácticos y límites de anidamiento. Se analizan los fuentes completos del
lexer, parser, puente y driver. La auditoría de ejemplos comprueba también los
120 aceptados directamente por el parser TS, manteniendo explícita la lista de
ocho excluidos de esa comparación. Las suites aisladas siguen ejecutándose.

## Resolución de módulos: implementada en v60

El nuevo [`../modules/`](../modules/README.md) construye el grafo de archivos
y persiste tokens/AST por archivo. Esta API puntual continúa independiente.
El diseño siguiente conserva la separación de capas: interfaces semánticas,
C++/objetos y scheduler concurrente siguen pendientes.

Antes de portar el checker, el cargador construye el grafo de archivos.
La integración actual conserva los nodos import/export; no resuelve rutas, no
busca archivos, no vincula nombres y no usa cachés globales.

El orden previsto es:

1. Leer y analizar cada fuente con identidad propia; extraer solicitudes de
   import y reexport desde su AST, incluidos type-only, alias y efecto lateral.
2. Resolver cada specifier respecto al archivo, aliases y raíces configuradas,
   reproduciendo las reglas de extensiones e identidad canónica de stage 0.
3. Registrar archivos y dependencias sin duplicados; diagnosticar archivos
   ausentes y ciclos con su recorrido. No confundir aliases de símbolos con
   aliases de rutas ni concatenar los ámbitos de los módulos.
4. Separar descubrimiento del grafo de resolución de exports/símbolos y del
   checker. Preparar trabajos por archivo y resultados en orden determinista;
   después añadir paralelismo acotado sin tareas duplicadas ni esperas cíclicas.

### Helper de reutilización antes de lexer/parser

Queda anotado como requisito del cargador un helper, provisionalmente
`getOrParseModule`: decidir si reutiliza una entrada válida o llama a
`parseSource`. Debe evitar volver a tokenizar y parsear contenido que no ha
cambiado, tanto dentro de una ejecución como entre ejecuciones cuando exista
almacenamiento persistente. La caché se implementa en el cargador v60, no en este puente.

La unidad mínima será **el archivo**, incluso si varios archivos forman un
módulo lógico. Se consultará un manifiesto persistente antes de lexer/parser y
de repetir la resolución costosa. Cada registro tendrá identidad canónica,
tamaño, mtime de alta precisión, metadatos adicionales disponibles (ctime/identidad
del archivo), hash de contenido, versiones/opciones, imports y dependencias,
huella de interfaz pública y referencias a AST, C++ generado y objetos `.o`.
Un módulo lógico agrupará esos registros; no será una única entrada que obligue
a rehacer todos sus archivos al cambiar uno.

Tamaño/fechas son el filtro rápido, no una prueba infalible de identidad: pueden
coincidir tras una edición o preservarse al copiar/restaurar archivos. El contrato
de validez deberá distinguir una detección fiable de cambios de un modo de
verificación por contenido. En caso de duda se leerá/hashará el archivo antes
de aceptar el hit, sin volver a parsearlo si coincide su hash. Un cambio sólo de
timestamp con contenido idéntico actualizará metadatos sin invalidar el AST.

| Capa reutilizable por archivo | Qué invalida su entrada |
|---|---|
| Tokens/AST e imports sintácticos | Contenido, versión/esquema y opciones de lexer/parser |
| Rutas y aristas resueltas | Imports, origen, aliases/raíces/reglas y cambios relevantes del filesystem |
| Símbolos y semántica | Fuente propia e interfaces públicas de dependencias usadas |
| C++ generado | Resultado semántico y opciones/versión del generador/runtime |
| Objeto `.o` | C++ efectivo, cabeceras transitivas, compilador, target, flags y ABI |
| Ejecutable enlazado | Conjunto de objetos/librerías y opciones de enlace |

El scheduler decidirá por capa qué artefacto falta o ha caducado. Un cambio de
cuerpo con interfaz pública intacta no deberá reparsear importadores ni forzar
su análisis semántico completo por defecto. Cambiar exports/tipos públicos sí
propagará invalidaciones a sus consumidores. Los includes o cabeceras comunes
pueden obligar a recompilar más de un `.o`: la granularidad no permite reutilizar
objetos incompatibles. Se reutilizarán las cachés del compilador TS actual como
referencia de diseño, sin asumir que ya cubren este futuro frontend ETS.
Para hacer efectiva esa granularidad en C++, se deberá evitar que cuerpos
ordinarios de archivos independientes acaben en una cabecera común que invalide
todos los objetos. El diseño de cabeceras por interfaz/unidad y las dependencias
reales de templates/inline formarán parte de la invalidación del backend.

- La clave incluirá un hash del contenido exacto, versión/esquema del AST y
  huella del lexer/parser, junto con opciones que afecten a su sintaxis. No
  bastan una semilla arbitraria, el nombre, tamaño o fecha de modificación.
- Se reutilizarán AST y solicitudes de import/reexport. Los datos cacheados se
  mantendrán inmutables; un checker posterior no debe contaminar el AST sintáctico
  compartido con anotaciones de otra compilación. La identidad/diagnósticos de
  archivo se conservarán o reasignarán explícitamente si el contenido se comparte.
- La resolución de rutas tendrá otra huella: archivo de origen, aliases, raíces
  y reglas de resolución. Cambiar esa configuración obliga a resolver otra vez
  las dependencias, aunque el AST pueda seguir reutilizándose. Un cambio en una
  dependencia no exige reparsear al importador si su texto no cambió; sí puede
  invalidar resolución de símbolos y resultados semánticos posteriores.
  Los hits del resolver deberán validar sus supuestos sobre archivos/candidatos,
  incluidos nuevos archivos con precedencia, eliminaciones y cambios de symlinks.
- En paralelo, habrá una entrada de trabajo en curso por clave para que varios
  solicitantes compartan el resultado, sin duplicar parseos. Se separará esa
  deduplicación de la detección de ciclos del grafo para no provocar esperas
  circulares; un trabajo fallido se liberará para permitir reintentos.
- Entradas corruptas, incompatibles o incompletas serán misses recuperables;
  escrituras persistentes atómicas y validación de nodos/aristas antes de usarlos.
  Primera versión: persistir sólo resultados sintácticos correctos.
- Pruebas previstas: segunda compilación sin cambios con cero parseos nuevos,
  edición de un único archivo con un único miss sintáctico, invalidación por
  versión/opciones, nueva resolución al cambiar aliases/raíces, caché corrupta,
  varios solicitantes de la misma clave y diagnósticos deterministas con/sin caché.
  Se añadirá un módulo lógico de varios archivos: editar sólo uno deberá producir
  un único miss sintáctico y reutilizar los `.o` efectivos intactos. Se comprobarán
  timestamps cambiados sin edición, ediciones de igual tamaño/fecha preservada,
  cambios de interfaz frente a cuerpo, cabeceras y archivos añadidos/eliminados.

Para descubrir los imports hace falta leer/analizar el archivo que los declara;
no hace falta comprobar sus tipos ni haber analizado sus dependencias. El grafo
debe estar resuelto antes de vincular símbolos y comenzar el análisis semántico
global. El resolver secuencial y la caché sintáctica se validan en `../modules/`;
la planificación concurrente y las capas posteriores siguen pendientes.
