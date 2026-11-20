// Build/I/O adapter only: the resulting binary opens and analyzes the project.
//
// El frontend se puede construir de dos maneras:
//   - Con el compilador nativo (la semilla): es el camino de produccion y el
//     unico que sabe resolver los imports `estatic:*`.
//   - Con stage 0 (`src/`): el bootstrap. No compila las librerias del
//     runtime, asi que solo sirve mientras `compiler/` no las importe.
// La variable ESTATIC_SEED dice donde esta el compilador nativo; si no esta
// (o no existe), se usa stage 0.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compileFile } from "../../src/modules/module-loader.ts";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// La semilla: el compilador nativo que construye el frontend.
function seedCompiler(): string {
  const seed = process.env.ESTATIC_SEED ?? "";
  if (seed == "") return "";
  if (!existsSync(seed)) throw new Error("ESTATIC_SEED no existe: " + seed);
  return seed;
}

// Construye el frontend con el compilador nativo: el analiza y emite el IR,
// y el mismo lo convierte en C++ y lo construye (el camino de produccion).
function buildWithSeed(directory: string, entry: string, unity: boolean, optimization: string, detail: (text: string) => void): string {
  const seed = seedCompiler();
  const ir = join(directory, "frontend.ir.json");
  const binary = join(directory, "modules-demo");
  detail(`Frontend · analizar con el compilador nativo: ${entry}`);
  execFileSync(seed, [join(root, entry), "--check", "--emit-ir", ir, "--no-progress"],
    { cwd: root, encoding: "utf8", timeout: 3600000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ESTC_ROOT: root } });
  detail(`Frontend · emitir C++ y construir con el compilador nativo`);
  const args = ["--from-ir", ir, "-o", join(directory, "app.cpp"), "--binary", binary, "--build", "--no-progress"];
  if (unity) args.push("--unity");
  args.push("--cxx-flag", optimization);
  execFileSync(seed, args,
    { cwd: root, encoding: "utf8", timeout: 3600000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ESTC_ROOT: root } });
  return binary;
}

export async function buildLoader(directory: string, entry = "compiler/modules/demo.ts", unity = false, optimization: "-O0" | "-O2" = "-O0", detail: (text:string)=>void = ()=>{}): Promise<string> {
  mkdirSync(directory, { recursive: true });
  // Bind persisted syntax to all stage-0/native sources used by this build.
  const hash = createHash("sha256");
  const sources = ["package.json", ...["src", "runtime", "compiler"].flatMap(folder =>
    readdirSync(join(root, folder), { recursive: true }).map(String)
      .filter(file => /\.(ts|ets|hpp)$/.test(file) && !/\.test\.ts$/.test(file))
      .map(file => `${folder}/${file}`))].sort();
  for (const file of sources) hash.update(file).update("\0").update(readFileSync(join(root, file))).update("\0");
  const identity = hash.digest("hex");
  if (seedCompiler() != "") return buildWithSeed(directory, entry, unity, optimization, detail);
  detail(`Transpilando frontend: ${entry}`);
  const result = await compileFile(join(root, entry), { baseDirectory: root });
  const includes = result.externalHeaders.join("\n");
  writeFileSync(join(directory, "estatic_common.hpp"), includes + "\n" + result.header);
  let units = result.modules.map((module, index) => {
    const file = join(directory, `unit-${index}.cpp`); writeFileSync(file, module.cpp); return file;
  });
  if (unity) {
    const file = join(directory, "unity.cpp");
    const header = result.header.split("\n").filter(line => line.trim() !== "#pragma once").join("\n");
    const bodies = result.modules.map(module => module.cpp.split("\n").filter(line => !line.includes('#include "estatic_common.hpp"')).join("\n"));
    writeFileSync(file, [header, includes, ...bodies].join("\n")); units = [file];
  }
  const binary = join(directory, "modules-demo");
  const compiler = process.env.CXX ?? "g++";
  const args = ["-std=c++20", optimization, "-pthread", "-fno-exceptions",
    `-DESTATIC_FRONTEND_ID="${identity}"`, `-I${root}`, `-I${directory}`, ...units, "-o", binary];
  detail(`Compilando frontend: ${JSON.stringify([compiler,...args])}`);
  execFileSync(compiler, args,
    { cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TMPDIR: directory } });
  return binary;
}
