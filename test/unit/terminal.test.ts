import {test} from "node:test";
import assert from "node:assert/strict";
import {compile} from "../../src/compiler.ts";
import {compileFile} from "../../src/modules/module-loader.ts";
import {TERMINAL_METHODS} from "../../src/semantic/terminal-methods.ts";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {tmpdir} from "node:os";
import {execFileSync,spawnSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const include='#include "runtime/ets_terminal.hpp"';
async function temporary(run:(dir:string)=>void|Promise<void>){const dir=mkdtempSync(join(tmpdir(),"ets-terminal-"));try{await run(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function binary(dir:string,source:string,ets=true):string {
 const file=join(dir,"main.cpp"),app=join(dir,"app");writeFileSync(file,ets?compile(source).cpp:source);
 execFileSync("g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,file,"-o",app],{encoding:"utf8"});return app;
}
const ptyRunner=String.raw`
import os,sys,subprocess,fcntl,termios,struct,errno,json
master,slave=os.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,80,0,0))
env=dict(os.environ,TERM=sys.argv[2]);env.pop('NO_COLOR',None)
if len(sys.argv)>3:env['NO_COLOR']='1'
child=subprocess.Popen([sys.argv[1]],stdin=subprocess.DEVNULL,stdout=slave,stderr=subprocess.PIPE,env=env)
os.close(slave);chunks=[]
while True:
 try:
  data=os.read(master,65536)
  if not data:break
  chunks.append(data)
 except OSError as e:
  if e.errno==errno.EIO:break
  raise
os.close(master)
_,error=child.communicate(timeout=10)
if child.returncode:raise RuntimeError(error.decode())
print(json.dumps(b''.join(chunks).decode()))
`;
function tty(app:string,console="xterm",noColor=false):string {
 return JSON.parse(execFileSync("python3",["-c",ptyRunner,app,console,...(noColor?["1"]:[])],{encoding:"utf8",timeout:15000}));
}
for(const [label,source] of [
 ["programa normal",'print(7);'],["strings y comentarios",'// console.clear();\nprint("console");'],
 ["variable local homónima",'const console:number=7;print(console);'],
 ["objeto local homónimo",'class Local {writeLine(text:string):void {print(text);}}const console:Local=new Local();console.writeLine("ok");'],
 ["comptime eliminado",'const value:number=comptime(():number=>{if(false){console.clear();}return 7;});print(value);'],
 ["función comptime no emitida",'@comptime function unused():boolean{return console.clear();}print(7);'],
] as const){test(`terminal lazy: no incluye header para ${label}`,()=>{assert.ok(!compile(source).cpp.includes(include));});}
test("terminal lazy: uso real y alias incluyen una sola cabecera",()=>{
 const cpp=compile('const handle=console;handle.writeLine("ok");console.flush();').cpp;assert.equal(cpp.split(include).length-1,1);assert.ok(cpp.includes("::console"));assert.doesNotMatch(cpp,/ets_runtime_full|ets_libuv|ets_http|ets_net/);
});
test("terminal lazy: no contamina compilaciones posteriores",()=>{assert.ok(compile('console.flush();').cpp.includes(include));assert.ok(!compile('print(7);').cpp.includes(include));});
test("terminal lazy: expansión ETS activa la inclusión",()=>{const code='console.writeLine("ok");';assert.ok(compile(`@etsgen function emit():string{return ${JSON.stringify(code)};}emit();`).cpp.includes(include));});
for(const [name,spec] of Object.entries(TERMINAL_METHODS)){
 test(`terminal checker: firma console.${name}`,()=>{const args=spec.params.map(type=>type==="string"?'"red"':"1");assert.doesNotThrow(()=>compile(`const result:${spec.returnType}=console.${name}(${args.join(",")});`));});
}
for(const source of ['console.writeLine(7);','console.moveTo("1",2);','console.color();','console.clear(1);','console.unknown();','console.constructor();','console.toString();','console.flush<number>();','const method=console.write;','console.moveTo(row:1,column:2);','console?.clear();']){
 test(`terminal checker: rechaza ${source}`,()=>{assert.throws(()=>compile(source));});
}
test("terminal native: pipe conserva UTF-8 y no emite controles",async()=>temporary(dir=>{
 const app=binary(dir,'console.color("red");console.style("bold");console.clear();console.hideCursor();console.moveTo(1,2);console.write("España 🙂");console.writeLine(" ok");print(console.isTTY());print(console.supportsAnsi());print(console.columns());print(console.rows());print(console.reset());console.flush();');
 assert.equal(execFileSync(app,{encoding:"utf8",env:{...process.env,TERM:"xterm"}}),"España 🙂 ok\n0\n0\n0\n0\n0\n");
}));
test("terminal native: alias y sombra local conservan comportamiento",async()=>temporary(dir=>{
 const app=binary(dir,'const handle=console;function local():void{const console:number=7;print(console);}local();handle.writeLine("ok");handle.flush();');assert.equal(execFileSync(app,{encoding:"utf8"}),"7\nok\n");
}));
test("terminal native PTY: colores, cursor, tamaño y restauración normal",async()=>temporary(dir=>{
 const app=binary(dir,'print(console.isTTY());print(console.supportsAnsi());print(console.columns());print(console.rows());console.color("red");console.background("blue");console.style("bold");console.moveTo(2,3);console.moveBy(-1,2);console.clearLine();console.clear();console.hideCursor();console.write("ok");console.flush();');
 assert.equal(tty(app),"1\r\n1\r\n80\r\n24\r\n\x1b[31m\x1b[44m\x1b[1m\x1b[2;3H\x1b[1A\x1b[2C\x1b[2K\r\x1b[2J\x1b[H\x1b[?25lok\x1b[0m\x1b[?25h");
}));
test("terminal native PTY: NO_COLOR y TERM=dumb degradan controles",async()=>temporary(dir=>{
 const app=binary(dir,'console.color("red");console.background("blue");console.clear();console.writeLine("ok");console.flush();');
 assert.equal(tty(app,"xterm",true),"\x1b[2J\x1b[Hok\r\n");assert.equal(tty(app,"dumb"),"ok\r\n");
}));
test("terminal native PTY: argumentos inválidos no inyectan secuencias",async()=>temporary(dir=>{
 const app=binary(dir,'print(console.moveTo(0,1));print(console.moveTo(1.5,1));print(console.moveBy(999999,0));print(console.color("red;99"));print(console.style("unknown"));console.flush();');assert.equal(tty(app),"0\r\n0\r\n0\r\n0\r\n0\r\n");
}));
test("terminal native PTY: reset y showCursor evitan restauración duplicada",async()=>temporary(dir=>{
 const app=binary(dir,'console.color("green");console.hideCursor();console.reset();console.showCursor();');assert.equal(tty(app),"\x1b[32m\x1b[?25l\x1b[0m\x1b[?25h");
}));
test("terminal native: header standalone en varias unidades",async()=>temporary(async dir=>{
 writeFileSync(join(dir,"a.cpp"),'#include "runtime/ets_terminal.hpp"\nvoid hello(){console.write("a");}');writeFileSync(join(dir,"b.cpp"),'#include "runtime/ets_terminal.hpp"\nvoid hello();int main(){hello();console.writeLine("b");}');const app=join(dir,"app");execFileSync("g++",["-std=c++20","-pthread","-fno-exceptions","-Wall","-Wextra","-Werror",`-I${root}`,join(dir,"a.cpp"),join(dir,"b.cpp"),"-o",app]);assert.equal(execFileSync(app,{encoding:"utf8"}),"ab\n");
}));
test("terminal native: múltiples módulos ETS con header condicionado",async()=>temporary(async dir=>{
 writeFileSync(join(dir,"lib.ets"),'export function hello():void{console.writeLine("ok");}');writeFileSync(join(dir,"main.ets"),'import {hello} from "./lib";hello();');const result=await compileFile(join(dir,"main.ets"));assert.ok(result.header.includes(include));writeFileSync(join(dir,"estatic_common.hpp"),result.header);const files=result.modules.map((module,index)=>{const file=join(dir,`module-${index}.cpp`);writeFileSync(file,module.cpp);return file;});const app=join(dir,"app");execFileSync("g++",["-std=c++20","-pthread","-fno-exceptions",`-I${root}`,...files,"-o",app]);assert.equal(execFileSync(app,{encoding:"utf8"}),"ok\n");
}));

test("terminal lazy: término privado ajeno no sombrea el global",async()=>temporary(async dir=>{
 writeFileSync(join(dir,"lib.ets"),'const console:number=7;print(console);');writeFileSync(join(dir,"main.ets"),'import "./lib";console.writeLine("ok");');const result=await compileFile(join(dir,"main.ets"));assert.ok(result.header.includes(include));assert.ok(result.modules.some(module=>module.cpp.includes("::console")));
}));
test("terminal lazy: import homónimo se comporta como objeto de usuario",async()=>temporary(async dir=>{
 writeFileSync(join(dir,"lib.ets"),'export const console:number=7;');writeFileSync(join(dir,"main.ets"),'import {console} from "./lib";print(console);');const result=await compileFile(join(dir,"main.ets"));assert.ok(!result.header.includes(include));
}));

test("console: logging tradicional y handle no incluyen backend de terminal",()=>{
 const cpp=compile('const output=console;output.log("ok");console.error("error");').cpp;assert.ok(!cpp.includes(include));assert.ok(!cpp.includes('runtime/ets_runtime_full.hpp'));
});
test("console: term deja de ser un builtin",()=>{assert.throws(()=>compile('term.writeLine("old");'),/term/);});
test("console native: métodos nuevos y logging antiguo conviven",async()=>temporary(dir=>{
 const app=binary(dir,'const output=console;console.log("before");output.writeLine("middle");output.flush();console.log("after");console.error("error");');const result=spawnSync(app,[],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,"before\nmiddle\nafter\n");assert.equal(result.stderr,"error\n");
}));
test("console native: receptor de controles se evalúa una vez",async()=>temporary(dir=>{
 const app=binary(dir,'function receiver():Console{print("receiver");return console;}receiver().writeLine("ok");');assert.equal(execFileSync(app,{encoding:"utf8"}),"receiver\nok\n");
}));
test("console native: minimal incluye solo IO y terminal requeridos",async()=>temporary(dir=>{
 const entry=join(dir,"main.ets"),out=join(dir,"main.cpp");writeFileSync(entry,'console.log("before");console.writeLine("ok");console.flush();');const cli=spawnSync(process.execPath,["--experimental-strip-types",join(root,"src/cli.ts"),entry,"--minimal","-o",out],{encoding:"utf8"});assert.equal(cli.status,0,cli.stderr);const cpp=readFileSync(out,"utf8");assert.ok(cpp.includes(include));assert.ok(cpp.includes('#include "runtime/ets_io.hpp"'));assert.ok(!cpp.includes('runtime/ets_runtime_full.hpp'));const app=binary(dir,cpp,false);assert.equal(execFileSync(app,{encoding:"utf8"}),"before\nok\n");
}));

test("console native: logging standalone enlaza sin implementación de terminal",async()=>temporary(dir=>{
 const cpp='#include "runtime/ets_io.hpp"\nint main(){console.log("ok");}';const app=binary(dir,cpp,false);assert.equal(execFileSync(app,{encoding:"utf8"}),"ok\n");const dependencies=execFileSync("g++",["-std=c++20",`-I${root}`,"-MM",join(dir,"main.cpp")],{encoding:"utf8"});assert.ok(!dependencies.includes("ets_terminal.hpp"),dependencies);
}));
