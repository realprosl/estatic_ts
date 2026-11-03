// Experimental native-to-native frontend rebuild. Never imports the Stage0 compiler.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifiedFrontend } from "./build/frontend-artifact.ts";
import { buildIrCpp, nativeIr } from "./ir/cpp.ts";
import { generateCppFromIr } from "../backend/ir/cpp-generator.ts";

export function rebuildFrontend(sourceFrontend: string, entry: string, output: string, cxx = process.env.CXX ?? "g++"): void {
  const input = verifiedFrontend(sourceFrontend);
  const source = resolve(entry);
  const target = resolve(output);
  if (input === target) throw new Error("La salida no puede sobrescribir el frontend de entrada");
  const ir = nativeIr(input, source, ["--trace"]);
  const result = generateCppFromIr(ir);
  const cpp = target + ".cpp";
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(cpp, result.cpp);
  buildIrCpp(result, cpp, target, cxx);
  const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  writeFileSync(target + ".provenance.json", JSON.stringify({
    format: "estc-native-rebuild-1",
    source,
    inputFrontendSha256: sha256(input),
    outputFrontendSha256: sha256(target),
    compiler: cxx,
  }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [frontend, entry, output, cxx] = process.argv.slice(2);
  if (!frontend || !entry || !output) {
    console.error("Uso: rebuild-frontend.ts <frontend-nativo> <fuente.ets> <salida> [cxx]");
    process.exitCode = 2;
  } else {
    try { rebuildFrontend(frontend, entry, output, cxx); }
    catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  }
}
