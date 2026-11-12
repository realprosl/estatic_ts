# Evaluación comptime del frontend nativo

El checker valida tipos, efectos y seguridad antes de evaluar constantes. El
intérprete `comptime.ets` consume el AST expandido y su binding; `constant.ets`
implementa los valores y operaciones numéricas. El driver no delega esta fase
al evaluador TypeScript. Esto no conecta todavía las tablas al backend.

## Entradas y resultados

`comptime(callback)` exige un callable sin parámetros con resultado materializable.
Las funciones síncronas declaradas con `@comptime` se evalúan cuando sus entradas
están disponibles. Sólo `COMPTIME_VALUE_UNAVAILABLE` permite diferir una llamada
anotada; los errores del cuerpo mantienen su diagnóstico. Las llamadas dentro
de otra evaluación esperan a disponer de su entorno de invocación.

Las tablas `files[m].constantStates`, `constantValues` y `constantCodes` están
indexadas por nodo original. El estado es vacío, `evaluated`, `deferred` o `error`.
Los valores son strings JSON tipados: `{"type":"number","value":3}` o
`{"type":"u64","exactInteger":"18446744073709551615"}`. Arrays, objetos,
Optional y Result contienen entradas tipadas, con clase y tag cuando corresponde.
Los códigos estructurados no dependen del texto humano del diagnóstico.

## Semántica implementada

Se mantienen ámbitos léxicos, TDZ, cierres y recursión mediante identidades del
binder, también a través de imports y namespaces. Hay bloques, condicionales,
switch con fallthrough, bucles y señales de return/break/continue. Las llamadas
conservan orden fuente, defaults, correspondencia de argumentos nombrados,
rest/spread y la firma seleccionada. Arrays y objetos se copian como valores.
Los destinos tipados aplican conversiones recursivas, incluidos callbacks de
arrays. Las asignaciones resuelven su destino una sola vez antes del RHS.

Los enteros hasta 64 bits usan bits exactos y serialización decimal, sin un
double intermedio. Se comprueban overflow signed, división por cero y shifts;
unsigned aplica wrap. Los casts intrínsecos i8/u8/i16/u16/i32/u32/i64/u64/f32/f64
son llamadas directas. f32 redondea operaciones y destinos; la conversión desde
entero se hace directamente a f32 para evitar doble redondeo. No se materializan
flotantes no finitos. Las operaciones Math admitidas son deterministas; I/O,
suspensión y aleatoriedad en una evaluación estricta se rechazan.

## Límites explícitos

Cada raíz dispone de 10.000 pasos, profundidad de llamada 100 y 1 MiB de valores
lógicos acumulados. Helpers y callbacks comparten el presupuesto de su raíz;
raíces independientes lo reinician. No es una medición del heap vivo.
Las strings del runtime nativo operan en bytes UTF-8, por lo que longitud e
índices Unicode pueden diferir del evaluador JavaScript de stage 0.

Las capturas de valores runtime se invalidan conservadoramente ante escrituras,
movimientos o efectos previos que impidan demostrar su valor; no se interpreta
todo el prefijo runtime para reconstruir snapshots. La comprobación de fuentes
sigue activa incluso cuando la evaluación podría borrar una rama.

Se materializan clases por valor, constructores explícitos y por composición,
campos/defaults, métodos con this, enums y variantes de uniones. Match evalúa el
sujeto una vez e invoca sólo el caso elegido. Optional admite métodos y helpers,
incluido optionalOrElse con un Optional alternativo. Los parámetros out aliasan
la celda mutable del argumento; no se convierten en copias locales.

Los efectos externos, I/O, tareas async y escapes @cppgen se rechazan durante
la evaluación estricta. Los contratos de memoria que el intérprete no puede
materializar, los métodos sin implementación de evaluación y la aritmética
entera exponencial mantienen diagnósticos explícitos de cobertura. La expansión
@etsgen usa este mismo intérprete y vuelve a pasar su salida por lexer, parser,
binder y checker; no ejecuta un evaluador TypeScript ni genera C++.

## Decoradores

La tabla `decorators` conserva módulo, nodo, objetivo, nombre y argumentos.
Se reconocen `@comptime`, `@deprecated` con mensaje string opcional, `@sealed`
en clases, include/link de cabecera, @etsgen, @cppgen y metadatos ABI
cpp_name/cpp_type/cpp_drogon con sus objetivos y argumentos comprobados. Se comprueban
aridad, objetivo y duplicados no repetibles; los desconocidos se rechazan.
Estos metadatos no prueban emisión, warnings runtime ni integración ABI/backend.

El audit verifica valores materializados y destinos originales de decoradores.
La revisión reproducible de 2026-10-24 vuelve a pasar sus 83 muestras; las
99 regresiones del checkpoint de comptime son una cifra histórica, no el tamaño
actual de esta suite. Véanse [FRONTEND-REVIEW.md](../audit/FRONTEND-REVIEW.md) y el
[inventario vigente](../PENDING.md), que conserva X02 abierto por cobertura de
contratos de memoria durante evaluación. Por ejemplo, una función que recibe
`constRef<number>` es válida fuera de comptime, pero invocarla desde una raíz
comptime produce `COMPTIME_UNSUPPORTED`; no se cuenta como evaluación soportada.
