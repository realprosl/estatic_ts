# Rendimiento del análisis nativo

La comprobación de las propias fuentes del frontend superaba el límite de
600 segundos. Después de corregir las consultas y el consumo de resúmenes,
la auditoría completa termina correctamente, sin aumentar ese límite.

## Medición reproducible

```bash
npm run audit:bootstrap:self
```

Resultado medido sobre la revisión que introduce estas correcciones:

| Medida | Resultado |
|---|---:|
| Módulos | 22 |
| Símbolos | 6335 |
| Nodos con tipo publicado | 71655 |
| Diagnósticos | 0 |
| Análisis nativo, incluida carga de fuentes | 47301 ms |
| Construcción del ejecutable de auditoría | 36707 ms |

`analysisMs` y `buildMs` se miden por separado en el adaptador de auditoría.
Construir usa stage 0 y O2; el ejecutable resultante carga el proyecto y ejecuta
lexer, parser, expansión, binder, tipos, seguridad, comptime y huellas por módulo
en ETS. No se omiten pasadas ni se delega el proyecto al checker TypeScript.
El tiempo depende del equipo y de otros procesos concurrentes. Al reutilizar
un ejecutable ya construido no se vuelve a pagar `buildMs`.

## Causas y correcciones

- La consulta del receptor copiaba un `TypedFile` completo, con todas sus
  tablas semánticas, para leer una entrada. Ahora lee las entradas directamente.
- Las consultas de async, retención y proyección de raíces copiaban resúmenes
  enteros. Ahora consultan sólo los campos necesarios. Se mantienen snapshots
  donde el punto fijo modifica los conjuntos que está recorriendo.
- La comprobación de accesos recorría la cadena de llamadas también para
  préstamos pertenecientes a otra raíz. Esos préstamos se descartan antes de
  calcular su vigencia, con la misma condición de rechazo.
- Los métodos sobre un handle autorizado `out`/ref repetían su cuerpo aunque
  tenían un resumen conocido. Pueden consumirlo para receptores sin owners ni
  callbacks; los efectos opacos y otros préstamos conservan el camino preciso.
  La proyección mantiene el nodo del receptor para comprobar cada acceso.
- Una llamada desde un constructor sólo puede usar el resumen de valores si
  todos sus campos requeridos están inicializados en la ruta actual.

## Regresiones de seguridad y escala

El checker incluye una clase con 18 niveles de métodos que duplican la llamada
al nivel siguiente, utilizada a través de un parámetro `out`. Se comprueba el
programa completo dos veces, incluida determinación de salida y sintaxis/binding
intactos. Una ejecución O0 midió 775 ms para ese caso, excluida la construcción
del ejecutable. La prueba no fija un umbral estrecho dependiente del hardware.

Otros casos comprueban que el resumen sigue rechazando un acceso global por
alias oculto durante un préstamo exclusivo y una escritura mediante constRef.
Se conservan las regresiones de movimientos, inicialización, defaults, capturas,
llamadas opacas, suspensión y préstamos de parámetros.

La validación final pasa **3489/3489** pruebas de `npm test`, sin fallos,
cancelaciones ni skips. Las seis capas del frontend pasan **2162/2162**;
el checker, **1373/1373**. También pasan las 83 obligaciones de referencia,
75 contratos de sintaxis, 131 archivos del corpus de gramática y la verificación
de 216 contratos de builtins.

Este cierre corresponde al bloqueo de rendimiento. No certifica por sí solo
el inventario completo del lenguaje de [PENDING.md](../PENDING.md), ni introduce
IR o un backend.
