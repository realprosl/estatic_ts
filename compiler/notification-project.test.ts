import { test } from "node:test";
import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { root } from "./root.ts";
import { buildNativeCompiler } from "./build/native-compiler.ts";
import { buildIrFrontend } from "./ir/cpp.ts";

test("native notification project compiles seven modules and invalidates caches safely",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"etsc-notification-")),sample=join(root,"examples/notification-app");
 try{
  cpSync(sample,directory,{recursive:true,filter:path=>path===sample||![".build","types"].includes(basename(path))});
  const binary=buildNativeCompiler(),frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();
  const run=(extra:string[]=[])=>spawnSync(binary,["run","--frontend",frontend,"--verbose",...extra],{cwd:directory,encoding:"utf8",timeout:120000,env:{...process.env,ESTC_ROOT:root}});
  const expected=readFileSync(join(directory,"expected.txt"),"utf8"),ir=join(directory,".build/project.ir.json");
  let p=run(["--emit-ir",ir]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,expected);
  assert(JSON.parse(readFileSync(ir,"utf8")).modules.length>=7,"The native frontend must load the modular project");
  const files=(folder:string,suffix:string)=>readdirSync(join(directory,".build",folder),{recursive:true}).map(String).filter(path=>path.endsWith(suffix)).map(path=>join(directory,".build",folder,path));
  const objects=files("cache/objects",".o"),archives=files("runtime",".a");assert.equal(objects.length,1);assert.equal(archives.length,1);
  const objectTime=statSync(objects[0]).mtimeMs,runtimeTime=statSync(archives[0]).mtimeMs;
  p=run();assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,expected);assert.match(p.stderr,/Objeto C\+\+: caché reutilizada/);assert.equal(statSync(objects[0]).mtimeMs,objectTime);assert.equal(statSync(archives[0]).mtimeMs,runtimeTime);
  const helper=join(directory,"src/shared/format.ts"),original=readFileSync(helper,"utf8");
  writeFileSync(helper,original.replace(' + ": " + ',' + " -> " + '));
  p=run();assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,expected.replaceAll("Ana:","Ana ->").replaceAll("Luis:","Luis ->"));assert.match(p.stderr,/caché no válida; recompilando/);assert.equal(files("cache/objects",".o").length,2);
  writeFileSync(helper,original.replace('return message.recipient + ": " + message.body;',"return 42;"));
  p=run();assert.equal(p.status,1,p.stderr);assert.equal(p.stdout,"");assert.match(p.stderr,/✗ Analizando fuentes/);assert.doesNotMatch(p.stderr,/Compilación completada/);
  writeFileSync(helper,original);p=run();assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,expected);assert.match(p.stderr,/Objeto C\+\+: caché reutilizada/);assert.equal(statSync(objects[0]).mtimeMs,objectTime);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
