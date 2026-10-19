import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, parse, evalEtsgenCalls } from "../../src/compiler.ts";
import { evaluateComptime } from "../../src/codegen/comptime-evaluator.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { TypeChecker } from "../../src/semantic/type-checker.ts";

function value(source: string, name = "result"): unknown {
  const declaration = compile(source).ast.statements.find(item => item.kind === "VariableDeclaration" && item.name === name);
  assert.ok(declaration && declaration.kind === "VariableDeclaration");
  assert.equal(declaration.initializer.kind, "LiteralExpression");
  return (declaration.initializer as { value: unknown }).value;
}

const overloads = `function choose(n: number): number { return 11; }
  function choose(n: string): number { return 99; }`;

test("comptime overloads: respeta numero frente a string", () => {
  assert.equal(value(`${overloads} const result: number = comptime((): number => choose(1));`), 11);
});

test("comptime overloads: respeta string frente a numero en orden inverso", () => {
  assert.equal(value(`function choose(n: string): number { return 99; }
    function choose(n: number): number { return 11; }
    const result: number = comptime((): number => choose("x"));`), 99);
});

test("comptime overloads: distingue tipos de retorno diferentes", () => {
  assert.equal(value(`function choose(n: number): number { return 11; }
    function choose(n: string): string { return "text"; }
    const result: number = comptime((): number => choose(1));`), 11);
});

test("comptime overloads: distingue boolean", () => {
  assert.equal(value(`function choose(n: boolean): number { return 7; }
    ${overloads} const result: number = comptime((): number => choose(true));`), 7);
});

test("comptime overloads: distingue aridad", () => {
  assert.equal(value(`function choose(): number { return 7; }
    function choose(n: number): number { return 11; }
    const result: number = comptime((): number => choose());`), 7);
});

test("comptime overloads: usa el tipo estatico de un array vacio", () => {
  assert.equal(value(`function choose(xs: number[]): number { return 11; }
    function choose(xs: string[]): number { return 99; }
    const result: number = comptime((): number => { const xs: number[] = []; return choose(xs); });`), 11);
});

test("comptime overloads: mantiene aliases", () => {
  assert.equal(value(`type Count = number;
    function choose(n: Count): number { return 11; }
    function choose(n: string): number { return 99; }
    const result: number = comptime((): number => choose(1));`), 11);
});

test("comptime overloads: usa la sobrecarga generica seleccionada por el checker", () => {
  assert.equal(value(`function choose<T>(n: T): number { return 11; }
    function choose(n: string): number { return 99; }
    const result: number = comptime((): number => choose<number>(1));`), 11);
});

test("comptime overloads: llamadas anidadas y recursivas conservan la seleccion", () => {
  assert.equal(value(`function choose(n: number): number { if (n <= 0) return 1; return choose(n - 1) + 1; }
    function choose(n: string): number { return 99; }
    function outer(n: number): number { return choose(n); }
    const result: number = comptime((): number => outer(3));`), 4);
});

test("comptime overloads: evalua argumentos una sola vez", () => {
  assert.equal(value(`${overloads}
    const result: number = comptime((): number => { let count: number = 0; const n: number = choose(count += 1); return n + count; });`), 12);
});

test("comptime overloads: @comptime usa la sobrecarga elegida", () => {
  assert.equal(value(`@comptime function choose(n: number): number { return 11; }
    @comptime function choose(n: string): number { return 99; }
    const result: number = choose(1);`), 11);
});

test("comptime overloads: el decorador pertenece a la firma, no al nombre", () => {
  const source = `@comptime function choose(n: number): number { return 11; }
    function choose(n: string): number { return 99; }
    const result: number = choose(1);
    function runtime(n: string): number { return choose(n); }`;
  assert.equal(value(source), 11);
  assert.match(compile(source).cpp, /return choose\(n\)/);
});

test("comptime overloads: llamada runtime a @comptime se aplaza con su firma", () => {
  const { cpp } = compile(`@comptime function choose(n: number): number { return n + 11; }
    @comptime function choose(n: string): number { return 99; }
    function runtime(n: number): number { return choose(n); }`);
  assert.match(cpp, /return choose\(n\)/);
});

test("comptime overloads: @cppgen usa la sobrecarga elegida", () => {
  const { ast } = compile(`@cppgen function emit(n: number): string { return "print(11);"; }
    @cppgen function emit(n: string): string { return "print(99);"; }
    emit(1);`);
  const result = ast.statements.find(item => item.kind === "ExpressionStatement");
  assert.ok(result && result.kind === "ExpressionStatement" && result.expression.kind === "RawCppExpression");
  assert.equal(result.expression.value, "print(11);");
});

