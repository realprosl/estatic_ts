// Host adapter: stage 0 supplies tokens; only the ETS parser runs in the binary.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Lexer } from "../../src/lexer/lexer.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const build = join(root, "build/bootstrap/parser"); mkdirSync(build, { recursive: true });
const cpp = join(build, "demo.cpp"), binary = join(build, process.platform === "win32" ? "demo.exe" : "demo");
execFileSync(process.execPath, ["--experimental-strip-types", join(root, "src/cli.ts"), join(root, "bootstrap/parser/demo.ets"), "-o", cpp], { cwd: root, stdio: "inherit" });
execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, cpp, "-o", binary], { cwd: root, stdio: "inherit" });
const source = process.argv[2];
const args = source === undefined ? [] : new Lexer(source).tokenize().flatMap(token => [token.kind, token.lexeme, ...Object.values(token.span.start).map(String), ...Object.values(token.span.end).map(String)]);
execFileSync(binary, args, { stdio: "inherit" });
