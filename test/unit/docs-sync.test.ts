// Test de sincronización docs ↔ código.
//
// Ejecuta scripts/check-docs-sync.ts y verifica que pasa. Si falla, el
// test falla con el mismo mensaje que el script.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { implementedAsPendingIssues } from "../../scripts/check-docs-sync.ts";

test("docs-sync: LIMITATIONS.md coherente con el código", () => {
  const result = spawnSync(
    "node",
    ["--experimental-strip-types", "scripts/check-docs-sync.ts"],
    { encoding: "utf-8" },
  );
  // El script imprime a stdout cuando pasa, a stderr cuando falla.
  // Lo mostramos en el mensaje de error del test para que se vea claro.
  assert.equal(
    result.status,
    0,
    `check-docs-sync falló:\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
  );
  // Sanity: la salida en éxito debe contener la marca de verificación.
  assert.match(result.stdout, /✓ check-docs-sync/);
});

test("docs-sync: la regla implemented-as-pending detecta una feature ya implementada", () => {
  // `as` (shape `expr as T`) lo implementa el frontend nativo (PENDING.md T08).
  // Si vuelve a figurar como pendiente, el doc contradice al codigo.
  const issues = implementedAsPendingIssues(
    "## 🟡 Pendiente\n\n- `as` / `<T>x` type assertions — se prefiere `match` para narrowing.\n",
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.rule, "implemented-as-pending");
  assert.match(issues[0]?.symbol ?? "", /T08/);
});

test("docs-sync: la regla implemented-as-pending no dispara con alcance de stage 0", () => {
  // Un bullet que acota la limitacion a stage 0 describe el compilador de
  // bootstrap, no una feature pendiente del dialecto.
  const issues = implementedAsPendingIssues(
    "## 🟡 Pendiente\n\n- Narrowing por tipo sobre primitivos en **stage 0**: `if (typeof x == \"string\")`.\n",
  );
  assert.deepEqual(issues, []);
});

test("docs-sync: la regla implemented-as-pending no dispara con una seccion limpia", () => {
  const issues = implementedAsPendingIssues(
    "## 🟡 Pendiente\n\n- Conditional types (`T extends U ? X : Y`) en tipos.\n- Mapped types (`{ [K in keyof T]: V }`).\n",
  );
  assert.deepEqual(issues, []);
});
