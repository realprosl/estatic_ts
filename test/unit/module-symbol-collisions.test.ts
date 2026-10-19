import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileFile } from "../../src/modules/module-loader.ts";
import { declaredNames } from "../../src/modules/module-symbols.ts";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { DiagnosticError } from "../../src/core/diagnostic.ts";

async function project(files: Record<string, string>, run: (entry: string, dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "estatic-symbol-collision-"));
  try {
    for (const [file, source] of Object.entries(files)) writeFileSync(join(dir, file), source);
    await run(join(dir, "main.ets"), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function isolatesBindings(left: string, right: string, symbol: string): Promise<void> {
  await project({
    "a.ets": left,
    "b.ets": right,
    "main.ets": 'import "./a.ets";\nimport "./b.ets";\n',
  }, async (entry, dir) => {
    const result=await compileFile(entry);
    const names=result.ast.statements.flatMap(declaredNames).filter(name=>name.endsWith("_"+symbol));
    assert.equal(new Set(names).size,2);
    assert.equal(result.modules.length,3);
  });
}

test("module symbols: funciones privadas de distinta firma no se mezclan en comptime", async () => {
  await isolatesBindings(
    'function helper(n: number): number { return n + 10; }\nconst left: number = comptime((): number => helper(1));',
    'function helper(n: string): number { return 99; }\nconst right: number = comptime((): number => helper("x"));',
    "helper",
  );
});

test("module symbols: funciones @comptime no se sobrescriben entre modulos", async () => {
  await isolatesBindings(
    '@comptime function helper(n: number): number { return n + 10; }\nexport const left: number = helper(1);',
    '@comptime function helper(n: string): number { return 99; }\nexport const right: number = helper("x");',
    "helper",
  );
});

test("module symbols: funciones @etsgen no se sobrescriben entre modulos", async () => {
  await isolatesBindings(
    '@etsgen function emit(n: number): string { return "print(11);"; }\nemit(1);',
    '@etsgen function emit(n: string): string { return "print(99);"; }\nemit("x");',
    "emit",
  );
});

for (const [label, left, right, symbol] of [
  ["variables", "const limit: number = 10;", "const limit: number = 99;", "limit"],
  ["aliases", "type Value = number;", "type Value = string;", "Value"],
  ["enums", "enum Mode { A, B }", "enum Mode { C, D }", "Mode"],
  ["interfaces", "interface Shape { x: number; }", "interface Shape { y: string; }", "Shape"],
  ["clases", "class Model { value: number; }", "class Model { value: string; }", "Model"],
  ["unions", "union Result = Ok(number) | Err(string);", "union Result = Good(number) | Bad(string);", "Result"],
  ["destructuring de array", "const [value] = [10];", "const [value] = [99];", "value"],
  ["destructuring de objeto", "class LeftModel { x: number = 10; } const { x: value } = new LeftModel();", "class RightModel { y: number = 99; } const { y: value } = new RightModel();", "value"],
  ["recursos using", "using resource = 10;", "using resource = 99;", "resource"],
]) {
  test(`module symbols: aísla bindings de ${label}`, async () => {
    await isolatesBindings(left, right, symbol);
  });
}

test("module symbols: mantiene sobrecargas del mismo modulo para runtime", async () => {
  await project({ "main.ets": 'function identity(n: number): number { return n; }\nfunction identity(n: string): string { return n; }\nprint(identity(1));\nprint(identity("x"));' }, async entry => {
    const result = await compileFile(entry);
    assert.equal(result.ast.statements.filter(item => item.kind === "FunctionDeclaration" && item.name === "identity").length, 2);
  });
});

test("module symbols: los nombres locales iguales no colisionan", async () => {
  await project({
    "a.ets": 'export function left(): number { const local: number = 11; return local; }',
    "b.ets": 'export function right(): number { const local: number = 99; return local; }',
    "main.ets": 'import { left } from "./a.ets";\nimport { right } from "./b.ets";\nconst result: number = comptime((): number => left() + right());',
  }, async entry => {
    const { ast } = await compileFile(entry);
    const result = ast.statements.find(item => item.kind === "VariableDeclaration" && item.name === "result");
    assert.ok(result && result.kind === "VariableDeclaration" && result.initializer.kind === "LiteralExpression");
    assert.equal(result.initializer.value, 110);
  });
});

test("module symbols: mantiene capturas e imports comptime con nombres distintos", async () => {
  await project({
    "a.ets": 'const leftLimit: number = 11;\n@comptime export function left(): number { return leftLimit; }',
    "b.ets": 'const rightLimit: number = 99;\n@comptime export function right(): number { return rightLimit; }',
    "main.ets": 'import { left } from "./a.ets";\nimport { right } from "./b.ets";\nconst result: number = comptime((): number => left() + right());',
  }, async entry => {
    const { ast } = await compileFile(entry);
    const result = ast.statements.find(item => item.kind === "VariableDeclaration" && item.name === "result");
    assert.ok(result && result.kind === "VariableDeclaration" && result.initializer.kind === "LiteralExpression");
    assert.equal(result.initializer.value, 110);
  });
});

test("module symbols: una dependencia compartida se comprueba una sola vez", async () => {
  await project({
    "shared.ets": "export const shared: number = 7;",
    "a.ets": 'import { shared } from "./shared.ets";\nexport const left: number = shared;',
    "main.ets": 'import { shared } from "./shared.ets";\nimport { left } from "./a.ets";\nconst result: number = comptime((): number => shared + left);',
  }, async entry => {
    const { ast, modules } = await compileFile(entry);
    assert.equal(modules.length, 3);
    const result = ast.statements.find(item => item.kind === "VariableDeclaration" && item.name === "result");
    assert.ok(result && result.kind === "VariableDeclaration" && result.initializer.kind === "LiteralExpression");
    assert.equal(result.initializer.value, 14);
  });
});

test("module symbols: temporales de destructuring no cuentan como nombres de usuario", async () => {
  await project({
    "a.ets": "const [leftValue] = [11];",
    "b.ets": "const [rightValue] = [99];",
    "main.ets": 'import "./a.ets";\nimport "./b.ets";',
  }, async entry => {
    const { modules } = await compileFile(entry);
    assert.equal(modules.length, 3);
  });
});

test("module symbols: diagnostico de tipo conserva origen y nombre tras aislamiento", async () => {
  await project({
    "a.ets": "// first\nfunction helper(n: number): number { return n; }",
    "b.ets": "// second\n\nfunction helper(n: string): string { return 7; }",
    "main.ets": 'import "./a.ets";\nimport "./b.ets";',
  }, async (entry, dir) => {
    await assert.rejects(() => compileFile(entry), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError);
      const diagnostic=error.diagnostics[0];
      assert.equal(diagnostic.file,join(dir,"b.ets"));
      assert.equal(diagnostic.span.start.line,3);
      assert.doesNotMatch(error.message,/ets_import_/);
      return true;
    });
  });
});

