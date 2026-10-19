import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, compile, evalEtsgenCalls } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";

const simple = '@etsgen function emit(): string { return "print(7);"; }\nemit();';

function failure(source: string, limits: Record<string, number>, code: string) {
  assert.throws(() => evalEtsgenCalls(parse(source), undefined, limits), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError, String(error));
    assert.equal(error.diagnostics[0]?.code, code);
    assert.ok(error.diagnostics[0].span.start.line > 0);
    assert.ok(error.diagnostics[0].span.start.column > 0);
    return true;
  });
}

function printCount(source: string, limits: Record<string, number>): number {
  return evalEtsgenCalls(parse(source), undefined, limits).statements.filter(item => item.kind === "ExpressionStatement" && item.expression.kind === "CallExpression" && item.expression.callee === "print").length;
}

test("etsgen limits: recursion directa no acaba en RangeError", () => {
  failure('@etsgen function loop(n: number): string { return loop(n); }\nloop(1);', { maxRecursion: 8 }, "ETSGEN_RECURSION_LIMIT");
});

test("etsgen limits: recursion mutua comparte profundidad", () => {
  failure('@etsgen function left(n: number): string { return right(n); }\n@etsgen function right(n: number): string { return left(n); }\nleft(1);', { maxRecursion: 8 }, "ETSGEN_RECURSION_LIMIT");
});

test("etsgen limits: pipeline por defecto detiene recursion", () => {
  assert.throws(() => compile('@etsgen function loop(n: number): string { return loop(n); }\nloop(1);'), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "ETSGEN_RECURSION_LIMIT");
    return true;
  });
});

test("etsgen limits: cero instrucciones rechaza la primera expresion", () => {
  failure(simple, { maxInstructions: 0 }, "ETSGEN_INSTRUCTION_LIMIT");
});

test("etsgen limits: expresiones anidadas comparten instrucciones", () => {
  failure('@etsgen function emit(): string { return "print(" + (1 + 2 + 3 + 4) + ");"; }\nemit();', { maxInstructions: 3 }, "ETSGEN_INSTRUCTION_LIMIT");
});

test("etsgen limits: profundidades de expresiones tambien se acotan", () => {
  failure('@etsgen function emit(): string { return "print(" + (1 + 2 + 3 + 4) + ");"; }\nemit();', { maxRecursion: 2 }, "ETSGEN_RECURSION_LIMIT");
});

test("etsgen limits: resultados literales cuentan payload", () => {
  failure('@etsgen function emit(): string { return "' + " ".repeat(256) + '"; }\nemit();', { maxValueBytes: 128 }, "ETSGEN_VALUE_LIMIT");
});

test("etsgen limits: concat se comprueba antes de generar", () => {
  failure('@etsgen function emit(): string { return "' + " ".repeat(60) + '" + "' + " ".repeat(60) + '"; }\nemit();', { maxValueBytes: 200 }, "ETSGEN_VALUE_LIMIT");
});

test("etsgen limits: templates tambien consumen presupuesto", () => {
  failure('@etsgen function emit(): string { return `' + " ".repeat(100) + '${"' + " ".repeat(100) + '"}`; }\nemit();', { maxValueBytes: 128 }, "ETSGEN_VALUE_LIMIT");
});

test("etsgen limits: codigo generado se acota antes del parseo", () => {
  failure('@etsgen function emit(): string { return "' + "(".repeat(256) + '"; }\nemit();', { maxGeneratedBytes: 128 }, "ETSGEN_GENERATED_LIMIT");
});

test("etsgen limits: frontera de codigo generado en bytes UTF-8", () => {
  const source = '@etsgen function emit(): string { return "print(\'🙂\');"; }\nemit();';
  assert.equal(printCount(source, { maxGeneratedBytes: 14 }), 1);
  failure(source, { maxGeneratedBytes: 13 }, "ETSGEN_GENERATED_LIMIT");
});

test("etsgen limits: frontera de valor UTF-8", () => {
  const source = '@etsgen function emit(): string { return "/*🙂*/"; }\nemit();';
  assert.equal(printCount(source, { maxValueBytes: 16 }), 0);
  failure(source, { maxValueBytes: 15 }, "ETSGEN_VALUE_LIMIT");
});

test("etsgen limits: argumentos literales tambien se comprueban", () => {
  failure('@etsgen function emit(text: string): string { return "print(7);"; }\nemit("' + "x".repeat(256) + '");', { maxValueBytes: 128 }, "ETSGEN_VALUE_LIMIT");
});

test("etsgen limits: llamadas independientes no acumulan instrucciones", () => {
  assert.equal(printCount(simple + '\nemit();\nemit();\nemit();', { maxInstructions: 1 }), 4);
});

test("etsgen limits: llamadas independientes no acumulan valores", () => {
  assert.equal(printCount(simple + '\nemit();\nemit();\nemit();', { maxValueBytes: 17 }), 4);
});

test("etsgen limits: helpers anidados no reinician instrucciones", () => {
  failure('@etsgen function inner(): string { return "print(7);"; }\n@etsgen function outer(): string { return inner(); }\nouter();', { maxInstructions: 1 }, "ETSGEN_INSTRUCTION_LIMIT");
});

test("etsgen limits: capturas globales se comprueban al usarlas", () => {
  failure('const code: string = "' + " ".repeat(256) + '";\n@etsgen function emit(): string { return code; }\nemit();', { maxValueBytes: 128 }, "ETSGEN_VALUE_LIMIT");
});

test("etsgen limits: aritmetica global tiene presupuesto propio", () => {
  assert.equal(printCount('const n: number = 1 + 2;\n' + simple + '\nemit();', { maxInstructions: 3 }), 2);
});

test("etsgen limits: limites invalidos no desactivan protecciones", () => {
  for (const value of [NaN, Infinity, -1, 0.5]) {
    failure(simple, { maxInstructions: value }, "ETSGEN_INVALID_LIMIT");
  }
});

test("etsgen limits: sintaxis no soportada conserva fallback runtime", () => {
  assert.equal(printCount('@etsgen function emit(n: number): string { return "print(7);"; }\nfunction runtime(n: number): void { emit(n); }', {}), 0);
});
