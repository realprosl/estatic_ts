import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, chmodSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { root } from "./root.ts";

const temporary=()=>{mkdirSync(join(root,"build/test-tmp"),{recursive:true});return mkdtempSync(join(root,"build/test-tmp/install-"));};
// El instalador es un script de shell: no usa Node. Se invoca con bash y con
// Node envenenado en el PATH para comprobar que no lo necesita.
//
// Por defecto se instala solo la semilla (`--seed-only`): la generacion 2
// (compilar compiler/ con la semilla) cuesta varios minutos por
// instalacion y hay un test dedicado que la cubre.
// La semilla (un etsc completo compilado desde native-cpp/compiler/unity.cpp) se
// construye una sola vez y se reutiliza con `install.sh --seed`.
let builtSeed="";
const testSeed=()=>{
  if(builtSeed)return builtSeed;
  const out=join(root,"build/test-seed");
  const p=spawnSync("bash",[join(root,"native-cpp/build-all.sh"),"--out",out],{cwd:root,encoding:"utf8",timeout:1800000});
  assert.equal(p.status,0,p.stderr+p.stdout);
  return builtSeed=join(out,"etsc");
};
const install=(prefix:string,extra:string[]=[])=>spawnSync("bash",[join(root,"install.sh"),"--prefix",prefix,"--seed-only",...extra],{cwd:root,encoding:"utf8",timeout:600000});

