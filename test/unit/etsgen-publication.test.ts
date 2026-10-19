import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";
import { compileFile } from "../../src/modules/module-loader.ts";
import { writeGeneratedSources } from "../../src/codegen/etsgen-sources.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const generator=(code:string)=>`@etsgen function emit():string {return ${JSON.stringify(code)};}`;
const publicFunction="@etsPublish function answer(value:number):number {return value+1;}";

test("etsgen publication: caller fuente usa función generada y etiquetas públicas",()=>{
  const {ast,cpp}=compile(generator(publicFunction)+"print(answer(value:41));emit();");
  assert.match(cpp,/answer\(41\.0\)/);
  assert.equal(ast.generatedSources![0].bindings!.find(b=>b.name === "answer")!.emittedName,"answer");
  assert.equal(ast.generatedSources![0].bindings!.find(b=>b.name === "value")!.emittedName,"value");
});
test("etsgen publication: variable local publicada conserva ámbito y mutabilidad",()=>{
  assert.doesNotThrow(()=>compile(generator("@etsPublish let result:number=7;")+"function run():void {emit();result=8;print(result);} run();"));
  assert.throws(()=>compile(generator("@etsPublish const result:number=7;")+"function run():void {emit();result=8;}"),/constante/);
  assert.throws(()=>compile(generator("@etsPublish const result:number=7;")+"function run():void {emit();} print(result);"),/result/);
});
test("etsgen publication: clase e interface generadas se validan con el AST normal",()=>{
  assert.doesNotThrow(()=>compile(generator("@etsPublish class Box {value:number;} @etsPublish interface Shape {value:number;}")+"emit(); const box:Box=new Box(7);const shape:Shape={value:8};print(box.value+shape.value);"));
});
test("etsgen publication: nombres privados siguen ocultos al caller",()=>{
  assert.throws(()=>compile(generator("const secret:number=7;")+"emit();print(secret);"),/secret/);
});
test("etsgen publication: rechaza publicación repetida y colisión original",()=>{
  assert.throws(()=>compile(generator(publicFunction)+"emit();emit();"),/duplicad/);
  assert.throws(()=>compile(generator(publicFunction)+"function answer(value:number):number{return 0;} emit();"),/duplicad/);
});
for(const code of ["@etsPublish(1) const result:number=7;","{ @etsPublish const result:number=7; }","@etsPublish const [a,b]=[1,2];"]) {
  test(`etsgen publication: rechaza marcador inválido ${code}`,()=>{
    assert.throws(()=>compile(generator(code)+"emit();"),(error:unknown)=>{
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(d=>d.generated && d.code === "ETSGEN_GENERATED_HYGIENE"));return true;
    });
  });
}
test("etsgen publication: marcador fuente original no se ignora",()=>{
  assert.throws(()=>compile("@etsPublish const value:number=7;"),/@etsPublish/);
});
test("etsgen publication: no borra errores en argumentos ni cuerpos comptime",()=>{
  assert.throws(()=>compile('@etsgen function emit(n:number):string{return "@etsPublish const result:number=7;";} emit("bad");print(result);'),/number|string/);
  assert.throws(()=>compile(generator(publicFunction)+"emit();const result:number=comptime(():number=>{const hidden:string=7;return answer(1);});"),/string|number/);
  assert.throws(()=>compile(generator(publicFunction)+"emit();const result:number=comptime(():number=>{const hidden:number=7;hidden=8;return answer(1);});"),/constante/);
});
test("etsgen publication: expansión hija puede publicar para el código original",()=>{
  assert.doesNotThrow(()=>compile('@etsgen function child():string{return "@etsPublish const result:number=7;";}'+generator("child();")+"function run():void {emit();print(result);}run();"));
});
test("etsgen publication: padre generado puede usar publicación hija",()=>{
  assert.doesNotThrow(()=>compile('@etsgen function child():string{return "@etsPublish const result:number=7;";}'+generator("child();print(result);")+"function run():void {emit();}run();"));
});
test("etsgen publication: no borra argumentos inválidos de expansión hija",()=>{
  assert.throws(()=>compile('@etsgen function child(n:number):string{return "print(7);";}'+generator('child("bad");')+"emit();"),/number|string/);
});
test("etsgen publication: errores originales sobreviven a chequeos intermedios",()=>{
  assert.throws(()=>compile('function f(n:number):number{return n;}f(bad:1);'+generator(publicFunction)+"emit();print(answer(41));"),/no tiene un parámetro llamado 'bad'/);
  assert.throws(()=>compile(generator(publicFunction)+"emit();const bad:string=answer(41);"),/string|number/);
});
test("etsgen publication: sobrecargas generadas mantienen etiquetas externas",()=>{
  assert.doesNotThrow(()=>compile(generator('@etsPublish function answer(value:number):number{return value;} @etsPublish function answer(value:string):string{return value;}')+'emit();print(answer(value:7));print(answer(value:"hi"));'));
});

