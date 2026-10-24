# Flujo, memoria, capturas y API pública nativos (v64)

`safety.ets` ejecuta una pasada ETS después de la comprobación de tipos. Consume
el grafo, el binding y las tablas tipadas de **la misma carga**. No modifica
fuentes, AST, binding ni tablas de tipos. Añade diagnósticos y las tablas
`captures`, `borrows` y `effects` de `model.ets`. Los errores de tipos impiden iniciarla;
no se interpretan tablas parciales como un programa correcto.

## Flujo y ownership

Cada símbolo tiene un estado por ruta: sin inicializar, disponible, movido o
posiblemente movido. El recorrido respeta el orden de evaluación del AST,
argumentos, defaults e incrementos. No usa el orden de asignación de IDs de la
arena como si fuera orden de ejecución.

- Las ramas se analizan por separado y se unen en su continuación. Una rama
  que retorna no contamina la continuación de la función, pero sus efectos sí
  se unen al volver al llamador. Se conservan canales de return/break/continue.
- Los bucles incluyen la ruta de cero iteraciones y el retorno al encabezado.
  Se itera hasta estabilizar el estado del dominio finito. Se detecta el uso de un owner en una iteración posterior.
  Los literales booleanos y el cortocircuito evitan rutas evidentemente muertas.
- `move(lvalue)` admite owners directos y agregados que los contienen. Consume el origen;
  se rechazan lecturas y segundos movimientos posteriores (E4102/E4103).
  Transferir un owner sin move produce E4101. Los movimientos parciales de campos
  e índices dejan una obligación de reinicialización antes de usar el agregado
  completo. Los índices dinámicos se solapan conservadoramente y escribir en uno
  no demuestra restaurar una posición movida. Un `new C()` puede inicializar
  directamente un owner. Asignarle de nuevo un valor válido restablece el estado.
- Se comprueban lecturas **y escrituras** antes de inicialización (E4001).
  Las llamadas directas seleccionadas se recorren con el estado del llamador,
  incluyendo defaults omitidos e inicializadores de campos al construir.
  Se preserva la posición del uso dentro del callee, también entre archivos.
- Las rutas que terminan en return o en un bucle `while(true)` sin salida
  cumplen la comprobación de finalización. Una ruta normal sin valor no la cumple.

Las llamadas directas se expanden de forma acotada, no mediante un nuevo
intérprete ni ejecutando valores del programa. La recursión numérica continúa
admitida. Si interviene ownership y falta un resumen de efectos, se produce un
diagnóstico conservador. Un callable reasignado también necesita un resumen
(E4104). Los callbacks/métodos opacos que podrían afectar globals con ownership
o todavía no inicializados, o atravesar un préstamo activo, se rechazan en lugar de omitir esos efectos.

## Préstamos y readonly

Se resuelven `ref<T>`, `constRef<T>`, `ptr<T>`, `constPtr<T>` y el modificador
fuente `readonly T`. `ref(x)`/`constRef(x)` tienen identidad de valor en el
binder y declaraciones canónicas en `types/estatic.d.ts`; stage 0 ya reconocía
esos helpers. Los nombres locales homónimos conservan su comportamiento normal.

- Los préstamos sólo se permiten como parámetros o handles locales con origen
  lvalue conocido. No se pueden devolver, almacenar en fields/globals ni
  introducir dentro de arrays/tuplas/uniones (E4203). Las firmas callable sí
  pueden recibir préstamos en sus propios parámetros.
- Las llamadas comprueban lvalues, mutabilidad y conflictos sobre una misma
  raíz: dos préstamos mutables, mutable+compartido o préstamo+move no pueden
  coexistir durante la llamada. El acceso por un handle `ref<T>` permite
  modificar su referente; `constRef<T>`/`constPtr<T>`/readonly lo impiden.
- Cada préstamo local conserva raíz, principio y último uso por offset o por orden léxico expandido,
  incluidos usos de aliases. Dos usos en una misma línea no comparten por eso
  una duración artificial. Los préstamos sin usos no mantienen un intervalo vivo.
- Se rechazan intervalos solapados cuando alguno es mutable, acceso directo a
  la fuente durante un préstamo mutable y escritura/move durante uno compartido.
  Las llamadas directas conservan préstamos activos del llamador al comprobar
  accesos a globals en el callee. Una captura por valor ya creada es una copia,
  no una lectura tardía de su fuente original.
- Un cast no puede introducir o borrar un contrato de memoria. Las
  instanciaciones de agregados genéricos revalidan transferencias y capturas
  después de sustituir tipos. Los packs con owners exigen move y conservan la
  correspondencia de elementos; los packs con préstamos requieren lifetimes.

