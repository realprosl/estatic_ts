import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { buildLoader, root } from "../modules/build.ts";
import { nativeIr, buildIrCpp as referenceBuild } from "./cpp.ts";
import { generateCppFromIr as referenceCpp } from "../../src/codegen/ir/cpp-generator.ts";
const nativeProjects=new WeakMap<object,Parameters<typeof referenceCpp>[0]>();
function generateCppFromIr(project:Parameters<typeof referenceCpp>[0]):ReturnType<typeof referenceCpp>{
 let result:ReturnType<typeof referenceCpp>;
 if(!process.env.ESTATIC_NATIVE_CODEGEN)result=referenceCpp(project);
 else {const p=spawnSync(process.env.ESTATIC_NATIVE_CODEGEN,["--codegen-json"],{input:JSON.stringify(project),encoding:"utf8",maxBuffer:64*1024*1024});if(p.error)throw p.error;if(p.status!==0)throw new Error(p.stderr);result=JSON.parse(p.stdout);}
 nativeProjects.set(result,project);return result;
}
function buildIrCpp(result:ReturnType<typeof referenceCpp>,cpp:string,binary:string,cxx?:string,flags:string[]=[]):void{
 if(!process.env.ESTATIC_NATIVE_BUILD){referenceBuild(result,cpp,binary,cxx,flags);return;}
 const project=nativeProjects.get(result);assert(project);const jsonFile=cpp+".json";writeFileSync(jsonFile,JSON.stringify(project));
 const args=["--from-ir",jsonFile,"-o",cpp,"--binary",binary,"--build"];if(cxx)args.push("--cxx",cxx);for(const flag of flags)args.push("--cxx-flag",flag);
 if(flags.some(flag=>flag.includes("sanitize"))&&process.env.ESTATIC_TEST_DISABLE_LSAN==="1"){const header=cpp+".lsan.hpp";writeFileSync(header,'extern "C" int __lsan_is_turned_off(){return 1;}\n');args.push("--cxx-flag","-include","--cxx-flag",header);}
 const p=spawnSync(process.env.ESTATIC_NATIVE_BUILD,args,{encoding:"utf8",timeout:180000,env:{...process.env,ESTC_ROOT:root}});assert.ifError(p.error);assert.equal(p.status,0,p.stderr);
 // Sanitizer test's environment exception remains test-only.
}
const directory=mkdtempSync(join(root,"build-ir-cpp-test-"));let lower:string;
before(async()=>{lower=process.env.ESTATIC_IR_BINARY??await buildLoader(join(directory,"lower"),"bootstrap/ir/demo.ets",true);});
after(()=>rmSync(directory,{recursive:true,force:true}));
function ir(source:string,files:Record<string,string>={}) {
 const dir=mkdtempSync(join(directory,"case-"));for(const [name,text]of Object.entries({"main.ets":source,...files})){mkdirSync(dirname(join(dir,name)),{recursive:true});writeFileSync(join(dir,name),text);}return nativeIr(lower,join(dir,"main.ets"));
}
function execute(source:string,files:Record<string,string>={},flags:string[]=[]):string {
 const project=ir(source,files), result=generateCppFromIr(project);assert.equal(result.cpp,generateCppFromIr(project).cpp);
 const dir=mkdtempSync(join(directory,"cpp-")),cpp=join(dir,"app.cpp"),binary=join(dir,"app");writeFileSync(cpp,result.cpp+(flags.some(f=>f.includes("sanitize"))&&process.env.ESTATIC_TEST_DISABLE_LSAN==="1"?'\nextern "C" int __lsan_is_turned_off(){return 1;}\n':""));
 buildIrCpp(result,cpp,binary,undefined,flags);const p=spawnSync(binary,[],{encoding:"utf8",timeout:15000,env:flags.some(f=>f.includes("sanitize"))?{...process.env,ASAN_OPTIONS:"detect_leaks=0",LSAN_OPTIONS:"detect_leaks=0"}:process.env});assert.ifError(p.error);assert.equal(p.status,0,p.stderr);return p.stdout;
}
for(const [name,source,expected] of [
 ["interface dispatch",'interface Named{name():string;}class A{name():string{return "A";}}class B{name():string{return "B";}}function f(x:Named):string{return x.name();}print(f(new A()));print(f(new B()));',"A\nB\n"],
 ["interface array dispatch",'interface I{f():number;}class A{f():number{return 2;}}class B{f():number{return 3;}}let xs:I[]=[new A(),new B()];print(xs[0].f());print(xs[1].f());',"2\n3\n"],
 ["interface value copy",'interface I{n:number;inc():void;}class C{n:number=1;inc():void{this.n+=1;}}let x:I=new C();let y:I=x;y.inc();print(x.n);print(y.n);',"1\n2\n"],
 ["generic interface",'interface I{get():number;}class C<T>{value:T;get():T{return this.value;}}function f(x:I):number{return x.get();}print(f(new C<number>(7)));',"7\n"],
 ["interface narrowing conversion",'interface A{f():number;}interface B{f():number;g():number;}class C{f():number{return 4;}g():number{return 5;}}let b:B=new C();let a:A=b;print(a.f());',"4\n"],
 ["intersection dispatch",'interface A{a():number;}interface B{b():number;}class C{a():number{return 2;}b():number{return 3;}}function f(x:A&B):number{return x.a()+x.b();}print(f(new C()));',"5\n"],
 ["interface recursive container",'interface I{render():string;}class Leaf{render():string{return "L";}}class Group{children:I[];render():string{let s="";for(const child of this.children)s+=child.render();return s;}}const x:I=new Group([new Leaf(),new Group([new Leaf()])]);print(x.render());',"LL\n"],
 ["interface named arguments",'interface I{f(a:number,b:number):number;}class C{f(a:number,b:number):number{return a*10+b;}}function call(x:I):number{return x.f(b:2,a:1);}print(call(new C()));',"12\n"],
 ["interface optional conversion",'interface I{f():number;}class C{f():number{return 8;}}const c:I=new C();const x=optionalSome(c);if(x.isPresent())print(x.value().f());',"8\n"],
 ["interface generic method",'interface I{id<T>(x:T):T;}class C{id<T>(x:T):T{return x;}}function f(i:I):void{print(i.id<number>(3));print(i.id<string>("s"));}f(new C());',"3\ns\n"],
 ["interface field projection",'interface A{n:number;}interface B{n:number;f():number;}class C{n:number=4;f():number{return this.n;}}const b:B=new C();const a:A=b;print(a.n);',"4\n"],
 ["scalars",'let n:i32=2;n+=3;print(n*2);',"10\n"],
 ["recursion",'function f(n:number):number{if(n==0)return 1;return n*f(n-1);}print(f(5));',"120\n"],
 ["loops",'let n=0;for(let i=0;i<6;i+=1){if(i==1)continue;if(i==5)break;n+=i;}print(n);',"9\n"],
 ["short circuit",'let n=0;function f():boolean{n+=1;return true;}const x=false&&f();const y=true||f();print(n);',"0\n"],
 ["named arguments",'let n=0;function next():number{n+=1;return n;}function f(a:number,b:number):number{return a*10+b;}print(f(b:next(),a:next()));',"21\n"],
 ["arrays",'let a=[1,2];a[1]=3;print(a[0]+a[1]);',"4\n"],
 ["tuples",'const a:[number,string]=[2,"s"];print(a[0]);print(a[1]);',"2\ns\n"],
 ["fixed spread",'const a:number[2]=[1,2];const b:number[3]=[0,...a];print(b[2]);',"2\n"],
 ["class",'class C{x:number;constructor(n:number){this.x=n;}inc():void{this.x+=1;}}let c=new C(2);c.inc();print(c.x);',"3\n"],
 ["generic default",'function f<T>(a:T,b:T[]=[a]):T[]{return b;}print(f(4)[0]);',"4\n"],
 ["generic class",'class Box<T>{constructor(public items:T[]=[]){}}const b=new Box<number>();print(b.items.length);',"0\n"],
 ["closure",'function make(n:number):(x:number)=>number{return(x:number):number=>n+x;}const f=make(10);print(f(2));',"12\n"],
 ["reference capture",'function f():number{let n=0;const bump=():void=>{n+=1;};bump();bump();return n;}print(f());',"2\n"],
 ["generic closure default",'function f<T>(a:T,b:()=>T=():T=>a):T{return b();}print(f(4));',"4\n"],
 ["callable field",'class C{f:(n:number)=>number;}const c=new C((n:number):number=>n+1);print(c.f(2));',"3\n"],
 ["owner",'class C{x:number=3;}let p:ptr<C> = new C();const q=move(p);print(q.x);',"3\n"],
 ["partial owner",'class C{x:number=2;}class Pair{a:ptr<C>;b:ptr<C>;}function f():number{let p=new Pair(new C(),new C());const a=move(p.a);return a.x;}print(f());',"2\n"],
 ["borrow",'function inc(n:ref<number>):void{n+=1;}let n=1;inc(n);print(n);',"2\n"],
 ["assignment receiver",'let n=0;let xs:number[][]=[[1]];function next():number{n+=1;return 0;}(xs[next()]=[3]).push(4);print(n);print(xs[0].length);',"1\n2\n"],
 ["optional",'const a=optionalNone<number>();print(a??9);const b=optionalSome(2);print(b??0);',"9\n2\n"],
 ["optional call",'class C{x:number=3;get(n:number):number{return n;}}let n=0;function next():number{n+=1;return n;}const a=optionalNone<C>();const x=a?.get(next());print(x??9);print(n);',"9\n0\n"],
 ["variant",'union Choice=A(number)|B;function f(c:Choice):number{if(c.kind=="A")return c.value;return 0;}print(f(Choice.A(7)));print(f(Choice.B()));',"7\n0\n"],
 ["sum match",'let x:string|number="s";match(x,[whenType<string>(()=>print("string")),whenType<number>(()=>print("number"))]);',"string\n"],
 ["switch",'let s="";switch(2){case 1:s+="a";break;case 2:s+="b";default:s+="c";}print(s);',"bc\n"],
 ["iteration",'let sum=0;for(const x of [1,2,3])sum+=x;for(const k in [1,2])sum+=k;print(sum);',"7\n"],
 ["map",'let m=new Map<string,number>();m.set("a",1);m.set("b",2);let n=0;for(const pair of m)n+=pair[1];print(n);',"3\n"],
 ["array callbacks",'const a=[1,2,3];const b=a.map((n:number):number=>n*2);print(b.reduce(0,(a:number,b:number):number=>a+b));',"12\n"],
 ["owner callback",'class C{x:number=1;}const xs:ptr<C>[]=[new C()];xs.forEach((x:constRef<C>):void=>print(x.x));',"1\n"],
 ["exact64",'const a:i64=-9223372036854775808;const b:u64=18446744073709551615;print(a);print(b);',"-9223372036854775808\n18446744073709551615\n"],
 ["integer wrap",'function f(n:i32):i32{const one:i32=1;return n+one;}print(f(2147483647));',"-2147483648\n"],
 ["comptime",'const a=comptime(():number[]=>[2,3]);print(a[1]);',"3\n"],
 ["enum",'enum Color{Red="red",Blue="blue"}print(Color.Red);',"red\n"],
 ["async",'async function f():Promise<number>{return 3;}print(await f());',"3\n"],
 ["async frame",'class C{x:number=2;}async function one():Promise<number>{return 3;}async function f():Promise<number>{const p:ptr<C> = new C();return p.x+await one();}print(await f());',"5\n"],
 ["for await",'async function one(n:number):Promise<number>{return n;}const tasks=[one(1),one(2)];let n=0;for await(const x of tasks)n+=x;print(n);',"3\n"],
 ["async sleep",'async function f():Promise<number>{await sleep(1);return 7;}print(await f());',"7\n"],
 ["optional callback",'const x=optionalSome(3);const y=optionalMap(x,(n:number):number=>n+1);print(optionalValueOr(y,0));',"4\n"],
 ["optional owner",'class C{x:number=5;}const p=optionalSome<ptr<C>>(new C());const q=move(p).value();print(q.x);',"5\n"],
 ["string runtime",'const s=" hello ";print(s.trim().toUpperCase());print(Math.floor(3.8));',"HELLO\n3\n"],
 ["json runtime",'const value=JSON.parseValue("true");print(jsonIsBool(value));',"1\n"],
 ["boolean places",'function yes(n:ref<boolean>):void{n=true;}let a:boolean[]=[false];yes(a[0]);print(a[0]);const b=a.map((x:boolean):boolean=>!x);print(b[0]);',"1\n0\n"],
 ["variadic pack",'function f<...T>(...values:T):void{print(values);}f(1,"s");',"1s\n"],
 ["floating cast",'function f(n:number):i8{return n;}print(f(3.9));',"3\n"],
 ["deferred task drop",'class C{x:number=2;}let hits=0;async function task(p:ptr<C>):Promise<number>{hits+=1;return p.x;}function f():void{const pending=task(new C());}f();print(hits);',"0\n"],
 ["all tasks",'async function one(n:number):Promise<number>{return n;}const ns=all([one(1),one(2)]);print(ns[0]+ns[1]);',"3\n"],
 ["distinct logical numeric alternatives",'const n:f64=2;let x:number|f64=n;match(x,[whenType<number>(()=>print("number")),whenType<f64>(()=>print("f64"))]);',"f64\n"],
 ["exact64 template",'const n:u64=18446744073709551615;print(`v=${n}`);',"v=18446744073709551615\n"],
 ["fixed nondefault values",'const xs:Result<number>[2]=[ok(1),ok(2)];print(xs[0].value());',"1\n"],
 ["detached task drain",'async function f():Promise<void>{await sleep(1);print("done");}spawn(f());',"done\n"],
 ["Result",'function f():Result<number>{return ok(4);}const r=f();if(r.isOk())print(r.value());',"4\n"],
] as const)test(`IR C++ executes ${name}`,()=>assert.equal(execute(source),expected));
test("IR C++ initializes imported modules once",()=>assert.equal(execute('import {get} from "./dep";print(get());',{"dep.ets":'export let n=3;export function get():number{return n;}print("dep");'}),"dep\n3\n"));
test("IR C++ rejects unsuccessful projects and unsupported capabilities before emission",()=>{
 const p=ir('print(1);');p.success=false;assert.throws(()=>generateCppFromIr(p),/success:true/);p.success=true;p.functions[0].blocks[0].instructions[0].op="backendEscape";assert.throws(()=>generateCppFromIr(p),/Capacidad/);
 assert.throws(()=>generateCppFromIr(ir('class C{x:number=1;}print(new C());')),/contrato de impresión/);
 p.annotations=[{name:"cpp_type",source:p.functions[0].source,target:p.functions[0].source,arguments:["External"]}];assert.throws(()=>generateCppFromIr(p),/ABI externo/);
});

