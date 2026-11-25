# Caché de análisis por módulo (#344)

Con `--cache DIR` (o `incremental.cacheDirectory` en `estatic.config`), `etsc`
reutiliza entre ejecuciones el análisis de flujos por función de cada módulo,
que es la fase más cara de la seguridad de memoria.

## Qué se guarda

Hay una entrada por módulo en `DIR/flows/`. Cada entrada contiene:

- los diagnósticos que produjo el análisis de las funciones del módulo, con su
  posición (nodo) y el módulo en que aparecen;
- los módulos cuyo cuerpo se reanalizó con precisión al seguir llamadas
  (dependencias de cuerpo).

## Cuándo se reutiliza

La entrada vale si coinciden:

1. la clave semántica del módulo: identidad del compilador, contenido del
   módulo, interfaces (firmas, tipos y contratos de efectos) de lo que importa
   y cuerpos de los que exige el checker (genéricos y `comptime`);
2. las opciones de análisis;
3. el contenido y la interfaz de cada módulo cuyo cuerpo se reanalizó.

Si se cambia el cuerpo de una función sin tocar su interfaz, solo se vuelven a
analizar ese módulo y los que reprodujeron ese cuerpo. Los diagnósticos se
publican en el mismo orden que en un análisis completo.

La caché no se usa si el proyecto ya tiene errores antes de los flujos.

## Límites actuales

- Los flujos de las variables globales, los efectos, el lowering y la
  verificación de la IR siguen siendo de programa completo.
- Las llamadas que el resumen de efectos no cubre se reanalizan con precisión y
  crean una dependencia de cuerpo. Es el caso de callbacks, movimientos,
  constructores, parámetros prestados y defaults con efectos.
  `ESTATIC_FLOW_CONTRACTS=1` resume las llamadas entre módulos y `=2` resume
  todas. Son modos experimentales para medir qué falta en el contrato.

## IR completo sin cambios

Si ningún módulo cargado ha cambiado (mismo contenido, opciones y compilador),
`etsc` no analiza: reutiliza el IR verificado de la ejecución anterior para ese
punto de entrada (`DIR/ir/`). El análisis es determinista, así que el IR es
idéntico byte a byte. Solo se guarda un IR por entrada y solo si no hubo
diagnósticos.

`ESTATIC_NO_ANALYSIS_CACHE=1` desactiva la caché de flujos y la de IR (la de
sintaxis sigue activa). La usa `scripts/benchmark-analysis.py` para medir el
análisis semántico completo.
