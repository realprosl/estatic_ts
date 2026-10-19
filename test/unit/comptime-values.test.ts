import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, compile } from "../../src/compiler.ts";
import { evaluateComptime } from "../../src/codegen/comptime-evaluator.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";

function evaluate(body: string, bytes = 128, helpers = "") {
  return evaluateComptime(parse(`${helpers}\nconst result = comptime(() => { ${body} });`), {
    maxInstructions: 10000, maxRecursion: 100, maxValueBytes: bytes,
  });
}

function rejectsValueLimit(body: string, bytes = 128, helpers = ""): void {
  assert.throws(() => evaluate(body, bytes, helpers), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_VALUE_LIMIT");
    return true;
  });
}

test("comptime values: string devuelto no evade el limite", () => {
  rejectsValueLimit(`return "${"x".repeat(256)}";`);
});

test("comptime values: string local cuenta su payload", () => {
  rejectsValueLimit(`const text = "${"x".repeat(256)}"; return 7;`);
});

test("comptime values: frontera UTF-8 de un caracter no ASCII", () => {
  assert.doesNotThrow(() => evaluate('return "é";', 10));
  rejectsValueLimit('return "é";', 9);
});

test("comptime values: frontera UTF-8 de un emoji", () => {
  assert.doesNotThrow(() => evaluate('return "🙂";', 12));
  rejectsValueLimit('return "🙂";', 11);
});

test("comptime values: concat descartado tambien consume presupuesto", () => {
  rejectsValueLimit(`"${"a".repeat(80)}" + "${"b".repeat(80)}"; return 7;`);
});

test("comptime values: template descartado tambien consume presupuesto", () => {
  rejectsValueLimit('`' + "a".repeat(80) + '${"' + "b".repeat(80) + '"}`; return 7;');
});

test("comptime values: join comprueba el tamano antes de crear el string", () => {
  rejectsValueLimit(`const xs = [1, 2, 3]; xs.join("${"x".repeat(80)}"); return 7;`);
});

test("comptime values: push cuenta crecimiento aunque no se devuelva el array", () => {
  rejectsValueLimit("const xs = []; for (let i = 0; i < 40; i += 1) { xs.push(i); } return 7;");
});

test("comptime values: asignacion de indice cuenta crecimiento", () => {
  rejectsValueLimit("const xs = []; xs[10000000] = 7; return 7;");
});

test("comptime values: claves de objetos cuentan payload UTF-8", () => {
  rejectsValueLimit(`const obj = { ${"key".repeat(50)}: 7 }; return 7;`);
});

test("comptime values: asignacion de campo comprueba el nuevo valor", () => {
  rejectsValueLimit(`const obj = { x: 7 }; obj.x = "${"x".repeat(256)}"; return 7;`);
});

test("comptime values: strings devueltos por helpers tambien se comprueban", () => {
  rejectsValueLimit("helper(); return 7;", 128, `function helper(): string { return "${"x".repeat(256)}"; }`);
});

test("comptime values: resultado de map descartado se comprueba", () => {
  rejectsValueLimit(`const xs = [1, 2, 3]; xs.map((x: number): string => "${"x".repeat(80)}"); return 7;`);
});

test("comptime values: ciclos de arrays dan diagnostico y no RangeError", () => {
  assert.throws(() => evaluate("const xs = []; xs.push(xs); return xs;"), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_CYCLIC_VALUE");
    return true;
  });
});

test("comptime values: ciclos de objetos dan diagnostico", () => {
  assert.throws(() => evaluate("const obj = { x: 7 }; obj.x = obj; return obj;"), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_CYCLIC_VALUE");
    return true;
  });
});

test("comptime values: aliases sin ciclo siguen siendo validos", () => {
  assert.doesNotThrow(() => evaluate("const obj = { x: 7 }; const pair = { left: obj, right: obj }; return 7;", 1024));
});

test("comptime values: crecimiento de scalar arrays no factura snapshots completos", () => {
  assert.doesNotThrow(() => evaluate("const xs = []; for (let i = 0; i < 100; i += 1) { xs.push(i); } return 7;", 2048));
});

test("comptime values: string pequeno sigue evaluandose", () => {
  const result = evaluate('return "ok";').statements.find(item => item.kind === "VariableDeclaration");
  assert.ok(result && result.kind === "VariableDeclaration" && result.initializer.kind === "LiteralExpression");
  assert.equal(result.initializer.value, "ok");
});

test("comptime values: cppgen no puede devolver codigo ilimitado", () => {
  const ast = parse(`@cppgen function emit(): string { return "${"x".repeat(256)}"; } emit();`);
  assert.throws(() => evaluateComptime(ast, { maxInstructions: 10000, maxRecursion: 100, maxValueBytes: 128 }), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_VALUE_LIMIT");
    return true;
  });
});

test("comptime values: limite por defecto rechaza payload superior a 1 MiB", () => {
  assert.throws(() => compile(`const result: string = comptime((): string => "${"x".repeat(1024 * 1024 + 1)}");`), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_VALUE_LIMIT");
    return true;
  });
});

test("comptime values: asignacion de string descartado comprueba el payload", () => {
  rejectsValueLimit(`let text = ""; text = "${"x".repeat(256)}"; return 7;`);
});

test("comptime values: argumento no usado por un helper tambien se comprueba", () => {
  rejectsValueLimit(`helper("${"x".repeat(256)}"); return 7;`, 128, "function helper(text: string): number { return 7; }");
});

test("comptime values: ciclos mediante indices se rechazan antes de mutar", () => {
  assert.throws(() => evaluate("const xs = []; xs[0] = xs; return 7;"), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_CYCLIC_VALUE");
    return true;
  });
});

test("comptime values: ciclos mutuos no se confunden con aliases", () => {
  assert.throws(() => evaluate("const left = { x: 7 }; const right = { x: left }; left.x = right; return 7;", 1024), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "COMPTIME_CYCLIC_VALUE");
    return true;
  });
});

test("comptime values: frontera ASCII exacta incluye overhead logico", () => {
  assert.doesNotThrow(() => evaluate(`return "${"x".repeat(120)}";`, 128));
  rejectsValueLimit(`return "${"x".repeat(121)}";`, 128);
});

test("comptime values: UTF-8 no usa longitud UTF-16 del string", () => {
  assert.doesNotThrow(() => evaluate('return "🙂🙂";', 16));
  rejectsValueLimit('return "🙂🙂";', 15);
});

test("comptime values: length del array sigue disponible tras crecer", () => {
  const result = evaluate("const xs = []; xs.push(1); xs.push(2); return xs.length;").statements.find(item => item.kind === "VariableDeclaration");
  assert.ok(result && result.kind === "VariableDeclaration" && result.initializer.kind === "LiteralExpression");
  assert.equal(result.initializer.value, 2);
});

test("comptime values: el acceso a miembros no soportados sigue rechazado", () => {
  assert.throws(() => evaluate("const xs = []; return xs.missing;"), /member access solo soportado/);
});