function native(result: Awaited<ReturnType<typeof compileFile>>,dir:string):string {
  writeFileSync(join(dir,"estatic_common.hpp"),result.header);
  const files=result.modules.map((module,index)=>{const file=join(dir,`module-${index}.cpp`);writeFileSync(file,module.cpp);return file;});
  execFileSync("g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${resolve(".")}`,...files,"-o",join(dir,"app")],{encoding:"utf8"});
  return execFileSync(join(dir,"app"),{encoding:"utf8"});
}

test("module symbols native: overloads, closures, mutación y comptime aislados",async()=>{
  await project({
    "a.ets": 'let count:number=10; function helper(value:number):number{return value+count;}function helper(value:string):string{return value;} @comptime function calculate():number{return helper(1);}export const left:number=calculate(); export function readLeft():number {const f=():number=>helper(2);count+=1;return f();}',
    "b.ets": 'let count:number=90; function helper(value:number):number{return value+count;}function helper(value:string):string{return value;} @comptime function calculate():number{return helper(9);}export const right:number=calculate(); export function readRight():number {const f=():number=>helper(3);count+=2;return f();}',
    "main.ets": 'import {left,readLeft} from "./a";import {right,readRight} from "./b";print(left);print(right);print(readLeft());print(readRight());print(readLeft());',
  },async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"11\n99\n13\n95\n14\n");});
});

