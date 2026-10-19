import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {compileFile,loadModuleGraph,type ModuleCompilationResult} from "../../src/modules/module-loader.ts";
import {scanModuleSyntax} from "../../src/modules/module-syntax.ts";
import {DiagnosticError} from "../../src/core/diagnostic.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
async function project(files:Record<string,string>,run:(entry:string,dir:string)=>Promise<void>) {
  const dir=mkdtempSync(join(tmpdir(),"ets-module-exports-"));
  try {for(const[name,source]of Object.entries(files))writeFileSync(join(dir,name),source);await run(join(dir,"main.ets"),dir);}
  finally{rmSync(dir,{recursive:true,force:true});}
}
function native(result:ModuleCompilationResult,dir:string):string {
  writeFileSync(join(dir,"estatic_common.hpp"),result.header);
  const files=result.modules.map((module,index)=>{const file=join(dir,`module-${index}.cpp`);writeFileSync(file,module.cpp);return file;});
  execFileSync("g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,...files,"-o",join(dir,"app")],{encoding:"utf8"});
  return execFileSync(join(dir,"app"),{encoding:"utf8"});
}

test("module syntax: mixed default/named, multiline, comentarios y offsets",()=>{
  const source='import identity, {\n /* keep */ value as seed,\n} from "./lib"; // tail\nprint(seed);';
  const scanned=scanModuleSyntax(source);
  assert.deepEqual(scanned.requests[0].bindings,[{imported:"default",local:"identity"},{imported:"value",local:"seed"}]);
  assert.equal(scanned.source.length,source.length);assert.equal(scanned.source.indexOf("print"),source.indexOf("print"));assert.ok(scanned.source.includes("// tail"));
});
test("module syntax: ignora texto import/export dentro de strings y funciones",()=>{
  const scanned=scanModuleSyntax('const text:string="import x from \\"./fake\\"";function run():void {print("export * from x");}');
  assert.equal(scanned.requests.length,0);
});
test("module defaults native: función genérica y clase anónimas con import mixto",async()=>{
  await project({"fn.ets":'export default function<T>(value:T):T{return value;}export function increment(value:number):number{return value+1;}',"box.ets":'export default class {value:number;}',"main.ets":'import identity, {\n increment as add,\n} from "./fn";\nimport Crate from "./box";\nconst box:Crate=new Crate(7);print(identity<number>(box.value));print(add(7));'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"7\n8\n");});
});
test("module defaults native: snapshot de expresión frente a export vivo",async()=>{
  await project({"lib.ets":'function seed():number{return 7;}let current:number=seed();current=8;export default current;export {current as live};current=9;',"arrow.ets":'export default (value:number):number=>value+1;',"ref.ets":'function original(value:number):number{return value+2;}export default original;',"main.ets":'import snapshot, {live} from "./lib";\nimport arrow from "./arrow";\nimport reference from "./ref";\nprint(snapshot);print(live);print(arrow(7));print(reference(7));'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"8\n9\n8\n9\n");});
});
test("module reexports native: aliases transitivos, diamante y un solo init",async()=>{
  await project({"lib.ets":'let counter:number=7;function bump():void{counter+=1;}export {counter as value,bump};print("once");',"left.ets":'export * from "./lib";',"right.ets":'export {value,bump} from "./lib";',"barrel.ets":'export * from "./left";\nexport * from "./right";\nexport {value as count} from "./lib";',"main.ets":'import {count as seed,bump} from "./barrel";\nprint(seed);bump();print(seed);'},async(entry,dir)=>{assert.equal((await loadModuleGraph(entry)).modules.length,5);assert.equal(native(await compileFile(entry),dir),"once\n7\n8\n");});
});
test("module namespace reexports native: tipos, default, enum y aliases anidados",async()=>{
  await project({"lib.ets":'export default class Box {value:number;}export function increment(value:number):number{return value+1;}export enum Mode {Low,High}',"barrel.ets":'export * as api from "./lib";',"main.ets":'import {api as model} from "./barrel";\nimport * as top from "./barrel";\nconst box:top.api.default=new model.default(7);print(top.api.increment(box.value));print(model.Mode.High);'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"8\n1\n");});
});
test("module reexports native: default @etsgen y helper genérico por barrel",async()=>{
  await project({"values.ets":'export default function<T>(value:T):T{return value;}',"gen.ets":'import helper from "./values";\n@etsgen export default function emit():string{return "print(etsDefinition(\\"helper\\",7));";}',"barrel.ets":'export {default as generate} from "./gen";',"main.ets":'import {\n generate as emit,\n} from "./barrel";\nemit();'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"7\n");});
});
for(const expression of ['7','"ok"','(value:number):number=>value+1']) {
  test(`module default expression: inferencia ${expression}`,async()=>{
    await project({"lib.ets":'export default '+expression+';',"main.ets":'import value from "./lib";\n'+(expression.startsWith("(") ? "print(value(7));" : "print(value);")},async entry=>{await compileFile(entry);});
  });
}
test("module reexports: export local puede publicar import renombrado",async()=>{
  await project({"lib.ets":'export function original(n:number):number{return n;}',"barrel.ets":'import {original as local} from "./lib";\nexport {local as publicName};',"main.ets":'import {publicName as run} from "./barrel";\nprint(run(7));'},async entry=>{await compileFile(entry);});
});
test("module reexports: export local de namespace importado",async()=>{
  await project({"lib.ets":'export const value:number=7;',"barrel.ets":'import * as local from "./lib";\nexport {local as model};',"main.ets":'import {model} from "./barrel";\nprint(model.value);'},async entry=>{await compileFile(entry);});
});
test("module reexports: default puede reenviarse como default o nombre",async()=>{
  await project({"lib.ets":'export default function original(n:number):number{return n;}',"barrel.ets":'export {default,default as named} from "./lib";',"main.ets":'import run,{named as other} from "./barrel";\nprint(run(7));print(other(8));'},async entry=>{await compileFile(entry);});
});
test("module reexports: export explícito resuelve conflicto de estrellas",async()=>{
  await project({"a.ets":'export const value:number=7;',"b.ets":'export const value:number=9;',"barrel.ets":'export * from "./a";\nexport * from "./b";\nexport {value} from "./a";',"main.ets":'import {value} from "./barrel";\nprint(value);'},async entry=>{await compileFile(entry);});
});
test("module reexports: conserva sobrecargas comptime publicadas localmente",async()=>{
  await project({"lib.ets":'@comptime function choose(value:number):number{return 11;}@comptime function choose(value:string):number{return 99;}export {choose as default};',"main.ets":'import pick from "./lib";\nconst a:number=pick(7);const b:number=pick("text");'},async entry=>{
    const result=await compileFile(entry);assert.deepEqual(result.ast.statements.filter((s:any)=>["a","b"].includes(s.name)).map((s:any)=>s.initializer.value),[11,99]);
  });
});
for(const [label,lib,barrel,main,message] of [
  ["default inexistente",'export const value:number=7;','', 'import value from "./lib";',/default/],
  ["nombre privado de función default",'export default function original():number{return 7;}','', 'import {original} from "./lib";',/privado/],
  ["reexport privado",'const hidden:number=7;','export {hidden as publicName} from "./lib";','import "./barrel";',/privado/],
  ["reexport inexistente",'export const value:number=7;','export {missing} from "./lib";','import "./barrel";',/missing/],
  ["export local inexistente",'export {missing as publicName};','', 'import "./lib";',/missing/],
  ["export duplicado",'export const value:number=7;export {value};','', 'import "./lib";',/duplicado/],
  ["default duplicado",'export default 7;export default 8;','', 'import "./lib";',/duplicado/],
  ["estrella no publica default",'export default 7;','export * from "./lib";', 'import value from "./barrel";',/default/],
  ["barrel no introduce binding local",'export const value:number=7;','export {value as other} from "./lib";print(value);', 'import "./barrel";',/debe importarse explícitamente/],
  ["mixto no oculta visibilidad incompatible",'export function f(n:number):number{return n;}function f(n:string):string{return n;}','', 'import "./lib";',/misma visibilidad/],
] as const) {
  test(`module exports: rechaza ${label}`,async()=>{await project({"lib.ets":lib,"barrel.ets":barrel,"main.ets":main},async entry=>{await assert.rejects(()=>compileFile(entry),message);});});
}
test("module reexports: ambigüedad de estrellas tiene código y archivo",async()=>{
  await project({"a.ets":'export const value:number=7;',"b.ets":'export const value:number=9;',"barrel.ets":'export * from "./a";\nexport * from "./b";',"main.ets":'import "./barrel";'},async(entry,dir)=>{
    await assert.rejects(()=>compileFile(entry),(error:unknown)=>{assert.ok(error instanceof DiagnosticError);assert.equal(error.diagnostics[0].code,"MODULE_EXPORT_AMBIGUOUS");assert.equal(error.diagnostics[0].file,join(dir,"barrel.ets"));assert.equal(error.diagnostics[0].span.start.line,2);return true;});
  });
});
test("module syntax: diagnóstico conserva línea después de import multilinea",async()=>{
  await project({"lib.ets":'export function f(n:number):number{return n;}',"main.ets":'import {\n f as run,\n} from "./lib";\nprint(run("bad"));'},async entry=>{
    await assert.rejects(()=>compileFile(entry),(error:unknown)=>{assert.ok(error instanceof DiagnosticError);assert.equal(error.diagnostics[0].file,entry);assert.equal(error.diagnostics[0].span.start.line,4);assert.match(error.message,/run/);return true;});
  });
});
test("module syntax: CRLF y comentarios no inventan dependencias",()=>{
  const source='// import x from "fake"\r\nimport /* gap */ {\r\nvalue as seed\r\n} from "./real";\r\n';
  const result=scanModuleSyntax(source);assert.equal(result.requests.length,1);assert.equal(result.requests[0].line,2);assert.equal(result.source.length,source.length);
});
test("module syntax: cambio exclusivo del reexport modifica hash",async()=>{
  await project({"lib.ets":'export const value:number=7;',"barrel.ets":'export {value as first} from "./lib";',"main.ets":'import "./barrel";'},async(entry,dir)=>{
    const before=(await loadModuleGraph(entry)).modules.find(m=>m.file.endsWith("barrel.ets"))!.hash;
    writeFileSync(join(dir,"barrel.ets"),'export {value as other} from "./lib";');
    assert.notEqual((await loadModuleGraph(entry)).modules.find(m=>m.file.endsWith("barrel.ets"))!.hash,before);
  });
});
