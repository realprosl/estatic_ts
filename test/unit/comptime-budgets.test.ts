import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, parse } from "../../src/compiler.ts";
import { evaluateComptime, type ComptimeLimits } from "../../src/codegen/comptime-evaluator.ts";
import type { Program } from "../../src/ast/nodes.ts";

const limits: ComptimeLimits = { maxInstructions: 200, maxRecursion: 5, maxValueBytes: 1024 };
const work = "let n = 0; for (let i = 0; i < 10; i += 1) { n += 1; } return n;";
const helper = `function work(): number { ${work} }`;

function evaluate(source: string, custom = limits): Program {
  return evaluateComptime(parse(source), custom);
}

function literal(ast: Program, name: string): unknown {
  const result = ast.statements.find(item => item.kind === "VariableDeclaration" && item.name === name);
  assert.ok(result && result.kind === "VariableDeclaration" && result.initializer.kind === "LiteralExpression");
  return result.initializer.value;
}

test("comptime budgets: una evaluacion cabe dentro del limite", () => {
  assert.equal(literal(evaluate(`const result = comptime(() => { ${work} });`), "result"), 10);
});

test("comptime budgets: arrows independientes no suman instrucciones", () => {
  const ast = evaluate(Array.from({ length: 4 }, (_, i) => `const result${i} = comptime(() => { ${work} });`).join("\n"));
  for (let i = 0; i < 4; i++) assert.equal(literal(ast, `result${i}`), 10);
});

test("comptime budgets: funciones decoradas independientes no comparten presupuesto", () => {
  const ast = evaluate(`@comptime ${helper}\n` + Array.from({ length: 4 }, (_, i) => `const result${i} = work();`).join("\n"));
  for (let i = 0; i < 4; i++) assert.equal(literal(ast, `result${i}`), 10);
});

test("comptime budgets: cppgen independiente no comparte presupuesto", () => {
  const ast = evaluate(`@cppgen function emit(): string { ${work.replace("return n;", 'return "print(10);";')} }\n` + "emit();\n".repeat(4));
  const statements = ast.statements.filter(item => item.kind === "ExpressionStatement");
  assert.equal(statements.length, 4);
  for (const statement of statements) {
    assert.ok(statement.kind === "ExpressionStatement" && statement.expression.kind === "RawCppExpression");
    assert.equal(statement.expression.value, "print(10);");
  }
});

test("comptime budgets: inicializadores especulativos no consumen el presupuesto del caller", () => {
  const ast = evaluate(`${helper}\nconst earlier = work();\nconst result = comptime(() => { ${work} });`);
  assert.equal(literal(ast, "result"), 10);
});

test("comptime budgets: muchos literales previos no agotan una evaluacion pequena", () => {
  const source = Array.from({ length: 250 }, (_, i) => `const value${i} = ${i};`).join("\n");
  assert.equal(literal(evaluate(`${source}\nconst result = comptime(() => 7);`), "result"), 7);
});

test("comptime budgets: un intento especulativo agotado no contamina la siguiente raiz", () => {
  const ast = evaluate(`function expensive(): number { let n = 0; while (n < 1000) n += 1; return n; }
    const earlier = expensive(); const result = comptime(() => 7);`);
  assert.equal(literal(ast, "result"), 7);
});

test("comptime budgets: recursion especulativa agotada restaura la profundidad", () => {
  const ast = evaluate(`function recurse(n: number): number { return n <= 0 ? 1 : recurse(n - 1); }
    ${Array.from({ length: 8 }, (_, i) => `const earlier${i} = recurse(20);`).join("\n")}
    @comptime function small(): number { return 7; }
    const result = small();`);
  assert.equal(literal(ast, "result"), 7);
});

test("comptime budgets: estimaciones de valores se reinician entre raices", () => {
  const ast = evaluate(Array.from({ length: 4 }, (_, i) => `const result${i} = comptime(() => { const xs = [1, 2, 3]; return 7; });`).join("\n"), { ...limits, maxValueBytes: 80 });
  for (let i = 0; i < 4; i++) assert.equal(literal(ast, `result${i}`), 7);
});

test("comptime budgets: arrays top-level especulativos no contaminan memoria posterior", () => {
  const source = Array.from({ length: 4 }, (_, i) => `const xs${i} = [1, 2, 3];`).join("\n");
  const ast = evaluate(`${source}\nconst result = comptime(() => { const xs = [1, 2, 3]; return 7; });`, { ...limits, maxValueBytes: 80 });
  assert.equal(literal(ast, "result"), 7);
});

test("comptime budgets: helper anidado sigue sumando instrucciones a la misma raiz", () => {
  assert.throws(() => evaluate(`${helper}\nconst result = comptime(() => work() + work());`), /limite de 200 instrucciones/);
});

test("comptime budgets: helpers decorados no reinician instrucciones de su caller", () => {
  assert.throws(() => evaluate(`@comptime ${helper}\n@comptime function outer(): number { return work() + work(); }\nconst result = outer();`), /limite de 200 instrucciones/);
});

test("comptime budgets: helper anidado sigue sumando estimaciones de valores", () => {
  assert.throws(() => evaluate(`function allocate(): number { const xs = [1, 2, 3]; return 7; }
    const result = comptime(() => allocate() + allocate());`, { ...limits, maxValueBytes: 80 }), /limite de 80 bytes/);
});

test("comptime budgets: bucle infinito mantiene su limite", () => {
  assert.throws(() => evaluate("const result = comptime(() => { while (true) { continue; } return 7; });"), /limite|exced/);
});

test("comptime budgets: recursion profunda mantiene su limite", () => {
  assert.throws(() => evaluate(`function recurse(n: number): number { return n <= 0 ? 1 : recurse(n - 1); }
    const result = comptime(() => recurse(20));`), /profundidad de recursion excede 5/);
});

test("comptime budgets: pipeline por defecto acepta muchas constantes independientes", () => {
  const source = Array.from({ length: 100 }, (_, i) => `const result${i}: number = comptime((): number => { ${work} });`).join("\n");
  const { ast } = compile(source);
  for (let i = 0; i < 100; i++) assert.equal(literal(ast, `result${i}`), 10);
});