`borrows` entrega `{module,symbol,root,begin,end,mode}`. Los intervalos son
metadatos conservadores, no lifetimes persistentes ni una prueba general de
aliasing. Se agrupan campos/índices bajo la raíz del lvalue. El análisis de
intervalos no es un solver NLL completo sobre CFG: puede rechazar reborrows o
rutas que un análisis más preciso demostraría disjuntas. Las rutas de movimientos
parciales distinguen campos e índices constantes; esta precisión no se extiende
a todos los préstamos. Las reglas de suspensión se describen más abajo.

## Capturas y procedencia de escapes

Las capturas se obtienen del binding por **identidad de símbolo**, incluyendo
el callee de una llamada. Se excluyen globals verdaderos y se distinguen ámbitos
interiores, parámetros y sombras. Las capturas transitivas se transportan por
los arrows exteriores necesarios.

`captures` contiene `{module,closure,symbol,mode}`. Un lector captura por valor.
Si un arrow modifica estado capturado, todas sus capturas se clasifican por
referencia, siguiendo la política del backend actual. Se permite su uso local.
Capturar préstamos u owners sin lifetime demostrado produce E4209. Las funciones
nombradas anidadas conservan su entorno por identidad de símbolo. This se captura
por referencia para uso local; su transporte fuera del ámbito produce E4210.

Un grafo de procedencia separado enlaza variables, aliases, asignaciones,
condicionales, capturas transitivas, literales de arrays/tuplas/objetos, push,
índices y campos bajo su raíz. Una worklist propaga el origen de riesgo hasta
un punto fijo; los ciclos terminan y sobrescribir por un valor seguro no borra
el riesgo anterior. Los resultados escalares no se marcan sólo porque se haya
invocado una closure mutable para calcularlos.

Se rechaza E4210 cuando una closure conocida por capturar por referencia puede
salir por un retorno explícito/implícito, un contenedor retornado, almacenamiento
global/exterior o un argumento callback cuya retención no se ha demostrado.
v64 consulta [resúmenes de efectos](./EFFECTS.md): un consumidor demostrado
como no retenedor permite closures locales por referencia. Una llamada opaca
conserva el rechazo conservador.
Los lectores devueltos por valor y la mutación de globals de vida estática
continúan permitidos.

No es escape analysis completo: no modela C++ opaco, heaps compartidos,
lifetimes interprocedurales generales, todos los contratos de tareas y contenedores o
efectos indirectos. Map/Set y payloads de uniones transportan la procedencia de
callbacks. Los owners almacenados requieren transferencia; los préstamos no se
pueden almacenar en esos agregados. La procedencia es insensible al
orden y a los elementos concretos de un contenedor; puede dar falsos positivos.
No demuestra ausencia de fugas ni seguridad concurrente.

## Superficie pública

Se parte de las tablas de export del binder, incluyendo aliases, defaults,
type-only y barrels, y se recorren firmas, sobrecargas, parámetros, aliases y
miembros públicos. No se recorre el cuerpo de implementación como si fuera API.
Los fields/métodos privados o protegidos se excluyen de la superficie; los tipos
de parámetros de constructor siguen formando parte de su firma pública.

Se comprueban tipos nominales canónicos y referencias a aliases antes de su
expansión. Un tipo privado no puede ocultarse tras un alias, array, callable,
retorno inferido o un nombre idéntico de otro archivo (E4401). La identidad debe
estar publicada por su módulo de origen; un reexport explícito con otro nombre
puede publicarla. Los tipos importados que ya son públicos en su origen son
válidos sin exigir reexportarlos de cada consumidor.

La comprobación no exige anotación explícita en toda variable exportada: puede
usar su tipo inferido. No persiste huellas de API ni introduce invalidación
semántica incremental. Un error mantiene el archivo y el nodo de la firma que
expone el tipo; los spans internos de anotaciones siguen limitados por el parser.

## Validación y límites de la entrega

La suite nativa construye el ejecutable C++20 obligatoriamente. Cada invocación
repite checker+seguridad y compara la salida completa; además verifica sintaxis
y binding intactos. Incluye ramas, bucles, argumentos/defaults, préstamos en la
misma línea, capturas seguras y peligrosas, aliases cíclicos, contenedores,
reexports y homónimos entre módulos. Se conservan las regresiones anteriores.

Hay contrastes con stage 0 y diferencias expresamente registradas. A las cuatro
diferencias de v62 se añaden dos casos de préstamos en una sola línea que el
checker TS directo rechaza por su granularidad de líneas y el nativo acepta
usando offsets. Los callables reasignados usan conjuntos conservadores de destinos y la
recursión consulta resúmenes; los casos opacos siguen restringidos. Permanecen
las restricciones a callbacks retenidos, owners capturados y almacenamiento de
préstamos en packs sin contrato de lifetime. Los owners se transfieren mediante move.
No se anuncia paridad general ni se cambia el checker TS para ocultar diferencias.

