import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "../../src/compiler.ts";
import { evaluateComptime, type ComptimeLimits } from "../../src/codegen/comptime-evaluator.ts";
import { DiagnosticError, formatDiagnostic, type Diagnostic } from "../../src/core/diagnostic.ts";
import { compileFile } from "../../src/modules/module-loader.ts";

const limits: ComptimeLimits = { maxInstructions: 10000, maxRecursion: 100, maxValueBytes: 1024 };

function failure(source: string, custom = limits): Diagnostic {
  try { evaluateComptime(parse(source), custom); }
  catch (error) {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics.length, 1);
    return error.diagnostics[0];
  }
  throw new Error("Se esperaba un diagnostico");
}

function position(source: string, offset: number) {
  const before = source.slice(0, offset);
  return { offset, line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}

function startsAt(diagnostic: Diagnostic, source: string, needle: string) {
  const offset = source.indexOf(needle);
  assert.ok(offset >= 0, needle);
  assert.deepEqual(diagnostic.span.start, position(source, offset));
  assert.ok(diagnostic.span.end.line >= diagnostic.span.start.line);
  assert.ok(diagnostic.span.end.offset > diagnostic.span.start.offset);
}

test("comptime diagnostics: division conserva inicio y fin de la expresion", () => {
  const source = "// header\nconst result = comptime(() => {\n  return 1 / 0;\n});";
  const diagnostic = failure(source);
  startsAt(diagnostic, source, "1 / 0");
  assert.deepEqual(diagnostic.span.end, position(source, source.indexOf("1 / 0") + 5));
});

test("comptime diagnostics: TDZ senala la lectura", () => {
  const source = "const result = comptime(() => {\n  return local;\n  let local = 1;\n});";
  startsAt(failure(source), source, "local;");
});

test("comptime diagnostics: binding no disponible conserva su codigo y posicion", () => {
  const source = "\nconst result = comptime(() => {\n  return missing;\n});";
  const diagnostic = failure(source);
  assert.equal(diagnostic.code, "COMPTIME_VALUE_UNAVAILABLE");
  startsAt(diagnostic, source, "missing");
});

test("comptime diagnostics: new no soportado senala la expresion", () => {
  const source = "\nconst result = comptime(() => {\n  return new Model();\n});";
  startsAt(failure(source), source, "new Model()");
});

test("comptime diagnostics: Math no pierde posiciones al delegar", () => {
  const source = "\nconst result = comptime(() => {\n  return Math.unknown(1);\n});";
  startsAt(failure(source), source, "Math.unknown(1)");
});

test("comptime diagnostics: indices invalidos senalan la asignacion", () => {
  const source = "const result = comptime(() => {\n  const xs = [];\n  xs[-1] = 7;\n  return 1;\n});";
  const diagnostic = failure(source);
  assert.equal(diagnostic.code, "COMPTIME_INVALID_INDEX");
  startsAt(diagnostic, source, "xs[-1]");
});

test("comptime diagnostics: ciclo senala el argumento de la mutacion", () => {
  const source = "const result = comptime(() => {\n  const xs = [];\n  xs.push(xs);\n  return 7;\n});";
  const diagnostic = failure(source);
  assert.equal(diagnostic.code, "COMPTIME_CYCLIC_VALUE");
  const argumentOffset = source.indexOf("xs);");
  assert.deepEqual(diagnostic.span.start, position(source, argumentOffset));
});

test("comptime diagnostics: limite de declaracion local conserva la sentencia", () => {
  const source = `const result = comptime(() => {\n  const text = "${"x".repeat(256)}";\n  return 7;\n});`;
  const diagnostic = failure(source, { ...limits, maxValueBytes: 128 });
  assert.equal(diagnostic.code, "COMPTIME_VALUE_LIMIT");
  startsAt(diagnostic, source, "const text");
});

test("comptime diagnostics: limite de array literal conserva el initializer", () => {
  const source = "const result = comptime(() => {\n  const xs = [1, 2, 3];\n  return 7;\n});";
  startsAt(failure(source, { ...limits, maxValueBytes: 8 }), source, "[1, 2, 3]");
});

test("comptime diagnostics: instrucciones agotadas senalan el nodo ejecutado", () => {
  const source = "\nconst result = comptime(() => {\n  return 7;\n});";
  const diagnostic = failure(source, { ...limits, maxInstructions: 0 });
  startsAt(diagnostic, source, "{\n  return");
});

test("comptime diagnostics: recursion senala la llamada que excede el limite", () => {
  const source = "function dive(): number {\n  return dive();\n}\nconst result = comptime(() => dive());";
  startsAt(failure(source, { ...limits, maxRecursion: 1 }), source, "dive();");
});

test("comptime diagnostics: cppgen conserva la posicion del call site", () => {
  const source = `@cppgen function emit(): string { return "${"x".repeat(256)}"; }\n\n// call\nemit();`;
  startsAt(failure(source, { ...limits, maxValueBytes: 128 }), source, "emit();");
});

test("comptime diagnostics: CRLF y Unicode no convierten offset en columna", () => {
  const source = "// España 🙂\r\nconst result = comptime(() => {\r\n  return 1 / 0;\r\n});";
  startsAt(failure(source), source, "1 / 0");
});

test("comptime diagnostics: formatter muestra la linea real sin linea cero", () => {
  const source = "const result = comptime(() => {\n  return 1 / 0;\n});";
  const formatted = formatDiagnostic("sample.ets", source, failure(source));
  assert.match(formatted, /sample\.ets:2:10/);
  assert.match(formatted, /2 \|.*return 1 \/ 0/);
  assert.doesNotMatch(formatted, /sample\.ets:0:/);
});

async function modules(dependency: string, entry: string, check: (diagnostic: Diagnostic, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "estatic-diagnostic-"));
  try {
    writeFileSync(join(dir, "lib.ets"), dependency);
    writeFileSync(join(dir, "main.ets"), entry);
    await assert.rejects(() => compileFile(join(dir, "main.ets")), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      assert.equal(error.diagnostics.length, 1);
      check(error.diagnostics[0], dir);
      return true;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("comptime diagnostics: error del entry se remapea a su propio archivo", async () => {
  await modules("export const seed: number = 1;", 'import { seed } from "./lib.ets";\n\nconst result: number = comptime((): number => 1 / 0);', (diagnostic, dir) => {
    assert.equal(diagnostic.file, join(dir, "main.ets"));
    assert.ok(diagnostic.source);
    startsAt(diagnostic, diagnostic.source, "1 / 0");
    assert.equal(diagnostic.span.start.line, 3);
  });
});

test("comptime diagnostics: error en funcion importada senala la dependencia", async () => {
  const source = "@comptime export function broken(): number {\n  return 1 / 0;\n}";
  await modules(source, 'import { broken } from "./lib.ets";\nconst result: number = broken();', (diagnostic, dir) => {
    assert.equal(diagnostic.file, join(dir, "lib.ets"));
    assert.equal(diagnostic.source, source);
    startsAt(diagnostic, source, "1 / 0");
  });
});

test("comptime diagnostics: remapeo conserva fin y offsets relativos al source", async () => {
  await modules("// dependency\nexport const seed: number = 1;", 'import { seed } from "./lib.ets";\n// entry\nconst result: number = comptime((): number => 1 / 0);', diagnostic => {
    assert.ok(diagnostic.source);
    const offset = diagnostic.source.indexOf("1 / 0");
    assert.deepEqual(diagnostic.span.start, position(diagnostic.source, offset));
    assert.deepEqual(diagnostic.span.end, position(diagnostic.source, offset + 5));
  });
});
