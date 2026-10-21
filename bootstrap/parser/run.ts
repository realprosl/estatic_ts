// Host adapter: stage 0 supplies tokens; only the ETS parser runs in the binary.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Lexer } from "../../src/lexer/lexer.ts";
import { transportTokens } from "./token-transport.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const build = join(root, "build/bootstrap/parser"); mkdirSync(build, { recursive: true });
const cpp = join(build, "demo.cpp"), binary = join(build, process.platform === "win32" ? "demo.exe" : "demo");
execFileSync(process.execPath, ["--experimental-strip-types", join(root, "src/cli.ts"), join(root, "bootstrap/parser/demo.ets"), "-o", cpp], { cwd: root, stdio: "inherit" });
execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, cpp, "-o", binary], { cwd: root, stdio: "inherit" });
const source = process.argv[2];
const args = source === undefined ? [] : transportTokens(new Lexer(source).tokenize());
execFileSync(binary, args, { stdio: "inherit" });
