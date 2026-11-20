// Test de sincronización de las declaraciones `estatic:*` con las librerías
// del runtime.
//
// `types/estatic-modules.d.ts` lo copia `etsc init` a los proyectos: si
// declara una API que ya no existe, el editor engaña; si no declara una API
// nueva, el editor la marca como error aunque el compilador la acepte. Los
// bloques `declare module "estatic:*"` se generan desde `runtime/lib/`, así
// que aquí se comprueba que están al día.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const LIB_DIR = "runtime/lib";
const MODULES_DTS = "types/estatic-modules.d.ts";

function libFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { out.push(...libFiles(path)); continue; }
    if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out.sort();
}

function modules(): string[] {
  return libFiles(LIB_DIR).map(
    (file) => "estatic:" + relative(LIB_DIR, file).replace(/\.ts$/, "").replace(/\\/g, "/"),
  );
}

test("estatic-dts: las declaraciones estan al dia con runtime/lib", () => {
  const result = spawnSync(
    "node",
    ["--experimental-strip-types", "scripts/generate-estatic-modules-dts.ts", "--check"],
    { encoding: "utf-8" },
  );
  assert.equal(
    result.status,
    0,
    `${MODULES_DTS} esta desfasado:\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
  );
  assert.match(result.stdout, /al día/);
});

test("estatic-dts: cada libreria del runtime declara su modulo", () => {
  const dts = readFileSync(join(ROOT, MODULES_DTS), "utf-8");
  for (const module of modules()) {
    assert.ok(
      dts.includes('declare module "' + module + '"'),
      `${MODULES_DTS} no declara el modulo ${module}`,
    );
  }
});

test("estatic-dts: los modulos declarados corresponden a librerias que existen", () => {
  const dts = readFileSync(join(ROOT, MODULES_DTS), "utf-8");
  const declared = [...dts.matchAll(/declare module "(estatic:[^"]+)"/g)].map((match) => match[1]);
  // `estatic:compiler` es el modulo interno que todavia no existe (#292).
  const missing = declared.filter((name) => !modules().includes(name) && name != "estatic:compiler");
  assert.deepEqual(missing, []);
});

// El fichero debe ser un SCRIPT (sin import/export en la raiz): si fuera un
// modulo, TypeScript trataria sus `declare module "estatic:*"` como
// augmentaciones y `import ... from "estatic:math"` no se resolveria.
test("estatic-dts: el fichero de modulos es un script, no un modulo", () => {
  const dts = readFileSync(join(ROOT, MODULES_DTS), "utf-8");
  const root = dts.split("\n").filter((line) => line.trim() != "" && !line.trim().startsWith("//"));
  assert.ok(
    root.every((line) => !/^export\s/.test(line) && !/^import\s/.test(line)),
    `${MODULES_DTS} tiene import/export en la raiz: seria un modulo y sus declare module no resolverian`,
  );
});
