import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, compile } from "../../src/compiler.ts";
import { evaluateComptime } from "../../src/codegen/comptime-evaluator.ts";

function value(body: string): unknown {
  const program = evaluateComptime(parse(`const result = comptime(() => { ${body} });`));
  const result = program.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal(result.initializer.kind, "LiteralExpression");
  return (result.initializer as { value: unknown }).value;
}

test("comptime: false && omite division por cero", () => {
  assert.equal(value("return false && (1 / 0 > 0);"), false);
});

test("comptime: true || omite division por cero", () => {
  assert.equal(value("return true || (1 / 0 > 0);"), true);
});

for (const expression of ["false &&", "true ||"]) {
  test(`comptime: ${expression} no ejecuta efectos del lado derecho`, () => {
    assert.equal(value(`let calls = 0; const ignored = ${expression} ((calls += 1) > 0); return calls;`), 0);
  });
}

for (const expression of ["true &&", "false ||"]) {
  test(`comptime: ${expression} evalua el lado derecho una sola vez`, () => {
    assert.equal(value(`let calls = 0; const ignored = ${expression} ((calls += 1) > 0); return calls;`), 1);
  });
}

for (const literal of ["0", "false", '""']) {
  test(`comptime: ${literal} ?? no evalua el fallback`, () => {
    assert.equal(value(`return ${literal} ?? (1 / 0);`), JSON.parse(literal));
  });
}

test("comptime: undefined ?? evalua el fallback", () => {
  assert.equal(value("return undefined ?? 7;"), 7);
});

test("comptime: && necesario conserva errores del lado derecho", () => {
  assert.throws(() => value("return true && (1 / 0 > 0);"), /division por cero/);
});

test("comptime: || necesario conserva errores del lado derecho", () => {
  assert.throws(() => value("return false || (1 / 0 > 0);"), /division por cero/);
});

test("comptime: pipeline completo sustituye la expresion por un literal", () => {
  const result = compile("const result: boolean = comptime((): boolean => true || (1 / 0 > 0));");
  const declaration = result.ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(declaration && declaration.kind === "VariableDeclaration");
  assert.equal(declaration.initializer.kind, "LiteralExpression");
  assert.equal((declaration.initializer as { value: unknown }).value, true);
  assert.doesNotMatch(result.cpp, /comptime\(/);
});

test("comptime: el operando izquierdo se evalua una sola vez", () => {
  assert.equal(value("let calls = 0; const ignored = ((calls += 1) > 0) || ((calls += 1) > 0); return calls;"), 1);
});

test("comptime: cortocircuito en expresiones anidadas", () => {
  assert.equal(value("return (false && (1 / 0 > 0)) || (true || (1 / 0 > 0));"), true);
});