test("runtime cache invalidates headers and ABI flags and recovers corrupted archives",async()=>{
 const dir=temporary();try{
  mkdirSync(join(dir,"compiler/build"),{recursive:true});mkdirSync(join(dir,"runtime"));writeFileSync(join(dir,"package.json"),'{"type":"module"}');
  cpSync(join(root,"compiler/root.ts"),join(dir,"compiler/root.ts"));cpSync(join(root,"compiler/build/runtime-cache.ts"),join(dir,"compiler/build/runtime-cache.ts"));
  writeFileSync(join(dir,"runtime/runtime_ets_libuv.cpp"),'#include "feature.hpp"\n#ifndef MODE\n#define MODE 0\n#endif\nint value(){return VALUE+MODE;}\n');writeFileSync(join(dir,"runtime/runtime_ets_net_libuv.cpp"),'int unused(){return 0;}');writeFileSync(join(dir,"runtime/feature.hpp"),'#define VALUE 3\n');
  const {runtimeArchive}=await import(pathToFileURL(join(dir,"compiler/build/runtime-cache.ts")).href);
  const archive=runtimeArchive("libuv"),first=statSync(archive).mtimeMs;assert.equal(runtimeArchive("libuv"),archive);assert.equal(statSync(archive).mtimeMs,first);
  const program=join(dir,"app.cpp"),binary=join(dir,"app");writeFileSync(program,'int value();int main(){return value();}');
  const result=(lib:string)=>{const p=spawnSync(process.env.CXX??"g++",[program,lib,"-o",binary],{encoding:"utf8"});assert.equal(p.status,0,p.stderr);return spawnSync(binary).status;};
  assert.equal(result(archive),3);writeFileSync(join(dir,"runtime/feature.hpp"),'#define VALUE 9\n');assert.equal(result(runtimeArchive("libuv")),9);
  const other=runtimeArchive("libuv",undefined,["-DMODE=2"]);assert.notEqual(other,archive);assert.equal(result(other),11);
  writeFileSync(archive,"corrupt");assert.equal(result(runtimeArchive("libuv")),9);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("install protects an unrelated command before modifying its prefix",()=>{
 const dir=temporary();try{
  mkdirSync(join(dir,"bin"));writeFileSync(join(dir,"bin/etsc"),"another program");
  const p=install(dir);assert.equal(p.status,1);assert.match(p.stderr,/comando ajeno/);assert.equal(readFileSync(join(dir,"bin/etsc"),"utf8"),"another program");
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("installed etsc compiles bootstrap native headers outside the checkout",async()=>{
 const dir=temporary(),prefix=join(dir,"prefix");
 try{
  const seed=testSeed();
  const installed=install(prefix,["--seed",seed]);
  assert.equal(installed.status,0,installed.stderr+installed.stdout);
  const moved=join(dir,"moved-prefix");renameSync(prefix,moved);
  const boundary=join(dir,"platform.ets"),probe=join(dir,"bootstrap-header.ets");
  writeFileSync(boundary,readFileSync(join(root,"compiler/platform/platform.ts"),"utf8"));
  writeFileSync(probe,'import {contentHash} from "./platform"; print(contentHash("abc"));');
  // Neither the working directory nor include flags point at the checkout.
  const p=spawnSync(join(moved,"bin/etsc"),["run",probe,"--binary",join(dir,"bootstrap-header")],{cwd:dir,encoding:"utf8",timeout:120000,env:{...process.env,ESTC_ROOT:""}});
  assert.equal(p.status,0,p.stderr+p.stdout);
  assert.equal(p.stdout,"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\n");
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("installed etsc initializes, builds and runs independently of the clone with precompiled runtime",async()=>{
 const dir=temporary(),prefix=join(dir,"prefix"),project=join(dir,"project with spaces"),cache=join(dir,"user-cache");
 try{
  const seed=testSeed();
  // An npm-linked stage-0 launcher from this checkout is safe to replace.
  mkdirSync(join(prefix,"bin"),{recursive:true});symlinkSync(join(root,"src/cli.ts"),join(prefix,"bin/etsc"));
  const sourceBefore=readFileSync(join(root,"src/cli.ts"),"utf8");
  const installed=install(prefix,["--seed",seed]);
  assert.equal(readFileSync(join(root,"src/cli.ts"),"utf8"),sourceBefore);assert.equal(installed.status,0,installed.stderr+installed.stdout);
  const bin=join(prefix,"bin/etsc"),home=realpathSync(join(prefix,"lib/estc/current"));if(process.platform==="linux")assert.equal(readFileSync(bin).subarray(0,4).toString(),"\x7fELF");
  // Installed use must not import the stage-0 compiler or build its frontend.
  assert(!existsSync(join(home,"src")));
  assert.equal(readFileSync(join(home,"compiler/modules/platform.hpp"),"utf8"),readFileSync(join(root,"compiler/modules/platform.hpp"),"utf8"));
  assert(readdirSync(join(home,"compiler"),{recursive:true}).filter(path=>statSync(join(home,"compiler",path)).isFile()).every(path=>/\.(hpp|h)$/.test(path)));
  const poison=join(dir,"without-node"),sentinel=join(dir,"node-was-used");mkdirSync(poison);
  for(const executable of ["node","nodejs","npm"]){const path=join(poison,executable);writeFileSync(path,`#!/bin/sh\necho forbidden >> '${sentinel}'\nexit 99\n`);chmodSync(path,0o755);}
  const nativeEnv={...process.env,PATH:poison+":"+process.env.PATH,NATIVO_NODE:"/missing/node",NODE:"/missing/node",XDG_CACHE_HOME:cache,ESTC_RUNTIME_CACHE:"",ESTATIC_RUNTIME_CACHE:""};
  const run=(args:string[],cwd=dir)=>spawnSync(bin,args,{cwd,encoding:"utf8",timeout:120000,env:nativeEnv});
  // La semilla es el compilador ETS (compiler/unity.cpp): su CLI es la de
  // compiler/driver/main.ts, no la del CLI de la etapa 0. Hasta que la semilla
  // se regenere con #143 todavía imprime la etiqueta antigua.
  for(const flag of ["--version","-version","-v","-V","/V"]){const p=run([flag]);assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/^etsc (\d+\.\d+\.\d+ \(v\d+\)|bootstrap ETS \(ets-ir-2\))\n$/);}
  for(const flag of ["--help","-h","-H"]){const p=run([flag]);assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/Uso: etsc build\|run/);assert.match(p.stdout,/init \[directorio\]/);assert.match(p.stdout,/--version/);}
  // Diagnósticos al estilo de rustc: código, fichero:línea:columna, la línea
  // de código subrayada, ayuda y resumen final.
  const bad=join(dir,"bad.ets");writeFileSync(bad,"let count: number = 1;\nprint(cont);\n");
  const diagnosed=run(["--check",bad,"--no-progress"],dir);assert.equal(diagnosed.status,1);
  assert.match(diagnosed.stderr,/error\[E2001\]: No existe 'cont' en este ámbito/);
  assert.match(diagnosed.stderr,/--> .*bad\.ets:2:7\n/);
  assert.match(diagnosed.stderr,/2 \| print\(cont\);\n\s+\| {7}\^{4}/);
  assert.match(diagnosed.stderr,/= ayuda: ¿querías decir 'count'\?/);
  assert.match(diagnosed.stderr,/error: no se pudo compilar por un error/);
assert(!diagnosed.stderr.includes("\x1b["),"Sin terminal no hay colores");
  // Catálogo messages/<idioma>.json: los mismos errores en inglés y --explain.
  const english=spawnSync(bin,["--check",bad,"--no-progress"],{cwd:dir,encoding:"utf8",timeout:120000,env:{...nativeEnv,ESTC_LANG:"en"}});
  assert.match(english.stderr,/error\[E2001\]: cannot find 'cont' in this scope/);assert.match(english.stderr,/= help: did you mean 'count'\?/);
  assert.match(english.stderr,/error: could not compile due to 1 previous error/);assert.match(english.stderr,/etsc --explain E2001/);
  const explained=run(["--explain","E3003"]);assert.equal(explained.status,0,explained.stderr);assert.match(explained.stdout,/^E3003: .*'const'/);
  writeFileSync(join(home,"templates/types/estatic.d.ts"),"// stale template");
  mkdirSync(project);writeFileSync(join(project,"existing.txt"),"keep me");
  let p=run(["init",project]);assert.equal(p.status,0,p.stderr);assert.match(readFileSync(join(project,"README.md"),"utf8"),/etsc build/);
  assert.equal(readFileSync(join(project,"existing.txt"),"utf8"),"keep me");
  assert.equal(readFileSync(join(project,"types/estatic.d.ts"),"utf8"),readFileSync(join(root,"types/estatic.d.ts"),"utf8"));
  assert.equal(readFileSync(join(project,"types/estatic-modules.d.ts"),"utf8"),readFileSync(join(root,"types/estatic-modules.d.ts"),"utf8"));
  const editor=JSON.parse(readFileSync(join(project,"tsconfig.json"),"utf8"));assert(editor.include.includes("types/**/*"));assert(editor.include.includes("estatic.config.json"));
  assert.match(readFileSync(join(project,"types/estatic.d.ts"),"utf8"),/declare global/);
  assert.match(readFileSync(join(project,".gitignore"),"utf8"),/\.build\//);
  p=run(["init",project]);assert.equal(p.status,1);assert.equal(readFileSync(join(project,"existing.txt"),"utf8"),"keep me");
  // init --no-src convierte en proyecto una carpeta que ya tiene su codigo.
  const existing=join(dir,"existing code");mkdirSync(join(existing,"src"),{recursive:true});writeFileSync(join(existing,"src/main.ts"),'print("mine");');
  p=run(["init",existing]);assert.equal(p.status,1);assert(!existsSync(join(existing,"estatic.config.json")));
  p=run(["init",existing,"--no-src"]);assert.equal(p.status,0,p.stderr);assert.equal(readFileSync(join(existing,"src/main.ts"),"utf8"),'print("mine");');
  for(const file of ["estatic.config.json","tsconfig.json",".gitignore","README.md","types/estatic.d.ts","types/estatic-modules.d.ts"])assert(existsSync(join(existing,file)),file);
  p=run(["update-types",existing,"--no-src"]);assert.equal(p.status,2);
  writeFileSync(join(project,"src/main.ts"),'async function f():Promise<void>{await sleep(1);print("native installed");}await f();');
  p=run(["build"],project);assert.equal(p.status,0,p.stderr);assert(existsSync(join(project,"build/app")));
  p=run(["run"],project);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"native installed\n");
  // #149: el runtime viene compilado en la instalacion y un build sin cambios no
  // compila nada; si el C++ generado no cambia, se reutiliza el objeto del programa.
  assert(readdirSync(join(home,"build/objects")).some(file=>file.endsWith(".o")));
  assert(existsSync(join(project,".build/cache/build-fingerprint")));
  const builtAt=statSync(join(project,"build/app")).mtimeMs;
  p=run(["build"],project);assert.equal(p.status,0,p.stderr);assert.equal(statSync(join(project,"build/app")).mtimeMs,builtAt,"Un build sin cambios no vuelve a enlazar");
  const programObjects=()=>readdirSync(join(project,".build/cache/objects")).filter(file=>file.startsWith("program-"));
  // Una unidad por módulo más __main.cpp (#178).
  const programObject=programObjects();assert.ok(programObject.length>=1);
  writeFileSync(join(project,"src/main.ts"),readFileSync(join(project,"src/main.ts"),"utf8")+"\n// comentario\n");
  p=run(["run"],project);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"native installed\n");assert.deepEqual(programObjects(),programObject);
  // La cabecera precompilada de esta combinacion queda en la cache del usuario.
  if(process.platform==="linux")assert(readdirSync(join(cache,"estc/pch"),{recursive:true}).some(file=>String(file).endsWith(".gch")));
  const upgrade=install(prefix,["--seed",seed]);assert.equal(upgrade.status,0,upgrade.stderr);assert.notEqual(realpathSync(join(prefix,"lib/estc/current")),home);
  const moved=join(dir,"relocated prefix");renameSync(prefix,moved);const movedBin=join(moved,"bin/etsc");
  const runMoved=(args:string[])=>spawnSync(movedBin,args,{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});
  p=runMoved(["run"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"native installed\n");
  const irFile=join(project,"checked.ir.json");
  p=runMoved(["--check","--emit-ir",irFile]);assert.equal(p.status,0,p.stderr);assert(existsSync(irFile));
  // #344: sin cambios en las fuentes se reutiliza el IR verificado, idéntico.
  const irAgain=join(project,"checked-again.ir.json");p=runMoved(["--check","--emit-ir",irAgain]);assert.equal(p.status,0,p.stderr);
  assert.equal(readFileSync(irAgain,"utf8"),readFileSync(irFile,"utf8"));assert.ok(readdirSync(join(project,".build/cache/ir")).length>=1);
  p=runMoved(["--from-ir",irFile,"-o",join(project,"from-ir.cpp"),"--binary",join(project,"from-ir"),"--run"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"native installed\n");
  const configPath=join(project,"estatic.config.json"),config=JSON.parse(readFileSync(configPath,"utf8"));renameSync(configPath,configPath+".saved");
  const tsConfig=join(project,"estatic.config.ts");writeFileSync(tsConfig,"export default "+JSON.stringify(config)+";");
  p=runMoved(["--check"]);assert.equal(p.status,0,p.stderr);
  writeFileSync(tsConfig,'export default (()=>({entry:"src/main.ts"}))();');p=runMoved(["--check"]);assert.equal(p.status,2);rmSync(tsConfig);renameSync(configPath+".saved",configPath);
  mkdirSync(join(project,"deps"));writeFileSync(join(project,"deps/dep.ets"),'export const answer=42;');config.aliases={app:"deps"};writeFileSync(configPath,JSON.stringify(config));writeFileSync(join(project,"src/main.ts"),'import {answer} from "app/dep";print(answer);');
  p=runMoved(["run"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"42\n");
  // #344: un cambio en una dependencia invalida el IR reutilizado.
  writeFileSync(join(project,"deps/dep.ets"),'export const answer=43;');p=runMoved(["run"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"43\n");
  writeFileSync(join(project,"deps/dep.ets"),'export const answer=42;');p=runMoved(["run"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"42\n");
  // #143: un objeto de la caché dañado se recompila.
  for(const file of programObjects())writeFileSync(join(project,".build/cache/objects",file),"corrupt");rmSync(join(project,".build/cache/build-fingerprint"),{force:true});
  p=runMoved(["run"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"42\n");for(const file of programObjects())assert.notEqual(readFileSync(join(project,".build/cache/objects",file),"utf8"),"corrupt");
  // #143: cacheDirectory propio.
  config.incremental={enabled:true,cacheDirectory:"custom cache"};writeFileSync(configPath,JSON.stringify(config));
  p=runMoved(["run"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"42\n");assert(existsSync(join(project,"custom cache/objects")));
  writeFileSync(join(project,"src/main.ts"),'import { argument, exitProcess } from "estatic:process";print(argument(1));exitProcess(7);');p=runMoved(["run","--","forwarded"]);assert.equal(p.status,7,p.stderr);assert.equal(p.stdout,"forwarded\n");assert(!existsSync(sentinel),"The installed compiler must never execute Node");
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("install compiles the C++ seed without Node",async()=>{
 const dir=temporary(),prefix=join(dir,"prefix");
 try{
  // Sin --seed: el instalador compila la semilla de native-cpp/ con el
  // compilador C++20 del sistema. Node no interviene.
  const poison=join(dir,"without-node"),sentinel=join(dir,"node-was-used");mkdirSync(poison);
  for(const executable of ["node","nodejs","npm"]){const path=join(poison,executable);writeFileSync(path,`#!/bin/sh\necho forbidden >> '${sentinel}'\nexit 99\n`);chmodSync(path,0o755);}
  const env={...process.env,PATH:poison+":"+process.env.PATH,NODE:"/missing/node"};
  const p=spawnSync("bash",[join(root,"install.sh"),"--prefix",prefix,"--seed-only"],{cwd:root,encoding:"utf8",timeout:900000,env});
  assert.equal(p.status,0,p.stderr+p.stdout);
  assert(!existsSync(sentinel),"install.sh must never execute Node");
  const bin=join(prefix,"bin/etsc");assert(existsSync(bin));
  const home=realpathSync(join(prefix,"lib/estc/current"));
  assert(existsSync(join(home,"native/frontend")));
  assert(existsSync(join(home,"runtime")));
  assert(existsSync(join(home,"types/estatic.d.ts")));
  assert(existsSync(join(home,"templates/estatic.config.json")));
  // La instalacion no arrastra el compilador de stage 0.
  assert(!existsSync(join(home,"src")));
  assert.equal(readFileSync(join(home,"compiler/modules/platform.hpp"),"utf8"),readFileSync(join(root,"compiler/modules/platform.hpp"),"utf8"));
  assert(readdirSync(join(home,"compiler"),{recursive:true}).filter(path=>statSync(join(home,"compiler",path)).isFile()).every(path=>/\.(hpp|h)$/.test(path)));
  const version=spawnSync(bin,["--version"],{encoding:"utf8",env:{...env,ESTC_ROOT:home}});assert.equal(version.status,0,version.stderr);assert.match(version.stdout,/^etsc /);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("install migrates an owned nativo command to etsc",async()=>{
 const dir=temporary();try{
  mkdirSync(join(dir,"bin"));mkdirSync(join(dir,"lib/nativo/current"),{recursive:true});const old=join(dir,"bin/nativo");writeFileSync(old,"old driver");
  writeFileSync(join(dir,"lib/nativo/current/installation.json"),JSON.stringify({format:"nativo-install-1",commandHash:createHash("sha256").update(readFileSync(old)).digest("hex")}));
  const seed=testSeed();const p=install(dir,["--seed",seed]);assert.equal(p.status,0,p.stderr);assert(!existsSync(old));assert(existsSync(join(dir,"bin/etsc")));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const owned of [true,false])test(`install migrates estc and preserves unrelated commands (owned=${owned})`,async()=>{
 const dir=temporary();try{
  mkdirSync(join(dir,"bin"));const release=join(dir,"lib/estc/releases/old");mkdirSync(release,{recursive:true});
  symlinkSync("releases/old",join(dir,"lib/estc/current"));
  const legacy=join(dir,"bin/estc");writeFileSync(legacy,"old native driver");
  writeFileSync(join(release,"installation.json"),JSON.stringify({format:"estc-install-1",commandHash:createHash("sha256").update(owned?"old native driver":"another driver").digest("hex")}));
  const seed=testSeed();
  const p=install(dir,["--seed",seed]);assert.equal(p.status,0,p.stderr+p.stdout);
  assert(existsSync(join(dir,"bin/etsc")));assert.equal(existsSync(legacy),!owned);
  if(!owned)assert.equal(readFileSync(legacy,"utf8"),"old native driver");
  const version=spawnSync(join(dir,"bin/etsc"),["--version"],{encoding:"utf8"});assert.equal(version.status,0,version.stderr);assert.match(version.stdout,/^etsc /);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("install builds compiler/ with the seed and publishes that executable",async()=>{
 // La cadena completa: la semilla compila compiler/ y el ejecutable
 // resultante se publica como `etsc`. Asi el compilador instalado refleja
 // el codigo actual de compiler/ y no el snapshot de la semilla.
 const dir=temporary();const prefix=join(dir,"prefix");
 try{
  const p=spawnSync("bash",[join(root,"install.sh"),"--prefix",prefix],{cwd:root,encoding:"utf8",timeout:3600000});
  assert.equal(p.status,0,p.stderr+p.stdout);
  const bin=join(prefix,"bin/etsc");assert(existsSync(bin));
  const home=realpathSync(join(prefix,"lib/estc/current"));
  // La generacion 2 produce el compilador bootstrap ETS, no la semilla.
  const version=spawnSync(bin,["--version"],{encoding:"utf8",env:{...process.env,ESTC_ROOT:home}});
  assert.equal(version.status,0,version.stderr);
  assert.match(version.stdout,/^etsc \d+\.\d+\.\d+ \(v\d+\)\n$/);
  // El runtime y las librerias que lo acompanan siguen en la distribucion.
  assert(existsSync(join(home,"native/frontend")));
  assert(existsSync(join(home,"runtime")));
  // #178: C++ por módulo. examples/modules da la misma salida con --unity y por
  // módulo, y un cambio de cuerpo en math.ts solo recompila su unidad.
  {const env={...process.env,ESTC_ROOT:home};const project=join(dir,"modules178");mkdirSync(project,{recursive:true});
   for(const name of ["main.ts","math.ts"])writeFileSync(join(project,name),readFileSync(join(root,"examples/modules",name),"utf8"));
   const run=(args:string[])=>spawnSync(bin,[...args,"--no-progress"],{cwd:project,encoding:"utf8",env,timeout:600000});
   let p=run(["run","main.ts","--unity","-o","build/unity.cpp","--binary","build/unity"]);assert.equal(p.status,0,p.stderr);const expected=p.stdout;
   p=run(["run","main.ts","-o","build/app.cpp","--binary","build/app","--cache",".cache"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,expected);
   const units=readdirSync(join(project,"build/app.cpp.units")).sort();assert.ok(units.includes("program.hpp")&&units.includes("__main.cpp")&&units.some(u=>u.endsWith("math.cpp")),units.join(","));
   const objects=()=>readdirSync(join(project,".cache/objects")).filter(f=>f.startsWith("program-")).sort();const before=objects();assert.equal(before.length,units.length-1);
   writeFileSync(join(project,"math.ts"),readFileSync(join(project,"math.ts"),"utf8").replace("total = total + index;","total = total + index * 1;"));
   p=run(["run","main.ts","-o","build/app.cpp","--binary","build/app","--cache",".cache"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,expected);
   const after=objects();assert.equal(after.length,before.length);assert.equal(after.filter(o=>!before.includes(o)).length,1,"solo se recompila la unidad de math");
   // Nombres C++ estables: una función nueva en math.ts no cambia el C++ de main.
   const mainUnit=()=>readFileSync(join(project,"build/app.cpp.units/main.cpp"),"utf8");const mainBefore=mainUnit();assert.doesNotMatch(mainBefore,/ir_f\d/);
   writeFileSync(join(project,"math.ts"),"function helperNuevo(): number { return 7; }\n"+readFileSync(join(project,"math.ts"),"utf8"));
   p=run(["run","main.ts","-o","build/app.cpp","--binary","build/app","--cache",".cache"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,expected);assert.equal(mainUnit(),mainBefore);}
  // #143 (comportamiento nuevo del CLI; la semilla aún no lo tiene).
  {const env={...process.env,ESTC_ROOT:home};const project=join(dir,"cli143");
   let p=spawnSync(bin,["init",project,"--verbose"],{cwd:dir,encoding:"utf8",env});assert.equal(p.status,0,p.stderr);assert.match(p.stderr,/Creando proyecto/);
   const header=join(project,"cache-header.hpp"),flags=["--cxx-flag","-include","--cxx-flag",header],build=(args:string[])=>spawnSync(bin,[...args,"--no-progress"],{cwd:project,encoding:"utf8",env,timeout:600000});
   writeFileSync(header,"// valid header\n");p=build(["run",...flags]);assert.equal(p.status,0,p.stderr);
   writeFileSync(header,"#error changed header must invalidate the object\n");p=build(["build",...flags]);assert.notEqual(p.status,0);assert.match(p.stderr,/changed header/);
   writeFileSync(header,"// valid header\n");p=build(["run",...flags]);assert.equal(p.status,0,p.stderr);
   const configPath=join(project,"estatic.config.json");const config=JSON.parse(readFileSync(configPath,"utf8"));config.incremental={enabled:false,cacheDirectory:"disabled cache"};writeFileSync(configPath,JSON.stringify(config));
   p=build(["run"]);assert.equal(p.status,0,p.stderr);assert(!existsSync(join(project,"disabled cache")));}
  // #190: etsc update contra un repositorio local (ESTC_REPO). La etiqueta
  // v0.0.2 lleva un install.sh falso que solo registra sus argumentos.
  {const installedVersion="v"+JSON.parse(readFileSync(join(home,"installation.json"),"utf8")).packageVersion;
   const repo=join(dir,"repo190"),git=(...args:string[])=>{const r=spawnSync("git",["-C",repo,"-c","user.name=t","-c","user.email=t@t",...args],{encoding:"utf8"});assert.equal(r.status,0,r.stderr);};
   mkdirSync(repo,{recursive:true});git("init","-q");const marker=join(dir,"update190.txt");
   writeFileSync(join(repo,"install.sh"),`#!/usr/bin/env bash\necho "$@" > ${JSON.stringify(marker)}\n`);git("add",".");git("commit","-q","-m","fake");
   // Versiones muy por encima de la instalada: el test no caduca al subir de versión.
   for(const tag of ["v0.0.2","v999.99.0","v999.100.0",installedVersion,"nightly"])git("tag",tag);
   const env={...process.env,ESTC_ROOT:home,ESTC_REPO:"file://"+repo},update=(...args:string[])=>spawnSync(bin,["update",...args],{encoding:"utf8",env,timeout:120000});
   let p=update("--list");assert.equal(p.status,0,p.stderr);const listed=p.stdout.trim().split("\n");
   assert.ok(listed.indexOf("v999.99.0")<listed.indexOf("v999.100.0"),p.stdout);assert.ok(!p.stdout.includes("nightly"));assert.ok(listed.includes(installedVersion+"  (instalada)"),p.stdout);
   p=update("--dry-run");assert.equal(p.status,1,p.stderr);assert.ok(p.stdout.includes(installedVersion+" → v"),p.stdout);
   p=update(installedVersion.slice(1));assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/ya está en/);
   p=update("9.9.9");assert.equal(p.status,1);assert.match(p.stderr,/No existe la versión v9\.9\.9/);
   p=update("abc");assert.equal(p.status,2);assert.match(p.stderr,/Versión no válida/);
   p=update("0.0.2","--","--seed-only");assert.equal(p.status,0,p.stderr+p.stdout);
   assert.equal(readFileSync(marker,"utf8").trim(),"--prefix "+realpathSync(prefix)+" --seed-only");}
  // #192: etsc install con repositorios git locales. liba depende de libb
  // (indirecta); la app importa módulos sueltos ("liba/math"), sin punto de entrada.
  {const repos=join(dir,"repos192"),commit=(repo:string,...tags:string[])=>{for(const args of [["init","-q"],["add","."],["commit","-q","-m","x"],...tags.map(t=>["tag",t])]){const r=spawnSync("git",["-C",repo,"-c","user.name=t","-c","user.email=t@t",...args],{encoding:"utf8"});assert.equal(r.status,0,r.stderr);}};
   const libb=join(repos,"libb"),liba=join(repos,"liba");mkdirSync(libb,{recursive:true});mkdirSync(join(liba,"internal"),{recursive:true});
   writeFileSync(join(libb,"estatic.config.json"),JSON.stringify({name:"libb"}));writeFileSync(join(libb,"util.ts"),"export function twice(x: number): number { return x * 2; }\n");commit(libb,"v1.0.0","v1.1.0");
   writeFileSync(join(liba,"estatic.config.json"),JSON.stringify({name:"liba",aliases:{"@interno":"internal",libb:"/home/autor/libb"},dependencies:{libb:{url:"file://"+libb,version:"1.0.0"}}}));
   writeFileSync(join(liba,"internal/consts.ts"),"export const base: number = 10;\n");
   writeFileSync(join(liba,"math.ts"),'import { twice } from "libb/util";\nimport { base } from "@interno/consts";\nexport function calc(x: number): number { return twice(x) + base; }\n');commit(liba,"v0.3.0");
   const project=join(dir,"app192"),env={...process.env,ESTC_ROOT:home,HOME:join(dir,"home192"),XDG_DATA_HOME:""},etsc=(...args:string[])=>spawnSync(bin,args,{cwd:project,encoding:"utf8",env,timeout:600000});
   let p=spawnSync(bin,["init",project],{cwd:dir,encoding:"utf8",env});assert.equal(p.status,0,p.stderr);
   writeFileSync(join(project,"src/main.ts"),'import { calc } from "liba/math";\nprint(calc(4));\n');
   p=etsc("install","file://"+liba);assert.equal(p.status,0,p.stderr+p.stdout);assert.match(p.stdout,/libb v1\.0\.0 \(dependencia de liba\)/);
   const config=()=>JSON.parse(readFileSync(join(project,"estatic.config.json"),"utf8"));let c=config();
   assert.equal(c.dependencies.liba.version,"v0.3.0");assert.equal(c.dependencies.libb.indirect,true);assert.ok(!c.aliases.liba.includes("//"),c.aliases.liba);assert.ok(c.aliases.libb.startsWith(project),c.aliases.libb);
   const ts=readFileSync(join(project,"tsconfig.json"),"utf8");assert.ok(ts.includes('"liba/*": ["'+c.aliases.liba+'/*"]'),ts);
   p=etsc("run","--no-progress");assert.equal(p.status,0,p.stderr);assert.equal(p.stdout.trim(),"18");
   // Otra máquina: sin las descargas, build falla con ayuda y `etsc install` las recupera.
   rmSync(join(project,".build/deps"),{recursive:true,force:true});p=etsc("run","--no-progress");assert.notEqual(p.status,0);assert.match(p.stderr,/Falta la dependencia/);
   p=etsc("install");assert.equal(p.status,0,p.stderr);p=etsc("run","--no-progress");assert.equal(p.status,0,p.stderr);assert.equal(p.stdout.trim(),"18");
   // Directa manda sobre indirecta; -g instala en la carpeta global.
   p=etsc("install","file://"+libb,"1.1.0","-g");assert.equal(p.status,0,p.stderr);c=config();assert.equal(c.dependencies.libb.version,"v1.1.0");assert.equal(c.dependencies.libb.indirect,undefined);assert.equal(c.dependencies.libb.global,true);
   assert.ok(existsSync(join(dir,"home192/.local/share/estatic/deps/libb@v1.1.0/util.ts")));
   p=etsc("install","file://"+liba,"0.3.0");assert.equal(p.status,0,p.stderr);assert.match(p.stderr,/se usa v1\.1\.0 \(instalada directamente\)/);
   p=etsc("install","file://"+liba,"9.9.9");assert.equal(p.status,1);assert.match(p.stderr,/No existe la versión 9\.9\.9/);}
  // etsc init lib: dos librerías con el mismo alias interno (@interno) no chocan.
  {const libs=join(dir,"libs-init"),env={...process.env,ESTC_ROOT:home,HOME:join(dir,"home-init"),XDG_DATA_HOME:""};mkdirSync(libs,{recursive:true});
   const etsc=(cwd:string,...args:string[])=>spawnSync(bin,args,{cwd,encoding:"utf8",env,timeout:600000});
   const git=(repo:string,...args:string[])=>{const r=spawnSync("git",["-C",repo,"-c","user.name=t","-c","user.email=t@t",...args],{encoding:"utf8"});assert.equal(r.status,0,r.stderr);};
   for(const name of ["saludos","otra"]){let p=etsc(libs,"init","lib",name);assert.equal(p.status,0,p.stderr);
    for(const file of ["estatic.config.json","tsconfig.json","saludo.ts","internal/formato.ts","README.md",".gitignore","types/estatic.d.ts"])assert.ok(existsSync(join(libs,name,file)),file);
    assert.equal(JSON.parse(readFileSync(join(libs,name,"estatic.config.json"),"utf8")).name,name);}
   writeFileSync(join(libs,"otra/internal/formato.ts"),readFileSync(join(libs,"otra/internal/formato.ts"),"utf8").replace("toUpperCase","toLowerCase"));
   let p=etsc(join(libs,"saludos"),"saludo.ts","--check","--config","estatic.config.json","--no-progress");assert.equal(p.status,0,p.stderr);
   for(const name of ["saludos","otra"]){git(join(libs,name),"init","-q");git(join(libs,name),"add",".");git(join(libs,name),"commit","-q","-m","x");git(join(libs,name),"tag","v0.1.0");}
   p=etsc(libs,"init","lib","saludos");assert.notEqual(p.status,0);assert.match(p.stderr,/No se sobrescribe/);
   const app=join(libs,"app");p=etsc(libs,"init","app");assert.equal(p.status,0,p.stderr);
   writeFileSync(join(app,"src/main.ts"),'import { saludar } from "saludos/saludo";\nimport { saludar as otro } from "otra/saludo";\nprint(saludar("mundo"));\nprint(otro("MUNDO"));\n');
   for(const name of ["saludos","otra"]){p=etsc(app,"install","file://"+join(libs,name));assert.equal(p.status,0,p.stderr+p.stdout);}
   p=etsc(app,"run","--no-progress");assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"Hola, MUNDO\nHola, mundo\n");
   // Paso 3b: cada librería tiene su cabecera y sus .o en <librería>/.estatic-cache/objects;
   // cambiar los tipos del proyecto no los recompila.
   const libObjects=join(app,".build/deps/saludos@v0.1.0/.estatic-cache/objects"),stamp=()=>readdirSync(libObjects).sort().map(f=>f+":"+statSync(join(libObjects,f)).mtimeMs).join(",");
   const first=stamp();assert.ok(first.includes(".o"),first);
   writeFileSync(join(app,"src/main.ts"),"class Punto { x: number = 1; }\n"+readFileSync(join(app,"src/main.ts"),"utf8")+"print(new Punto().x);\n");
   p=etsc(app,"run","--no-progress");assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"Hola, MUNDO\nHola, mundo\n1\n");assert.equal(stamp(),first);}
  // Prelude (#165): Error y sus variantes del runtime sin import; prelude del proyecto en la config.
  {const project=join(dir,"prelude-app"),env={...process.env,ESTC_ROOT:home};mkdirSync(join(project,"src/std"),{recursive:true});
   const etsc=(...args:string[])=>spawnSync(bin,args,{cwd:project,encoding:"utf8",env,timeout:600000});
   writeFileSync(join(project,"errores.ts"),['const e: Error = new Error("algo falló");','print(e.toString());','const t: Error = new TypeError("tipo malo", { cause: e });','print(t.toString());','const c = t.cause;','if (c !== undefined) print("causa: " + c.message);','function dividir(a: number, b: number): Result<number, Error> {','  if (b == 0) return resultErr<number, Error>(new RangeError("división por cero"));','  return resultOk<number, Error>(a / b);','}','const r = dividir(1, 0);','if (!r.isOk()) print(r.error().toString());','print(new Error().toString());',''].join("\n"));
   let p=etsc("run","errores.ts","--no-progress");assert.equal(p.status,0,p.stderr);
   assert.equal(p.stdout,"Error: algo falló\nTypeError: tipo malo\ncausa: algo falló\nRangeError: división por cero\nError\n");
   writeFileSync(join(project,"src/std/saludo.ts"),'export function saludar(nombre: string): string { return "hola " + nombre; }\n');
   writeFileSync(join(project,"src/main.ts"),'import "./otro";\nprint(saludar("prelude"));\n');
   writeFileSync(join(project,"src/otro.ts"),'function saludar(nombre: string): string { return "local " + nombre; }\nprint(saludar("tapado"));\n');
   writeFileSync(join(project,"estatic.config.json"),JSON.stringify({entry:"src/main.ts",prelude:["src/std/saludo.ts"],output:{cpp:"build/app.cpp",binary:"build/app"},compiler:{enabled:true}}));
   p=etsc("run","--no-progress");assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"local tapado\nhola prelude\n");
   writeFileSync(join(project,"src/std/otra.ts"),'export function saludar(): string { return "x"; }\n');
   writeFileSync(join(project,"estatic.config.json"),JSON.stringify({entry:"src/main.ts",prelude:["src/std/saludo.ts","src/std/otra.ts"]}));
   p=etsc("--check","--no-progress");assert.notEqual(p.status,0);assert.match(p.stderr,/Dos módulos del prelude exportan 'saludar'/);}
   const source=join(dir,"node-streams.ets"),app=join(dir,"node-streams-app");
   writeFileSync(source,`import process from "estatic:process";
import child_process from "estatic:child_process";
process.stdin.on("data",(chunk:string):void=>{process.stdout.write("parent:"+chunk);});
const childArgs:string[]=["-c","printf child-out; printf child-err >&2; cat"];
const child=child_process.spawn("/bin/sh",childArgs);
child.stdout.on("data",(chunk:string):void=>{process.stdout.write("child:"+chunk);});
child.stderr.on("data",(chunk:string):void=>{process.stderr.write("child-error:"+chunk);});
child.stdin.write("child-input");child.stdin.end();
child.on("close",(code:number):void=>print("child-close:",code));
`);
   const run=spawnSync(bin,["run",source,"--binary",app,"--no-progress"],{cwd:dir,encoding:"utf8",input:"stdin-input",timeout:180000,env:{...process.env,ESTC_ROOT:home}});
   assert.equal(run.status,0,run.stderr+run.stdout);
   assert.match(run.stdout,/parent:stdin-input/);assert.match(run.stdout,/child:child-out/);assert.match(run.stdout,/child:child-input/);assert.match(run.stdout,/child-close:\s*0/);
   assert.match(run.stderr,/child-error:child-err/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
