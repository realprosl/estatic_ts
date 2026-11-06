// Generate the source-only native C++ compiler snapshot from bootstrap/ via src/.
// The output is intentionally rebuildable without Node.js or TypeScript.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileFile } from "../src/modules/module-loader.ts";
import { nativeTables } from "../bootstrap/build/native-tables.ts";
import { getTs2cppVersionLabel } from "../src/core/ts2cpp-version.ts";

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
console.log(`Generated ${result.modules.length} C++ frontend units in ${frontend}`);
