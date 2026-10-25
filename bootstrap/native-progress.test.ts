import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildNativeCompiler } from "./build/native-compiler.ts";
import { buildIrFrontend } from "./ir/cpp.ts";
import { root } from "./root.ts";

const dir=mkdtempSync(join(tmpdir(),"etsc-progress-"));let binary:string,frontend:string;
before(async()=>{binary=buildNativeCompiler();frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();});
after(()=>rmSync(dir,{recursive:true,force:true}));
const run=(args:string[],extra:Record<string,string>={})=>spawnSync(binary,args,{cwd:dir,encoding:"utf8",timeout:120000,env:{...process.env,ESTC_ROOT:root,...extra}});
function source(name:string,text:string){const path=join(dir,name+".ets");writeFileSync(path,text);return path;}
function terminal(args:string[],extra:Record<string,string>={}){
 const script=`import os,pty,subprocess,json,sys
master,slave=pty.openpty()
environment=os.environ.copy()
for key in ['NO_COLOR','CI']: environment.pop(key,None)
environment['TERM']='xterm'
environment.update(json.loads(sys.argv[1]))
p=subprocess.Popen(sys.argv[2:],stdout=subprocess.PIPE,stderr=slave,env=environment)
os.close(slave)
data=b''
while True:
 try:
  block=os.read(master,65536)
  if not block: break
  data+=block
 except OSError: break
os.close(master)
stdout=p.communicate(timeout=30)[0]
print(json.dumps({'status':p.returncode,'stdout':stdout.decode(),'stderr':data.decode()}))`;
 const p=spawnSync("python3",["-c",script,JSON.stringify(extra),binary,...args],{cwd:dir,encoding:"utf8",timeout:120000,env:{...process.env,ESTC_ROOT:root}});
 assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout) as {status:number;stdout:string;stderr:string};
}
test("native etsc verbose preserves program arguments and exit codes without Node",()=>{
 const input=source("arguments",'print(argument(1));exitProcess(7);');
 const p=run(["run",input,"--frontend",frontend,"--verbose","--no-progress","--","--verbose"],{NODE:"/missing/node"});
 assert.equal(p.status,7,p.stderr);assert.equal(p.stdout,"--verbose\n");
 for(const label of ["Analizando fuentes y verificando IR","Generando C++","Preparando runtime","Compilando y enlazando C++","Comando:","Compilación completada"])assert(p.stderr.includes(label),p.stderr);
 assert.match(p.stderr,/\(\d+ ms\)/);assert.doesNotMatch(p.stderr,/[\r\x1b]/);
});
test("native etsc is quiet in pipes and check keeps its result on stdout",()=>{
 const input=source("checked",'print("checked");');
 const p=run([input,"--frontend",frontend,"--check"]);assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/Comprobado:/);assert.equal(p.stderr,"");
});
test("native etsc verbose identifies reused project object caches",()=>{
 const input=source("cached",'print("cached");'),config=join(dir,"estatic.config.json");
 writeFileSync(config,JSON.stringify({entry:input,output:{cpp:"build/cache.cpp",binary:"build/cache"},incremental:{enabled:true},compiler:{flags:["-O0"]}}));
 const args=["run","--config",config,"--frontend",frontend,"--verbose"];
 let p=run(args);assert.equal(p.status,0,p.stderr);assert.match(p.stderr,/caché no válida; recompilando/);
 p=run(args);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"cached\n");assert.match(p.stderr,/Objeto C\+\+: caché reutilizada/);assert.doesNotMatch(p.stderr,/> Compilando C\+\+/);
});
test("native etsc verbose reports frontend and compiler failures without success",()=>{
 const input=source("invalid",'const n:number="wrong";');
 let p=run([input,"--frontend",frontend,"--check","--verbose"]);assert.equal(p.status,1,p.stderr);assert.match(p.stderr,/✗ Analizando/);assert.doesNotMatch(p.stderr,/Compilación completada/);
 p=run(["build",source("bad-compiler",'print("hello");'),"--frontend",frontend,"--verbose","--cxx-flag","-this-flag-does-not-exist"]);
 assert.equal(p.status,1,p.stderr);assert.match(p.stderr,/✗ Compilando y enlazando/);assert.doesNotMatch(p.stderr,/Compilación completada/);
 assert.equal(run(["run","--unknown","--verbose"]).status,2);
});
test("native etsc animates during real compiler work in a PTY",()=>{
 const input=source("animated",'print("animated");'),compiler=join(dir,"slow-cxx");
 writeFileSync(compiler,'#!/bin/sh\nsleep 0.3\nexec g++ "$@"\n');chmodSync(compiler,0o755);
 const p=terminal(["run",input,"--frontend",frontend,"--cxx",compiler,"--verbose"]);
 assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"animated\n");
 const compilation=p.stderr.slice(p.stderr.indexOf("Compilando y enlazando C++"));assert.match(compilation,/⠙/);assert.match(compilation,/⠹/);assert.match(compilation,/Compilación completada/);
});
test("native etsc disables terminal animation with flags and environment",()=>{
 const input=source("plain",'print("plain");');
 for(const [flags,env] of [ [["--no-progress"],{}],[[],{NO_COLOR:""}],[[],{TERM:"dumb"}],[[],{CI:"1"}] ] as [string[],Record<string,string>][]){
  const p=terminal([input,"--frontend",frontend,"--check","--verbose",...flags],env);
  assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/Comprobado:/);assert.doesNotMatch(p.stderr.replace(/\r\n/g,"\n"),/[\r\x1b]/);
 }
});
test("native etsc clears animated error output and retains diagnostics",()=>{
 const compiler=join(dir,"failing-cxx");writeFileSync(compiler,'#!/bin/sh\nsleep 0.2\necho native-compiler-error >&2\nexit 9\n');chmodSync(compiler,0o755);
 const p=terminal(["build",source("compiler-error",'print("hello");'),"--frontend",frontend,"--verbose","--cxx",compiler]);
 assert.equal(p.status,1,p.stderr);assert.match(p.stderr,/native-compiler-error/);assert.match(p.stderr,/✗/);assert.doesNotMatch(p.stderr,/Compilación completada/);
});
