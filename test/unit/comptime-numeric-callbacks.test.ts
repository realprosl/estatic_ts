import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function initializer(source: string) {
  const { ast } = compile(source);
  const result = ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result?.kind === "VariableDeclaration");
  return result.initializer as {value?: unknown; exactInteger?: string};
}

const arithmetic = [
  ["i32", "i16", "5", "i16", "2", "a / b", "2"],
  ["i32", "u16", "65535", "u16", "1", "a + b", "65536"],
  ["u32", "u32", "4294967295", "u32", "1", "a + b", "0"],
  ["u32", "u32", "4294967295", "u32", "4294967295", "a * b", "1"],
  ["boolean", "i32", "-1", "u32", "1", "a < b", "false"],
  ["i64", "i64", "-1", "u32", "1", "a + b", "0"],
  ["u64", "i32", "-1", "u64", "1", "a + b", "0"],
  ["f32", "f32", "16777216", "f32", "1", "(a + b) - a", "0"],
  ["f32", "f32", "16777216", "i32", "1", "(a + b) - a", "0"],
  ["f64", "f32", "16777216", "f64", "1", "(a + b) - a", "1"],
  ["boolean", "i64", "9007199254740993", "f64", "9007199254740992", "a == b", "true"],
  ["u32", "u32", "0", "u32", "0", "~a", "4294967295"],
  ["i32", "u8", "0", "u8", "0", "~a", "-1"],
  ["i32", "i32", "1", "i64", "2", "a << b", "4"],
  ["i32", "i32", "1", "i64", "31", "a << b", "-2147483648"],
  ["i64", "i64", "1", "i64", "63", "a << b", "-9223372036854775808"],
] as const;
for (const [result, left, a, right, b, expression, expected] of arithmetic) {
  test(`promotions: ${left} ${expression} ${right}`, () => {
    const init = initializer(`const result: ${result} = comptime((): ${result} => {
      const a: ${left} = ${a}; const b: ${right} = ${b}; return ${expression};
    });`);
    assert.equal(init.exactInteger ?? String(init.value), expected);
  });
}

for (const [type, body, expected] of [
  ["f32", "return 16777217;", 16777216],
  ["f32", "const x: f64 = 16777217; return f32(x);", 16777216],
  ["f64", "const x: u64 = 18446744073709551615; return x;", Number(18446744073709551615n)],
  ["f32", "const x: i64 = 16777217; const ys: f32[] = [x]; return ys[0];", 16777216],
  ["f32", "const x: f64 = 16777217; let y: f32 = 0; y = x; return y;", 16777216],
] as const) {
  test(`float conversion: ${type} ${body}`, () => {
    assert.equal(initializer(`const result: ${type} = comptime((): ${type} => { ${body} });`).value, expected);
  });
}

test("float conversion: parámetros y retornos nombrados", () => {
  assert.equal(initializer(`@comptime function f(x: f32): f64 { return x; }
    const x: i64 = 16777217; const result: f64 = f(x);`).value, 16777216);
});

const callbacks = [
  ["map entero", "const xs: i64[] = [257,258]; const ys: u8[] = xs.map((x: u8): u8 => x); return `${ys[0]}/${ys[1]}/${xs[0]}`;", "1/2/257"],
  ["map float", "const xs: f64[] = [16777217]; const ys: f32[] = xs.map((x: f32): f32 => x); return `${ys[0]}`;", "16777216"],
  ["map retorno contextual", "const xs: f64[] = [16777217]; const ys: f32[] = xs.map<f32>((x: f64) => x); return `${ys[0]}`;", "16777216"],
  ["map adapta resultado", "const xs: i64[] = [257]; const ys: u8[] = xs.map<u8>((x: i64): i64 => x); return `${ys[0]}`;", "1"],
  ["flatMap", "const xs: i64[] = [257]; const ys: u8[] = xs.flatMap<u8>((x: u8): u8[] => [x,x]); return `${ys.length}/${ys[1]}`;", "2/1"],
  ["forEach", "const xs: i64[] = [257,258]; let total: u8 = 0; xs.forEach((x: u8): void => { total += x; }); return `${total}`;", "3"],
  ["filter", "const xs: i64[] = [257,258]; const ys: i64[] = xs.filter((x: u8): boolean => x == 1); return `${ys[0]}`;", "257"],
  ["some", "const xs: i64[] = [257,258]; return `${xs.some((x: u8): boolean => x == 1)}`;", "true"],
  ["every", "const xs: i64[] = [257,258]; return `${xs.every((x: u8): boolean => x < 3)}`;", "true"],
  ["reduce", "const xs: i64[] = [1,2]; const total: u8 = xs.reduce<u8>(255, (acc: u8, x: u8): u8 => acc + x); return `${total}`;", "2"],
  ["reduce vacío", "const xs: i64[] = []; const total: u8 = xs.reduce<u8>(255, (acc: u8, x: u8): u8 => acc + x); return `${total}`;", "255"],
  ["reduce adapta acumulador", "const xs: i64[] = [257]; return `${xs.reduce<u8>(0, (acc: i64,x: i64): i64 => acc + x)}`;", "1"],
  ["sort dos argumentos", "let xs: i32[] = [3,1,2]; xs.sort((a: i32,b: i32): number => a - b); return `${xs[0]}/${xs[1]}/${xs[2]}`;", "1/2/3"],
  ["sort conversión", "let xs: i64[] = [258,257]; xs.sort((a: u8,b: u8): number => a - b); return `${xs[0]}/${xs[1]}`;", "257/258"],
] as const;
for (const [name, body, expected] of callbacks) {
  test(`callback conversion: ${name}`, () => {
    assert.equal(initializer(`const result: string = comptime((): string => { ${body} });`).value, expected);
  });
}

