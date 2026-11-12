# Procedencia e inputs incrementales del frontend

La salida `ets-checked-2` mantiene un AST independiente por archivo, junto con
sus tablas de tipos, firmas, conversiones, símbolos, efectos y constantes.
`entry` y `entryModuleId` identifican la entrada. `frontendIdentity` identifica
las fuentes del build que produjo el análisis.

## Referencias y persistencia

Cada `files[m]` publica `file` (ruta canónica), `moduleId` y `sourceHash`. Un nodo
se localiza por `(moduleId, sourceHash, node)` y conserva su `span` original.
Los índices numéricos `m`, `node`, `symbol` siguen siendo referencias eficientes
de esta carga. No son IDs persistentes; una edición puede cambiar el orden de
las arenas. La futura IR debe conservar esta procedencia al derivar nodos.

`symbolIds` corresponde uno a uno con `binding.symbols`. Normaliza aliases a
su origen y usa claves de módulo, ámbitos léxicos, clase/nombre de declaración
y ordinal de ámbitos homónimos. No depende del índice global ni del offset.
Se conserva al insertar otros módulos o cambiar el cuerpo de un helper sin
alterar la declaración referenciada. Cambiar la estructura de ámbitos o mover
una declaración puede cambiar su ID; no se promete identidad tras refactors
arbitrarios. Los namespaces tienen la identidad del módulo al que apuntan.

## Registros por módulo

`moduleRecords` publica:

| Campo | Contrato |
|---|---|
| `id`, `file` | Identidad SHA-256 de la ruta canónica y ruta legible |
| `sourceHash` | SHA-256 de los bytes exactos del archivo |
| `interfaceHash` | Contratos exportados, tipos con identidades persistentes, efectos observables y huellas de interfaces de dependencias |
| `implementationHash` | Contenido propio y cierre transitivo de contenidos de dependencias |
| `dependencies` | IDs persistentes de las dependencias resueltas |
| `requiresBody`, `bodyDependencies` | Dependencias conservadoras de cuerpos para genéricos, constantes, defaults y evaluación comptime |
| `semanticKey` | Build/esquema, contenido propio, interfaz y entradas de cuerpos requeridas |

Los hashes no incluyen offsets, índices globales ni números locales de variantes.
Las interfaces incluyen firmas de sobrecargas, miembros, parámetros/defaults y
atributos; omiten cuerpos ordinarios. Se mantienen efectos de escritura, move,
retención e invocación, incluso cuando la firma de tipos no cambia.

La invalidación es conservadora por módulo. Un cambio de interfaz importada
puede invalidar consumidores que no usan el símbolo concreto modificado. Los
módulos con constantes, genéricos o comptime conservan dependencias de cuerpos;
los reexports no eliminan esa obligación. La huella de implementación transitiva
permite a fases futuras adoptar reglas adicionales, por ejemplo si hacen inline.
Un cuerpo ordinario cambiado, con interfaz/efectos iguales y sin dependencia de
su cuerpo, no cambia la clave semántica de un consumidor intacto.

Los programas con diagnósticos conservan procedencia, pero publican vacías las
huellas semánticas reutilizables. Un build ad hoc sin `frontendIdentity` tampoco
publica `semanticKey`: no puede certificar reutilización entre builds.

## Alcance

Estos registros son datos del frontend. El checker sigue ejecutándose en cada
carga; no se implementa aquí una caché persistente de resultados semánticos.
No hay IR, generación C++, caché de objetos ni enlace. Un backend deberá añadir
su versión, target, opciones y sus dependencias específicas a la clave de sus
artefactos; estos hashes por sí solos no autorizan reutilizarlos.

Las regresiones comparan cargas frías/calientes, cambios de orden, cuerpos,
tipos, efectos, genéricos, constantes, variantes y comptime a través de barrels.

## Fuentes generadas y orden semántico

`generatedSources` identifica cada expansión @etsgen, su módulo, llamada,
generador, padre y texto virtual. Los nodos mantienen el span de la llamada y
los atributos generatedSource/generatedOffset/generatedEndOffset y coordenadas
virtuales. Los diagnósticos añaden generated.sourceId y su posición virtual.

`files[m].analysisRanges[node]` conserva el intervalo de orden léxico del AST
expandido. Sus ordinales permiten interpretar los intervalos de préstamos sin
confundirlos con posiciones del texto original. [-1,-1] indica que no hubo
expansión y los intervalos usan offsets originales. Estos ordinales son locales
a esta carga; no se usan como identidades persistentes ni hashes de interfaz.
