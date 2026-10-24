# IR nativo de bootstrap

`model.ets`, `lower.ets`, `verify.ets` y `format.ets` implementan el primer
contrato ejecutable `ets-ir-1`. El lowering consume directamente el grafo,
binding y `CheckResult` de `analyzeProject`; no reconstruye semántica mediante
el checker de TypeScript. Node sólo construye y ejecuta el binario ETS mediante
el adaptador de stage 0 que ya utiliza el resto de bootstrap.

```sh
npm run bootstrap:ir -- examples/hello.ets
npm run test:bootstrap:ir
```

La salida es JSON determinista. Código de salida 0 indica lowering y verificación
correctos; 1 indica un diagnóstico; 2 indica argumentos de CLI incorrectos.
Un proyecto fallido puede contener IR parcial para diagnóstico: **ningún consumidor
debe ejecutarlo si `success` es false**.

## Contrato implementado

- Tabla propia de tipos escalares: number, boolean, string, enteros, floats y void.
- Identidades IR por índice para módulos, globals y funciones; valores y places
  por función. `symbolId`, módulo/hash, archivo, nodo y offsets conservan origen.
- Temporales de asignación única para constantes, load, operaciones, conversiones
  y llamadas. Los locales mutables y globals son places con load/store explícitos.
- Funciones síncronas libres, recursión y sobrecargas resueltas mediante
  `selected`/`selectedModules`. Llamadas directas con firmas concretas.
- Argumentos nombrados: evaluación en orden fuente y permutación posterior de
  los temporales según `argumentParameters`.
- Inicializadores por módulo; orden de dependencias, una vez por módulo.
  Los ciclos de inicialización se rechazan de forma conservadora.
- `if`, `while`, `for`, `return`, `break`, `continue`, ternarios y cortocircuito
  booleano con bloques, branch/jump/return/unreachable. Los resultados de las
  ramas se unen mediante un place interno, sin exigir SSA de memoria.
- Los i64/u64 exactos conservan texto decimal del checker, incluido el mínimo
  firmado, sin pasar por double ni crear un intermedio positivo fuera de rango.
- `print`, `write`, `printError` y `writeError` son intrínsecos explícitos con
  efecto de salida. No son instrucciones puras ni se eliminan.

`lowerProject` exige éxito y ausencia de diagnósticos en todas las fases. Comprueba
archivos, hashes de las snapshots, tamaños de las tablas consumidas, referencias
a símbolos, destinos seleccionados y aristas de AST. Las celdas de tipo de nodos
sintácticos sin valor pueden seguir vacías; sólo las operaciones bajadas requieren
tipo. No es una API de deserialización de tablas arbitrarias no confiables.

`verifyIr` se puede ejecutar independientemente. Comprueba instrucciones, tipos,
places, firmas de llamadas, destinos y terminadores; unicidad y definición de
cada temporal, uso posterior a definición y dominancia; inicialización de places
locales en todas las rutas mediante punto fijo, incluidos los backedges de bucles.
La entrada de cada función es el bloque 0. Los parámetros llegan inicializados;
los globals se rigen por el orden de inicialización del proyecto comprobado.

## Capacidades pendientes

La primera implementación cubre el núcleo escalar; no certifica que todo el
lenguaje del frontend tenga IR. Agregados, campos/índices, closures, llamadas
indirectas, instanciación genérica, argumentos omitidos/defaults, optional/rest/out,
ownership, préstamos, `using`, async, switch/match y decoradores/generación
requieren ampliar el contrato y su verificador. Las operaciones sin contrato se
rechazan con `IR_UNSUPPORTED`, incluidos externos y builtins no enumerados.
`COMPTIME_UNSUPPORTED` nunca se convierte en una constante ni en una operación
pura. Los decoradores de funciones requieren especialización/contrato y se
rechazan también cuando el checker ha podido evaluarlos.

No se generan todavía instrucciones drop/endBorrow ni se certifica limpieza de
recursos: los tipos que las necesitarían están fuera de esta capacidad. Las
obligaciones B02/M01/M05/X02 de `../PENDING.md` siguen abiertas para ampliar el IR.
No hay backend conectado a este IR. El CLI productivo de `src/` conserva su
pipeline actual. Los tests ejecutan el IR con un intérprete independiente de
pruebas para contrastar efectos, control de flujo y resultados; no constituye
un backend de producción.
