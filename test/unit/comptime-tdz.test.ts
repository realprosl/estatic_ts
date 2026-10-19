import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../src/compiler.ts";
import { evaluateComptime } from "../../src/codegen/comptime-evaluator.ts";

function value(body: string, before = ""): unknown {
  const program = evaluateComptime(parse(`${before}\nconst result = comptime(() => { ${body} });`));
  const result = program.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal(result.initializer.kind, "LiteralExpression");
  return (result.initializer as { value: unknown }).value;
}

const tdz = /zona muerta temporal/;

test("comptime TDZ: una lectura no atraviesa una declaracion posterior", () => {
  assert.throws(() => value("let x = 1; { return x; let x = 2; }"), tdz);
});

test("comptime TDZ: el initializer no puede leer su propio binding", () => {
  assert.throws(() => value("let x = 1; { let x = x + 1; return x; }"), tdz);
});

test("comptime TDZ: una asignacion no atraviesa una declaracion posterior", () => {
  assert.throws(() => value("let x = 1; { x = 9; let x = 2; } return x;"), tdz);
});

test("comptime TDZ: una asignacion compuesta tampoco atraviesa el binding", () => {
  assert.throws(() => value("let x = 1; { x += 9; let x = 2; } return x;"), tdz);
});

test("comptime TDZ: destructuring de array reserva todos sus nombres", () => {
  assert.throws(() => value("let x = 1; { return x; const [x] = [2]; }"), tdz);
});

test("comptime TDZ: destructuring de objeto reserva todos sus nombres", () => {
  assert.throws(() => value("let x = 1; { return x; const {x} = {x: 2}; }"), tdz);
});

test("comptime TDZ: initializer del for no lee el contador exterior", () => {
  assert.throws(() => value("let i = 3; for (let i = i; i < 4; i += 1) {} return i;"), tdz);
});

test("comptime TDZ: el binding queda disponible despues de inicializarse", () => {
  assert.equal(value("let x = 1; { let x = 2; x += 3; return x; }"), 5);
});

test("comptime TDZ: un bloque sin shadowing conserva acceso al exterior", () => {
  assert.equal(value("let x = 4; { let y = x + 1; return y; }"), 5);
});

test("comptime TDZ: se aplica dentro de callbacks", () => {
  assert.throws(() => value("let x = 1; return [1].map((n: number): number => { return x; let x = n; })[0];"), tdz);
});

test("comptime TDZ: se aplica dentro de funciones llamadas", () => {
  assert.throws(() => value("return read();", "function read(): number { let x = 1; { return x; let x = 2; } }"), tdz);
});

test("comptime TDZ: una captura top-level respeta el orden de declaracion", () => {
  assert.throws(() => evaluateComptime(parse(`const early = comptime(() => later); const later = 7;`)), tdz);
});
