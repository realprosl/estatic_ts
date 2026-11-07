# Proyecto Estatic

Compila el proyecto desde este directorio:

```bash
etsc build
etsc run
```

El driver instalado utiliza el frontend y el runtime preparados por install.sh.

## Soporte del editor

El proyecto incluye:

- `tsconfig.json` — configura el editor (VSCode/Neovim) para usar
  `moduleResolution: "bundler"` y, sobre todo, `"lib": ["es2022"]` y
  `"types": []`. Eso evita que tsserver añada APIs de DOM o de Node
  (`Buffer`, `__dirname`, etc.) que el dialecto no implementa.
- `types/estatic.d.ts` — declaraciones de los built-ins del dialecto
  (modificadores de memoria V22 `ptr<T>`, `constPtr<T>`, `ref<T>`,
  `constRef<T>`; `readonly<T>`; envoltorios `Optional<T>`, `Result`,
  `Promise`, `Map`, `Set`; handles `Timer`, `FsWatcher`, red/TLS y
  cancelación; `fs.*Sync`, `path.*`, `process.*`, `JSON`, `Console`
  y `console`; transferidor `move<T>(x: ptr<T>)`) y los helpers
  del runtime (`print`, `numberToString`, helpers de Optional/JsonValue).
  `declare global` los expone sin imports.

Para refrescar las declaraciones después de actualizar el compilador:

```bash
etsc update-types .
```

Si el archivo cambió, el comando conserva antes
`types/estatic.d.ts.bak`.

Si tu editor sigue marcando errores sobre tipos del dialecto, abre la
paleta de comandos y elige "TypeScript: Restart TS Server".
