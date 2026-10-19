import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

for (const [name, source] of [
  ["primitivo doble", "type Scalar = number; const xs: Scalar[][] = [[1, 2], [3]];"],
  ["primitivo triple", "type Scalar = number; const xs: Scalar[][][] = [[[1]]];"],
  ["cadena de aliases", "type Scalar = number; type Value = Scalar; const xs: Value[][] = [[1]];"],
  ["alias de vector", "type Row = number[]; const xs: Row[][] = [[[1]]];"],
  ["parametro y retorno", "type Scalar = number; function echo(xs: Scalar[][]): Scalar[][] { return xs; } const ys = echo([[1]]);"],
  ["alias generico", "type Row<T> = T[]; const xs: Row<number>[][] = [[[1]]];"],
  ["callback", "type Reader = () => number; const f: Reader = (): number => 7; const xs: Reader[][] = [[f]];"],
] as const) {
  test(`nested array aliases: ${name}`, () => assert.doesNotThrow(() => compile(source)));
}

test("nested array aliases: rechaza elemento incompatible tras expandir", () => {
  assert.throws(() => compile('type Scalar = number; const xs: Scalar[][] = [["bad"]];'), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.match(error.message, /number|string/);
    assert.doesNotMatch(error.message, /se obtuvo Scalar/);
    return true;
  });
});

test("nested array aliases: E4210 sigue protegiendo callbacks anidados", () => {
  assert.throws(() => compile(`type Reader = () => number;
    function make(): Reader[][] {
      let value: number = 0;
      const f: Reader = (): number => { value += 1; return value; };
      return [[f]];
    }`), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.ok(error.diagnostics.some(item => item.code === "CLOSURE_REFERENCE_RETURN"), error.message);
    return true;
  });
});

for (const source of ["type A = A[]; const xs: A[][] = [];", "type A = B[]; type B = A[]; const xs: A[][] = [];"]) {
  test(`nested array aliases: ciclo termina con diagnostico (${source})`, () => {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
      `import {compile} from './src/compiler.ts'; import {DiagnosticError} from './src/core/diagnostic.ts'; try { compile(${JSON.stringify(source)}); process.exit(2); } catch (error) { if (!(error instanceof DiagnosticError)) throw error; console.log(error.message); }`],
      { cwd: root, encoding: "utf8", timeout: 5000 });
    assert.equal(child.error, undefined, String(child.error));
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /ciclo|cíclic|recursiv/i);
  });
}

test("nested array aliases native: matrices y lectores devueltos funcionan", () => {
  const dir = mkdtempSync(join(tmpdir(), "ets-nested-alias-"));
  try {
    const file = join(dir, "main.cpp"); const binary = join(dir, "main");
    writeFileSync(file, compile(`type Scalar = number; type Reader = () => number;
      function make(value: number): Reader[][] { return [[(): number => value + 1]]; }
      function sum(xs: Scalar[][]): number { return xs[0][0] + xs[1][0]; }
      const matrix: Scalar[][] = [[1, 2], [3, 4]];
      print(sum(matrix));
      const readers: Reader[][] = make(7);
      const callback: Reader = readers[0][0]; print(callback()); print(callback());
    `).cpp);
    execFileSync("g++", ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-I", root, file, "-o", binary], { timeout: 60000, stdio: "pipe" });
    assert.equal(execFileSync(binary, { encoding: "utf8", timeout: 10000 }), "4\n8\n8\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
