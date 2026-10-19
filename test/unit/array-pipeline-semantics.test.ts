import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../../src/compiler.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const chain = (source: string) => `${source}.filter((x: number): boolean => x > 0).map<number>((x: number): number => x * 2).reduce<number>(0, (a: number, x: number): number => a + x)`;

for (const [name, source] of [
  ["global", `const xs: number[] = [1, 2]; const result: number = ${chain("xs")};`],
  ["local", `function run(): number { const xs: number[] = [1, 2]; return ${chain("xs")}; }`],
  ["parametro", `function run(xs: number[]): number { return ${chain("xs")}; }`],
  ["literal", `const result: number = ${chain("[1, 2]")};`],
  ["vacio", `const xs: number[] = []; const result: number = ${chain("xs")};`],
  ["llamada", `function source(): number[] { return [1, 2]; } const result: number = ${chain("source()")};`],
] as const) {
  test(`array pipeline: ruta conservadora para ${name}`, () => {
    const { cpp } = compile(source);
    assert.match(cpp, /ets_filter_vec<double>\(/);
    assert.match(cpp, /ets_map_vec<double, double>\(/);
    assert.match(cpp, /ets_reduce<double, double>\(/);
    assert.doesNotMatch(cpp, /_ets_item|_ets_acc/);
  });
}

function runNative(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ets-pipeline-"));
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

test("array pipeline native: todos los filter preceden a map y reduce", () => {
  assert.equal(runNative(`
    function predicate(x: number): boolean { print("p"); return x > 1; }
    function mapper(x: number): number { print("m"); return x * 10; }
    function reducer(a: number, x: number): number { print("r"); return a + x; }
    const xs: number[] = [1, 2, 3];
    const result: number = xs.filter(predicate).map<number>(mapper).reduce<number>(0, reducer);
    print(result);
    print(xs[0]); print(xs[1]); print(xs[2]);
  `), "p\np\np\nm\nm\nr\nr\n50\n1\n2\n3\n");
});

test("array pipeline native: captura locales y conserva fuente al repetir", () => {
  assert.equal(runNative(`
    function run(): void {
      const xs: number[] = [1, 2, 3];
      const minimum: number = 1;
      const factor: number = 10;
      const initial: number = 5;
      const result: number = xs.filter((x: number): boolean => x > minimum)
        .map<number>((x: number): number => x * factor)
        .reduce<number>(initial, (a: number, x: number): number => a + x);
      print(result);
      print(xs[0]); print(xs[1]); print(xs[2]);
      print(${chain("xs")});
    }
    run(); run();
  `), "55\n1\n2\n3\n12\n55\n1\n2\n3\n12\n");
});

test("array pipeline native: vacios, cambio de tipo y pipelines anidados", () => {
  assert.equal(runNative(`
    function positive(value: number): boolean { return value > 0; }
    function twice(value: number): number { return value * 2; }
    function sum(total: number, value: number): number { return total + value; }
    function run(): void {
      const empty: number[] = [];
      print(${chain("empty")});
      const xs: number[] = [1, 2, 3];
      const result: string = xs.filter((x: number): boolean => x > 1)
        .map<string>((x: number): string => numberToString(x))
        .reduce<string>("start", (a: string, x: string): string => a + x);
      print(result);
      const nested: number = xs.filter((x: number): boolean => x > 0)
        .map<number>((x: number): number => [1, 2].filter(positive).map<number>(twice).reduce<number>(0, sum))
        .reduce<number>(0, (a: number, x: number): number => a + x);
      print(nested);
      print(xs[0]); print(xs[1]); print(xs[2]);
    }
    run();
  `), "0\nstart23\n18\n1\n2\n3\n");
});
