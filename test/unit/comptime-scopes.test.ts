import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, compile } from "../../src/compiler.ts";
import { evaluateComptime } from "../../src/codegen/comptime-evaluator.ts";

function value(body: string, helpers = ""): unknown {
  const program = evaluateComptime(parse(`${helpers}\nconst result = comptime(() => { ${body} });`));
  const result = program.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal(result.initializer.kind, "LiteralExpression");
  return (result.initializer as { value: unknown }).value;
}

test("comptime scopes: bloque no sobrescribe la variable exterior", () => {
  assert.equal(value("let x = 10; { let x = 99; x += 1; } return x;"), 10);
});

test("comptime scopes: if tiene un ambito propio", () => {
  assert.equal(value("let x = 10; if (true) { const x = 99; } return x;"), 10);
});

test("comptime scopes: else tiene un ambito propio", () => {
  assert.equal(value("let x = 10; if (false) { const x = 1; } else { const x = 99; } return x;"), 10);
});

test("comptime scopes: asignacion sin declaracion actualiza el exterior", () => {
  assert.equal(value("let total = 0; { total += 3; { total = total + 4; } } return total;"), 7);
});

test("comptime scopes: bloque anidado modifica el binding mas cercano", () => {
  assert.equal(value("let x = 1; let seen = 0; { let x = 10; { x += 5; } seen = x; } return x + seen;"), 16);
});

test("comptime scopes: for no sobrescribe el contador exterior", () => {
  assert.equal(value("let i = 100; let sum = 0; for (let i = 0; i < 3; i += 1) { sum += i; } return i + sum;"), 103);
});

test("comptime scopes: for sin declaracion actualiza el contador exterior", () => {
  assert.equal(value("let i = 0; for (i = 0; i < 3; i += 1) {} return i;"), 3);
});

test("comptime scopes: variable del for no escapa", () => {
  assert.throws(() => value("for (let i = 0; i < 2; i += 1) {} return i;"), /no esta definido/);
});

test("comptime scopes: variable del bloque no escapa", () => {
  assert.throws(() => value("{ const hidden = 3; } return hidden;"), /no esta definido/);
});

test("comptime scopes: while sombrea sin perder las asignaciones externas", () => {
  assert.equal(value("let x = 10; let n = 0; while (n < 3) { let x = 99; x += 1; n += 1; } return x + n;"), 13);
});

test("comptime scopes: destructuring de array declara variables locales", () => {
  assert.equal(value("let x = 10; { const [x] = [99]; } return x;"), 10);
});

test("comptime scopes: destructuring de objeto declara variables locales", () => {
  assert.equal(value("let x = 10; { const {x} = {x: 99}; } return x;"), 10);
});

test("comptime scopes: return dentro de bloque anidado sale de la funcion", () => {
  assert.equal(value("{ { return 7; } } return 99;"), 7);
});

test("comptime scopes: return dentro de for conserva el resultado", () => {
  assert.equal(value("for (let i = 0; i < 3; i += 1) { if (i == 1) { return i + 10; } } return 99;"), 11);
});

test("comptime scopes: llamadas recursivas conservan parametros y capturas", () => {
  assert.equal(value("return fact(5) + factor;", `const factor = 2;
    function fact(n: number): number { if (n <= 1) { return factor; } return n * fact(n - 1); }`), 242);
});

test("comptime scopes: callback conserva parametros y lee todos los ambitos", () => {
  assert.equal(value("let base = 2; { let extra = 3; const xs = [1, 2].map((base: number): number => base + extra); return xs[0] + xs[1]; }"), 9);
});

test("comptime scopes: pipeline completo conserva sombreado de bloques", () => {
  const result = compile("const answer: number = comptime((): number => { let x: number = 10; if (true) { let x: number = 99; } return x; });");
  const declaration = result.ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "answer");
  assert.ok(declaration && declaration.kind === "VariableDeclaration");
  assert.equal((declaration.initializer as { value: unknown }).value, 10);
});

test("comptime scopes: parametros del callback no sobrescriben el exterior", () => {
  assert.equal(value("let x = 10; const xs = [1, 2].map((x: number): number => x + 1); return x + xs[0];"), 12);
});

test("comptime scopes: callback puede actualizar un acumulador exterior", () => {
  assert.equal(value("let sum = 0; [1, 2, 3].forEach((x: number): void => { sum += x; }); return sum;"), 6);
});

test("comptime scopes: recorrido del AST no filtra declaraciones de bloques", () => {
  const program = evaluateComptime(parse(`let x = 10;
    { const x = 99; const inner = comptime(() => x); }
    const result = comptime(() => x);`));
  const result = program.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value: unknown }).value, 10);
});

test("comptime scopes: recorrido del AST no filtra el contador del for", () => {
  const program = evaluateComptime(parse(`let i = 10;
    for (let i = 0; i < 2; i += 1) {}
    const result = comptime(() => i);`));
  const result = program.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value: unknown }).value, 10);
});
