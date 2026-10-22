# Binding nativo del proyecto (v61)

```bash
npm run bootstrap:binder -- examples/todo-project/main.ets --cache build/project-cache
npm run bootstrap:binder -- bootstrap/binder/demo.ets
npm run test:bootstrap:binder
```

Node construye el ejecutable. El ejecutable abre el proyecto con el cargador
ETS, recupera o analiza sus archivos y ejecuta `bindProject(graph)` en ETS
compilado a C++20. No se usa el binder ni el checker TypeScript para vincular
los nombres del proyecto solicitado. La demo compila nueve módulos ETS como
una unidad C++; el adaptador de módulos conserva su modo separado por defecto.

`binder.ets` contiene el binding y sus estructuras. `format.ets` serializa el
resultado de demostración. **Todavía no se infieren ni comprueban tipos**: el
[checker inicial v62](../checker/README.md) consume estas tablas y el AST sintáctico original.

## Resultado y propiedad de los datos

`bindProject(graph: ModuleGraph): BindingResult` recibe un grafo correcto y
ordenado por el cargador. Devuelve:

- `scopes`: ámbitos, su padre, archivo, nodo propietario y símbolos declarados.
- `symbols`: nombre, clase de declaración, ámbito, archivo/nodo, declaraciones
  de un grupo de sobrecargas, disponibilidad en espacios de valores/tipos,
  alias de import y módulo de un namespace.
- `files`: ámbito del módulo y tablas por ID de nodo para ámbito, declaración
  y padre sintáctico. Los nodos huérfanos de la arena que no son alcanzables
  desde Program permanecen sin ámbito; no generan usos duplicados.
- `references`: archivo/nodo/ámbito, nombre, espacio (`value`, `type`, `query`,
  `member`), símbolo local y destino original. `query` representa `typeof`:
  consulta una declaración de valor sin habilitar su uso runtime. Un miembro
  que depende de tipos se marca `deferred`, con destino todavía desconocido.
- `exports`: nombres públicos, destino y restricción type-only, sin insertar
  reexports en el ámbito local.
- `diagnostics`, con fase `binder`, archivo canónico y token de origen;
  `success` sólo es true sin diagnósticos.

Los IDs son índices locales de este resultado, **no claves persistentes de
símbolos**. Son deterministas para el mismo grafo y AST, incluso con hits de
caché, pero pueden cambiar al editar el proyecto. No deben persistirse como
identidades sin incluir su contexto/versión.

El AST no recibe símbolos, tipos, renombrados ni atributos nuevos. El binder
crea tablas separadas; se puede volver a ejecutar sobre los mismos resultados
sintácticos. La demo compara hashes de todos los SourceResult antes/después y
compara dos bindings completos. Un fallo de esa invariancia termina con código 3.
Errores de loader/lexer/parser se conservan y evitan iniciar el binding.

## Ámbitos y declaraciones

Primero se recorre cada arena alcanzable con una pila explícita y se registran
las declaraciones de todos los archivos. Después se conectan imports y exports
en el orden de dependencias, se verifican colisiones y se resuelven usos.
No se espera a inferir tipos para dar identidad a una declaración.

Hay ámbitos de builtins, módulos, funciones/métodos, arrows, clases/interfaces,
aliases/unions, bloques, bucles y switches. El cuerpo principal de una función
comparte su ámbito con los parámetros; un bloque interior puede sombrearlos.
Los casos de switch comparten ámbito. Los nombres de iteración no escapan del
bucle. Los genéricos tienen símbolos de tipo dentro de su declaración.

Los ámbitos conservan espacios de valores y tipos. Una clase está disponible
en ambos; una interfaz/alias sólo en tipos. Los parámetros, variables y
bindings de destructuring tienen identidad propia. Las variantes de union se
registran como constructores; los nombres de propiedades del payload no se
convierten en variables locales.

Las sobrecargas de funciones y métodos comparten símbolo y conservan todos
sus nodos de declaración, cada firma con su ámbito propio. No se escoge una
sobrecarga ni se comparan firmas todavía. Se detectan colisiones léxicas de
variables/parámetros/imports/miembros y visibilidad incoherente de sobrecargas
exportadas. Las reglas de duplicación por firma corresponden al checker.

Los métodos tienen receptor `this`; los arrows lo heredan léxicamente. Una
función ordinaria anidada no hereda ese receptor. Los campos/métodos de clase
no se resuelven como variables locales sin receptor. Los parámetros-propiedad
de constructor se registran también como miembros, conservando por separado
su identidad como parámetro.

