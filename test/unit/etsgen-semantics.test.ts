import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compile, parse, evalEtsgenCalls } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { compileFile } from "../../src/modules/module-loader.ts";
import { detectRuntimeBackends } from "../../src/modules/runtime-backends.ts";
import { CppGenerator } from "../../src/codegen/cpp-generator.ts";

function source(code: string, prefix = "", globals = "") {
  return `${globals}\n@etsgen function emit(): string { return ${JSON.stringify(code)}; }\nfunction run(): void { ${prefix}\n  emit();\n}`;
}

function rejectsGenerated(code: string, expected: RegExp, prefix = "") {
  assert.throws(() => compile(source(code, prefix)), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError, String(error));
    const diagnostic = error.diagnostics.find(item => item.code === "ETSGEN_GENERATED_SEMANTIC");
    assert.ok(diagnostic, error.message);
    assert.match(diagnostic.message, /emit/);
    assert.match(diagnostic.message, expected);
    assert.equal(diagnostic.span.start.line, 4);
    assert.equal(diagnostic.span.start.column, 3);
    assert.ok(diagnostic.notes?.some(note => note.includes("generado")));
    return true;
  });
}

for (const [label, code, message] of [
  ["tipo local", 'let hidden: string = 1;', /string|number/],
  ["mutacion de const", 'const hidden: number = 1; hidden = 2;', /constante/],
  ["variable inexistente", 'print(missing);', /missing/],
  ["funcion inexistente", 'unknownFunction();', /unknownFunction/],
  ["array incompatible", 'const xs: number[] = [1, "bad"];', /number|string/],
  ["argumento incompatible", 'numberToString("bad");', /number|string/],
  ["return incompatible", 'return 1;', /void|number/],
] as const) {
  test(`etsgen semantics: rechaza ${label} antes de emitir C++`, () => rejectsGenerated(code, message));
}

test("etsgen semantics: respeta const del caller", () => {
  rejectsGenerated("value = 2;", /constante/, "const value: number = 1;");
});

test("etsgen semantics: separa bindings generados del caller", () => {
  const {ast}=compile(source("let value: number = 2;", "let value: number = 1;"));
  const binding=ast.generatedSources?.[0].bindings?.find(item=>item.name === "value");
  assert.ok(binding);
  assert.notEqual(binding.emittedName,"value");
});

test("etsgen semantics: conserva captura de variable local", () => {
  const { cpp } = compile(source("print(value + 1);", "let value: number = 7;"));
  assert.match(cpp, /value \+ 1\.0/);
  assert.doesNotMatch(cpp, /etsgen: error/);
});

test("etsgen semantics: conserva captura de parametros", () => {
  const { cpp } = compile('@etsgen function emit(): string { return "print(value);"; }\nfunction run(value: number): void { emit(); }');
  assert.match(cpp, /print\(value\)/);
});

test("etsgen semantics: conserva funciones del programa", () => {
  const { cpp } = compile(source("print(helper(7));", "", "function helper(n: number): number { return n + 1; }"));
  assert.match(cpp, /helper\(7\.0\)/);
});

test("etsgen semantics: conserva condicional que usa el caller", () => {
  const { cpp } = compile(source('if (value > 5) { print("big"); } else { print("small"); }', "let value: number = 7;"));
  assert.match(cpp, /if \(\(value > 5\.0\)\)/);
});

test("etsgen semantics: arrays y callbacks usan tipos reales al emitir", () => {
  const { cpp } = compile(source("const xs: number[] = [1, 2]; const ys: number[] = xs.map<number>((x: number): number => x + 1); print(ys[0]);"));
  assert.match(cpp, /ets_map_vec<double, double>/);
  assert.match(cpp, /#include "runtime\/ets_collections\.hpp"/);
  assert.doesNotMatch(cpp, /etsgen: error|\.map</);
});

test("etsgen semantics: sintaxis invalida da diagnostico estructurado", () => {
  assert.throws(() => compile(source("let x = ;")), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "ETSGEN_GENERATED_PARSE");
    assert.match(error.message, /generated invalid code.*generated:.*parse error:/s);
    assert.equal(error.diagnostics[0].span.start.line, 4);
    return true;
  });
});

test("etsgen semantics: API directa tambien valida el fragmento", () => {
  assert.throws(() => evalEtsgenCalls(parse(source('let hidden: string = 1;'))), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.ok(error.diagnostics.some(item => item.code === "ETSGEN_GENERATED_SEMANTIC"));
    return true;
  });
});

test("etsgen semantics: no compila ni extrae C++ durante la expansión", context => {
  context.mock.method(CppGenerator.prototype, "generateModule", () => { throw new Error("la expansión no debe llamar al emisor de módulos"); });
  const { ast, cpp } = compile(source("print(7);"));
  assert.match(cpp, /print\(7\.0\)/);
  assert.doesNotMatch(JSON.stringify(ast), /RawCppExpression|generatedAst/);
});

test("etsgen semantics: varias generaciones conservan su propio contexto", () => {
  const { cpp } = compile('@etsgen function emit(): string { return "print(value);"; }\nfunction left(value: number): void { emit(); }\nfunction right(value: string): void { emit(); }');
  assert.equal((cpp.match(/print\(value\)/g) ?? []).length, 2);
});

test("etsgen semantics: fragmento vacio sigue siendo valido", () => {
  assert.doesNotThrow(() => compile(source("")));
});

test("etsgen semantics: contexto de expresion se rechaza explicitamente", () => {
  assert.throws(() => compile('@etsgen function emit(): string { return "print(7);"; }\nconst text: string = emit();'), (error: unknown) => {
    assert.ok(error instanceof DiagnosticError);
    assert.equal(error.diagnostics[0]?.code, "ETSGEN_GENERATED_CONTEXT");
    return true;
  });
});

test("etsgen semantics: metadatos conservan backends sin ciclos", () => {
  const { ast } = compile(source("setTimeout((): void => {}, 1);"));
  assert.doesNotThrow(() => JSON.stringify(ast));
  const backends = detectRuntimeBackends(ast);
  assert.equal(backends.libuv, true);
});

test("etsgen semantics: errores generados se atribuyen al modulo del caller", async () => {
  const dir = mkdtempSync(join(tmpdir(), "estatic-generated-semantic-"));
  try {
    writeFileSync(join(dir, "lib.ets"), '@etsgen export function emit(): string { return "let hidden: string = 1;"; }');
    writeFileSync(join(dir, "main.ets"), 'import { emit } from "./lib.ets";\n\nemit();');
    await assert.rejects(() => compileFile(join(dir, "main.ets")), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      const diagnostic = error.diagnostics.find(item => item.code === "ETSGEN_GENERATED_SEMANTIC");
      assert.ok(diagnostic, error.message);
      assert.equal(diagnostic.file, join(dir, "main.ets"));
      assert.equal(diagnostic.span.start.line, 3);
      return true;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
