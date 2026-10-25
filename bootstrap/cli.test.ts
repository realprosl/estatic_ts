import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CliProgress, phase, presentation } from "./cli-progress.ts";
import { buildIrFrontend } from "./ir/cpp.ts";
import { root } from "./root.ts";

function capture(tty: boolean, env: NodeJS.ProcessEnv={}, verbose=true, enabled=true) {
  let output="";
  const progress=new CliProgress(verbose,enabled,{isTTY:tty,write:(text:string)=>{output+=text;return true;}},env);
  return {progress,output:()=>output};
}
test("bootstrap progress: redirected output is plain and the default is quiet",()=>{
  for(const verbose of [false,true]){
    const c=capture(false,{},verbose);
    c.progress.handle({type:"start",label:"Compilando"});
    c.progress.handle({type:"finish",label:"Compilando",elapsed:12,failed:false});
    assert.doesNotMatch(c.output(),/[\r\x1b]/);
    if(verbose)assert.match(c.output(),/Compilando \(12 ms\)/);else assert.equal(c.output(),"");
  }
});
test("bootstrap progress: terminal restrictions and --no-progress disable animation",()=>{
  for(const env of [{NO_COLOR:""},{NO_COLOR:"1",FORCE_COLOR:"1"},{TERM:"dumb"},{CI:"1"}]){
    const c=capture(true,env);c.progress.handle({type:"start",label:"Build"});c.progress.clear();assert.doesNotMatch(c.output(),/[\r\x1b]/);
  }
  const c=capture(true,{},true,false);c.progress.handle({type:"start",label:"Build"});c.progress.clear();assert.doesNotMatch(c.output(),/[\r\x1b]/);
});
test("bootstrap progress: animation advances and is cleared after a failed phase",async()=>{
  const c=capture(true);
  await assert.rejects(phase("Build",async()=>{await new Promise(resolve=>setTimeout(resolve,190));throw new Error("bad build");},event=>c.progress.handle(event)),/bad build/);
  assert.match(c.output(),/⠋/);assert.match(c.output(),/⠙/);assert.match(c.output(),/✗/);
  const done=c.output();await new Promise(resolve=>setTimeout(resolve,100));assert.equal(c.output(),done);
});
test("bootstrap presentation flags preserve compiler values and program arguments",()=>{
  assert.deepEqual(presentation(["--verbose","--no-progress","run","--cxx-flag","--verbose","--","--verbose","--no-progress"]),{
    args:["run","--cxx-flag","--verbose","--","--verbose","--no-progress"],verbose:true,progress:false
  });
  assert.deepEqual(presentation(["--alias","--verbose","lib"]).args,["--alias","--verbose","lib"]);
});

const dir=mkdtempSync(join(tmpdir(),"bootstrap-cli-")),cli=join(root,"bootstrap/cli.ts");let frontend:string;
before(async()=>{frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();});
after(()=>rmSync(dir,{recursive:true,force:true}));
const command=(args:string[])=>spawnSync(process.execPath,["--experimental-strip-types",cli,...args],{cwd:dir,encoding:"utf8",timeout:180000});
function source(name:string,text:string){const path=join(dir,name+".ets");writeFileSync(path,text);return path;}

test("bootstrap CLI verbose reports real phases and preserves stdout and exit status",()=>{
  const input=source("arguments",'print(argument(1));exitProcess(7);');
  const p=command(["run",input,"--frontend",frontend,"--verbose","--no-progress","--","--verbose"]);
  assert.equal(p.status,7,p.stderr);assert.equal(p.stdout,"--verbose\n");
  for(const label of ["Analizando fuentes y verificando IR","Validando frontera","Generando C++","Preparando runtime, compilando y enlazando C++","Compilación completada","Ejecutable:"])assert(p.stderr.includes(label),p.stderr);
  assert.match(p.stderr,/\(\d+ ms\)/);assert.doesNotMatch(p.stderr,/[\r\x1b]/);
});
test("bootstrap CLI check stays quiet by default and does not generate C++",()=>{
  const input=source("check",'print("checked");');
  let p=command([input,"--frontend",frontend,"--check"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stderr,"");assert.match(p.stdout,/Comprobado:/);
  p=command([input,"--frontend",frontend,"--check","--verbose"]);assert.equal(p.status,0,p.stderr);assert.doesNotMatch(p.stderr,/Generando C\+\+/);assert(!existsSync(join(dir,"build/check.cpp")));
});
test("bootstrap CLI verbose reports errors without hanging or claiming success",()=>{
  const input=source("invalid",'const x:number="bad";');
  const p=command([input,"--frontend",frontend,"--verbose","--check"]);
  assert.equal(p.status,1,p.stderr);assert.match(p.stderr,/✗ Analizando/);assert.doesNotMatch(p.stderr,/Compilación completada|[\r\x1b]/);
  assert.equal(command(["--verbose","--unknown"]).status,2);
});
test("bootstrap CLI verbose init keeps stdout valid JSON",()=>{
  const p=command(["--verbose","init",join(dir,"project")]);assert.equal(p.status,0,p.stderr);
  assert.equal(JSON.parse(p.stdout).directory,join(dir,"project"));assert.match(p.stderr,/Creando proyecto/);
});
test("bootstrap CLI spinner animates during blocking C++ compilation in a real PTY",()=>{
  const input=source("animated",'print("animated");'),compiler=join(dir,"slow-cxx");
  writeFileSync(compiler,'#!/bin/sh\nsleep 0.3\nexec g++ "$@"\n');chmodSync(compiler,0o755);
  const script=`import os,pty,subprocess,select,json,sys
master,slave=pty.openpty()
environment=os.environ.copy()
for key in ['NO_COLOR','CI']: environment.pop(key,None)
environment['TERM']='xterm'
p=subprocess.Popen(sys.argv[1:],stdout=subprocess.PIPE,stderr=slave,env=environment)
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
  const p=spawnSync("python3",["-c",script,process.execPath,"--experimental-strip-types",cli,"run",input,"--frontend",frontend,"--cxx",compiler],{cwd:dir,encoding:"utf8",timeout:180000});
  assert.equal(p.status,0,p.stderr);const result=JSON.parse(p.stdout);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,"animated\n");
  const compilation=result.stderr.slice(result.stderr.indexOf("Preparando runtime, compilando"));
  assert.match(compilation,/⠙/);assert.match(compilation,/⠹/);assert.match(compilation,/Compilación completada/);
});
