// Host I/O/build only. Lexing, template expansion and parsing run in native ETS.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.length > 2 || (args[0] === "--file" && args.length !== 2) || (args.length === 2 && args[0] !== "--file")) {
  console.error("Usage: npm run bootstrap:frontend -- [source | --file path]"); process.exit(2);
}
const file = args[0] === "--file" ? resolve(args[1]) : "<input>";
const source = args[0] === "--file" ? readFileSync(file, "utf8") : args[0];
const build = join(root, "build/bootstrap/frontend"); mkdirSync(build, { recursive: true });
const cpp = join(build, "demo.cpp"), binary = join(build, process.platform === "win32" ? "demo.exe" : "demo");
execFileSync(process.execPath, ["--experimental-strip-types", join(root, "src/cli.ts"), join(root, "bootstrap/frontend/demo.ets"), "-o", cpp], { cwd: root, stdio: "inherit" });
execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, cpp, "-o", binary], { cwd: root, stdio: "inherit" });
execFileSync(binary, source === undefined ? [] : [source, file], { stdio: "inherit" });
