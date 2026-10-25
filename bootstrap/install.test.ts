import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, chmodSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { root } from "./root.ts";
import { buildIrFrontend } from "./ir/cpp.ts";

const temporary=()=>{mkdirSync(join(root,"build/test-tmp"),{recursive:true});return mkdtempSync(join(root,"build/test-tmp/install-"));};
const node=(args:string[],cwd=root,extra:Record<string,string>={})=>spawnSync(process.execPath,args,{cwd,encoding:"utf8",timeout:180000,env:{...process.env,...extra}});

test("runtime cache invalidates headers and ABI flags and recovers corrupted archives",async()=>{
 const dir=temporary();try{
  mkdirSync(join(dir,"bootstrap/build"),{recursive:true});mkdirSync(join(dir,"runtime"));writeFileSync(join(dir,"package.json"),'{"type":"module"}');
  cpSync(join(root,"bootstrap/root.ts"),join(dir,"bootstrap/root.ts"));cpSync(join(root,"bootstrap/build/runtime-cache.ts"),join(dir,"bootstrap/build/runtime-cache.ts"));
  writeFileSync(join(dir,"runtime/runtime_ets_libuv.cpp"),'#include "feature.hpp"\n#ifndef MODE\n#define MODE 0\n#endif\nint value(){return VALUE+MODE;}\n');writeFileSync(join(dir,"runtime/runtime_ets_net_libuv.cpp"),'int unused(){return 0;}');writeFileSync(join(dir,"runtime/feature.hpp"),'#define VALUE 3\n');
  const {runtimeArchive}=await import(pathToFileURL(join(dir,"bootstrap/build/runtime-cache.ts")).href);
  const archive=runtimeArchive("libuv"),first=statSync(archive).mtimeMs;assert.equal(runtimeArchive("libuv"),archive);assert.equal(statSync(archive).mtimeMs,first);
  const program=join(dir,"app.cpp"),binary=join(dir,"app");writeFileSync(program,'int value();int main(){return value();}');
  const result=(lib:string)=>{const p=spawnSync(process.env.CXX??"g++",[program,lib,"-o",binary],{encoding:"utf8"});assert.equal(p.status,0,p.stderr);return spawnSync(binary).status;};
  assert.equal(result(archive),3);writeFileSync(join(dir,"runtime/feature.hpp"),'#define VALUE 9\n');assert.equal(result(runtimeArchive("libuv")),9);
  const other=runtimeArchive("libuv",undefined,["-DMODE=2"]);assert.notEqual(other,archive);assert.equal(result(other),11);
  writeFileSync(archive,"corrupt");assert.equal(result(runtimeArchive("libuv")),9);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("install protects an unrelated command before modifying its prefix",()=>{
 const dir=temporary();try{mkdirSync(join(dir,"bin"));writeFileSync(join(dir,"bin/estc"),"another program");const p=node(["--experimental-strip-types",join(root,"bootstrap/install.ts"),"--prefix",dir]);assert.equal(p.status,1);assert.match(p.stderr,/comando ajeno/);assert.equal(readFileSync(join(dir,"bin/estc"),"utf8"),"another program");}finally{rmSync(dir,{recursive:true,force:true});}
});

test("installed estc initializes, builds and runs independently of the clone with precompiled runtime",async()=>{
 const dir=temporary(),prefix=join(dir,"prefix"),project=join(dir,"project with spaces"),cache=join(dir,"user-cache");
 try{
  const frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();
  const install=node(["--experimental-strip-types",join(root,"bootstrap/install.ts"),"--prefix",prefix,"--frontend",frontend]);assert.equal(install.status,0,install.stderr+install.stdout);
  const bin=join(prefix,"bin/estc"),home=realpathSync(join(prefix,"lib/estc/current"));if(process.platform==="linux")assert.equal(readFileSync(bin).subarray(0,4).toString(),"\x7fELF");
  // Installed use must not import the stage-0 compiler or build its frontend.
  assert(!existsSync(join(home,"src")));assert(!existsSync(join(home,"bootstrap")));
  const poison=join(dir,"without-node"),sentinel=join(dir,"node-was-used");mkdirSync(poison);
  for(const executable of ["node","nodejs","npm"]){const path=join(poison,executable);writeFileSync(path,`#!/bin/sh\necho forbidden >> '${sentinel}'\nexit 99\n`);chmodSync(path,0o755);}
  const nativeEnv={...process.env,PATH:poison+":"+process.env.PATH,NATIVO_NODE:"/missing/node",NODE:"/missing/node",XDG_CACHE_HOME:cache};
  const run=(args:string[],cwd=dir)=>spawnSync(bin,args,{cwd,encoding:"utf8",timeout:120000,env:nativeEnv});
  let p=run(["init",project]);assert.equal(p.status,0,p.stderr);assert.match(readFileSync(join(project,"README.md"),"utf8"),/estc build/);
  const libraries=readdirSync(join(home,"build/runtime-cache"),{recursive:true}).map(String).filter(p=>p.endsWith(".a")).map(p=>join(home,"build/runtime-cache",p));assert.equal(libraries.length,2);
  const before=libraries.map(p=>statSync(p).mtimeMs);
  writeFileSync(join(project,"src/main.ts"),'async function f():Promise<void>{await sleep(1);print("native installed");}await f();');
  p=run(["build"],project);assert.equal(p.status,0,p.stderr);assert(existsSync(join(project,"build/app")));
  p=run(["run"],project);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"native installed\n");
  assert.deepEqual(libraries.map(p=>statSync(p).mtimeMs),before);assert(!existsSync(cache),"Installed builds should reuse the prepared archives");
  const upgrade=node(["--experimental-strip-types",join(root,"bootstrap/install.ts"),"--prefix",prefix,"--frontend",frontend]);assert.equal(upgrade.status,0,upgrade.stderr);assert.notEqual(realpathSync(join(prefix,"lib/estc/current")),home);
  const moved=join(dir,"relocated prefix");renameSync(prefix,moved);const movedBin=join(moved,"bin/estc");
  p=spawnSync(movedBin,["run"],{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"native installed\n");assert(!existsSync(cache));
  p=spawnSync(movedBin,["run","--cxx-flag","-DUSER_PROFILE=1"],{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"native installed\n");assert(existsSync(join(cache,"estc/runtime")),"A new ABI profile must use the user cache");
  const irFile=join(project,"checked.ir.json");
  p=spawnSync(movedBin,["--check","--emit-ir",irFile],{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});assert.equal(p.status,0,p.stderr);assert(existsSync(irFile));
  p=spawnSync(movedBin,["--from-ir",irFile,"-o",join(project,"from-ir.cpp"),"--binary",join(project,"from-ir"),"--run"],{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"native installed\n");
  const configPath=join(project,"estatic.config.json"),config=JSON.parse(readFileSync(configPath,"utf8"));renameSync(configPath,configPath+".saved");
  const tsConfig=join(project,"estatic.config.ts");writeFileSync(tsConfig,"export default "+JSON.stringify(config)+";");
  p=spawnSync(movedBin,["--check"],{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});assert.equal(p.status,0,p.stderr);
  writeFileSync(tsConfig,'export default (()=>({entry:"src/main.ts"}))();');p=spawnSync(movedBin,["--check"],{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});assert.equal(p.status,2);rmSync(tsConfig);renameSync(configPath+".saved",configPath);
  mkdirSync(join(project,"deps"));writeFileSync(join(project,"deps/dep.ets"),'export const answer=42;');config.aliases={app:"deps"};writeFileSync(configPath,JSON.stringify(config));writeFileSync(join(project,"src/main.ts"),'import {answer} from "app/dep";print(answer);');
  p=spawnSync(movedBin,["run"],{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"42\n");
  writeFileSync(join(project,"src/main.ts"),'print(argument(1));exitProcess(7);');p=spawnSync(movedBin,["run","--","forwarded"],{cwd:project,encoding:"utf8",timeout:120000,env:nativeEnv});assert.equal(p.status,7,p.stderr);assert.equal(p.stdout,"forwarded\n");assert(!existsSync(sentinel),"The installed compiler must never execute Node");
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test("install migrates an owned nativo command to estc",async()=>{
 const dir=temporary();try{
  mkdirSync(join(dir,"bin"));mkdirSync(join(dir,"lib/nativo/current"),{recursive:true});const old=join(dir,"bin/nativo");writeFileSync(old,"old driver");
  writeFileSync(join(dir,"lib/nativo/current/installation.json"),JSON.stringify({format:"nativo-install-1",commandHash:createHash("sha256").update(readFileSync(old)).digest("hex")}));
  const frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();const p=node(["--experimental-strip-types",join(root,"bootstrap/install.ts"),"--prefix",dir,"--frontend",frontend]);assert.equal(p.status,0,p.stderr);assert(!existsSync(old));assert(existsSync(join(dir,"bin/estc")));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
