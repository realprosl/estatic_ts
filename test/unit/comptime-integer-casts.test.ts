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
  ["i8", "i64", "255", "-1"], ["u8", "i64", "-1", "255"],
  ["i16", "i64", "65535", "-1"], ["u16", "i64", "65537", "1"],
  ["i32", "i64", "4294967295", "-1"], ["u32", "i64", "-1", "4294967295"],
  ["i64", "u64", "18446744073709551615", "-1"],
  ["u64", "i64", "-1", "18446744073709551615"],
  ["u8", "u64", "18446744073709551615", "255"],
  ["i32", "u64", "9007199254740993", "1"],
  ["i16", "f64", "-12.75", "-12"], ["u8", "f64", "255.99", "255"],
  ["u8", "f64", "-0.99", "0"],
  ["i64", "f64", "9007199254740994.0", "9007199254740994"],
] as const;

for (const [target, source, value, expected] of cases) {
  test(`comptime cast: ${source}(${value}) -> ${target}`, () => {
    const { ast } = compile(`const result: string = comptime((): string => {
      const x: ${source} = ${value}; const y: ${target} = ${target}(x); return \`\${y}\`;
    });`);
    const result = ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
    assert.ok(result?.kind === "VariableDeclaration");
    assert.equal((result.initializer as { value: unknown }).value, expected);
  });
}

test("comptime cast: rechaza NaN antes de convertir a entero", () => {
  assert.throws(() => compile(`const result: i32 = comptime((): i32 => {
    const x: f64 = Math.sqrt(-1); return i32(x);
  });`), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.ok(error.diagnostics.some(d => d.code === "COMPTIME_INTEGER_CAST"), error.message);
    return true;
  });
});

for (const value of ["256.0", "-1.0"]) {
  test(`comptime cast: float ${value} fuera de u8`, () => {
    assert.throws(() => compile(`const result: u8 = comptime((): u8 => {
      const x: f64 = ${value}; return u8(x);
    });`), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(d => d.code === "COMPTIME_INTEGER_CAST_RANGE"), error.message);
      return true;
    });
  });
}

test("comptime casts native: igualdad con conversiones runtime C++20", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-casts-"));
  try {
    const source = cases.map(([target, from, value], i) => `
      function cast${i}(x: ${from}): ${target} { return ${target}(x); }
      const folded${i}: ${target} = comptime((): ${target} => {
        const x: ${from} = ${value}; return ${target}(x);
      });
      if (cast${i}(${value}) == folded${i}) { print("ok"); } else { print("bad"); }
    `).join("\n");
    writeFileSync(join(dir, "main.cpp"), compile(source).cpp);
    execFileSync("g++", ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-I", root, join(dir, "main.cpp"), "-o", join(dir, "main")], { timeout: 60000, stdio: "pipe" });
    assert.equal(execFileSync(join(dir, "main"), { encoding: "utf8", timeout: 10000 }), "ok\n".repeat(cases.length));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
