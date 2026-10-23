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
  Se itera hasta estabilizar el estado, con un máximo de cuatro pasadas para
  este dominio finito. Se detecta el uso de un owner en una iteración posterior.
  Los literales booleanos y el cortocircuito evitan rutas evidentemente muertas.
- `move(identifier)` sólo admite `ptr<T>`/`constPtr<T>`. Consume el origen;
  se rechazan lecturas y segundos movimientos posteriores (E4102/E4103).
  Transferir un owner sin move produce E4101. Un `new C()` puede inicializar
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
- Cada préstamo local conserva raíz, principio y último uso por **offset**,
  incluidos usos de aliases. Dos usos en una misma línea no comparten por eso
  una duración artificial. Los préstamos sin usos no mantienen un intervalo vivo.
- Se rechazan intervalos solapados cuando alguno es mutable, acceso directo a
  la fuente durante un préstamo mutable y escritura/move durante uno compartido.
  Las llamadas directas conservan préstamos activos del llamador al comprobar
  accesos a globals en el callee. Una captura por valor ya creada es una copia,
  no una lectura tardía de su fuente original.
- Un cast no puede introducir o borrar un contrato de memoria. Las
  instanciaciones genéricas con esos contratos se rechazan hasta comprobar
  transferencias tras la sustitución de tipos.

`borrows` entrega `{module,symbol,root,begin,end,mode}`. Los intervalos son
metadatos conservadores, no lifetimes persistentes ni una prueba general de
aliasing. Se agrupan campos/índices bajo la raíz del lvalue. El análisis de
intervalos no es un solver NLL completo sobre CFG: puede rechazar reborrows o
rutas que un análisis más preciso demostraría disjuntas. El ownership dentro de
agregados/fields queda bloqueado explícitamente hasta modelar su copia y
movimiento por elemento. El manejo async/await sigue pendiente en el checker.

## Capturas y procedencia de escapes

Las capturas se obtienen del binding por **identidad de símbolo**, incluyendo
el callee de una llamada. Se excluyen globals verdaderos y se distinguen ámbitos
interiores, parámetros y sombras. Las capturas transitivas se transportan por
los arrows exteriores necesarios.

`captures` contiene `{module,closure,symbol,mode}`. Un lector captura por valor.
Si un arrow modifica estado capturado, todas sus capturas se clasifican por
referencia, siguiendo la política del backend actual. Se permite su uso local.
Capturar préstamos, owners o `this` sin lifetime demostrado produce E4209. La
captura de una función nombrada anidada queda pendiente de su lowering.

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
lifetimes interprocedurales generales, tareas async, todos los contenedores o
efectos indirectos. Map/Set y payloads de uniones transportan la procedencia de
callbacks; se rechaza almacenar owners o préstamos en esos agregados hasta
completar sus reglas de transferencia. La procedencia es insensible al
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
las restricciones a callbacks retenidos, owners capturados y ownership en agregados.
No se anuncia paridad general ni se cambia el checker TS para ocultar diferencias.

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
secuencia; conserva también la posibilidad de no ejecutar ninguno. Los valores
retornados por callbacks conservan su procedencia para comprobar escapes.