test("module symbols native: tipos homónimos, enums, unions y destructuring",async()=>{
  const code=(value:number,fn:string)=>`type Value=number;interface View {value:number;} class Model {value:number;}enum Mode { First=${value} } union Outcome=Ok(number)|Err(string);const [base]=[${value}]; const {value:field}=new Model(base);export function ${fn}():number{const item:Model=new Model(base);const typed:Value=item.value;print(Outcome.Ok(typed));print(field);if(Mode.First==Mode.First){return typed;}return 0;}`;
  await project({"a.ets":code(11,"left"),"b.ets":code(99,"right"),"main.ets":'import {left} from "./a";import {right} from "./b";print(left());print(right());'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"Ok\n11\n11\nOk\n99\n99\n");});
});

test("module symbols native: generadores y helpers de definición homónimos",async()=>{
  const code=(value:number,fn:string)=>`function helper():number{return ${value};}@etsgen function emit():string{return ${JSON.stringify(`@etsPublish function ${fn}():number{return etsDefinition("helper");}`)};}emit();export {${fn}};`;
  await project({"a.ets":code(11,"left"),"b.ets":code(99,"right"),"main.ets":'import {left} from "./a";import {right} from "./b";print(left());print(right());'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"11\n99\n");});
});

test("module symbols: identidad no autoriza acceso privado desde otro módulo",async()=>{
  await project({"a.ets":'function helper():number{return 1;}print(helper());',"b.ets":'function helper():number{return 2;}print(helper());',"main.ets":'import "./a";import "./b";print(helper());'},async entry=>{await assert.rejects(()=>compileFile(entry),/importarse explícitamente/);});
});

test("module symbols: duplicados de un mismo módulo siguen siendo errores",async()=>{
  await project({"a.ets":'const value:number=1;const value:number=2;',"main.ets":'import "./a";const value:number=3;'},async entry=>{await assert.rejects(()=>compileFile(entry),/duplicad|redeclara|existe/i);});
});

test("module symbols: imports sin alias apuntan al propietario homónimo correcto",async()=>{
  await project({"a.ets":'export function answer():number{return 11;}',"b.ets":'export function answer():string{return "ok";}',"left.ets":'import {answer} from "./a";export const left:number=comptime(():number=>answer());',"right.ets":'import {answer} from "./b";export const right:string=comptime(():string=>answer());',"main.ets":'import {left} from "./left";import {right} from "./right";print(left);print(right);'},async entry=>{
    const result=await compileFile(entry);
    const constants=result.ast.statements.filter((n:any)=>["left","right"].includes(n.name)) as any[];
    assert.deepEqual(constants.map(n=>n.initializer.value),[11,"ok"]);
  });
});

test("module symbols: scopes locales y parámetros de tipo no capturan globals",async()=>{
  await project({"a.ets":'type T=number;function value<T>(input:T):T{return input;}function helper():number{const value:number=7;return value;}export const left:number=comptime(():number=>value(helper()));',"b.ets":'type T=string;function value<T>(input:T):T{return input;}function helper():string{const value:string="ok";return value;}export const right:string=comptime(():string=>value(helper()));',"main.ets":'import {left} from "./a";import {right} from "./b";'},async entry=>{
    const result=await compileFile(entry);
    const constants=result.ast.statements.filter((n:any)=>["left","right"].includes(n.name)) as any[];
    assert.deepEqual(constants.map(n=>n.initializer.value),[7,"ok"]);
  });
});

test("module symbols native: plantillas exportadas usan sus helpers privados",async()=>{
  const code=(value:number)=>`function helper<T>(value:T):T{return value;}const marker:number=${value};export function identity<T>(value:T):T {print(marker);return helper<T>(value);}`;
  await project({"a.ets":code(11),"b.ets":code(99),"left.ets":'import {identity} from "./a";export function left():number{return identity<number>(7);}',"right.ets":'import {identity} from "./b";export function right():string{return identity<string>("ok");}',"main.ets":'import {left} from "./left";import {right} from "./right";print(left());print(right());'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"11\n7\n99\nok\n");});
});

test("module symbols native: destructuring evalúa una vez y aplica defaults",async()=>{
  await project({"a.ets":'let calls:number=0;function source():number[]{calls+=1;return [11];}const [first,second=7]=source();export function read():number{print(calls);print(second);return first;}',"main.ets":'import {read} from "./a";print(read());print(read());'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"1\n7\n11\n1\n7\n11\n");});
});
