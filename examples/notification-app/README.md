# Notificaciones: proyecto modular para etsc

Aplicación local de prueba del compilador nativo. Simula entregas por SMS y
correo; no utiliza credenciales ni envía mensajes reales.

## Ejecutar

Con el compilador instalado desde la raíz del repositorio:

```bash
cd examples/notification-app
etsc update-types .
etsc run --verbose
```

Para construir sin ejecutar: `etsc build --verbose`. Para comprobar sin
compilar C++: `etsc --check --verbose` (incluye la validación del IR).
`--no-progress` desactiva las animaciones. Las compilaciones conservan sus
objetos y el runtime bajo `.build/`.

También se puede comprobar toda la salida esperada desde cualquier carpeta:

```bash
bash /ruta/al/estatic_ts/examples/notification-app/run.sh
```

`ETSC=/ruta/al/bin/etsc` permite seleccionar otro ejecutable para ese script.
El script prepara los tipos del editor, ejecuta el proyecto y compara su salida
con `expected.txt`, devolviendo un código distinto de cero si hay diferencias.

## Los siete módulos

| Archivo | Responsabilidad |
| --- | --- |
| `src/main.ts` | Compone los canales y mensajes, espera un temporizador y presenta resultados. |
| `src/domain/message.ts` | Clase exportada con constructor y datos de un mensaje. |
| `src/domain/channel.ts` | Interfaz común de los canales. |
| `src/channels/sms.ts` | Implementación del canal SMS. |
| `src/channels/email.ts` | Implementación del canal de correo. |
| `src/services/notifier.ts` | Recorre arrays de interfaces y mensajes, con despacho de métodos. |
| `src/shared/format.ts` | Formateador compartido por ambos canales. |

La configuración resuelve `@domain/*` y `@shared/*`. El `tsconfig.json` declara
los mismos aliases para el editor. `etsc update-types .` genera las declaraciones
canónicas de los globales en `types/estatic.d.ts`, sin mantener una copia manual.

Salida esperada:

```text
sms | Ana: Tu pedido esta listo
mail | Pedido | Ana: Tu pedido esta listo
sms | Luis: Tu cuenta esta activada
mail | Cuenta | Luis: Tu cuenta esta activada
TOTAL: 4
```

Para probar una recompilación, cambia el separador `": "` en
`src/shared/format.ts` por `" -> "` y repite `etsc run --verbose`. Cambiarán
ambos canales. Una segunda ejecución sin cambios reutiliza el objeto C++.
Restaurar el separador devuelve la salida esperada. El script `run.sh` detecta
cualquier cambio en esa salida, incluso uno intencionado.

## Regresión automatizada

Desde la raíz del repositorio:

```bash
npm run test:notification-app
```

La prueba usa una copia temporal: comprueba los siete módulos, la salida, la
reutilización de objetos/runtime, la recompilación de un módulo compartido,
el rechazo de un error de tipos y la recuperación al restaurar sus fuentes.
No modifica este proyecto.
