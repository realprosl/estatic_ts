# `@include` y `@cppgen` en el backend nativo

`ets-ir-2` conserva cada anotación con `name`, `arguments` (strings ya
interpretados por el frontend), `source` y `target`. `@cppgen` se asocia a la
función mediante módulo, nodo, archivo y offset de `target`, nunca mediante su nombre.
Los places de parámetros conservan además `name`, necesario para la frontera
con C++ opaco. El resto del backend sigue usando los índices IR.

`@include("compiler/modules/platform.hpp")` en una cabecera de módulo emite
un include entre comillas antes de las declaraciones. Los includes se ordenan
y deduplican. Las rutas son relativas a las raíces de inclusión del compilador:
solo admiten letras ASCII, números, `_`, `-`, `.`, `/`, sin componentes vacíos,
`.` ni `..`. Se rechazan rutas absolutas, barras inversas, espacios, controles,
comillas y directivas embebidas antes de emitir el archivo.

El contrato nativo de `@cppgen` es deliberadamente limitado:

```typescript
@cppgen function code(text: string): string { return text; }
function greeting(name: string): string {
  code("return name + std::string(\"!\");");
  return "";
}
```

El generador debe ser una función identidad síncrona de un único string, sin
capturas ni argumentos de anotación. Solo se admiten llamadas directas como
sentencia, con un literal string. El frontend las representa como
`backendEscape`, de tipo `void` y sin resultado; el backend verifica el destino,
la firma, el cuerpo y el literal antes de emitir. No ejecuta el cuerpo generador.
No se admiten generadores que calculen strings, entradas dinámicas, referencias
a la función como valor ni escapes dentro de corutinas.

El fragmento se emite en un bloque en el punto de llamada, después de los
efectos previos. Los parámetros del llamador están disponibles por su nombre
original como referencias a sus slots IR. No se publican locales ni globales
por nombre. `return` sale del llamador y el compilador C++ comprueba el tipo de
retorno real (incluidos `boolean` y `string[]` en `platform.ets`). Los nombres y
fragmentos deben ser C++ válido.

Es una frontera explícita de código nativo, no un sandbox: al igual que los
headers, los fuentes ETS y el IR de `--from-ir` deben ser de confianza. No se
deben compilar documentos IR enviados por terceros sin revisar. La validación
estructural no puede demostrar la seguridad del C++ literal.

Los helpers existentes `normalizePath`, `compilerRoot`, `resolveImportPath`,
`pathDirectory` y `resolveProjectPath` se publican también en los contratos
runtime del backend; el cargador de módulos los necesita para self-hosting.
También se conectan `string.padStart` y `string.padEnd`, usados por el evaluador.
Las colecciones recibidas por `out` o `ref` se desreferencian antes de tomar
su dirección para una operación mutante; así el checker conserva la misma
colección y produce un IR válido al compilarse a sí mismo.
Los cálculos de metadatos, tipos y estados de flujo se guardan en temporales
antes de prestar los destinos de `push` o el receptor de `join`. No se relajan
las reglas de préstamos del verificador.

`npm run test:bootstrap:ir:annotations` verifica rutas, deduplicación, orden,
parámetros, retornos, las seis funciones reales de `platform.ets` y rechazos
controlados. `bootstrap-native-selfhost.yml` reconstruye frontend y backend
exclusivamente desde el paquete C++ (frontend con `-O1` para que el análisis
del compilador sea viable), compila los siete demos con esos binarios
y ejecuta además las pruebas de contratos usando el frontend reconstruido.
