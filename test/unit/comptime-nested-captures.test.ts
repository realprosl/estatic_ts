import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, parse } from "../../src/compiler.ts";
import { evaluateComptime } from "../../src/codegen/comptime-evaluator.ts";

function resultOf(source: string): unknown {
  const program = evaluateComptime(parse(source));
  const result = program.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal(result.initializer.kind, "LiteralExpression");
  return (result.initializer as { value: unknown }).value;
}

test("comptime captures: funcion decorada pasa su parametro a otra", () => {
  assert.equal(resultOf(`@comptime
    function inc(n: number): number { return n + 1; }
    @comptime
    function outer(n: number): number { let x = inc(n); return x + 10; }
    const result = outer(3);`), 14);
});

test("comptime captures: la llamada anidada acepta una variable local", () => {
  assert.equal(resultOf(`const base = 5;
    @comptime
    function double(n: number): number { return n * 2; }
    @comptime
    function outer(n: number): number { let shifted = n + 2; return double(shifted) + base; }
    const result = outer(3);`), 15);
});

test("comptime captures: tres niveles conservan parametros y captura global", () => {
  assert.equal(resultOf(`const bias = 7;
    @comptime
    function leaf(n: number): number { return n + bias; }
    @comptime
    function middle(n: number): number { return leaf(n * 2); }
    @comptime
    function root(n: number): number { return middle(n + 1); }
    const result = root(2);`), 13);
});

test("comptime captures: la captura exterior sigue disponible tras volver", () => {
  assert.equal(resultOf(`const before = 4;
    const after = 9;
    @comptime
    function inner(n: number): number { return n * 2; }
    @comptime
    function outer(n: number): number { let a = before; let b = inner(n); return a + b + after; }
    const result = outer(3);`), 19);
});

test("comptime captures: recursion y helper anidado no pierden el ambito", () => {
  assert.equal(resultOf(`const offset = 3;
    @comptime
    function inc(n: number): number { return n + 1; }
    @comptime
    function sum(n: number): number { if (n <= 0) { return offset; } return inc(n) + sum(n - 1); }
    const result = sum(3);`), 12);
});

test("comptime captures: call sites distintos no comparten variables", () => {
  assert.equal(resultOf(`@comptime
    function twice(n: number): number { return n * 2; }
    @comptime
    function outer(n: number): number { return twice(n + 1); }
    const first = outer(2);
    const second = outer(10);
    const result = comptime(() => first + second);`), 28);
});

test("comptime captures: cppgen puede componer un helper comptime parametrizado", () => {
  const cpp = compile(`@comptime
    function twice(n: number): number { return n * 2; }
    @cppgen
    function emit(n: number): string { return "int generated = " + twice(n) + ";"; }
    function main(): void { emit(6); }`).cpp;
  assert.match(cpp, /int generated = 12;/);
});

test("comptime captures: una llamada nested conserva el resultado en el pipeline completo", () => {
  const result = compile(`@comptime
    function addOne(n: number): number { return n + 1; }
    @comptime
    function calculate(n: number): number { return addOne(n) * 3; }
    const result: number = calculate(4);`).ast.statements.find(
      s => s.kind === "VariableDeclaration" && s.name === "result",
    );
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value: unknown }).value, 15);
});
