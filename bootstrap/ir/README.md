# IR nativo de bootstrap

El contrato `ets-ir-2` se implementa en ETS dentro de este directorio. Consume
el grafo de módulos, binding y `CheckResult` de `analyzeProject`. El proceso
nativo comprueba y baja el fuente; Node sólo adapta construcción y E/S.

```sh
npm run bootstrap:ir -- examples/hello.ets
npm run test:bootstrap:ir
node --experimental-strip-types bootstrap/ir/audit.ts
```

La salida JSON es determinista. El código de salida es 0 para un proyecto
verificado, 1 para diagnósticos y 2 para argumentos incorrectos. Un proyecto
fallido puede contener IR parcial: **un consumidor debe exigir `success: true`**.
El backend C++20 de `src/codegen/ir/` consume este formato y reutiliza el
runtime del compilador existente. El [CLI general](../CLI.md) conecta todas las etapas;
la entrada de backend sigue disponible en `bootstrap/ir/cpp.ts`;
el CLI histórico de `src/` conserva su pipeline. Véase
[CPP.md](./CPP.md) para cobertura, capacidades rechazadas y validación.

## Modelo

| Tabla | Contenido |
|---|---|
| `types`, `typeDefinitions` | Tipos lógicos por ID; argumentos, campos, variantes y propiedad de recursos |
| `modules`, `globals` | Identidad persistente, inicialización y finalización por módulo |
| `functions` | Instancias concretas, parámetros, capturas, valores, places y bloques |
| `runtimeContracts` | Firma, efectos conservadores y capacidad requerida del runtime |
| `effectContracts` | Lecturas, escrituras, moves, invocaciones, retención y obligaciones callback del frontend |
| `annotations` | Decoradores comprobados y sus argumentos, asociados al origen |

Los valores temporales tienen una sola definición. Las variables mutables son
places explícitos: local, global, capture, field, index, deref y checkedView.
Las instrucciones usan IDs propios; `symbolId` conserva la identidad persistente
del frontend. Las cadenas canónicas de `types` sirven también para diagnóstico;
un backend consume las shapes, sin volver a resolver símbolos del AST.

Los tipos numéricos **no se reducen a number**: i8/u8/i16/u16/i32/u32/i64/u64,
f32/f64 y number conservan anchura y signo. Las promociones aritméticas y las
conversiones se materializan; i64/u64 mantienen texto exacto sin pasar por double.
El layout, la alineación y el ABI pertenecen al backend.

## Lowering implementado

- Constantes escalares y agregadas, aritmética, casts, enums, templates y `typeof`
  estático sin evaluar el operando; constantes comprobadas y `comptime` se
  materializan desde el evaluador nativo, sin interpretar JSON.
- Arrays, arrays fijos, tuplas, packs, registros, clases por valor, campos,
  constructores, parameter properties, métodos y campos estáticos inicializados.
- Funciones y recursión; especialización genérica, sobrecargas, argumentos
  nombrados, defaults, parámetros opcionales/rest y llamadas indirectas.
  Los argumentos reales y los destinos indexados se evalúan una vez en orden fuente.
  Los defaults de funciones, constructores y campos usan la sustitución concreta
  de su declaración. Los campos callable (también estáticos y opcionales) producen
  llamadas indirectas, sin fabricar contratos de runtime.
- Closures con entorno tipado y capturas por valor o referencia; la identidad
  de cada captura y su modo de transporte quedan explícitos.
- `if`, bucles, switch con fallthrough, break/continue, ternarios y cortocircuito;
  for-of/for-in mediante cursores tipados. Destructuring y sus defaults.
- Optional, coalescencia y acceso opcional con ramas que evitan evaluar argumentos
  del camino ausente; variantes de unión, discriminadores y `match` con callbacks
  evaluados únicamente en la rama seleccionada.
- Ownership exclusivo, moves de places/proyecciones, préstamos, fin de préstamo
  por liveness del CFG y limpieza de recursos en salidas normales y tempranas.
- Funciones async como tareas diferidas; suspensión, reanudación, cancelación,
  frame lógico y limpieza del frame; for-await consume tareas del cursor.
