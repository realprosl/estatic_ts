import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function exact(source: string, expected: string) {
  const { ast } = compile(source);
  const result = ast.statements.find(stmt => stmt.kind === "VariableDeclaration" && stmt.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  assert.equal((result.initializer as { exactInteger?: string }).exactInteger, expected);
  assert.doesNotThrow(() => JSON.stringify(ast));
}

for (const [type, literal, expected] of [
  ["i64", "9007199254740993", "9007199254740993"],
  ["i64", "9223372036854775807", "9223372036854775807"],
  ["i64", "-9223372036854775808", "-9223372036854775808"],
  ["u64", "18446744073709551615", "18446744073709551615"],
  ["u64", "0xffff_ffff_ffff_ffff", "18446744073709551615"],
  ["u64", "0b1111111111111111111111111111111111111111111111111111111111111111", "18446744073709551615"],
] as const) {
  test(`comptime exact64: literal ${type} ${literal}`, () => {
    exact(`const result: ${type} = comptime((): ${type} => ${literal});`, expected);
  });
}

for (const [type, expression, a, b, expected] of [
  ["i64", "a + b", "9007199254740992", "1", "9007199254740993"],
  ["i64", "(a + b) - a", "9007199254740992", "1", "1"],
  ["i64", "a / b", "9223372036854775807", "3", "3074457345618258602"],
  ["i64", "a % b", "9223372036854775807", "3", "1"],
  ["u64", "a + b", "18446744073709551615", "1", "0"],
  ["u64", "a - b", "0", "1", "18446744073709551615"],
  ["u64", "~a", "0", "0", "18446744073709551615"],
  ["u64", "a >> b", "18446744073709551615", "63", "1"],
  ["i64", "a << b", "1", "62", "4611686018427387904"],
] as const) {
  test(`comptime exact64: ${type} ${expression}`, () => exact(`
    @comptime function calc(a: ${type}, b: ${type}): ${type} { return ${expression}; }
    const result: ${type} = calc(${a}, ${b});`, expected));
}

test("comptime exact64: globals, aliases y funciones anidadas conservan el valor", () => {
  exact(`type Word = u64; const seed: Word = 18446744073709551614;
    @comptime function inner(x: Word): Word { return x + 1; }
    @comptime function outer(x: Word): Word { return inner(x); }
    const result: Word = outer(seed);`, "18446744073709551615");
});

test("comptime exact64: almacenamiento en array y lectura no redondean", () => {
  exact(`const result: u64 = comptime((): u64 => {
    const high: u64 = 18446744073709551615;
    const xs: u64[] = [high]; return xs[0];
  });`, "18446744073709551615");
});

test("comptime exact64: comparación distingue enteros consecutivos", () => {
  const { cpp } = compile(`const result: boolean = comptime((): boolean => {
    const a: i64 = 9007199254740992; const b: i64 = 9007199254740993;
    return a != b && a < b;
  });`);
  assert.match(cpp, /result = true|result = \(true\)|result = 1/);
});

test("comptime exact64: comparación mixta i64/u64 aplica promoción unsigned", () => {
  const { ast } = compile(`const result: boolean = comptime((): boolean => {
    const signed: i64 = -1; const unsigned: u64 = 18446744073709551615;
    return signed == unsigned;
  });`);
  const result = ast.statements.find(stmt => stmt.kind === "VariableDeclaration" && stmt.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value: unknown }).value, true);
});

test("comptime exact64: templates y cast explícito no pierden dígitos", () => {
  const { ast } = compile('const result: string = comptime((): string => { const value: u64 = u64(18446744073709551615); return `max=${value}`; });');
  const result = ast.statements.find(stmt => stmt.kind === "VariableDeclaration" && stmt.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value: unknown }).value, "max=18446744073709551615");
});

test("comptime exact64: Math no convierte silenciosamente a double", () => {
  assert.throws(() => compile('const result: number = comptime((): number => { const value: u64 = 18446744073709551615; return Math.sqrt(value); });'), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.ok(error.diagnostics.some(d => d.code === "COMPTIME_INTEGER_PRECISION"), error.message);
    return true;
  });
});

for (const [name, prefix, argument] of [
  ["literal", "", "18446744073709551615"],
  ["global", "const high: u64 = 18446744073709551615;", "high"],
] as const) {
  test(`comptime exact64: etsgen rechaza ${name} fuera de su rango`, () => {
    const source = name === "global"
      ? `${prefix} @etsgen function emit(): string { return \`print(\${high});\`; } emit();`
      : `@etsgen function emit(n: u64): string { return \`print(\${n});\`; } emit(${argument});`;
    assert.throws(() => compile(source), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(d => d.code === "ETSGEN_INTEGER_PRECISION"), error.message);
      return true;
    });
  });
}

for (const [type, value] of [["i64", "9223372036854775808"], ["i64", "-9223372036854775809"], ["u64", "18446744073709551616"]] as const) {
  test(`comptime exact64: rechaza literal fuera de ${type}`, () => {
    assert.throws(() => compile(`const result: ${type} = ${value};`), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.match(error.message, /no cabe|overflow/);
      return true;
    });
  });
}

test("comptime exact64: overflow firmado se detecta después de un operando grande", () => {
  assert.throws(() => compile(`@comptime function next(a: i64): i64 { return a + 1; }
    const result: i64 = next(9223372036854775807);`), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.ok(error.diagnostics.some(d => d.code === "COMPTIME_INTEGER_OVERFLOW"), error.message);
    return true;
  });
});

test("comptime exact64 native: límites exactos, llamadas y comparación runtime", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-exact64-"));
  try {
    const file = join(dir, "main.cpp"); const binary = join(dir, "main");
    writeFileSync(file, compile(`
      @comptime function add(a: u64, b: u64): u64 { return a + b; }
      function echo(a: u64): u64 { return a; }
      function less(a: u64, b: u64): boolean { return a < b; }
      const high: u64 = add(18446744073709551614, 1);
      const low: i64 = comptime((): i64 => -9223372036854775808);
      print(high); print(low); print(echo(high)); print("max=" + echo(high));
      if (less(9007199254740992, 9007199254740993)) { print("distinct"); } else { print("bad"); }
    `).cpp);
    execFileSync("g++", ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-I", root, file, "-o", binary], { timeout: 60000, stdio: "pipe" });
    assert.equal(execFileSync(binary, { encoding: "utf8", timeout: 10000 }), "18446744073709551615\n-9223372036854775808\n18446744073709551615\nmax=18446744073709551615\ndistinct\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
