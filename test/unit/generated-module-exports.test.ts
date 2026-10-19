import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {compileFile,type ModuleCompilationResult} from "../../src/modules/module-loader.ts";
import {DiagnosticError} from "../../src/core/diagnostic.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
async function project(files:Record<string,string>,run:(entry:string,dir:string)=>Promise<void>) {
  const dir=mkdtempSync(join(tmpdir(),"ets-generated-exports-"));
  try{for(const[name,source]of Object.entries(files))writeFileSync(join(dir,name),source);await run(join(dir,"main.ets"),dir);}
  finally{rmSync(dir,{recursive:true,force:true});}
}
function native(result:ModuleCompilationResult,dir:string):string {
  writeFileSync(join(dir,"estatic_common.hpp"),result.header);
  const files=result.modules.map((module,index)=>{const file=join(dir,`module-${index}.cpp`);writeFileSync(file,module.cpp);return file;});
  execFileSync("g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,...files,"-o",join(dir,"app")],{encoding:"utf8"});
  return execFileSync(join(dir,"app"),{encoding:"utf8"});
}
const generator=(code:string,name="emit",visibility="")=>`@etsgen ${visibility}function ${name}():string{return ${JSON.stringify(code)};}`;
const declaration="@etsPublish function answer(value:number):number{return value+1;}";
const producer=generator(declaration)+"emit();export {answer};";

test("generated exports native: función generada importada con alias y labels",async()=>{
  await project({"lib.ets":producer,"main.ets":'import {answer as add} from "./lib";\nconst answer:number=99;print(add(value:7));'},async(entry,dir)=>{
    const result=await compileFile(entry);assert.equal(native(result,dir),"8\n");
    assert.ok(result.ast.generatedSources![0].bindings!.some(b=>b.name === "answer" && b.emittedName.startsWith("ets_import_")));
  });
});
test("generated exports native: barrel, default, diamante, clase y genéricos",async()=>{
  const code='function identity<T>(value:T):T{return value;} @etsPublish function answer<T>(value:T):T{return identity<T>(value);} @etsPublish class Box {value:number;}';
  await project({"lib.ets":generator(code)+"emit();export {answer,Box};","left.ets":'export * from "./lib";',"right.ets":'export {answer as default,Box} from "./lib";',"barrel.ets":'export * from "./left";\nexport * as model from "./right";\nexport {default} from "./right";',"main.ets":'import id,{model} from "./barrel";\nconst box:model.Box=new model.Box(7);print(id<number>(box.value));print(model.default<string>("ok"));'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"7\nok\n");});
});
test("generated exports native: variable mutable conserva almacenamiento único",async()=>{
  const code='@etsPublish let counter:number=7; @etsPublish function bump():void {counter+=1;}';
  await project({"lib.ets":generator(code)+"emit();export {counter as value,bump};","barrel.ets":'export {value as count,bump} from "./lib";',"main.ets":'import {count,bump} from "./barrel";\nprint(count);bump();print(count);'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"7\n8\n");});
});
test("generated exports native: generador importado, publicación hija y etsDefinition",async()=>{
  const child=generator('@etsPublish function answer(value:number):number{return etsDefinition("helper",value);}',"child","export ");
  await project({"gen.ets":'function helper(value:number):number{return value+1;}'+child+generator('etsDefinition("child");',"parent","export "),"lib.ets":'import {parent as generate} from "./gen";\ngenerate();export {answer};',"main.ets":'import {answer} from "./lib";\nprint(answer(7));'},async(entry,dir)=>{assert.equal(native(await compileFile(entry),dir),"8\n");});
});
test("generated exports: publicaciones homónimas no mezclan identidades",async()=>{
  await project({"a.ets":producer,"b.ets":generator('@etsPublish function answer(value:string):string{return value;}',"produce")+"produce();export {answer};","main.ets":'import {answer as left} from "./a";\nimport {answer as right} from "./b";\nprint(left(7));print(right("ok"));'},async entry=>{
    const result=await compileFile(entry);const names=result.ast.generatedSources!.flatMap(source=>source.bindings!).filter(b=>b.name === "answer").map(b=>b.emittedName);assert.equal(new Set(names).size,2);
  });
});
test("generated exports: fuente productora usa su publicación con otro módulo homónimo",async()=>{
  await project({"a.ets":producer+"print(answer(7));","b.ets":'export const answer:number=99;',"main.ets":'import {answer as add} from "./a";\nimport "./b";\nprint(add(8));'},async entry=>{await compileFile(entry);});
});
test("generated exports: sobrecargas conservan parámetros públicos",async()=>{
  const code='@etsPublish function answer(value:number):number{return value;}@etsPublish function answer(value:string):string{return value;}';
  await project({"lib.ets":generator(code)+"emit();export {answer};","main.ets":'import {answer as choose} from "./lib";\nprint(choose(value:7));print(choose(value:"ok"));'},async entry=>{await compileFile(entry);});
});
test("generated exports: generador generado se importa y expande en otro módulo",async()=>{
  const nested=generator('@etsPublish function answer(value:number):number{return value+1;}',"generate");
  await project({"factory.ets":generator(nested.replace('@etsgen ','@etsPublish @etsgen '),"factory")+"factory();export {generate};","lib.ets":'import {generate} from "./factory";\ngenerate();export {answer};',"main.ets":'import {answer} from "./lib";\nprint(answer(7));'},async entry=>{await compileFile(entry);});
});
test("generated exports: interface publicada comprueba tipos del consumidor",async()=>{
  await project({"lib.ets":generator('@etsPublish interface Shape {value:number;}')+"emit();export {Shape};","main.ets":'import type {Shape as View} from "./lib";\nclass Box {value:number;}function read(value:View):number{return value.value;}print(read(new Box(7)));'},async entry=>{await compileFile(entry);});
});
test("generated exports: clase genérica publicada conserva tipos",async()=>{
  await project({"lib.ets":generator('@etsPublish class Box<T> {value:T;}')+"emit();export {Box};","main.ets":'import {Box as Crate} from "./lib";\nconst box:Crate<number> = new Crate<number>(7);print(box.value);'},async entry=>{await compileFile(entry);});
});
for(const [label,code,suffix] of [
  ["sin publicación",'function answer(value:number):number{return value;}',"emit();"],
  ["nombre ausente",'print(7);',"emit();"],
  ["generador sin llamada",declaration,""],
  ["publicación local",declaration,"function run():void {emit();}run();"],
  ["publicación en bloque",declaration,"{emit();}"],
] as const) {
  test(`generated exports: rechaza ${label} sin usarlo en consumidor`,async()=>{
    await project({"lib.ets":generator(code)+suffix+"\nexport {answer};","main.ets":'import {answer} from "./lib";'},async(entry,dir)=>{
      await assert.rejects(()=>compileFile(entry),(error:unknown)=>{assert.ok(error instanceof DiagnosticError);const diagnostic=error.diagnostics.find(d=>d.code === "MODULE_GENERATED_EXPORT_MISSING");assert.ok(diagnostic,error.message);assert.equal(diagnostic.file,join(dir,"lib.ets"));assert.equal(diagnostic.span.start.line,2);return true;});
    });
  });
}
test("generated exports: import usado tampoco oculta publicación ausente",async()=>{
  await project({"lib.ets":generator('print(7);')+"emit();export {answer};","main.ets":'import {answer as add} from "./lib";\nprint(add(7));'},async entry=>{await assert.rejects(()=>compileFile(entry),/no publicó 'answer'/);});
});
test("generated exports: valida tipos originales antes de borrar comptime",async()=>{
  await project({"lib.ets":producer,"main.ets":'import {answer} from "./lib";\nconst result:number=comptime(():number=>{const bad:string=7;return answer(1);});'},async entry=>{await assert.rejects(()=>compileFile(entry),/string|number/);});
});
test("generated exports: rechaza argumento incompatible con tipo generado",async()=>{
  await project({"lib.ets":producer,"main.ets":'import {answer as add} from "./lib";\nprint(add("bad"));'},async entry=>{
    await assert.rejects(()=>compileFile(entry),(error:unknown)=>{assert.ok(error instanceof DiagnosticError);assert.match(error.message,/add|string|number/);assert.doesNotMatch(error.message,/ets_import_/);return true;});
  });
});
test("generated exports: const publicada sigue siendo inmutable",async()=>{
  await project({"lib.ets":generator('@etsPublish const value:number=7;')+"emit();export {value};","main.ets":'import {value as result} from "./lib";\nresult=9;'},async entry=>{await assert.rejects(()=>compileFile(entry),/constante/);});
});
test("generated exports: export de variable requiere anotación",async()=>{
  await project({"lib.ets":generator('@etsPublish const value=7;')+"emit();export {value};","main.ets":'import {value} from "./lib";'},async entry=>{await assert.rejects(()=>compileFile(entry),/anotación de tipo explícita/);});
});
test("generated exports: nombres no declarados en export siguen privados",async()=>{
  await project({"lib.ets":generator(declaration)+"emit();","main.ets":'import {answer} from "./lib";'},async entry=>{await assert.rejects(()=>compileFile(entry),/no declara 'answer'/);});
});
test("generated exports: duplicar publicación genera error con procedencia",async()=>{
  await project({"lib.ets":generator(declaration)+"emit();emit();export {answer};","main.ets":'import {answer} from "./lib";'},async entry=>{
    await assert.rejects(()=>compileFile(entry),(error:unknown)=>{assert.ok(error instanceof DiagnosticError);assert.ok(error.diagnostics.some(d=>d.generated));assert.match(error.message,/duplicad/);return true;});
  });
});
test("generated exports: API generada no puede exponer clase privada",async()=>{
  const code='class Hidden {value:number;}@etsPublish function answer():Hidden{return new Hidden(7);}';
  await project({"lib.ets":generator(code)+"emit();export {answer};","main.ets":'import {answer} from "./lib";'},async entry=>{await assert.rejects(()=>compileFile(entry),/tipo privado/);});
});
test("generated exports: sintaxis generada inválida conserva el fragmento",async()=>{
  await project({"lib.ets":generator('@etsPublish function answer(')+"emit();export {answer};","main.ets":'import {answer} from "./lib";'},async entry=>{
    await assert.rejects(()=>compileFile(entry),(error:unknown)=>{assert.ok(error instanceof DiagnosticError);assert.ok(error.diagnostics.some(d=>d.code === "ETSGEN_GENERATED_PARSE" && d.generated));return true;});
  });
});
test("generated exports: expansión no borra acceso a generador ajeno no importado",async()=>{
  await project({"gen.ets":generator(declaration,"child")+generator('child();',"parent","export "),"lib.ets":'import {parent} from "./gen";\nparent();export {answer};',"main.ets":'import {answer} from "./lib";'},async entry=>{await assert.rejects(()=>compileFile(entry),/debe importarse explícitamente o seleccionarse con etsDefinition/);});
});
test("generated exports: publicación colisiona con binding fuente normalizado",async()=>{
  await project({"lib.ets":'export const answer:number=99;'+generator(declaration)+'emit();',"main.ets":'import {answer as value} from "./lib";'},async entry=>{await assert.rejects(()=>compileFile(entry),/duplicad/);});
});
test("generated exports: publicación raíz no oculta namespace importado",async()=>{
  await project({"values.ets":'export const value:number=7;',"lib.ets":'import * as model from "./values";\n'+generator('@etsPublish const model:number=7;')+'emit();',"main.ets":'import "./lib";'},async entry=>{await assert.rejects(()=>compileFile(entry),/conflicto.*namespace/);});
});

// Exercise the shipped multi-module example: literal ETS braces in a template
// must remain text rather than turning into unintended interpolations.
test("generated exports native: ejemplo con plantilla ETS multilínea", async()=>{
  await project({}, async(_entry,dir)=>{
    const entry=join(root,"examples/generated-module-exports/main.ets");
    const result=await compileFile(entry);
    assert.equal(native(result,dir),"7\nok\n");
    assert.match(result.ast.generatedSources![0].source, /class Box \{ value: number; \}/);
  });
});
