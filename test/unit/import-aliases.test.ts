import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {compileFile,loadModuleGraph,type ModuleCompilationResult} from "../../src/modules/module-loader.ts";
import {DiagnosticError} from "../../src/core/diagnostic.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
async function project(files:Record<string,string>,run:(entry:string,dir:string)=>Promise<void>) {
  const dir=mkdtempSync(join(tmpdir(),"ets-import-alias-"));
  try {for(const [name,source] of Object.entries(files)) writeFileSync(join(dir,name),source);await run(join(dir,"main.ets"),dir);}
  finally {rmSync(dir,{recursive:true,force:true});}
}
function native(result:ModuleCompilationResult,dir:string):string {
  writeFileSync(join(dir,"estatic_common.hpp"),result.header);
  const paths=result.modules.map((module,index)=>{const path=join(dir,`module-${index}.cpp`);writeFileSync(path,module.cpp);return path;});
  execFileSync("g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,...paths,"-o",join(dir,"app")],{encoding:"utf8"});
  return execFileSync(join(dir,"app"),{encoding:"utf8"});
}
const lib='export function increment(value:number):number{return value+1;} export const base:number=7; export class Box {value:number;} export interface Shape {value:number;} export enum Mode { Low, High }';

test("imports as: grafo conserva nombre exportado y nombre local",async()=>{
  await project({"lib.ets":lib,"main.ets":'import { increment as add, base as seed } from "./lib";\nprint(add(seed));'},async entry=>{
    const graph=await loadModuleGraph(entry);assert.deepEqual(graph.modules.at(-1)!.imports[0].bindings,[{imported:"increment",local:"add"},{imported:"base",local:"seed"}]);
    await compileFile(entry);
  });
});
test("imports as native: aliases, tipos, propiedades, labels y sombras",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {increment as add,base as seed,Box as Crate,Shape as View,Mode as State} from "./lib";\nconst increment:number=99;const base:number=100;function read(value:View):number{return value.value;}function run():void {const increment:number=123;const box:Crate=new Crate(7);const view:Crate=new Crate(8);print(add(value:box.value));print(seed);print(read(view));print(State.High);{const add:number=55;print(add);}print(add(9));const labels:string="add increment seed";print(labels);}run();'},async(entry,dir)=>{
    assert.equal(native(await compileFile(entry),dir),"8\n7\n8\n1\n55\n10\nadd increment seed\n");
  });
});
test("imports as: parámetros y arrows locales ocultan alias",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {increment as add} from "./lib";\nfunction run(add:number):number {return add;}const xs:number[]=[1];const ys:number[]=xs.map<number>((add:number):number=>add+1);print(run(7));print(ys[0]);print(add(7));'},async entry=>{await compileFile(entry);});
});
test("imports as: parámetro genérico oculta solo el espacio de tipos",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {Box as Crate} from "./lib";\nfunction identity<Crate>(value:Crate):Crate{return value;}const box:Crate=new Crate(7);print(identity<number>(box.value));'},async entry=>{await compileFile(entry);});
});
test("imports as: aliases de sobrecargas y const mantienen resolución comptime",async()=>{
  await project({"lib.ets":'@comptime export function choose(value:number):number{return value+1;} @comptime export function choose(value:string):number{return 99;} export const base:number=7;',"main.ets":'import {choose as pick,base as seed} from "./lib";\nconst a:number=pick(7);const b:number=pick("text");const c:number=comptime(():number=>seed+1);print(a);print(b);print(c);'},async entry=>{
    const result=await compileFile(entry);const values=result.ast.statements.filter((s:any)=>["a","b","c"].includes(s.name)).map((s:any)=>s.initializer.value);assert.deepEqual(values,[8,99,8]);
  });
});
test("imports as native: alias @etsgen y etsDefinition con import renombrado",async()=>{
  await project({"values.ets":'export const base:number=7;export function helper(value:number):number{return value+1;}',"lib.ets":'import {base as seed,helper as increment} from "./values";\n@etsgen export function emit():string{return "print(etsDefinition(\\"increment\\",7));print(etsDefinition(\\"seed\\"));";}',"main.ets":'import {emit as generate} from "./lib";\ngenerate();'},async(entry,dir)=>{
    assert.equal(native(await compileFile(entry),dir),"8\n7\n");
  });
});
test("imports as: fragmentos ETS acceden a aliases del caller y tipos importados",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {increment as add,Box as Crate} from "./lib";\n@etsgen function emit():string{return "const box:Crate=new Crate(7);print(add(box.value));";}emit();'},async entry=>{await compileFile(entry);});
});
test("imports as: no expone nombre original cuando solo se importa alias",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {increment as add} from "./lib";\nprint(increment(7));'},async entry=>{await assert.rejects(()=>compileFile(entry),/debe importarse explícitamente/);});
});
for(const [label,declaration,main,message] of [
  ["privado",'function hidden():number{return 7;}','import {hidden as visible} from "./lib";\nprint(visible());',/es privado/],
  ["inexistente",lib,'import {missing as visible} from "./lib";\n',/no declara 'missing'/],
  ["local duplicado",lib,'import {base as seed} from "./lib";\nconst seed:number=1;',/conflicto/],
  ["alias duplicado",lib,'import {base as seed,increment as seed} from "./lib";\n',/más de una vez/],
  ["alias inválido",lib,'import {base as seed as other} from "./lib";\n',/Import no válido/],
] as const) {
  test(`imports as: rechaza ${label}`,async()=>{await project({"lib.ets":declaration,"main.ets":main},async entry=>{await assert.rejects(()=>compileFile(entry),message);});});
}
test("imports as: diagnósticos usan alias y coordenadas fuente",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {increment as add} from "./lib";\nprint(add("bad"));'},async entry=>{
    await assert.rejects(()=>compileFile(entry),(error:unknown)=>{assert.ok(error instanceof DiagnosticError);assert.match(error.message,/add/);assert.doesNotMatch(error.message,/ets_import_/);assert.equal(error.diagnostics[0].span.start.line,2);assert.equal(error.diagnostics[0].file,entry);return true;});
  });
});
test("imports as: cambiar solo el alias invalida hash del módulo",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {base as first} from "./lib";\n'},async(entry)=>{
    const before=(await loadModuleGraph(entry)).modules.at(-1)!.hash;
    writeFileSync(entry,'import {base as second} from "./lib";\n');
    assert.notEqual((await loadModuleGraph(entry)).modules.at(-1)!.hash,before);
  });
});
test("imports namespace native: miembros, tipos y constructores estáticos",async()=>{
  await project({"lib.ets":lib,"main.ets":'import * as model from "./lib";\nconst box:model.Box=new model.Box(7);const view:model.Box=new model.Box(8);function read(value:model.Shape):number{return value.value;}print(model.increment(box.value));print(model.base);print(model.Mode.High);print(read(view));'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"8\n7\n1\n8\n");});
});
test("imports namespace: sombra local conserva propiedades ordinarias",async()=>{
  await project({"lib.ets":lib,"main.ets":'import * as model from "./lib";\nclass Local {base:number;}function run():void {const model:Local=new Local(99);print(model.base);}run();print(model.base);'},async entry=>{await compileFile(entry);});
});
test("imports namespace: ETS generado y expansión hija conservan namespace",async()=>{
  await project({"lib.ets":lib,"main.ets":'import * as model from "./lib";\n@etsgen function child():string{return "const box:model.Box=new model.Box(7);print(model.increment(box.value));";}@etsgen function emit():string{return "child();print(model.base);";}emit();'},async entry=>{await compileFile(entry);});
});
for(const code of ["print(model.hidden);","model.missing();","print(model);","print(model[\"base\"]);"]) {
  test(`imports namespace: rechaza acceso no estático o no exportado ${code}`,async()=>{
    await project({"lib.ets":lib+' const hidden:number=99;',"main.ets":'import * as model from "./lib";\n'+code},async entry=>{await assert.rejects(()=>compileFile(entry),/namespace/);});
  });
}
test("etsDefinition generic native: cuerpo y dependencias privados entre módulos",async()=>{
  await project({"lib.ets":'const base:number=7;function offset(value:number):number{return value+base;}function inner<T>(value:T):T{return value;}function helper<T>(value:T):T{print(offset(1));return inner<T>(value);}@etsgen export function emit():string{return "print(etsDefinition(\\"helper\\",7));";}',"main.ets":'import {emit as generate} from "./lib";\ngenerate();'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"8\n7\n");});
});
test("imports as generic native: templates exportados funcionan con alias",async()=>{
  await project({"lib.ets":'function helper<T>(value:T):T{return value;}export function identity<T>(value:T):T{return helper<T>(value);}',"main.ets":'import {identity as id} from "./lib";\nprint(id<number>(7));print(id<string>("ok"));'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"7\nok\n");});
});
test("imports as: homónimos exportados de dos módulos tienen destinos distintos",async()=>{
  await project({"a.ets":'@comptime export function choose(value:number):number{return 11;}',"b.ets":'@comptime export function choose(value:number):number{return 99;}',"main.ets":'import {choose as left} from "./a";\nimport {choose as right} from "./b";\nconst a:number=left(1);const b:number=right(1);'},async entry=>{
    const result=await compileFile(entry);assert.deepEqual(result.ast.statements.filter((s:any)=>["a","b"].includes(s.name)).map((s:any)=>s.initializer.value),[11,99]);
  });
});
test("imports namespace: homónimos exportados no se mezclan",async()=>{
  await project({"a.ets":'export const value:number=11;',"b.ets":'export const value:number=99;',"main.ets":'import * as a from "./a";\nimport * as b from "./b";\nprint(a.value);print(b.value);'},async entry=>{
    const result=await compileFile(entry);const names=result.ast.statements.filter(s=>s.kind === "VariableDeclaration").map((s:any)=>s.name);assert.equal(new Set(names).size,2);
  });
});
test("imports as: nombres internos reservados no capturan locales existentes",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {increment as add} from "./lib";\nfunction run():void {const ets_import_0_increment:number=99;print(add(7));}run();'},async entry=>{
    const result=await compileFile(entry);assert.ok(result.ast.statements.some((s:any)=>s.kind === "FunctionDeclaration" && s.name === "ets_import_1_increment"));
  });
});
test("imports as: un destino puede tener dos aliases o combinarse con namespace",async()=>{
  for(const source of ['import {increment as add,increment as another} from "./lib";\nprint(add(7));print(another(8));','import {Box as Crate} from "./lib";\nimport * as model from "./lib";\nconst box:Crate=new model.Box(7);print(model.increment(box.value));']) {
    await project({"lib.ets":lib,"main.ets":source},async entry=>{await compileFile(entry);});
  }
});
test("imports as: nombres de prototipo no alteran capturas ETS",async()=>{
  await project({"lib.ets":'export const base:number=7;',"main.ets":'import {base as constructor} from "./lib";\n@etsgen function emit():string{return "print(etsCapture(\\"constructor\\"));";}emit();'},async entry=>{await compileFile(entry);});
});
test("imports as: alias sombreado en caller también se respeta en ETS generado",async()=>{
  await project({"lib.ets":lib,"main.ets":'import {base as seed} from "./lib";\n@etsgen function emit():string{return "print(seed);";}function run():void {const seed:string="local";emit();}run();'},async entry=>{
    const result=await compileFile(entry);const capture=result.ast.generatedSources![0].captures!.find(c=>c.name === "seed");assert.equal(capture?.emittedName,"seed");
  });
});
test("imports namespace: namespace sombreado también se respeta en ETS generado",async()=>{
  await project({"lib.ets":lib,"main.ets":'import * as model from "./lib";\nclass Local {base:number;}@etsgen function emit():string{return "print(model.base);";}function run():void {const model:Local=new Local(99);emit();}run();'},async entry=>{await compileFile(entry);});
});
