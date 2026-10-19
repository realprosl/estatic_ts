import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function folded(source: string, expected: string) {
  const { ast } = compile(source);
  const result = ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value: unknown }).value, expected);
}

for (const [name, body, expected] of [
  ["vector", "const x: i64 = 257; const ys: u8[] = [x]; return `${ys[0]}/${x}`;", "1/257"],
  ["fixed", "const x: i64 = 257; const ys: u8[2] = [x, x]; return `${ys[0]}/${ys[1]}`;", "1/1"],
  ["tuple", "const x: i64 = 65535; const ys: [u8,i16] = [x, x]; return `${ys[0]}/${ys[1]}`;", "255/-1"],
  ["signed64", "const x: u64 = 18446744073709551615; const ys: i64[] = [x]; return `${ys[0]}`;", "-1"],
  ["float", "const x: f64 = -12.75; const ys: i16[] = [x]; return `${ys[0]}`;", "-12"],
  ["nested", "const x: i64 = 257; const ys: u8[][] = [[x],[x]]; return `${ys.length}/${ys[0].length}/${ys[0][0]}`;", "2/1/1"],
  ["nested preserve", "const xs: i64[] = [1,2]; const ys: i64[][] = [xs]; return `${ys.length}/${ys[0][1]}`;", "1/2"],
  ["spread", "const xs: u8[] = [1,2]; const ys: u8[] = [...xs,3]; return `${ys.length}/${ys[2]}`;", "3/3"],
  ["spread nested", "const xs: i64[][] = [[1,2]]; const ys: i64[][] = [...xs]; return `${ys.length}/${ys[0][1]}`;", "1/2"],
] as const) {
  test(`comptime aggregate: ${name}`, () => folded(`const result: string = comptime((): string => { ${body} });`, expected));
}

test("comptime aggregate: interface y shorthand conservan fuente", () => folded(`
  interface Box { value: u8; }
  const result: string = comptime((): string => {
    const value: i64 = 257; const box: Box = {value}; return \`\${box.value}/\${value}\`;
  });`, "1/257"));

test("comptime aggregate: array de interfaces", () => folded(`
  interface Box { value: u8; }
  const result: string = comptime((): string => {
    const value: i64 = 257; const boxes: Box[] = [{value}]; return \`\${boxes[0].value}\`;
  });`, "1"));

test("comptime aggregate: campo de tipo alias", () => folded(`
  type Byte = u8; interface Box { value: Byte; }
  const result: string = comptime((): string => {
    const value: i64 = 257; const box: Box = {value}; return \`\${box.value}\`;
  });`, "1"));

test("comptime aggregate: campo array dentro de interface", () => folded(`
  interface Box { values: u8[]; }
  const result: string = comptime((): string => {
    const value: i64 = 257; const box: Box = {values:[value]}; return \`\${box.values[0]}\`;
  });`, "1"));

test("comptime aggregate: global objeto convertido antes de captura", () => folded(`
  interface Box { value: u8; } const x: i64 = 257; const box: Box = {value:x};
  const result: string = comptime((): string => \`\${box.value}\`);`, "1"));

test("comptime aggregate: argumento literal array se convierte antes del helper", () => folded(`
  function read(xs: u8[]): string { return \`\${xs[0]}\`; }
  const result: string = comptime((): string => { const x: i64 = 257; return read([x]); });`, "1"));

test("comptime aggregate: argumento literal objeto se convierte antes del helper", () => folded(`
  interface Box { value: u8; } function read(box: Box): string { return \`\${box.value}\`; }
  const result: string = comptime((): string => { const x: i64 = 257; return read({value:x}); });`, "1"));

test("comptime aggregate: retorno literal array", () => folded(`
  function values(x: i64): u8[] { return [x]; }
  const result: string = comptime((): string => { const ys: u8[] = values(257); return \`\${ys[0]}\`; });`, "1"));

test("comptime aggregate: global array convertido antes de captura", () => folded(`
  const x: i64 = 257; const ys: u8[] = [x];
  const result: string = comptime((): string => \`\${ys[0]}\`);`, "1"));

for (const declaration of ["const ys: u8[] = [x];", "const ys: u8[1] = [x];", "const ys: [u8] = [x];", "const box: Box = {value:x};"]) {
  test(`comptime aggregate: rechaza float fuera de rango en ${declaration}`, () => {
    assert.throws(() => compile(`interface Box { value: u8; }
      const result: string = comptime((): string => { const x: f64 = 256.0; ${declaration} return "bad"; });`), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(d => d.code === "COMPTIME_INTEGER_CAST_RANGE"), error.message);
      return true;
    });
  });
}

test("comptime aggregate native: arrays y nesting coinciden con C++20", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-aggregate-"));
  try {
    const source = `
      function calc(x: i64): string {
        const ys: u8[] = [x]; const matrix: u8[][] = [[x]]; const pair: [u8,i16] = [x,x];
        return \`\${ys[0]}/\${matrix[0][0]}/\${matrix[0].length}/\${pair[0]}/\${pair[1]}\`;
      }
      const folded: string = comptime((): string => calc(257));
      if (calc(257) == folded) { print(folded); } else { print("bad"); }
    `;
    writeFileSync(join(dir, "main.cpp"), compile(source).cpp);
    execFileSync("g++", ["-std=c++20", "-Werror=narrowing", "-O2", "-pthread", "-fno-exceptions", "-I", root, join(dir, "main.cpp"), "-o", join(dir, "main")], { timeout: 60000, stdio: "pipe" });
    assert.equal(execFileSync(join(dir, "main"), { encoding: "utf8", timeout: 10000 }), "1/1/1/1/257\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