test("comptime overloads: @etsgen usa la sobrecarga elegida", () => {
  const { ast } = compile(`@etsgen function emit(n: number): string { return "print(11);"; }
    @etsgen function emit(n: string): string { return "print(99);"; }
    emit(1);`);
  const statement = ast.statements.find(item => item.kind === "ExpressionStatement");
  assert.ok(statement && statement.kind === "ExpressionStatement" && statement.expression.kind === "CallExpression");
  assert.equal(statement.expression.callee, "print");
  assert.deepEqual(statement.expression.args.map(arg => arg.kind === "LiteralExpression" ? arg.value : undefined), [11]);
});

test("comptime overloads: @etsgen anidado mantiene la firma seleccionada", () => {
  const { ast } = compile(`@etsgen function inner(n: number): string { return "print(11);"; }
    @etsgen function inner(n: string): string { return "print(99);"; }
    @etsgen function outer(n: number): string { return inner(n); }
    outer(1);`);
  const statement = ast.statements.find(item => item.kind === "ExpressionStatement");
  assert.ok(statement && statement.kind === "ExpressionStatement" && statement.expression.kind === "CallExpression");
  assert.equal(statement.expression.callee, "print");
  assert.deepEqual(statement.expression.args.map(arg => arg.kind === "LiteralExpression" ? arg.value : undefined), [11]);
});

test("comptime overloads: los tipos incompatibles siguen siendo rechazados", () => {
  assert.throws(() => compile(`${overloads} const result: number = comptime((): number => choose(true));`), /Ninguna sobrecarga/);
});

test("comptime overloads: API directa sin checker rechaza seleccion desconocida", () => {
  assert.throws(() => evaluateComptime(parse(`${overloads} const result = comptime(() => choose(1));`)), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_OVERLOAD_UNRESOLVED");
    return true;
  });
});

test("comptime overloads: mini evaluator directo tampoco elige la ultima firma", () => {
  assert.throws(() => evalEtsgenCalls(parse(`@etsgen function emit(n: number): string { return "print(11);"; }
    @etsgen function emit(n: string): string { return "print(99);"; }
    emit(1);`)), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_OVERLOAD_UNRESOLVED");
    return true;
  });
});

test("comptime overloads: varios call sites conservan selecciones independientes", () => {
  assert.equal(value(`${overloads}
    const result: number = comptime((): number => choose(1) + choose("x") + choose(2));`), 121);
});

test("comptime overloads: @cppgen no transforma una firma runtime homonima", () => {
  const { ast, cpp } = compile(`@cppgen function emit(n: number): string { return "print(11);"; }
    function emit(n: string): string { return n; }
    emit(1);
    function runtime(n: string): string { return emit(n); }`);
  const statement = ast.statements.find(item => item.kind === "ExpressionStatement");
  assert.ok(statement && statement.kind === "ExpressionStatement" && statement.expression.kind === "RawCppExpression");
  assert.equal(statement.expression.value, "print(11);");
  assert.match(cpp, /return emit\(n\)/);
});

test("comptime overloads: @etsgen no transforma una firma runtime homonima", () => {
  const { ast, cpp } = compile(`function emit(n: string): string { return n; }
    @etsgen function emit(n: number): string { return "print(11);"; }
    emit(1);
    function runtime(n: string): string { return emit(n); }`);
  const statement = ast.statements.find(item => item.kind === "ExpressionStatement");
  assert.ok(statement && statement.kind === "ExpressionStatement" && statement.expression.kind === "CallExpression");
  assert.equal(statement.expression.callee, "print");
  assert.deepEqual(statement.expression.args.map(arg => arg.kind === "LiteralExpression" ? arg.value : undefined), [11]);
  assert.match(cpp, /return emit\(n\)/);
});

test("comptime overloads: API directa acepta la seleccion del checker", () => {
  const ast = parse(`${overloads} const result: number = comptime((): number => choose(1));`);
  const checker = new TypeChecker();
  checker.check(ast);
  const result = evaluateComptime(ast, undefined, call => checker.functionOf(call)).statements.find(item => item.kind === "VariableDeclaration");
  assert.ok(result && result.kind === "VariableDeclaration" && result.initializer.kind === "LiteralExpression");
  assert.equal(result.initializer.value, 11);
});

test("comptime overloads: mini evaluator acepta la seleccion del checker", () => {
  const ast = parse(`@etsgen function emit(n: number): string { return "print(11);"; }
    @etsgen function emit(n: string): string { return "print(99);"; }
    emit(1);`);
  const checker = new TypeChecker();
  checker.check(ast);
  const statement = evalEtsgenCalls(ast, call => checker.functionOf(call)).statements.find(item => item.kind === "ExpressionStatement");
  assert.ok(statement && statement.kind === "ExpressionStatement" && statement.expression.kind === "CallExpression");
  assert.equal(statement.expression.callee, "print");
  assert.deepEqual(statement.expression.args.map(arg => arg.kind === "LiteralExpression" ? arg.value : undefined), [11]);
});

test("comptime overloads: la seleccion no introduce ciclos en el AST", () => {
  const { ast } = compile(`${overloads} const result: number = comptime((): number => choose(1));`);
  assert.doesNotThrow(() => JSON.stringify(ast));
});
