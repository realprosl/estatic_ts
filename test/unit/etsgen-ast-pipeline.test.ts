import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";
import { TypeChecker } from "../../src/semantic/type-checker.ts";
import { DiagnosticError, formatDiagnostic } from "../../src/core/diagnostic.ts";
import { compileFile } from "../../src/modules/module-loader.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

function source(code: string) { return `@etsgen function emit(): string { return ${JSON.stringify(code)}; }\n\nemit();`; }
function failure(code: string) {
  try { compile(source(code)); assert.fail("debe rechazar el fragmento"); }
  catch(error) { assert.ok(error instanceof DiagnosticError); return error.diagnostics[0]; }
}

test("etsgen AST: resultado conserva declaraciones y llamadas ordinarias", () => {
  const code = "const generated: i32 = 7; print(generated);";
  const {ast} = compile(source(code));
  assert.ok(ast.statements.some(s=>s.kind === "VariableDeclaration" && s.span.hygiene?.name === "generated"));
  assert.ok(ast.statements.some(s=>s.kind === "ExpressionStatement" && s.expression.kind === "CallExpression" && s.expression.callee === "print"));
  assert.doesNotMatch(JSON.stringify(ast),/RawCppExpression|generatedAst/);
  assert.equal(ast.generatedSources?.[0].source,code);
  assert.equal(ast.generatedSources?.[0].generator,"emit");
});

test("etsgen AST: nodos conservan llamada y coordenadas del ETS generado", () => {
  const {ast} = compile(source("// línea 1\nconst generated: i32 = 7;\nprint(generated);"));
  const stmt=ast.statements.find(s=>s.kind === "VariableDeclaration");
  assert.ok(stmt);
  assert.equal(stmt.span.start.line,3);
  assert.equal(stmt.span.generated?.span.start.line,2);
  assert.equal(stmt.span.generated?.id,ast.generatedSources?.[0].id);
  assert.doesNotThrow(()=>JSON.stringify(ast));
});

test("etsgen AST: fragmentos independientes reciben identidades diferentes", () => {
  const {ast}=compile(source("print(7);")+"\nemit();");
  assert.equal(ast.generatedSources?.length,2);
  assert.notEqual(ast.generatedSources?.[0].id,ast.generatedSources?.[1].id);
  const statements=ast.statements.filter(s=>s.kind === "ExpressionStatement");
  assert.deepEqual(statements.map(s=>s.span.generated?.id),ast.generatedSources?.map(s=>s.id));
});

test("etsgen AST: fragmento vacío no deja una expresión C++", () => {
  const {ast}=compile(source("// solo un comentario"));
  assert.equal(ast.statements.filter(s=>s.kind !== "FunctionDeclaration").length,0);
  assert.equal(ast.generatedSources?.[0].source,"// solo un comentario");
});

test("etsgen diagnostic: error semántico muestra línea del fragmento y caller", () => {
  const code="const a: number = 1;\nconst b: number = 2;\nlet bad: string = a;";
  const diagnostic=failure(code);
  assert.equal(diagnostic.code,"ETSGEN_GENERATED_SEMANTIC");
  assert.equal(diagnostic.span.start.line,3);
  assert.equal(diagnostic.generated?.span.start.line,3);
  assert.equal(diagnostic.generated?.source,code);
  const rendered=formatDiagnostic("main.ets",source(code),diagnostic);
  assert.match(rendered,/main\.ets:3:1/);
  assert.match(rendered,/fragmento @etsgen 'emit'/);
  assert.match(rendered,/3 \| let bad: string = a;/);
});

test("etsgen diagnostic: error de parser expone ETS y posición interna", () => {
  const code="print(1);\nconst ok: number = 2;\nconst bad = ;";
  const diagnostic=failure(code);
  assert.equal(diagnostic.code,"ETSGEN_GENERATED_PARSE");
  assert.equal(diagnostic.generated?.span.start.line,3);
  assert.equal(diagnostic.generated?.source,code);
  assert.match(formatDiagnostic("main.ets",source(code),diagnostic),/3 \| const bad = ;/);
});

test("etsgen diagnostic: Unicode y CRLF no desplazan la línea interna", () => {
  const code='print("España 🙂");\r\nlet bad: string = 1;';
  const diagnostic=failure(code);
  assert.equal(diagnostic.generated?.span.start.line,2);
  assert.equal(diagnostic.generated?.span.start.offset,code.indexOf("let"));
});

