// Build/I/O adapter only: the resulting binary opens and analyzes the project.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compileFile } from "../../src/modules/module-loader.ts";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export async function buildLoader(directory: string, entry = "bootstrap/modules/demo.ets", unity = false): Promise<string> {
  mkdirSync(directory, { recursive: true });
  // Bind persisted syntax to all stage-0/native sources used by this build.
  const hash = createHash("sha256");
  const sources = ["package.json", ...["src", "runtime", "bootstrap"].flatMap(folder =>
    readdirSync(join(root, folder), { recursive: true }).map(String)
      .filter(file => /\.(ts|ets|hpp)$/.test(file) && !/\.test\.ts$/.test(file))
      .map(file => `${folder}/${file}`))].sort();
  for (const file of sources) hash.update(file).update("\0").update(readFileSync(join(root, file))).update("\0");
  const identity = hash.digest("hex");
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
  execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions",
    `-DESTATIC_FRONTEND_ID="${identity}"`, `-I${root}`, `-I${directory}`, ...units, "-o", binary],
    { cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TMPDIR: directory } });
  return binary;
}