- Inicializadores según dependencias y finalizadores en orden inverso. Los ciclos
  de inicialización de módulos se rechazan de forma conservadora.
- Builtins y métodos de runtime con contratos explícitos. `@cppgen` conserva un
  `backendEscape` con generador tipado y requiere capacidad específica de C++.
  Un backend debe rechazar las capacidades que no implemente.

## Recursos y préstamos

`load` copia un valor y está prohibido para tipos con recursos. `move` transfiere
el valor; `own` crea un owner. `store` reemplaza el contenido del destino,
destruyendo primero sus subobjetos vivos y transfiriendo después el operando. `dropRemaining` destruye, en orden inverso de
construcción, los subobjetos que siguen vivos. Requiere flags de inicialización
lógicos: después de un move parcial sólo destruye los campos restantes. No llama
a un método `dispose` por convención. `using` sigue el ownership del lenguaje.

Cada borrow/address define una lease. `endBorrow` es idempotente y condicionado
a que esa lease esté activa: permite cerrar las rutas que nunca la adquirieron.
El análisis divide aristas cuando las ramas requieren finales distintos. Ningún
préstamo del fuente puede quedar activo al suspender o abandonar la función.

Las tareas son recursos diferidos; `taskCreate` conserva argumentos, `suspend`
consume la tarea y separa las continuaciones normal/cancelada, `resume` obtiene
su resultado y `dropFrame` destruye valores/places vivos al cancelar. Las tablas
del frame son lógicas; el backend decide su representación física.

## Verificación y límites

`verifyIr` comprueba tablas, shapes, promociones, firmas, proyecciones, destinos,
definiciones y dominancia, inicialización por punto fijo, rutas de ownership y
duración de préstamos. Valida referencias y aridades antes de indexar las tablas,
recalcula la propiedad estructural de recurso y comprueba capturas, leases,
frames completos, reanudación única y orden inverso de finalización. En una unión
del CFG, un préstamo sólo está disponible si continúa activo en todas las rutas;
la unión de préstamos posibles se conserva para detectar conflictos y salidas. Comprueba también que existan las aristas de los contratos
de efectos. Estos resúmenes son conservadores: no autorizan eliminar llamadas ni
sustituyen la comprobación de capacidades y callbacks de un backend.

La entrada exige un análisis nativo exitoso de una misma carga; valida hashes,
identidades y tablas. No es un deserializador para datos arbitrarios hostiles.
El narrowing conserva una vista comprobada del frontend: este verificador no
repite el análisis completo de patrones ni el sistema de tipos del fuente.

Los campos estáticos necesitan inicializador explícito. Los casos sin contrato
se rechazan mediante `IR_UNSUPPORTED`; un éxito del frontend por sí solo no
certifica cobertura universal del lenguaje ni la ejecución de un backend.
`COMPTIME_UNSUPPORTED` sigue siendo un diagnóstico, nunca una constante ficticia.
Las restricciones de memoria en comptime de X02 siguen perteneciendo al frontend.

Las pruebas compilan el lowering y verificador nativos, comprueban determinismo,
ejecutan resultados con un oráculo independiente y corrompen contratos para
comprobar rechazos. Ese oráculo es infraestructura de pruebas, no un runtime
productivo. La auditoría del corpus valida lowering/verificación, sin ejecutar
servidores, red ni los programas de ejemplo.

La evidencia de la ejecución final se recoge en [VALIDATION.md](./VALIDATION.md).

## Dispatch estructural

Las shapes de interfaces/intersecciones publican `methods` y `methodTypes`.
`variants` enumera los tipos concretos efectivamente convertidos a la interfaz.
La tabla `dispatches` enlaza interfaz, concreto, nombre y firma con un callee IR;
`interfaceCall` toma el receptor prestado y los argumentos ordenados. El
verificador exige cobertura para cada alternativa y comprueba firmas/destinos.
Los métodos genéricos tienen entradas especializadas por firma de llamada.
La representación física de estos valores continúa siendo decisión del backend.
