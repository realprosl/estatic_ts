import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cases = [
  ["local u8", "const x: i64 = 257; const y: u8 = x; return y;", "1"],
  ["local i8", "const x: u64 = 18446744073709551615; const y: i8 = x; return y;", "-1"],
  ["local u64", "const x: i64 = -1; const y: u64 = x; return y;", "18446744073709551615"],
  ["assignment", "const x: i64 = 258; let y: u8 = 0; y = x; return y;", "2"],
  ["compound", "let y: u8 = 255; y += 2; return y;", "1"],
  ["shadow", "const x: i64 = 258; let y: u8 = 0; { let y: u16 = 0; y = x; } y = x; return y;", "2"],
  ["array slot", "const x: i64 = 259; let ys: u8[] = [0]; ys[0] = x; return ys[0];", "3"],
  ["fraction", "const x: f64 = -12.75; const y: i16 = x; return y;", "-12"],
] as const;

function folded(source: string, expected: string) {
  const { ast } = compile(source);
  const result = ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  const init = result.initializer as { value?: unknown; exactInteger?: string };
  assert.equal(init.exactInteger ?? String(init.value), expected);
}

for (const [name, body, expected] of cases) {
  test(`comptime implicit: ${name}`, () => folded(`const result: string = comptime((): string => {
    ${body.replace("return y;", "return `${y}`;").replace("return ys[0];", "return `${ys[0]}`;")}
  });`, expected));
}

test("comptime implicit: parámetro raíz @comptime", () => folded(`
  @comptime function f(x: u8): u8 { return x; }
  const x: i64 = 257; const result: u8 = f(x);`, "1"));

test("comptime implicit: helper convierte parámetro y retorno", () => folded(`
  function f(x: u8): i8 { return x; }
  const result: i8 = comptime((): i8 => { const x: i64 = 511; return f(x); });`, "-1"));

test("comptime implicit: retorno de arrow", () => folded(`
  const result: u8 = comptime((): u8 => { const x: i64 = 257; return x; });`, "1"));

test("comptime implicit: retorno de arrow expresión", () => folded(`
  const x: i64 = 257; const result: u8 = comptime((): u8 => x);`, "1"));

test("comptime implicit: alias de tipos", () => folded(`
  type Byte = u8; @comptime function f(x: i64): Byte { return x; }
  const result: Byte = f(257);`, "1"));

test("comptime implicit: global convertido antes de capturarlo", () => folded(`
  const x: i64 = 257; const y: u8 = x;
  const result: u8 = comptime((): u8 => y);`, "1"));

test("comptime implicit: helper restaura tipo de retorno exterior", () => folded(`
  function f(x: u16): u16 { return x; }
  const result: u8 = comptime((): u8 => { const x: i64 = 257; f(1); return x; });`, "1"));

test("comptime implicit: parámetro de 64 bits conserva todos los dígitos", () => folded(`
  @comptime function f(x: i64): i64 { return x; }
  const x: u64 = 18446744073709551615; const result: i64 = f(x);`, "-1"));

test("comptime implicit: campo entero de objeto", () => folded(`
  interface Box { value: u8; }
  const result: string = comptime((): string => {
    const x: i64 = 259; let box: Box = { value: 0 }; box.value = x;
    return \`\${box.value}\`;
  });`, "3"));

test("comptime implicit: retorno desde bloque anidado", () => folded(`
  const result: u8 = comptime((): u8 => { const x: i64 = 257; if (true) { return x; } return 0; });`, "1"));

test("comptime implicit: rango flotante también se valida en parámetros", () => {
  assert.throws(() => compile(`@comptime function f(x: u8): u8 { return x; }
    const x: f64 = 256.0; const result: u8 = f(x);`), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.ok(error.diagnostics.some(d => d.code === "COMPTIME_INTEGER_CAST_RANGE"), error.message);
    return true;
  });
});

for (const body of [
  "const x: f64 = 256.0; const y: u8 = x; return y;",
  "const x: f64 = 256.0; let y: u8 = 0; y = x; return y;",
  "const x: f64 = 256.0; return x;",
]) {
  test(`comptime implicit: rechaza float fuera de rango (${body})`, () => {
    assert.throws(() => compile(`const result: u8 = comptime((): u8 => { ${body} });`), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(d => d.code === "COMPTIME_INTEGER_CAST_RANGE"), error.message);
      return true;
    });
  });
}

test("comptime implicit native: parámetros, variables y retornos coinciden con C++20", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-implicit-"));
  try {
    const source = `
      function narrow(x: u8): i8 { return x; }
      function runtime(x: i64): i8 { const y: u8 = x; return narrow(y); }
      const folded: i8 = comptime((): i8 => { const x: i64 = 511; const y: u8 = x; return narrow(y); });
      if (runtime(511) == folded) { print("ok"); } else { print("bad"); }
    `;
    writeFileSync(join(dir, "main.cpp"), compile(source).cpp);
    execFileSync("g++", ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-I", root, join(dir, "main.cpp"), "-o", join(dir, "main")], { timeout: 60000, stdio: "pipe" });
    assert.equal(execFileSync(join(dir, "main"), { encoding: "utf8", timeout: 10000 }), "ok\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