test("IR C++ dispatches namespace function identities",()=>assert.equal(execute('import * as ns from "./dep";print(ns.get());',{"dep.ets":'export function get():number{return 4;}'}),"4\n"));
test("IR C++ reuses file Result helpers",()=>{
 const path=join(directory,"contents.txt");
 assert.equal(execute(`const r=writeFile(${JSON.stringify(path)},"hello");if(r.isOk()){const s=readFile(${JSON.stringify(path)});if(s.isOk())print(s.value());}`),"hello\n");
});
test("IR C++ ownership and exact arithmetic pass ASan/UBSan",()=>assert.equal(execute('class C{x:number=1;}class Pair{a:ptr<C>;b:ptr<C>;}function f():number{let p=new Pair(new C(),new C());const q=move(p.a);p.a=new C();return q.x+p.a.x;}function add(n:i64):i64{const one:i64=1;return n+one;}print(f());print(add(9223372036854775807));',{},["-fsanitize=address,undefined","-fno-omit-frame-pointer"]),"2\n-9223372036854775808\n"));

test("IR C++ rejects malformed operators at its producer boundary",()=>{
 const p=ir('let x=1;print(x+2);');const op=p.functions.flatMap(f=>f.blocks.flatMap(b=>b.instructions)).find(i=>i.op==="binary")!;op.text="; std::abort();";
 assert.throws(()=>generateCppFromIr(p),/Operador binario inválido/);
});