const definitionCode='print(etsDefinition("helper", value));print(etsDefinition("base"));';
const definitionSource='const base:number=7; function helper(n:number):number{return n+1;}'+generator(definitionCode)+'function run():void {const helper:number=99;const base:string="wrong";const value:number=7;emit();}run();';
test("etsgen definition: usa símbolos de definición y argumentos del caller",()=>{
  const {ast,cpp}=compile(definitionSource);
  assert.match(cpp,/::helper\(value\)/);assert.match(cpp,/::base/);
  assert.equal(ast.generatedSources![0].captures!.filter(c=>c.kind === "definition").length,2);
});
for(const code of ['etsDefinition("missing");','etsDefinition("bad;name");','const name:string="base";etsDefinition(name);','print(etsDefinition("base",1));']) {
  test(`etsgen definition: rechaza captura inválida ${code}`,()=>assert.throws(()=>compile('const base:number=7;'+generator(code)+"emit();"),/etsDefinition/));
}
test("etsgen definition: closures no capturan homónimo del caller",()=>{
  const {cpp}=compile('const base:number=7;'+generator('const read:()=>number=():number=>etsDefinition("base");print(read());')+'function run():void {const base:string="wrong";emit();}run();');
  assert.match(cpp,/::base/);
});

test("etsgen definition native: publicación y capturas sobreviven compilación C++",()=>{
  const dir=mkdtempSync(join(tmpdir(),"etsgen-public-native-"));
  try {
    const cpp=compile(generator(publicFunction)+"emit();print(answer(value:41));"+definitionSource.replace(/@etsgen function emit/g,"@etsgen function other").replace(/emit\(\);/g,"other();")).cpp;
    writeFileSync(join(dir,"main.cpp"),cpp);
    execFileSync("g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,join(dir,"main.cpp"),"-o",join(dir,"app")],{encoding:"utf8"});
    assert.equal(execFileSync(join(dir,"app"),{encoding:"utf8"}),"42\n8\n7\n");
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("etsgen definition modules: helper privado accesible solo mediante marcador",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"etsgen-definition-modules-"));
  try {
    writeFileSync(join(dir,"lib.ets"),'const base:number=7;function helper(n:number):number{return n+1;} '+generator(definitionCode).replace('@etsgen function','@etsgen export function'));
    writeFileSync(join(dir,"main.ets"),'import {emit} from "./lib";\nfunction run():void {const helper:number=99;const base:string="wrong";const value:number=7;emit();} run();');
    const result=await compileFile(join(dir,"main.ets"));
    assert.equal(result.ast.generatedSources![0].definitionModule,join(dir,"lib.ets"));
    writeFileSync(join(dir,"estatic_common.hpp"),result.header);
    result.modules.forEach((m,i)=>writeFileSync(join(dir,`module${i}.cpp`),m.cpp));
    execFileSync("g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,join(dir,"module0.cpp"),join(dir,"module1.cpp"),"-o",join(dir,"app")],{encoding:"utf8"});
    assert.equal(execFileSync(join(dir,"app"),{encoding:"utf8"}),"8\n7\n");
    writeFileSync(join(dir,"other.ets"),'export const foreign:number=99;');
    writeFileSync(join(dir,"lib.ets"),generator('print(etsDefinition("foreign"));').replace('@etsgen function','@etsgen export function'));
    writeFileSync(join(dir,"main.ets"),'import {emit} from "./lib";\nimport {foreign} from "./other";\nemit();');
    await assert.rejects(()=>compileFile(join(dir,"main.ets")),/foreign.*módulo de definición/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("etsgen publication modules: no fuga de nombres al resto de módulos",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"etsgen-public-modules-"));
  try {
    writeFileSync(join(dir,"lib.ets"),generator(publicFunction)+"emit();");
    writeFileSync(join(dir,"main.ets"),'import "./lib";\nprint(answer(1));');
    await assert.rejects(()=>compileFile(join(dir,"main.ets")),/debe importarse explícitamente/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("etsgen source dump: ETS original y manifiesto con identidades y capturas",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"etsgen-source-dump-"));
  try {
    const {ast}=compile(definitionSource);
    await writeGeneratedSources(ast.generatedSources!,dir);
    const manifest=JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8"));
    assert.equal(manifest.version,1);assert.equal(manifest.fragments.length,1);
    assert.equal(readFileSync(join(dir,manifest.fragments[0].file),"utf8"),definitionCode);
    assert.ok(manifest.fragments[0].captures.some((capture:any)=>capture.kind === "definition"));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test("etsgen source dump CLI: funciona en unity, multi y en error generado",()=>{
  const dir=mkdtempSync(join(tmpdir(),"etsgen-dump-cli-"));
  try {
    const input=join(dir,"main.ets");writeFileSync(input,generator(publicFunction)+"emit();print(answer(41));");
    for(const mode of [[],["--multi"]]) {
      const dump=join(dir,mode.length ? "multi-fragments" : "unity-fragments");
      execFileSync(process.execPath,["--experimental-strip-types",join(root,"src/cli.ts"),"--emit-etsgen",dump,input,"-o",join(dir,"main.cpp"),...mode],{encoding:"utf8"});
      assert.equal(readFileSync(join(dump,"etsgen-0.ets"),"utf8"),publicFunction);
    }
    writeFileSync(input,generator('const bad:string=7;')+"emit();");
    const dump=join(dir,"errors");
    const failed=spawnSync(process.execPath,["--experimental-strip-types",join(root,"src/cli.ts"),input,"--emit-etsgen",dump,"-o",join(dir,"bad.cpp")],{encoding:"utf8"});
    assert.equal(failed.status,1);assert.ok(existsSync(join(dump,"manifest.json")));
    assert.equal(readFileSync(join(dump,"etsgen-0.ets"),"utf8"),'const bad:string=7;');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
