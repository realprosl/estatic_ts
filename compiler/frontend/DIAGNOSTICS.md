# Contrato de diagnósticos del frontend nativo

Los puntos de entrada de fuentes, cargador, binder, checker y auditoría emiten
el mismo contrato `ets-diagnostic-1`. La función ETS `formatDiagnostic` es el
único serializador. [diagnostic.ts](diagnostic.ts) publica el tipo del JSON
para consumidores, sin dependencias de Node ni de un módulo de presentación.

| Campo | Contrato |
|---|---|
| `schema` | Siempre `ets-diagnostic-1` |
| `phase` | `loader`, `resolver`, `lexer`, `parser`, `binder` o `checker` |
| `code` | Identificador estable separado del texto; no debe inferirse del mensaje |
| `severity` | Los productores actuales emiten `error`; el contrato reserva `warning` y `note` |
| `message` | Texto explicativo, sin prefijo de código; el serializador no añade ANSI |
| `file` | Archivo fuente; los proyectos usan su ruta canónica |
| `span` | Intervalo `{start,end}` en la fuente original |
| `generated` | `null` o `{sourceId,span,offset,line,column}` en la fuente generada |
| `offset`, `line`, `column` | Alias de compatibilidad de `span.start` |

Cada posición contiene `offset` desde cero y `line`/`column` desde uno. Los
offsets y columnas usan unidades UTF-16, incluidas las fuentes con emojis.
Los intervalos son semiabiertos: incluyen start y excluyen end. EOF o un error
de resolución sin texto disponible pueden tener un intervalo vacío.

## Códigos y migración

Los códigos existentes `E4102`, `E4207`, `COMPTIME_*` y `ETSGEN_*` se conservan.
El adaptador de creación separa sus prefijos históricos del mensaje. Los errores
sin un código específico reciben `LEXER_ERROR`, `PARSER_ERROR`, `BINDER_ERROR`,
`CHECKER_ERROR`, `LOADER_ERROR` o `RESOLVER_ERROR`. Estos códigos generales
identifican la fase; no se presentan como una clasificación granular de todos
los errores. Una nueva clasificación específica debe asignarse en el productor,
sin derivarla de traducciones ni posiciones.

La salida del proyecto cambia de `ets-checked-1` a **`ets-checked-2`** porque
`message` deja de incluir el código y `generated` siempre está presente.
Los clientes deben consultar `code` directamente y aceptar `generated:null`.
Se conservan las coordenadas planas, pero el renderizador debe usar `span`.
La supresión de duplicados compara también el código normalizado.

Los registros internos de lexer/parser y los diagnósticos dentro del AST aislado
siguen siendo estructuras de fase. El puente `parseSource` los convierte al
contrato público, que es el de las listas `diagnostics` de fuentes y proyectos.
El CLI TypeScript de stage 0 conserva su propio contrato.

## Fuentes generadas

La ubicación primaria sigue apuntando a la llamada del archivo original.
`generated.sourceId` permite consultar `generatedSources`; su `span` señala
el nodo o token dentro del fragmento generado. Se conserva tanto el inicio
como el final originales antes de reubicar el AST expandido. Las expansiones
anidadas se relacionan mediante `generatedSources[].parentId`.

Los errores de parseo de una expansión conservan `ETSGEN_GENERATED_PARSE` en
la fase `checker`, que informa del fallo de expansión, con el intervalo de la
llamada y el del error dentro del texto generado.

Este módulo no imprime fragmentos, colores, subrayados ni mensajes de terminal.
La futura presentación consume estos datos y la fuente correspondiente.
