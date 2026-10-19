import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile, parse } from "../../src/compiler.ts";
import { evaluateComptime } from "../../src/codegen/comptime-evaluator.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";

function diagnosticFrom(source: string): DiagnosticError {
  try {
    evaluateComptime(parse(source));
  } catch (error) {
    if (error instanceof DiagnosticError) return error;
    throw error;
  }
  throw new Error("se esperaba un DiagnosticError");
}

test("comptime typed errors: identificador no disponible lleva codigo estable", () => {
  const error = diagnosticFrom("const result = comptime(() => missing);");
  assert.equal(error.diagnostics[0]?.code, "COMPTIME_VALUE_UNAVAILABLE");
});

test("comptime typed errors: valor runtime aplaza la funcion decorada", () => {
  const cpp = compile(`@comptime
    function twice(n: number): number { return n * 2; }
    function runtime(n: number): number { return twice(n); }`).cpp;
  assert.match(cpp, /twice\(n\)/);
});

test("comptime typed errors: parametro de funcion decorada se resuelve al invocarla", () => {
  const ast = compile(`@comptime
    function twice(n: number): number { return n * 2; }
    @comptime
    function outer(n: number): number { return twice(n + 1); }
    const result: number = outer(3);`).ast;
  const result = ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value: unknown }).value, 8);
});

test("comptime typed errors: division por cero nunca se aplaza", () => {
  assert.throws(() => compile(`@comptime
    function explode(): number { return 1 / 0; }
    const result: number = explode();`), /division por cero/);
});

test("comptime typed errors: TDZ nunca se trata como valor runtime", () => {
  const error = diagnosticFrom(`@comptime
    function broken(): number { return value; let value = 1; }
    const result = broken();`);
  assert.match(error.message, /zona muerta temporal/);
  assert.notEqual(error.diagnostics[0]?.code, "COMPTIME_VALUE_UNAVAILABLE");
});

test("comptime typed errors: el evaluator no clasifica errores por redaccion", () => {
  const source = readFileSync(new URL("../../src/codegen/comptime-evaluator.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /msg\.includes\([^\n]*(?:no esta definido|comptime-compatibe)/);
});
