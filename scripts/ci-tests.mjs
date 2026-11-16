#!/usr/bin/env node
// Decide qué tests corre el CI y los reparte en shards.
//
//   node scripts/ci-tests.mjs --full [--shards N]
//   node scripts/ci-tests.mjs --changed <fichero-con-rutas> [--shards N]
//
// Imprime en stdout líneas `clave=valor` para $GITHUB_OUTPUT:
//   matrix=<JSON con {"include":[{"shard":1,"tests":"a b"},...]}>
//   count=<nº de ficheros de test seleccionados>
//   areas=<zonas tocadas, separadas por comas>
//
// La lista completa sale del script "test" de package.json: es la fuente de
// verdad, así que un test nuevo que se añada allí entra solo en la CI completa.
// En modo --changed cada ruta tocada se traduce a los tests de su zona; las
// rutas que solo son documentación no añaden nada y las desconocidas añaden
// la lista completa (mejor de más que de menos).
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const shards = Math.max(1, Number(option("--shards") ?? 4));

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const all = pkg.scripts.test.split(/\s+/).filter((part) => /\.ts$/.test(part));
const unit = all.filter((file) => file.startsWith("test/"));

// Zona → tests. El orden importa: gana la primera regla que encaje.
const rules = [
  // Solo documentación: no corre nada.
  { area: "docs", match: /^(docs\/|.*\.md$|LICENSE|\.gitignore$|\.vscode\/)/, tests: [] },
  { area: "lexer", match: /^compiler\/lexer\//, tests: ["compiler/lexer/lexer.test.ts", "compiler/parser/parser.test.ts", "compiler/modules/loader.test.ts"] },
  { area: "parser", match: /^compiler\/parser\//, tests: ["compiler/parser/parser.test.ts", "compiler/parser/ast-schema.test.ts", "compiler/binder/binder.test.ts"] },
  { area: "binder", match: /^compiler\/binder\//, tests: ["compiler/binder/binder.test.ts", "compiler/checker/checker.test.ts"] },
  { area: "checker", match: /^compiler\/checker\//, tests: ["compiler/checker/checker.test.ts", "compiler/ir/ir.test.ts"] },
  { area: "modules", match: /^compiler\/modules\//, tests: ["compiler/modules/loader.test.ts", "compiler/install.test.ts"] },
  { area: "ir", match: /^compiler\/ir\//, tests: ["compiler/ir/ir.test.ts", "compiler/ir/readonly-verifier.test.ts", "compiler/ir/cpp.test.ts", "compiler/ir/native.test.ts"] },
  { area: "backend", match: /^compiler\/backend\//, tests: ["compiler/ir/cpp.test.ts", "compiler/ir/native.test.ts", "compiler/ir/native-annotations.test.ts"] },
  { area: "driver", match: /^compiler\/(driver|native)\//, tests: ["compiler/install.test.ts", "compiler/cli.test.ts", "compiler/native-progress.test.ts"] },
  { area: "diag", match: /^compiler\/diag\//, tests: ["compiler/diag/source.test.ts"] },
  { area: "audit", match: /^compiler\/audit\//, tests: ["compiler/audit/layers.test.ts"] },
  { area: "prelude", match: /^runtime\/prelude\//, tests: ["compiler/install.test.ts", "compiler/checker/checker.test.ts", "compiler/ir/cpp.test.ts"] },
  { area: "runtime", match: /^runtime\//, tests: ["compiler/ir/cpp.test.ts", "test/unit/runtime-backends.test.ts", "test/unit/terminal.test.ts"] },
  { area: "types", match: /^types\//, tests: ["test/unit/docs-sync.test.ts"] },
  { area: "seed", match: /^(native-cpp\/|install\.sh$|scripts\/(postinstall|build-ets-compiler|check-ets-compiler)\.sh$)/, tests: ["compiler/install.test.ts", "compiler/cli.test.ts"] },
  { area: "ci", match: /^(\.github\/|scripts\/ci-tests\.mjs$)/, tests: ["compiler/audit/layers.test.ts"] },
  { area: "examples", match: /^examples\//, tests: ["compiler/checker/checker.test.ts", "compiler/notification-project.test.ts"] },
  // src/ está de salida: sus tests son los de test/unit.
  { area: "src", match: /^src\//, tests: unit },
  // Un test tocado se corre a sí mismo (lo añade abajo).
  { area: "tests", match: /\.test\.ts$|^test\//, tests: [] },
];

let selected;
const areas = new Set();
if (args.includes("--full")) {
  selected = all;
  areas.add("completa");
} else {
  const file = option("--changed");
  if (!file) {
    console.error("Uso: ci-tests.mjs --full | --changed <fichero> [--shards N]");
    process.exit(2);
  }
  const changed = readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  const picked = new Set();
  for (const path of changed) {
    if (all.includes(path)) picked.add(path);
    const rule = rules.find((candidate) => candidate.match.test(path));
    if (!rule) {
      areas.add(`desconocida:${path}`);
      for (const test of all) picked.add(test);
      continue;
    }
    areas.add(rule.area);
    for (const test of rule.tests) picked.add(test);
  }
  selected = all.filter((test) => picked.has(test));
}

// Reparto voraz por peso: los tests que compilan C++ pesan más.
const heavy = new Map([
  ["compiler/ir/cpp.test.ts", 8],
  ["compiler/ir/native.test.ts", 6],
  ["compiler/checker/checker.test.ts", 5],
  ["compiler/install.test.ts", 5],
  ["compiler/notification-project.test.ts", 4],
  ["compiler/ir/native-annotations.test.ts", 3],
  ["compiler/cli.test.ts", 3],
  ["test/runner.ts", 4],
]);
const count = Math.min(shards, Math.max(1, selected.length));
const buckets = Array.from({ length: count }, (_, index) => ({ shard: index + 1, weight: 0, tests: [] }));
const ordered = [...selected].sort((a, b) => (heavy.get(b) ?? 1) - (heavy.get(a) ?? 1));
for (const test of ordered) {
  const lightest = buckets.reduce((best, bucket) => (bucket.weight < best.weight ? bucket : best));
  lightest.tests.push(test);
  lightest.weight += heavy.get(test) ?? 1;
}
const include = buckets
  .filter((bucket) => bucket.tests.length > 0)
  // Mantiene el orden de package.json dentro de cada shard.
  .map((bucket) => ({ shard: bucket.shard, tests: all.filter((test) => bucket.tests.includes(test)).join(" ") }));

console.log(`matrix=${JSON.stringify({ include })}`);
console.log(`count=${selected.length}`);
console.log(`areas=${[...areas].join(",")}`);