test("IR C++ writes back legacy out parameters through runtime references",()=>{
 const path=join(directory,"out-contents.txt");writeFileSync(path,"out");
 assert.equal(execute(`let content="";let error="";if(readFile(${JSON.stringify(path)},content,error))print(content);`),"out\n");
});


for(const backend of ["httplib","drogon"] as const)test(`IR C++ retains callbacks and routes real HTTP through ${backend}`,async()=>{
 const reservation=createServer();reservation.listen(0,"127.0.0.1");await once(reservation,"listening");const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const source=`let server=http.createServer();const greeting="hello ";server.get("/users/:id",(req:Request,res:Response):void=>{res.status(202).header("X-Reply","yes").send(greeting+http.param(req,"id")+":"+http.query(req,"q")+":"+http.header(req,"X-Test")+":"+req.method+":"+req.path);});server.post("/echo",(req:Request,res:Response):void=>{res.status(201).send(req.body);});server.delete("/item",(req:Request,res:Response):void=>{res.status(203).json(${JSON.stringify('{"ok":true}')});});server.listen("127.0.0.1",${port});`;
 const project=ir((backend==="drogon"?"@cpp_drogon ":"")+source),result=generateCppFromIr(project);assert(result.headers.includes(`runtime/ets_http_${backend}.hpp`));
 const cpp=join(directory,"server.cpp"),binary=join(directory,"server");writeFileSync(cpp,result.cpp);buildIrCpp(result,cpp,binary);
 const child=spawn(binary,[],{stdio:["ignore","pipe","pipe"]});let errors="";child.stderr.on("data",chunk=>errors+=chunk);const closed=once(child,"close");
 try {
  let response:Response|undefined;
  for(let attempt=0;attempt<100;attempt++){try{response=await fetch(`http://127.0.0.1:${port}/users/42?q=one%20two`,{headers:{"X-Test":"custom"}});break;}catch{if(child.exitCode!==null)throw new Error(errors);await new Promise(resolve=>setTimeout(resolve,25));}}
  assert(response,"Server did not start");assert.equal(response.status,202);assert.equal(response.headers.get("x-reply"),"yes");assert.equal(await response.text(),backend==="drogon"?"hello 42:one%20two:custom:GET:/users/42":"hello 42:one two:custom:GET:/users/42");
  response=await fetch(`http://127.0.0.1:${port}/echo`,{method:"POST",body:"payload"});assert.equal(response.status,201);assert.equal(await response.text(),"payload");
  response=await fetch(`http://127.0.0.1:${port}/item`,{method:"DELETE"});assert.equal(response.status,203);assert.match(response.headers.get("content-type")??"",/application\/json/);assert.deepEqual(await response.json(),{ok:true});
 }finally{child.kill("SIGTERM");await closed;}
});

