// Generate the source-only native C++ compiler snapshot from bootstrap/ via src/.
// The output is intentionally rebuildable without Node.js or TypeScript.
//
// The snapshot carries everything an installer needs to put a working native
// compiler on a machine: the C++ frontend (one unit per module, plus the
// unity amalgamation), the hand-written driver and IR backend, the runtime,
// the canonical type declarations and the project templates that `etsc init`
// writes. `install.sh` consumes this tree without Node.js.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileFile } from "../src/modules/module-loader.ts";
import { nativeTables } from "../bootstrap/build/native-tables.ts";
import { getTs2cppVersionLabel } from "../src/core/ts2cpp-version.ts";
import { initializeProject } from "../src/project/init-project.ts";

const directory = "native-cpp";
const frontend = join(directory, "frontend");
mkdirSync(frontend, { recursive: true });
const result = await compileFile("bootstrap/ir/demo.ets", { baseDirectory: process.cwd() });
writeFileSync(join(frontend, "estatic_common.hpp"), result.externalHeaders.join("\n") + "\n" + result.header);
for (const [index, module] of result.modules.entries()) {
  writeFileSync(join(frontend, `unit-${index}.cpp`), module.cpp);
}
const header = result.header.split("\n").filter(line => line.trim() !== "#pragma once").join("\n");
const bodies = result.modules.map(module => module.cpp.split("\n").filter(line => !line.includes('#include "estatic_common.hpp"')).join("\n"));
writeFileSync(join(frontend, "unity.cpp"), [header, result.externalHeaders.join("\n"), ...bodies].join("\n"));
const nativeHeaders = join(directory, "build/bootstrap/etsc");
mkdirSync(nativeHeaders, { recursive: true });
nativeTables(join(nativeHeaders, "native-tables.hpp"));
writeFileSync(join(nativeHeaders, "install_config.hpp"),
  `#define ESTC_PLATFORM "linux"\n#define ESTC_ARCH "portable"\n#define ESTC_VERSION ${JSON.stringify(getTs2cppVersionLabel().replace(/^estatic/, "etsc"))}\n`);

// Project templates. `etsc init` writes these; without them an installed
// compiler could not create a project, so they travel with the snapshot.
// They are generated in the same shape the installer publishes: the config is
// JSON (the installed compiler reads JSON, not TypeScript) and it points at
// the `.build` directories the driver uses.
const templates = join(directory, "templates");
rmSync(templates, { recursive: true, force: true });
await initializeProject(templates, { command: "etsc", native: true, compiler: "g++" });
const config = (await import(pathToFileURL(join(templates, "estatic.config.ts")).href)).default;
config.incremental.cacheDirectory = ".build/cache";
config.incremental.generatedDirectory = ".build/generated";
config.logging.file = ".build/transpiler-report.json";
writeFileSync(join(templates, "estatic.config.json"), JSON.stringify(config, null, 2) + "\n");
rmSync(join(templates, "estatic.config.ts"));
const tsconfig = JSON.parse(readFileSync(join(templates, "tsconfig.json"), "utf8"));
tsconfig.include = tsconfig.include.filter(entry => entry !== "estatic.config.ts");
tsconfig.include.push("estatic.config.json");
writeFileSync(join(templates, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");
const readme = readFileSync(join(templates, "README.md"), "utf8").replaceAll("estatic.config.ts", "estatic.config.json");
writeFileSync(join(templates, "README.md"), readme);
const ignore = readFileSync(join(templates, ".gitignore"), "utf8");
writeFileSync(join(templates, ".gitignore"), ignore.endsWith("\n") ? `${ignore}.build/\n` : `${ignore}\n.build/\n`);
console.log(`Generated ${result.modules.length} C++ frontend units in ${frontend}`);
console.log(`Generated project templates in ${templates}`);