for (const [body, code] of [
  ["const a: i32 = 2147483647; const b: i32 = 1; return a + b;", "COMPTIME_INTEGER_OVERFLOW"],
  ["const a: i32 = -2147483648; const b: i32 = -1; return a / b;", "COMPTIME_INTEGER_OVERFLOW"],
  ["const a: i32 = 1; const b: i64 = 32; return a << b;", "COMPTIME_INTEGER_SHIFT"],
  ["const xs: f64[] = [256.0]; const ys: u8[] = xs.map((x: u8): u8 => x); return ys[0];", "COMPTIME_INTEGER_CAST_RANGE"],
] as const) {
  test(`numeric diagnostic: ${code} ${body}`, () => {
    assert.throws(() => compile(`const result: i32 = comptime((): i32 => { ${body} });`), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(d => d.code === code), error.message);
      return true;
    });
  });
}

test("numeric callbacks native: promociones y callbacks coinciden con C++20", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-numeric-"));
  try {
    const comparisons = arithmetic.map(([result, left, a, right, b, expression], i) => `
      function calc${i}(a: ${left}, b: ${right}): ${result} { return ${expression}; }
      const folded${i}: ${result} = comptime((): ${result} => calc${i}(${a},${b}));
      if (calc${i}(${a},${b}) == folded${i}) { print("ok"); } else { print("bad"); }
    `).join("\n");
    const source = comparisons + `
      function pipeline(xs: i64[]): u8 {
        const ys: u8[] = xs.map((x: u8): u8 => x);
        return ys.reduce<u8>(255, (acc: u8,x: u8): u8 => acc + x);
      }
      const folded: u8 = comptime((): u8 => { const xs: i64[] = [257,258]; return pipeline(xs); });
      const xs: i64[] = [257,258];
      if (pipeline(xs) == folded) { print("ok"); } else { print("bad"); }
    `;
    writeFileSync(join(dir, "main.cpp"), compile(source).cpp);
    execFileSync("g++", ["-std=c++20", "-Werror=narrowing", "-O2", "-pthread", "-fno-exceptions", "-I", root, join(dir, "main.cpp"), "-o", join(dir, "main")], { timeout: 60000, stdio: "pipe" });
    assert.equal(execFileSync(join(dir, "main"), { encoding: "utf8", timeout: 10000 }), "ok\n".repeat(arithmetic.length + 1));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const numericTypes = ["i8","u8","i16","u16","i32","u32","i64","u64","f32","f64","number"];
const promotionRows = [
  "i32 i32 i32 i32 i32 u32 i64 u64 f32 f64 number",
  "i32 i32 i32 i32 i32 u32 i64 u64 f32 f64 number",
  "i32 i32 i32 i32 i32 u32 i64 u64 f32 f64 number",
  "i32 i32 i32 i32 i32 u32 i64 u64 f32 f64 number",
  "i32 i32 i32 i32 i32 u32 i64 u64 f32 f64 number",
  "u32 u32 u32 u32 u32 u32 i64 u64 f32 f64 number",
  "i64 i64 i64 i64 i64 i64 i64 u64 f32 f64 number",
  "u64 u64 u64 u64 u64 u64 u64 u64 f32 f64 number",
  "f32 f32 f32 f32 f32 f32 f32 f32 f32 f64 number",
  "f64 f64 f64 f64 f64 f64 f64 f64 f64 f64 number",
  "number number number number number number number number number number number",
].map(row => row.split(" "));

test("promotions matrix: 121 pares tipados, tipo de expresión y división", () => {
  numericTypes.forEach((left, i) => numericTypes.forEach((right, j) => {
    const expected = promotionRows[i][j];
    const { ast } = compile(`const result: ${expected} = comptime((): ${expected} => {
      const a: ${left} = 5; const b: ${right} = 2; return a / b;
    });`);
    const result = ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
    assert.ok(result?.kind === "VariableDeclaration");
    const init = result.initializer as {value?: unknown; exactInteger?: string};
    assert.equal(Number(init.exactInteger ?? init.value), ["f32","f64","number"].includes(expected) ? 2.5 : 2, `${left}/${right}`);
    const runtime = compile(`function f(a: ${left}, b: ${right}): ${expected} { return a / b; }`).ast;
    const fn = runtime.statements[0];
    assert.ok(fn.kind === "FunctionDeclaration");
    const statement = fn.body.statements[0];
    assert.ok(statement.kind === "ReturnStatement");
    assert.deepEqual(statement.value?.resolvedType, {kind:"primitive",name:expected}, `${left}/${right}`);
  }));
});

test("float32: evita doble redondeo desde u64 y conserva cero negativo", () => {
  const value = (1n << 63n) + (1n << 39n) + 1n;
  const expected = 2 ** 63 + 2 ** 40;
  assert.equal(initializer(`const x: u64 = ${value}; const result: f32 = comptime((): f32 => x);`).value, expected);
  assert.ok(Object.is(initializer(`const result: f32 = comptime((): f32 => -0.0);`).value, -0));
});

test("float32 native: conversión directa de argumento u64, sin double intermedio", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-float32-"));
  try {
    const value = (1n << 63n) + (1n << 39n) + 1n;
    const source = `function echo(x: f32): f32 { return x; }
      const x: u64 = ${value};
      const folded: f32 = comptime((): f32 => echo(x));
      if (echo(x) == folded) { print("ok"); } else { print("bad"); }
      function large(): number { return 1000000000000000000000000000000.0; }
      const largeFolded: number = comptime((): number => large());
      if (large() == largeFolded) { print("large"); } else { print("bad"); }`;
    writeFileSync(join(dir,"main.cpp"), compile(source).cpp);
    execFileSync("g++", ["-std=c++20","-O2","-pthread","-fno-exceptions","-I",root,join(dir,"main.cpp"),"-o",join(dir,"main")], {timeout:60000,stdio:"pipe"});
    assert.equal(execFileSync(join(dir,"main"),{encoding:"utf8",timeout:10000}),"ok\nlarge\n");
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("promotions matrix native: 121 tipos y resultados contra operadores C++", () => {
  const dir = mkdtempSync(join(tmpdir(),"ets-matrix-"));
  const cppType: Record<string,string> = {f32:"float",f64:"double",number:"double"};
  const cpp = (name: string) => cppType[name] ?? `${name.startsWith("u") ? "uint" : "int"}${name.slice(1)}_t`;
  try {
    let source = "#include <cstdint>\n#include <type_traits>\n";
    numericTypes.forEach((left,i) => numericTypes.forEach((right,j) => {
      const expected = promotionRows[i][j];
      const init = initializer(`const result: ${expected} = comptime((): ${expected} => {
        const a: ${left} = 5; const b: ${right} = 2; return a / b;
      });`);
      const reference = `(static_cast<${cpp(left)}>(5) / static_cast<${cpp(right)}>(2))`;
      source += `static_assert(std::is_same_v<decltype(${reference}), ${cpp(expected)}>);\n`;
      source += `static_assert(${reference} == ${init.exactInteger ?? String(init.value)});\n`;
    }));
    source += "int main() { return 0; }\n";
    writeFileSync(join(dir,"main.cpp"),source);
    execFileSync("g++",["-std=c++20","-O2",join(dir,"main.cpp"),"-o",join(dir,"main")],{timeout:60000,stdio:"pipe"});
    execFileSync(join(dir,"main"),{timeout:10000,stdio:"pipe"});
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("numeric callbacks: firmas no numéricas incompatibles siguen rechazadas", () => {
  assert.throws(() => compile(`const xs: i64[] = [1]; const ys: string[] = xs.map((x: string): string => x);`), /Se esperaba/);
});

test("numeric promotions: bitwise explícitamente flotante se rechaza", () => {
  assert.throws(() => compile(`const a: f32 = 1; const b: i32 = 1; const result = a & b;`), /bitwise/);
});

for (const body of [
  "const x: f64 = 1000000000000000000000000000000000000000.0; return f32(x);",
  "const a: f32 = 300000000000000000000000000000000000000.0; return a * a;",
  "return Math.sqrt(-1);",
]) {
  test(`numeric floats: resultado no representable (${body})`, () => {
    assert.throws(() => compile(`const result: f32 = comptime((): f32 => { ${body} });`), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(d => d.code === "COMPTIME_FLOAT_RANGE"), error.message);
      return true;
    });
  });
}