test("IR C++ selects the existing Drogon wrapper through its annotation",()=>{
 const p=ir('@cpp_drogon let server:Server=http.createServer();server.get("/",(req:Request,res:Response):void=>{res.send("ok");});');
 const result=generateCppFromIr(p);assert(result.headers.includes("runtime/ets_http_drogon.hpp"));assert(!result.headers.includes("runtime/ets_http_httplib.hpp"));
});

test("IR C++ libcurl client executes GET and POST through native async",async()=>{
 const server=createServer((req,res)=>{let body="";req.on("data",chunk=>body+=chunk);req.on("end",()=>{res.writeHead(202,{"X-Test":"curl"});res.end(req.method=== "POST"?body:"hello");});});server.listen(0,"127.0.0.1");await once(server,"listening");const port=(server.address() as {port:number}).port;
 try {
  const project=ir(`const a=await http.get("http://127.0.0.1:${port}/");if(a.isOk()){const r=a.value();print(r.status());print(r.body());print(r.header("X-Test"));}const b=await http.post("http://127.0.0.1:${port}/","payload");if(b.isOk())print(b.value().body());`);
  const result=generateCppFromIr(project);assert(result.runtimeBackends.curl);assert(result.runtimeBackends.libuv);
  const cpp=join(directory,"client.cpp"),binary=join(directory,"client");writeFileSync(cpp,result.cpp);buildIrCpp(result,cpp,binary);
  const child=spawn(binary,[],{stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
  const timer=setTimeout(()=>child.kill("SIGKILL"),15000);try{const [code]=await once(child,"close");assert.equal(code,0,stderr);assert.equal(stdout,"202\nhello\ncurl\npayload\n");}finally{clearTimeout(timer);}
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("bootstrap CLI connects native frontend, IR, C++, build and execution",()=>{
 const cli=join(root,"bootstrap/cli.ts"),dir=mkdtempSync(join(directory,"cli-"));
 const command=(args:string[])=>spawnSync(process.execPath,["--experimental-strip-types",cli,...args],{cwd:root,encoding:"utf8",timeout:120000});
 const source=join(dir,"main.ets"),cpp=join(dir,"app.cpp"),json=join(dir,"app.ir.json"),binary=join(dir,"app");writeFileSync(source,'print(argument(1));');
 let p=command([source,"--frontend",lower,"-o",cpp,"--binary",binary,"--emit-ir",json,"--run","--","hello"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"hello\n");
 p=command(["--from-ir",json,"-o",cpp,"--binary",binary,"--run","--","IR"]);assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"IR\n");
 p=command([source,"--frontend",lower,"--check"]);assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/Comprobado/);
 writeFileSync(source,'exitProcess(7);');p=command([source,"--frontend",lower,"-o",cpp,"--binary",binary,"--run"]);assert.equal(p.status,7,p.stderr);
 writeFileSync(source,'let n:number="bad";');p=command([source,"--frontend",lower,"--check"]);assert.equal(p.status,1);assert.match(p.stderr,/IR_INPUT|incompatible|comprobado/);
 assert.equal(command(["--unknown"]).status,2);assert.equal(command(["--version"]).status,0);assert.equal(command(["--help"]).status,0);
});

test("bootstrap CLI reuses project config and passes aliases/roots to native loader",()=>{
 const dir=mkdtempSync(join(directory,"config-")),modules=join(dir,"lib");mkdirSync(modules);writeFileSync(join(modules,"dep.ets"),'export const n=9;');
 const source=join(dir,"main.ets");writeFileSync(source,'import {n} from "lib/dep";print(n);');
 const config=join(dir,"estatic.config.ts");writeFileSync(config,'export default {entry:"main.ets",aliases:{lib:"./lib"},output:{cpp:"out/app.cpp",binary:"out/app"},compiler:{flags:["-O0"],linkFlags:[]}};');
 const p=spawnSync(process.execPath,["--experimental-strip-types",join(root,"bootstrap/cli.ts"),"--config",config,"--frontend",lower,"--run"],{cwd:dir,encoding:"utf8",timeout:120000});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"9\n");
 writeFileSync(source,'import {n} from "dep";print(n);');
 const checked=spawnSync(process.execPath,["--experimental-strip-types",join(root,"bootstrap/cli.ts"),source,"--frontend",lower,"--root",modules,"--cache",join(dir,"cache"),"--check"],{cwd:dir,encoding:"utf8",timeout:120000});assert.equal(checked.status,0,checked.stderr);
});


test("IR C++ recursive interface copies pass ASan/UBSan",()=>assert.equal(execute('interface I{render():string;}class Leaf{render():string{return "L";}}class Group{children:I[];render():string{let s="";for(const c of this.children)s+=c.render();return s;}}const x:I=new Group([new Leaf(),new Group([new Leaf()])]);const y:I=x;print(x.render());print(y.render());',{},["-fsanitize=address,undefined","-fno-omit-frame-pointer"]),"LL\nLL\n"));
