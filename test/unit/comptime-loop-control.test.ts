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

test("comptime loops: break sale del for pero no de la funcion", () => {
  assert.equal(value("let sum = 0; for (let i = 0; i < 5; i += 1) { if (i == 3) { break; } sum += i; } return sum + 10;"), 13);
});

test("comptime loops: break omite el incremento del for", () => {
  assert.equal(value("let i = 0; for (; i < 5; i += 1) { break; } return i;"), 0);
});

test("comptime loops: continue ejecuta el incremento del for", () => {
  assert.equal(value("let sum = 0; for (let i = 0; i < 5; i += 1) { if (i == 2) { continue; } sum += i; } return sum;"), 8);
});

test("comptime loops: continue incondicional termina un for acotado", () => {
  assert.equal(value("let i = 0; for (; i < 4; i += 1) { continue; } return i;"), 4);
});

test("comptime loops: break sale del while pero no de la funcion", () => {
  assert.equal(value("let n = 0; while (true) { n += 1; if (n == 3) { break; } } return n + 10;"), 13);
});

test("comptime loops: continue vuelve a comprobar la condicion del while", () => {
  assert.equal(value("let n = 0; let sum = 0; while (n < 4) { n += 1; if (n == 2) { continue; } sum += n; } return sum;"), 8);
});

test("comptime loops: break afecta solo al bucle mas cercano", () => {
  assert.equal(value("let sum = 0; for (let i = 0; i < 3; i += 1) { for (let j = 0; j < 5; j += 1) { if (j == 2) { break; } sum += 1; } sum += 10; } return sum;"), 36);
});

test("comptime loops: continue afecta solo al bucle mas cercano", () => {
  assert.equal(value("let sum = 0; for (let i = 0; i < 3; i += 1) { let j = 0; while (j < 3) { j += 1; if (j == 2) { continue; } sum += 1; } sum += 10; } return sum;"), 36);
});

test("comptime loops: bloque anidado propaga break", () => {
  assert.equal(value("let n = 0; while (true) { { { n += 1; break; } } n += 100; } return n;"), 1);
});

test("comptime loops: return atraviesa todos los bucles", () => {
  assert.equal(value("for (let i = 0; i < 3; i += 1) { while (true) { return 7; } } return 99;"), 7);
});

for (const keyword of ["break", "continue"]) {
  test(`comptime loops: ${keyword} fuera de un bucle produce diagnostico`, () => {
    assert.throws(() => value(`${keyword}; return 7;`), /fuera de un bucle/);
  });
  test(`comptime loops: ${keyword} no escapa de una funcion llamada`, () => {
    assert.throws(() => value("while (true) { invalid(); break; } return 7;",
      `function invalid(): void { ${keyword}; }`), /fuera de un bucle/);
  });
}

test("comptime loops: continue infinito sigue limitado por presupuesto", () => {
  assert.throws(() => value("while (true) { continue; } return 7;"), /excedio|excedido/);
});

test("comptime loops: pipeline completo conserva el resultado tras break", () => {
  const result = compile("const answer: number = comptime((): number => { let n: number = 0; while (true) { n += 1; if (n == 3) { break; } } return n; });");
  const declaration = result.ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "answer");
  assert.ok(declaration && declaration.kind === "VariableDeclaration");
  assert.equal((declaration.initializer as { value: unknown }).value, 3);
});