Los resúmenes de llamadas recursivas conservan la autorización del parámetro
prestado o receptor que origina el acceso. Reenviar un parámetro out/ref permite
seguir usando ese handle; escribir directamente en la fuente global durante el
mismo préstamo sigue rechazándose. Los packs se validan después de seleccionar
la sobrecarga: un candidato descartado no añade errores de lifetime y un tipo
callable con parámetros prestados no se confunde con almacenar un préstamo.

El CLI principal y el codegen conservan su cadena. Estos resultados semánticos
nativos todavía no se traducen a C++ del programa solicitado. No hay caché
semántica, scheduler paralelo ni certificación completa de memoria.

## Constructores y consumidores síncronos

Los campos de constructores explícitos tienen estados de inicialización unidos
por rutas. Un campo readonly sólo admite la primera escritura directa a this
antes de inicializarse; las lecturas, retornos y uso de this exigen los campos
requeridos inicializados. Los defaults y parámetros-propiedad cuentan como
inicializaciones.

Los callbacks de arrays se recorren hasta un punto fijo con préstamo temporal
del iterable. Match une las alternativas de callbacks sin ejecutarlas como una
secuencia. La ruta sin coincidencia termina en trap y no alcanza la continuación. Los valores
retornados por callbacks conservan su procedencia para comprobar escapes.


## Frames de tareas y suspensión

Promise es move-only incluso cuando su resultado es void. Await consume la tarea
sin exigir un move adicional para un identificador; un segundo await o uso se
rechaza. Crear una tarea conserva los argumentos y evalúa defaults; su cuerpo
sólo se recorre al reanudarla. Los defaults no se vuelven a evaluar entonces.
Los efectos opacos de declaraciones externas no se convierten en operaciones
puras por tener un retorno Promise.

Los parámetros ref/constRef de funciones async siguen prohibidos sin una duración
demostrada (E4204). Suspender directamente en un inicializador de campo se
rechaza hasta comprobar la duración y el orden del constructor; crear una tarea
sin reanudarla sí está permitido. Un préstamo local con usos posteriores al punto de suspensión
también produce E4204, incluidos préstamos activos de llamadores. El operando de
await se evalúa antes de suspender: un último uso dentro del operando no prolonga
artificialmente el préstamo durante la ejecución de la tarea.

Los frames son portadores de procedencia aunque devuelvan un escalar. Una
captura por referencia puede usarse en una tarea local que se completa dentro
de su ámbito; no puede escapar por retorno, spawn o almacenamiento fuera de su
bloque (E4210). El resultado de await transporta las capturas de lo devuelto,
sin heredar las de todos los argumentos almacenados en el frame. Spawn rechaza
efectos opacos y acceso a globals con ownership sin duración demostrada.

All/race y for-await combinan conservadoramente los destinos posibles. No prueban
multiplicidad exacta ni un orden arbitrario de tareas que comparten owners. Las
tareas opacas conservan obligaciones de efectos; las restricciones de captura de
owners y receptores no desaparecen al envolver una función en async. El soporte
nativo de estas reglas no conecta todavía sus tablas al codegen.

Los callbacks funcionales observan los elementos y payloads por valor o constRef;
no reciben ref mutable del elemento de arrays/Optional. El acumulador de reduce
es un valor local del consumidor. Las firmas publicadas conservan los modos de
préstamo del callback. Los argumentos ref de llamadas directas e indirectas
comprueban también los modificadores readonly de sus campos de origen.

Un efecto externo invalida préstamos de globals y de argumentos accesibles;
un objeto local de un caller que no se pasa al callee no es alcanzable sólo por
existir un préstamo. Un escape @cppgen también puede alcanzar su frame léxico.

Las capturas locales de this usan modo reference y el mismo grafo de escapes.
Se admiten llamadas locales y consumidores síncronos que no retienen el callback;
devolverlo o almacenarlo en timers produce E4210. Un método llamado a través de
un préstamo conserva ese origen autorizado; las llamadas directas al propietario
siguen respetando préstamos activos.

For-await consume el conjunto de tareas y recibe cada resultado por valor. Un
resultado con ownership puede transferirse dentro de la iteración; la siguiente
iteración inicializa un recurso nuevo, incluidas sus rutas parcialmente movidas.
El binding prestado de un resultado temporal se rechaza sin almacenamiento local.

Match presta un subject con ownership cuando sus callbacks observan por préstamo
o no reciben parámetro. Una callback que recibe ownership por valor exige
transferir el subject. Los argumentos prestados no permiten copiar el owner a
un callback; los préstamos temporales comprueban las escrituras por otros aliases.