Las referencias adelantadas y la recursión se vinculan. Esto **no autoriza**
leer variables antes de inicializarlas: TDZ, inicialización y flujo se comprobarán
posteriormente, usando las identidades y posiciones conservadas.

## Módulos y nombres públicos

Imports nombrados, aliases, default, namespaces y type-only se conectan con la
identidad de la declaración exportada. Un import por efecto lateral no crea
nombres locales. Archivos distintos pueden tener declaraciones homónimas sin
fusionarlas. Se diagnostican imports privados, nombres inexistentes, conflictos
locales, exports duplicados y estrellas ambiguas.

Los reexports conservan la identidad de origen; las estrellas excluyen default.
Los exports explícitos tienen precedencia sobre estrellas. Un diamante que
llega a la misma declaración no produce ambigüedad. Los namespaces se comparan
por la identidad canónica de su módulo, incluso a través de aliases distintos.
Se admiten reexports de namespaces anidados y acceso estático a sus miembros,
incluidos nombres de tipos en anotaciones.

Un namespace importado no es un objeto runtime: requiere miembro estático;
se rechazan usos desnudos, llamadas, construcción, índices computados y acceso
opcional. Un import/export type-only no recupera disponibilidad runtime al
atravesar un barrel. `typeof` puede consultar su declaración de valor original.

Los defaults anónimos/expresiones tienen identidad de export sin introducir
un nombre global artificial en el AST. Los nombres de tipos de las anotaciones
canónicas, casts, genéricos, constraints, defaults y retornos también se vinculan;
los tamaños simbólicos de arrays fijos son referencias a valores.

Las tablas iniciales de builtins son datos declarados en ETS, contrastados con
`types/estatic.d.ts`. No se consulta el host para descubrir nombres durante el
binding. Las etiquetas de objetos, miembros, argumentos nombrados y nombres de
decoradores no se confunden con variables; sus expresiones hijas sí se recorren.

## Siguiente etapa y límites

Este resultado todavía no es un AST tipado. El checker deberá resolver tipos,
inferir expresiones, seleccionar sobrecargas, validar compatibilidades, miembros,
visibilidad privada/protegida, readonly, aridad, flujo/TDZ, capturas y escapes.
Los miembros de objetos/clases ordinarios quedan explícitamente diferidos porque
necesitan conocer el tipo de su receptor. Tampoco se valida todavía la filtración
de tipos privados a través de interfaces públicas, que puede depender de inferencia.

Las anotaciones se conservan como strings canónicos del parser; los errores
sobre nombres dentro de ellas se anclan al nodo propietario, no a un span interno
que ese formato no guarda. No se ejecuta `comptime`, `@cppgen` ni `@etsgen` ni se
vinculan nombres que sólo existirán tras una expansión futura. El checker y esa
integración tendrán su propio contrato, antes de dar el proyecto por compilable.

El binding se recalcula en cada carga. Sólo se reutiliza la caché sintáctica del
cargador; no hay caché semántica del binder, huella pública ni scheduler paralelo.
Las búsquedas usan tablas lineales y no se certifica una mejora de rendimiento.

## Validación del módulo

63 pruebas con construcción C++20 obligatoria, incluyendo su propio proyecto
de nueve módulos y `todo-project`. Se comprueban identidades de declaraciones,
sombreado/capturas léxicas, ámbitos y colisiones, tipos genéricos, destructuring,
receptores, propiedades de constructor, grupos de sobrecargas y builtins.

Los casos de módulos cubren imports/defaults/type-only, privados y ausentes,
barrels, estrellas ambiguas, precedencia explícita, diamantes y namespaces
anidados. `typeof` consulta imports type-only sin acceso runtime. También se
comparan bindings completos entre procesos con la caché sintáctica caliente.

Todas las invocaciones del driver repiten el binding y verifican que los hashes
de los SourceResult no cambien. Se conservan archivo y posiciones UTF-16 con
Unicode/CRLF; los errores del cargador/parser impiden continuar al binder.

Conjunto estable: **2004/2004**, por bloques (1236 stage 0 + 64 lexer +
542 parser + 57 puente + 42 cargador + 63 binder), sin skips. No incluye
`test/runner.ts` ni E2E/libuv. CLI `--version`/`-v`: `estatic 1.23.0 (v61)`.

La demo pública de todo-project devuelve seis archivos, 51 ámbitos, 317 símbolos
y 322 referencias, sin diagnósticos. Otra ejecución desde un proceso distinto
produce exactamente el mismo binding y conserva los seis registros sintácticos
sin reescribirlos. `git diff --check` correcto.
