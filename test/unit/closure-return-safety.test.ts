import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, parse } from "../../src/compiler.ts";
import { TypeChecker } from "../../src/semantic/type-checker.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { compileFile } from "../../src/modules/module-loader.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const prefix = "function make(): () => number { let value: number = 0;";
const unsafe = "(): number => { value += 1; return value; }";

for (const [name, body] of [
  ["directo", `return ${unsafe};`],
  ["alias const", `const f: () => number = ${unsafe}; return f;`],
  ["cadena de aliases", `const f: () => number = ${unsafe}; const g: () => number = f; return g;`],
  ["reasignacion", `const risky: () => number = ${unsafe}; let f: () => number = (): number => 1; f = risky; return f;`],
  ["rama condicional", `const f: () => number = ${unsafe}; return true ? f : (): number => 1;`],
  ["captura transitiva por valor", `const f: () => number = ${unsafe}; return (): number => f();`],
  ["identidad sin resumen interprocedural", `const f: () => number = ${unsafe}; return identity(f);`],
  ["alias ciclico conservador", `const risky: () => number = ${unsafe}; let f: () => number = (): number => 1; let g: () => number = f; f = g; g = risky; return f;`],
  ["rama de asignacion", `const risky: () => number = ${unsafe}; let f: () => number = (): number => 1; if (true) { f = risky; } return f;`],
] as const) {
  test(`closure return safety: rechaza ${name}`, () => {
    const source = `function identity(f: () => number): () => number { return f; }\n${prefix} ${body} }`;
    assert.throws(() => compile(source), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError, String(error));
      const diagnostic = error.diagnostics.find(item => item.code === "CLOSURE_REFERENCE_RETURN");
      assert.ok(diagnostic, error.message);
      assert.match(diagnostic.message, /E4210/);
      assert.ok(diagnostic.span.start.line > 0);
      assert.ok(diagnostic.hint);
      assert.ok(diagnostic.notes?.some(note => note.includes("referencia")));
      return true;
    });
  });
}

test("closure return safety: retorno implicito de arrow tambien se comprueba", () => {
  assert.throws(() => compile(`type Reader = () => number; ${prefix}
    const f: () => number = ${unsafe};
    const wrap: () => Reader = (): Reader => f;
    return wrap();
  }`), /E4210/);
});

test("closure return safety: API directa TypeChecker tambien protege", () => {
  assert.throws(() => new TypeChecker().check(parse(`${prefix} return ${unsafe}; }`)), /E4210/);
});

const locatedSource = `export function make(): () => number {
  let value: number = 0;
  const f: () => number = ${unsafe};
  return f;
}`;

test("closure return safety: diagnostico apunta al retorno, no al origen", () => {
  assert.throws(() => compile(locatedSource), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    const diagnostic = error.diagnostics.find(item => item.code === "CLOSURE_REFERENCE_RETURN");
    assert.ok(diagnostic);
    assert.equal(diagnostic.span.start.line, 4);
    assert.equal(diagnostic.span.start.column, 3);
    assert.ok(diagnostic.notes?.some(note => note.includes("3:")));
    return true;
  });
});

test("closure return safety: diagnostico modular conserva archivo y linea", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ets-closure-return-module-"));
  try {
    writeFileSync(join(dir, "lib.ets"), locatedSource);
    writeFileSync(join(dir, "main.ets"), 'import { make } from "./lib.ets";\nconst f: () => number = make();');
    await assert.rejects(() => compileFile(join(dir, "main.ets")), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      const diagnostic = error.diagnostics.find(item => item.code === "CLOSURE_REFERENCE_RETURN");
      assert.ok(diagnostic);
      assert.equal(diagnostic.file, join(dir, "lib.ets"));
      assert.equal(diagnostic.span.start.line, 4);
      assert.equal(diagnostic.span.start.column, 3);
      return true;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [name, source] of [
  ["lectura por valor", "function make(value: number): () => number { return (): number => value + 1; }"],
  ["global mutable", "let value: number = 0; function make(): () => number { return (): number => { value += 1; return value; }; }"],
  ["consumo local sin escape", `${prefix} const f: () => number = ${unsafe}; print(f()); return (): number => 7; }`],
  ["sombreado de alias", `${prefix} const f: () => number = ${unsafe}; if (true) { const f: () => number = (): number => 7; return f; } return (): number => 8; }`],
  ["parametro sin procedencia conocida", "function identity(f: () => number): () => number { return f; }"],
] as const) {
  test(`closure return safety: permite ${name}`, () => assert.doesNotThrow(() => compile(source)));
}

test("closure return safety native: lectura devuelta y mutacion local conservan semantica", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-closure-return-"));
  try {
    const file = join(dir, "main.cpp");
    const binary = join(dir, "main");
    writeFileSync(file, compile(`
      function make(value: number): () => number { return (): number => value + 1; }
      function run(): void {
        let value: number = 0;
        const increment: () => number = ${unsafe};
        print(increment()); print(increment()); print(value);
        const read: () => number = make(7); print(read()); print(read());
      }
      run();
    `).cpp);
    execFileSync("g++", ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-I", root, file, "-o", binary], { timeout: 60_000, stdio: "pipe" });
    assert.equal(execFileSync(binary, { encoding: "utf8", timeout: 10_000 }), "1\n2\n2\n8\n8\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
