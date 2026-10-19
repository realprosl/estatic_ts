import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function source(type: string, expression: string, a: number, b: number) {
  return `@comptime function calc(a: ${type}, b: ${type}): ${type} { return ${expression}; }
    const result: ${type} = calc(${a}, ${b});`;
}

for (const [type, expression, a, b, expected] of [
  ["i64", "a << b", 1, 40, 1099511627776],
  ["i64", "a + b << b", 1, 2, 12],
  ["i64", "a << b + b", 1, 2, 16],
  ["i64", "a >> b", 1099511627776, 40, 1],
  ["i64", "(-a) >> b", 1099511627776, 40, -1],
  ["i64", "a & b", 1099511627777, 1099511627776, 1099511627776],
  ["i64", "a | b", 1099511627776, 1, 1099511627777],
  ["i64", "a ^ b", 1099511627777, 1, 1099511627776],
  ["i64", "a / b", 7, 2, 3],
  ["i64", "a / b", -7, 2, -3],
  ["i64", "~a", 1099511627776, 0, -1099511627777],
  ["u64", "a * b", 4294967296, 4294967296, 0],
] as const) {
  test(`comptime integer64: ${type} ${expression} (${a}, ${b})`, () => {
    const { ast } = compile(source(type, expression, a, b));
    const result = ast.statements.find(stmt => stmt.kind === "VariableDeclaration" && stmt.name === "result");
    assert.ok(result?.kind === "VariableDeclaration");
    assert.equal((result.initializer as { value?: unknown }).value, expected);
  });
}

for (const [expression, a, b, code] of [
  ["a * b", 4503599627370496, 4096, "COMPTIME_INTEGER_OVERFLOW"],
  ["a << b", 1, 64, "COMPTIME_INTEGER_SHIFT"],
  ["a << b", 1, -1, "COMPTIME_INTEGER_SHIFT"],
  ["a / b", 7, 0, "COMPTIME_INTEGER_DIVISION_ZERO"],
] as const) {
  test(`comptime integer64: diagnostico ${code} para ${expression} (${a}, ${b})`, () => {
    assert.throws(() => compile(source("i64", expression, a, b)), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(item => item.code === code), error.message);
      return true;
    });
  });
}

test("comptime integer64: resultado mayor que 53 bits ahora se conserva", () => {
  const { ast } = compile(source("i64", "a + b", 9007199254740991, 2));
  const result = ast.statements.find(stmt => stmt.kind === "VariableDeclaration" && stmt.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  assert.equal((result.initializer as { exactInteger?: string }).exactInteger, "9007199254740993");
});

test("comptime integer64: <<= conserva el tipo de destino", () => {
  const { ast } = compile(`const result: i64 = comptime((): i64 => {
    let value: i64 = 1;
    value <<= 40;
    return value;
  });`);
  const result = ast.statements.find(stmt => stmt.kind === "VariableDeclaration" && stmt.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value?: unknown }).value, 1099511627776);
});

test("comptime integer64: number conserva division flotante", () => {
  const { ast } = compile("const result: number = comptime((): number => 7 / 2);");
  const result = ast.statements.find(stmt => stmt.kind === "VariableDeclaration" && stmt.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value?: unknown }).value, 3.5);
});

test("comptime integer64: argumentos runtime siguen aplazando la llamada", () => {
  const { ast } = compile(`@comptime function divide(a: i64, b: i64): i64 { return a / b; }
    function live(n: i64): i64 { return divide(n, 2); }`);
  const live = ast.statements.find(stmt => stmt.kind === "FunctionDeclaration" && stmt.name === "live");
  assert.ok(live?.kind === "FunctionDeclaration");
  const returned = live.body.statements[0];
  assert.ok(returned.kind === "ReturnStatement" && returned.value?.kind === "CallExpression");
  assert.equal(returned.value.callee, "divide");
});

test("comptime integer64 native: desplazamiento y division coinciden con C++", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-comptime-i64-"));
  try {
    const file = join(dir, "main.cpp"); const binary = join(dir, "main");
    writeFileSync(file, compile(`
      @comptime function staticShift(a: i64, b: i64): i64 { return a << b; }
      function liveShift(a: i64, b: i64): i64 { return a << b; }
      @comptime function staticDivide(a: i64, b: i64): i64 { return a / b; }
      function liveDivide(a: i64, b: i64): i64 { return a / b; }
      const foldedShift: i64 = staticShift(1, 40);
      const expectedShift: i64 = 1099511627776;
      if (foldedShift == liveShift(1, 40)) { print("shift"); } else { print("bad"); }
      if (foldedShift == expectedShift) { print("exact"); } else { print("bad"); }
      const foldedDivide: i64 = staticDivide(-7, 2); print(foldedDivide); print(liveDivide(-7, 2));
    `).cpp);
    execFileSync("g++", ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-I", root, file, "-o", binary], { timeout: 60000, stdio: "pipe" });
    assert.equal(execFileSync(binary, { encoding: "utf8", timeout: 10000 }), "shift\nexact\n-3\n-3\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
