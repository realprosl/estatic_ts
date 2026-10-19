import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../../src/compiler.ts";
import type { ArrowFunctionExpression } from "../../src/ast/nodes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function arrows(value: unknown): ArrowFunctionExpression[] {
  if (!value || typeof value !== "object") return [];
  const node = value as { kind?: string };
  return [
    ...(node.kind === "ArrowFunctionExpression" ? [value as ArrowFunctionExpression] : []),
    ...Object.values(value).flatMap(arrows),
  ];
}

for (const [name, source, expected] of [
  ["parametros anidados", `function run(): void { const f: () => number = (): number => { const g: (n: number) => number = (n: number): number => n + 1; return g(2); }; }`, [[], []]],
  ["local de lambda interior", `function run(): void { const f: () => number = (): number => { const g: () => number = (): number => { const hidden: number = 2; return hidden; }; return g(); }; }`, [[], []]],
  ["sombreado de bloque", `function run(): void { const value: number = 7; const f: () => number = (): number => { if (true) { const value: number = 3; print(value); } return value; }; }`, [["value"]]],
  ["local que sombrea global", `const value: number = 100; function run(): void { const value: number = 7; const f: () => number = (): number => value; }`, [["value"]]],
  ["callee local", `function run(): void { const helper: () => number = (): number => 7; const f: () => number = (): number => helper(); }`, [[], ["helper"]]],
  ["captura transitiva", `function run(): void { const value: number = 7; const f: () => number = (): number => { const g: () => number = (): number => value; return g(); }; }`, [["value"], ["value"]]],
  ["parametro exterior capturado solo por interior", `function run(): void { const f: (value: number) => number = (value: number): number => { const g: () => number = (): number => value; return g(); }; }`, [[], ["value"]]],
  ["binding de for con mismo nombre", `function run(): void { const value: number = 7; const f: () => number = (): number => { for (const value of [1, 2]) { print(value); } return value; }; }`, [["value"]]],
  ["global real", `const value: number = 100; function run(): void { const f: () => number = (): number => value; }`, [[]]],
  ["local homonimo de namespace", `function run(): void { const path: string = "ok"; const f: () => string = (): string => path; }`, [["path"]]],
  ["parametro interior que sombrea global", `const value: number = 100; function run(): void { const f: () => number = (): number => { const g: (value: number) => number = (value: number): number => value; return g(2); }; }`, [[], []]],
] as const) {
  test(`closure captures: ${name}`, () => {
    const { ast } = compile(source);
    assert.deepEqual(arrows(ast).map(arrow => [...(arrow.capturedSymbols ?? [])].sort()), expected);
  });
}

function runNative(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ets-captures-"));
  try {
    const file = join(dir, "main.cpp");
    const binary = join(dir, "main");
    writeFileSync(file, compile(source).cpp);
    execFileSync("g++", ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-I", root, file, "-o", binary], { timeout: 60_000, stdio: "pipe" });
    return execFileSync(binary, { encoding: "utf8", timeout: 10_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("closure captures native: pipelines anidados con lambdas inline", () => {
  assert.equal(runNative(`
    function run(): void {
      const xs: number[] = [1, 2, 3];
      const total: number = xs.map<number>((x: number): number => [1, 2]
        .filter((n: number): boolean => n > 0)
        .map<number>((n: number): number => n * x)
        .reduce<number>(0, (acc: number, n: number): number => acc + n))
        .reduce<number>(0, (acc: number, n: number): number => acc + n);
      print(total); print(xs[0]); print(xs[1]); print(xs[2]);
    }
    run();
  `), "18\n1\n2\n3\n");
});

test("closure captures native: sombreado y callee transitivo", () => {
  assert.equal(runNative(`
    const value: number = 100;
    function run(): void {
      const value: number = 7;
      const helper: (n: number) => number = (n: number): number => value + n;
      const f: () => number = (): number => {
        if (true) { const value: number = 3; print(value); }
        const g: () => number = (): number => helper(value);
        return g();
      };
      print(f());
      const path: string = "ok";
      const label: () => string = (): string => path;
      print(label());
    }
    run(); print(value);
  `), "3\n14\nok\n100\n");
});

for (const mutation of ["a += 1; b += 2;", "a = a + 1; b = b + 2;"]) {
  test(`closure captures native: mutacion transitiva ${mutation}`, () => {
    assert.equal(runNative(`
    function run(): void {
      let a: number = 1; let b: number = 2;
      const f: () => void = (): void => {
        const g: () => void = (): void => { ${mutation} };
        g();
      };
      f(); f(); print(a); print(b);
    }
    run();
    `), "3\n6\n");
  });
}

test("closure captures native: closure de solo lectura devuelta conserva valor", () => {
  assert.equal(runNative(`
    function make(value: number): () => number {
      return (): number => { const g: () => number = (): number => value + 1; return g(); };
    }
    const f: () => number = make(5);
    print(f()); print(f());
  `), "6\n6\n");
});
