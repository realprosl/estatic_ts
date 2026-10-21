import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,existsSync,unlinkSync,statSync,utimesSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync,execFileSync} from "node:child_process";
import {compile} from "../../src/compiler.ts";
import {compileFile,loadModuleGraph} from "../../src/modules/module-loader.ts";
import {mapCppSources,markCppOrigin} from "../../src/codegen/cpp-source-map.ts";
import {writeGeneratedSources,writeMappedCpp} from "../../src/codegen/etsgen-sources.ts";
import {buildIncremental} from "../../src/build/incremental-builder.ts";
import {loadConfig} from "../../src/config/project-config.ts";
import type {GeneratedSource,Span} from "../../src/core/span.ts";
import {compareModuleFingerprints} from "../../src/modules/module-fingerprints.ts";
import {BuildProfile} from "../../src/build/build-profile.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const span:Span={start:{offset:0,line:1,column:1},end:{offset:1,line:1,column:2}};
const sources:GeneratedSource[]=[{id:"etsgen:0",kind:"etsgen",generator:"emit",source:"print(7);",callSpan:span}];
const generated=(line=1,id="etsgen:0"):Span=>({...span,generated:{id,span:{start:{...span.start,line},end:{...span.end,line}}}});
const generator=(text:string,name="emit")=>`@etsgen function ${name}():string{return ${JSON.stringify(text)};}`;
async function temporary(run:(dir:string)=>void|Promise<void>){const dir=mkdtempSync(join(tmpdir(),"ets-cpp-maps-"));try{await run(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
const native=(file:string,extra:string[]=[])=>spawnSync("g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,file,...extra],{encoding:"utf8"});
const cli=(entry:string,args:string[])=>spawnSync(process.execPath,["--experimental-strip-types",join(root,"src/cli.ts"),entry,...args],{encoding:"utf8"});

test("cpp maps: código sin expansiones permanece idéntico",()=>{
 const cpp="int main() {return 0;}\n";assert.deepEqual(mapCppSources(cpp,"main.cpp",[],[]),{cpp,mappings:[]});assert.equal(markCppOrigin(span,cpp),cpp);
});
test("cpp maps: marcador conserva span y rango físico",()=>{
 const raw=markCppOrigin(generated(3),"int x=1;\nint y=2;");const result=mapCppSources(raw,"main.cpp",sources,["generated.ets"]);
 assert.match(result.cpp,/#line 3 "generated.ets"/);assert.equal(result.mappings.length,2);
 const mapping=result.mappings[0];assert.equal(result.cpp.split("\n")[mapping.cppStartLine-1],"int x=1;");assert.equal(mapping.cppEndLine,mapping.cppStartLine);assert.equal(mapping.origin.span.start.line,3);
});
test("cpp maps: restaura archivo C++ y línea física tras el fragmento",()=>{
 const result=mapCppSources(markCppOrigin(generated(),"int x;")+"int broken;","/tmp/main.cpp",sources,["generated.ets"]);
 const lines=result.cpp.split("\n");const reset=lines.findIndex(line=>/^#line .*main.cpp"$/.test(line));assert.ok(reset>=0);assert.equal(lines[reset],`#line ${reset+2} "/tmp/main.cpp"`);assert.ok(lines.slice(reset+1).includes("int broken;"));
});
test("cpp maps: scopes anidados restauran la procedencia del padre",()=>{
 const child={...sources[0],id:"etsgen:1",parentId:"etsgen:0"};
 const raw=markCppOrigin(generated(2),"before;"+markCppOrigin(generated(4,"etsgen:1"),"child;")+"after;");
 const result=mapCppSources(raw,"main.cpp",[...sources,child],["parent.ets","child.ets"]);
 assert.deepEqual(result.mappings.map(m=>m.origin.id),["etsgen:0","etsgen:1","etsgen:0"]);assert.match(result.cpp,/#line 4 "child.ets"/);assert.equal(result.cpp.match(/#line 2 "parent.ets"/g)?.length,2);
});
for(const [label,cpp] of [["sin apertura","// @ets-cpp-origin-end"],["sin cierre",markCppOrigin(generated(),"x;").replace("// @ets-cpp-origin-end","")],["id desconocido",markCppOrigin(generated(1,"unknown"),"x;")],["línea inválida",markCppOrigin(generated(0),"x;")]] as const){
 test(`cpp maps: rechaza mapa ${label}`,()=>{assert.throws(()=>mapCppSources(cpp,"main.cpp",sources,["generated.ets"]));});
}
test("cpp maps: escapa rutas con comillas y barras sin inyectar directivas",()=>{
 const result=mapCppSources(markCppOrigin(generated(),"int x;"),'a"b.cpp',sources,['x"y\\z.ets']);assert.ok(result.cpp.includes(JSON.stringify('x"y\\z.ets')));assert.ok(result.cpp.includes(JSON.stringify('a"b.cpp')));
});
test("cpp maps: string ETS con aspecto de marcador permanece texto",()=>{
 const {cpp}=compile(generator('print("// @ets-cpp-origin-end");')+"emit();");assert.doesNotThrow(()=>mapCppSources(cpp,"main.cpp",sources,["generated.ets"]));
});
test("cpp maps native: error deliberado apunta al ETS; error posterior vuelve al C++",async()=>temporary(async dir=>{
 const file=join(dir,"main.cpp"),ets=join(dir,"fragment.ets");writeFileSync(ets,"// source\n// source\nprint(7);\n");
 const raw=markCppOrigin(generated(3),'static_assert(false,"fragment_failure");')+'\nstatic_assert(false,"cpp_failure");';
 const result=mapCppSources(raw,file,sources,[ets]);writeFileSync(file,result.cpp);
 const nativeResult=native(file,["-fsyntax-only"]);assert.notEqual(nativeResult.status,0);assert.ok(nativeResult.stderr.includes(ets+":3:"),nativeResult.stderr);
 const physical=result.cpp.split("\n").findIndex(line=>line.includes('"cpp_failure"'))+1;assert.ok(nativeResult.stderr.includes(file+":"+physical+":"),nativeResult.stderr);
}));
test("cpp maps CLI native: unity compila y ejecuta conservando ETS original",async()=>temporary(async dir=>{
 const entry=join(dir,"main.ets"),out=join(dir,"app.cpp"),text='@etsPublish function answer(value:number):number {\n return value+1;\n}';writeFileSync(entry,generator(text)+"emit();print(answer(7));");
 const result=cli(entry,["-o",out]);assert.equal(result.status,0,result.stderr);
 const manifest=JSON.parse(readFileSync(join(out+".etsgen","manifest.json"),"utf8"));assert.equal(readFileSync(join(out+".etsgen",manifest.fragments[0].file),"utf8"),text);
 const map=JSON.parse(readFileSync(out+".map.json","utf8"));assert.ok(map.mappings.some((m:any)=>m.origin.span.start.line===2));
 const compiled=native(out,["-o",join(dir,"app")]);assert.equal(compiled.status,0,compiled.stderr);assert.equal(execFileSync(join(dir,"app"),{encoding:"utf8"}),"8\n");
}));
test("cpp maps CLI native: fallo en firma de plantilla de cabecera señala ETS",async()=>temporary(async dir=>{
 const entry=join(dir,"main.ets"),out=join(dir,"app.cpp"),text='\n@etsPublish function answer<T>(value:Native):number { return 7; }';
 writeFileSync(entry,'@cpp_type("MissingNativeType") class Native {}'+generator(text)+"emit();");
 const result=cli(entry,["-o",out]);assert.equal(result.status,0,result.stderr);
 // Introduce a native-only error after transpilation to exercise the emitted map.
 writeFileSync(out,readFileSync(out,"utf8").replaceAll("Native value","MissingNativeType value"));
 const compiled=native(out,["-fsyntax-only"]);assert.notEqual(compiled.status,0);assert.ok(compiled.stderr.includes(join(out+".etsgen","etsgen-0.ets")+":2:"),compiled.stderr);
 const map=JSON.parse(readFileSync(out+".map.json","utf8"));assert.ok(map.mappings.some((m:any)=>m.origin.span.start.line===2));
}));
test("cpp maps CLI: multi escribe mapas del header y las unidades",async()=>temporary(async dir=>{
 const entry=join(dir,"main.ets"),out=join(dir,"out"),dump=join(dir,"custom-fragments");writeFileSync(entry,generator('@etsPublish class Box {value:number;}')+"emit();print(new Box(7).value);");
 const result=cli(entry,["--multi","-o",out,"--emit-etsgen",dump]);assert.equal(result.status,0,result.stderr);assert.ok(existsSync(join(out,"main.cpp.map.json")));const header=readFileSync(join(out,"estatic_common.hpp"),"utf8");assert.ok(header.includes(join(dump,"etsgen-0.ets")));
 const compiled=native(join(out,"main.cpp"),["-o",join(dir,"app")]);assert.equal(compiled.status,0,compiled.stderr);assert.equal(execFileSync(join(dir,"app"),{encoding:"utf8"}),"7\n");
}));
test("cpp maps: manifest conserva llamada local al módulo y parentesco",async()=>temporary(async dir=>{
 writeFileSync(join(dir,"gen.ets"),generator('etsDefinition("child");',"parent")+'\n'+generator('print(7);',"child")+'\nexport {parent};');
 writeFileSync(join(dir,"main.ets"),'import {parent as produce} from "./gen";\nproduce();');
 const result=await compileFile(join(dir,"main.ets"));await writeGeneratedSources(result.ast.generatedSources!,join(dir,"sources"));const manifest=JSON.parse(readFileSync(join(dir,"sources/manifest.json"),"utf8"));
 assert.equal(manifest.fragments[0].displayGenerator,"produce");assert.equal(manifest.fragments[0].callLocation.file,join(dir,"main.ets"));assert.equal(manifest.fragments[0].callLocation.span.start.line,2);assert.equal(manifest.fragments[1].parentId,manifest.fragments[0].id);assert.equal(manifest.fragments[1].callLocation.file,join(dir,"sources/etsgen-0.ets"));assert.equal(manifest.fragments[1].callLocation.span.start.line,1);
}));
test("cpp maps: API escribe sidecar con ruta del manifiesto",async()=>temporary(async dir=>{
 await writeGeneratedSources(sources,dir);const out=join(dir,"main.cpp");const cpp=await writeMappedCpp(markCppOrigin(generated(),"int value;"),out,sources,dir);assert.equal(readFileSync(out,"utf8"),cpp);const map=JSON.parse(readFileSync(out+".map.json","utf8"));assert.equal(map.manifest,join(dir,"manifest.json"));
}));
test("cpp maps native: incremental conserva y reconstruye artefactos de depuración",async()=>temporary(async dir=>{
 const compiler=join(dir,"compiler");mkdirSync(join(compiler,"build"),{recursive:true});mkdirSync(join(compiler,"runtime"));
 // Unused prerequisite sentinel: this program does not use or link libuv.
 writeFileSync(join(compiler,"build/runtime_ets_libuv.o"),"");
 writeFileSync(join(compiler,"runtime/ets_runtime.hpp"),`#include ${JSON.stringify(join(root,"runtime/ets_runtime.hpp"))}\n`);
 writeFileSync(join(dir,"main.ets"),generator('print(7);')+"emit();");
 const configPath=join(dir,"config.ts");writeFileSync(configPath,`export default {entry:"main.ets",compiler:{enabled:true,flags:["-std=c++20","-O0","-pthread","-fno-exceptions",${JSON.stringify('-I'+root)}]}};`);const config=(await loadConfig(configPath))!;
 const first=await buildIncremental(config,compiler);assert.equal(first.compiled.length,1);assert.equal(first.transpilationCache,"miss");assert.equal(execFileSync(first.binary,{encoding:"utf8"}),"7\n");
 assert.ok(first.profile.totalsMs["check-source"]>=0);assert.ok(first.profile.totalsMs["native-compile"]>0);assert.ok(existsSync(first.profile.report));assert.ok(!existsSync(join(config.incremental.cacheDirectory,"../pch")));
 const originalHeader=readFileSync(first.header,"utf8");const old=new Date("2000-01-01T00:00:00Z");utimesSync(first.header,old,old);
 const hit=await buildIncremental(config,compiler);assert.equal(hit.cacheResult,"hit");assert.equal(readFileSync(first.header,"utf8"),originalHeader);assert.equal(statSync(first.header).mtimeMs,old.getTime());assert.ok(!("check-source" in hit.profile.totalsMs));
 const ets=join(config.incremental.generatedDirectory,"etsgen/etsgen-0.ets");unlinkSync(ets);const restored=await buildIncremental(config,compiler);assert.ok(existsSync(ets));assert.equal(restored.transpilationCache,"hit");assert.deepEqual(restored.parsedModules,{reused:1,parsed:0});assert.ok(!("check-source" in restored.profile.totalsMs));assert.equal(statSync(first.header).mtimeMs,old.getTime());
}));

test("cpp maps: recompilar sin expansiones elimina el sidecar anterior",async()=>temporary(async dir=>{
 const file=join(dir,"app.cpp");await writeGeneratedSources(sources,dir);await writeMappedCpp(markCppOrigin(generated(),"int x;"),file,sources,dir);assert.ok(existsSync(file+".map.json"));await writeMappedCpp("int main(){}",file,[],dir);assert.equal(existsSync(file+".map.json"),false);assert.equal(readFileSync(file,"utf8"),"int main(){}");
}));

test("transpilation cache: sólo vuelve a escanear y parsear el módulo modificado",async()=>temporary(async dir=>{
 const cache=join(dir,"cache"),options={baseDirectory:dir,transpilationCacheDirectory:cache};
 writeFileSync(join(dir,"left.ets"),"export function left():number{return 1;}");
 writeFileSync(join(dir,"right.ets"),"export function right():number{return 2;}");
 writeFileSync(join(dir,"main.ets"),'import {left} from "./left";import {right} from "./right";print(left()+right());');
 const cold=await compileFile(join(dir,"main.ets"),options);assert.deepEqual(cold.transpilationCache,{parsedHits:0,parsedMisses:3});
 const warmGraph=await loadModuleGraph(join(dir,"main.ets"),options);assert.deepEqual(warmGraph.frontendCache,{syntaxHits:3,syntaxMisses:0});
 const warm=await compileFile(join(dir,"main.ets"),options);assert.deepEqual(warm.transpilationCache,{parsedHits:3,parsedMisses:0});
 writeFileSync(join(dir,"right.ets"),"export function right():number{return 20;}");
 const changedGraph=await loadModuleGraph(join(dir,"main.ets"),options);assert.deepEqual(changedGraph.frontendCache,{syntaxHits:2,syntaxMisses:1});
 const changed=await compileFile(join(dir,"main.ets"),options);assert.deepEqual(changed.transpilationCache,{parsedHits:2,parsedMisses:1});
 assert.match(changed.modules.find(module=>module.name.endsWith("right.ets"))!.cpp,/20/);
}));

test("incremental: editar una implementación reutiliza frontend y objeto del módulo intacto",async()=>temporary(async dir=>{
 const compiler=join(dir,"compiler");mkdirSync(join(compiler,"build"),{recursive:true});mkdirSync(join(compiler,"runtime"));
 writeFileSync(join(compiler,"build/runtime_ets_libuv.o"),"");writeFileSync(join(compiler,"runtime/ets_runtime.hpp"),`#include ${JSON.stringify(join(root,"runtime/ets_runtime.hpp"))}\n`);
 const library=join(dir,"lib.ets");writeFileSync(library,"export function answer():number{return 7;}");writeFileSync(join(dir,"main.ets"),'import {answer} from "./lib";function run():number{return answer();}print(run());');
 const configPath=join(dir,"config.ts");writeFileSync(configPath,`export default {entry:"main.ets",compiler:{enabled:true,flags:["-std=c++20","-O0","-pthread","-fno-exceptions",${JSON.stringify('-I'+root)}]}};`);const config=(await loadConfig(configPath))!;
 const cold=await buildIncremental(config,compiler);assert.equal(cold.compiled.length,2);assert.equal(execFileSync(cold.binary,{encoding:"utf8"}),"7\n");
 writeFileSync(library,"export function answer():number{return 9;}");
 const changed=await buildIncremental(config,compiler);assert.equal(changed.transpilationCache,"partial");assert.deepEqual(changed.parsedModules,{reused:1,parsed:1});assert.equal(changed.compiled.length,1);assert.equal(changed.reused.length,1);assert.equal(execFileSync(changed.binary,{encoding:"utf8"}),"9\n");
 assert.equal(changed.semanticCache!.stages.source.reusedBodies,1);assert.equal(changed.semanticCache!.stages.final.reusedBodies,1);
 assert.equal(changed.moduleChanges.find(item=>item.file===library)?.reason,"implementation");
 const persisted=JSON.parse(readFileSync(changed.profile.report,"utf8"));assert.equal(persisted.moduleChanges.length,1);assert.ok(persisted.profile.totalsMs["codegen-module"]>=0);
 assert.equal(persisted.semanticCache.stages.source.checkedBodies,1);
 unlinkSync(changed.header);const restored=await buildIncremental(config,compiler);assert.ok(existsSync(restored.header));assert.equal(restored.transpilationCache,"hit");assert.ok(!("check-source" in restored.profile.totalsMs));assert.equal(execFileSync(restored.binary,{encoding:"utf8"}),"9\n");
}));

test("build profile: errores se propagan y medidas async conservan el resultado",async()=>{
 const profile=new BuildProfile();assert.throws(()=>profile.measure("broken",()=>{throw new Error("expected");}),/expected/);
 assert.equal(await profile.measureAsync("async",async()=>7),7);assert.ok(profile.totals().broken>=0);assert.ok(profile.totals().async>=0);
});

for(const [label,before,after,reason] of [
 ["cuerpo runtime","export function value():number{return 1;}","export function value():number{return 2;}","implementation"],
 ["firma","export function value():number{return 1;}","export function value(x:number=1):number{return x;}","interface"],
 ["helper privado comptime","function helper():number{return 1;}@comptime export function value():number{return helper();}","function helper():number{return 2;}@comptime export function value():number{return helper();}","compile-time"],
 ["cuerpo genérico","export function value<T>(x:T):T{return x;}","export function value<T>(x:T):T{print(1);return x;}","compile-time"],
 ["constante exportada","export const value:number=1;","export const value:number=2;","interface"],
] as const) {
 test(`module fingerprints: ${label}`,async()=>temporary(async dir=>{
  const lib=join(dir,"lib.ets"),entry=join(dir,"main.ets");writeFileSync(lib,before);writeFileSync(entry,'import "./lib";');
  const first=(await compileFile(entry)).semanticFingerprints!;writeFileSync(lib,after);const second=(await compileFile(entry)).semanticFingerprints!;
  const changes=compareModuleFingerprints(first,second);assert.equal(changes.find(item=>item.file===lib)?.reason,reason);
  assert.equal(changes.some(item=>item.file===entry),reason!=="implementation");
 }));
}

test("module fingerprints: propagación transitiva por reexports y eliminación",async()=>temporary(async dir=>{
 const lib=join(dir,"lib.ets"),entry=join(dir,"main.ets");writeFileSync(lib,'export function value():number{return 1;}');writeFileSync(join(dir,"barrel.ets"),'export * from "./lib";');writeFileSync(entry,'import {value} from "./barrel";print(value());');
 const first=(await compileFile(entry)).semanticFingerprints!;writeFileSync(lib,'export function value(x:number=1):number{return x;}');const second=(await compileFile(entry)).semanticFingerprints!;
 const changes=compareModuleFingerprints(first,second);assert.equal(changes.length,3);assert.equal(changes.find(item=>item.file===entry)?.reason,"dependency");
 writeFileSync(entry,"print(1);");const removed=compareModuleFingerprints(second,(await compileFile(entry)).semanticFingerprints!);assert.equal(removed.filter(item=>item.reason==="removed").length,2);
}));

test("module fingerprints: posiciones y comentarios no cambian interfaces",async()=>temporary(async dir=>{
 const entry=join(dir,"main.ets");writeFileSync(entry,'export function value():number{return 1;}');const before=(await compileFile(entry)).semanticFingerprints!;
 writeFileSync(entry,'// comment\n\nexport function value():number{return 1;}');const after=(await compileFile(entry)).semanticFingerprints!;
 assert.equal(before[0].interfaceHash,after[0].interfaceHash);assert.equal(before[0].implementationHash,after[0].implementationHash);
}));

test("module fingerprints: implementación importada por un generador invalida consumidores transitivos",async()=>temporary(async dir=>{
 const lib=join(dir,"lib.ets"),gen=join(dir,"gen.ets"),entry=join(dir,"main.ets");
 writeFileSync(lib,'export function helper():number{return 1;}');writeFileSync(gen,'import {helper} from "./lib";@comptime export function value():number{return helper();}');writeFileSync(entry,'import {value} from "./gen";');
 const before=(await compileFile(entry)).semanticFingerprints!;writeFileSync(lib,'export function helper():number{return 2;}');const after=(await compileFile(entry)).semanticFingerprints!;
 const changes=compareModuleFingerprints(before,after);assert.equal(changes.find(item=>item.file===lib)?.reason,"implementation");assert.equal(changes.find(item=>item.file===gen)?.reason,"dependency");assert.equal(changes.find(item=>item.file===entry)?.reason,"dependency");
}));
