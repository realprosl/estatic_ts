// Host adapter only: transpile -> compile C++ -> execute the lexer demo.
// No lexical logic is implemented in this script.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const build = join(root, "build/bootstrap/lexer");
mkdirSync(build, { recursive: true });
const cpp = join(build, "demo.cpp"), binary = join(build, process.platform === "win32" ? "demo.exe" : "demo");
execFileSync(process.execPath, ["--experimental-strip-types", join(root, "src/cli.ts"), join(root, "bootstrap/lexer/demo.ets"), "-o", cpp], { cwd: root, stdio: "inherit" });
execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, cpp, "-o", binary], { cwd: root, stdio: "inherit" });
execFileSync(binary, process.argv.slice(2), { stdio: "inherit" });