test("etsgen diagnostic: excerpt largo muestra la línea del error", () => {
  const code="//"+"x".repeat(350)+"\nlet bad: string = 1;";
  const rendered=formatDiagnostic("main.ets",source(code),failure(code));
  assert.match(rendered,/2 \| let bad: string = 1;/);
  assert.ok(rendered.length < 2000);
});

test("etsgen diagnostic: revalidación posterior conserva procedencia", () => {
  const {ast}=compile(source("const generated: number = 7;"));
  const stmt=ast.statements.find(s=>s.kind === "VariableDeclaration");
  assert.ok(stmt?.kind === "VariableDeclaration");
  stmt.initializer={kind:"LiteralExpression",value:"bad",literalType:"string",span:stmt.initializer.span};
  assert.throws(()=>new TypeChecker().check(ast),(error:unknown)=>{
    assert.ok(error instanceof DiagnosticError);
    const diagnostic=error.diagnostics.find(d=>d.generated);
    assert.ok(diagnostic);
    assert.equal(diagnostic.code,"ETSGEN_GENERATED_SEMANTIC");
    assert.equal(diagnostic.generated?.generator,"emit");
    assert.match(formatDiagnostic("main.ets","",diagnostic),/const generated: number = 7/);
    return true;
  });
});

test("etsgen AST native: funciones generadas se emiten por el pipeline normal", () => {
  const root=join(dirname(fileURLToPath(import.meta.url)),"../..");
  const dir=mkdtempSync(join(tmpdir(),"ets-ast-pipeline-"));
  try {
    const code="function made(x: i32): i32 { const a: i32 = 5; const b: i32 = 2; return x + a / b; } print(made(3));";
    const {ast,cpp}=compile(source(code));
    assert.ok(ast.statements.some(s=>s.kind === "FunctionDeclaration" && s.span.hygiene?.name === "made"));
    writeFileSync(join(dir,"main.cpp"),cpp);
    execFileSync("g++",["-std=c++20","-O2","-pthread","-fno-exceptions","-I",root,join(dir,"main.cpp"),"-o",join(dir,"main")],{stdio:"pipe",timeout:60000});
    assert.equal(execFileSync(join(dir,"main"),{encoding:"utf8",timeout:10000}),"5\n");
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("etsgen AST módulos: expansión pertenece al módulo del caller", async () => {
  const dir=mkdtempSync(join(tmpdir(),"ets-ast-module-"));
  try {
    writeFileSync(join(dir,"lib.ets"),'@etsgen export function emit(): string { return "function made(): number { return 7; } print(made());"; }');
    writeFileSync(join(dir,"main.ets"),'import { emit } from "./lib.ets";\n\nemit();');
    const result=await compileFile(join(dir,"main.ets"));
    const lib=result.modules.find(m=>m.name === join(dir,"lib.ets"));
    const main=result.modules.find(m=>m.name === join(dir,"main.ets"));
    assert.ok(lib && main);
    assert.match(main.cpp,/made\(/);
    assert.doesNotMatch(lib.cpp,/made\(/);
    assert.equal(result.ast.generatedSources?.[0].generator,"emit");
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("etsgen diagnóstico módulos: caller e interior conservan sus fuentes", async () => {
  const dir=mkdtempSync(join(tmpdir(),"ets-ast-error-"));
  try {
    writeFileSync(join(dir,"lib.ets"),'@etsgen export function emit(): string { return "print(1);\\nlet bad: string = 1;"; }');
    writeFileSync(join(dir,"main.ets"),'import { emit } from "./lib.ets";\n\nemit();');
    await assert.rejects(()=>compileFile(join(dir,"main.ets")),(error:unknown)=>{
      assert.ok(error instanceof DiagnosticError);
      const diagnostic=error.diagnostics[0];
      assert.equal(diagnostic.file,join(dir,"main.ets"));
      assert.equal(diagnostic.span.start.line,3);
      assert.equal(diagnostic.generated?.span.start.line,2);
      assert.match(formatDiagnostic("unused","",diagnostic),/2 \| let bad: string = 1;/);
      return true;
    });
  } finally {rmSync(dir,{recursive:true,force:true});}
});
