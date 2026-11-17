import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { buildLoader, root } from "../modules/build.ts";
import { nativeIr, buildIrCpp as referenceBuild } from "./cpp.ts";
import { generateCppFromIr as referenceCpp, IrCppGenerator } from "../../src/codegen/ir/cpp-generator.ts";
import { IrCodegenError } from "../../src/codegen/ir/model.ts";
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
before(async()=>{lower=process.env.ESTATIC_IR_BINARY??await buildLoader(join(directory,"lower"),"compiler/ir/demo.ts",true);});
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
 ["string con las firmas de TypeScript",'const s="hola mundo";print(s.indexOf("o"));print(s.indexOf("o",2));print(s.lastIndexOf("o"));print(s.lastIndexOf("o",5));print(s.slice(5));print(s.slice());print(s.substring(5));print(s.substr(-5));print(s.split(" ").length);print(s.split("",3).join("-"));print(s.startsWith("mundo",5));print(s.endsWith("hola",4));print("7".padStart(3)+"|");print(s.at(-1)??"?");print(s.at(50)??"fuera");print(s.codePointAt(0)??0);print(s.concat("!","?"));print(String.fromCharCode(72,105));print(String(42)+String(true)+String("x"));print("  a ".trimLeft()+"|");print(s.charAt());',"1\n9\n9\n1\nmundo\nhola mundo\nmundo\nmundo\n2\nh-o-l\ntrue\ntrue\n  7|\no\nfuera\n104\nhola mundo!?\nHi\n42truex\na |\nh\n"],
 ["array con las firmas de TypeScript",'let a:number[]=[3,1,2];print(a.reduce((s:number,x:number):number=>s+x));print(a.reduce((s:string,x:number):string=>s+x,"r"));print(a.reduceRight((s:number,x:number):number=>s-x));print(a.map((x:number,i:number):number=>x*i).join("-"));print(a.at(-1)??0);print(a.at(9)??-1);print(a.indexOf(2));print(a.lastIndexOf(3,-1));print(a.includes(3,1));print(a.findIndex((x:number):boolean=>x<3));print(a.findLast((x:number):boolean=>x>1)??0);print(a.findLastIndex((x:number,i:number):boolean=>i<2));print(a.push(4,5));print(a.unshift(0));print(a.pop()??-1);print(a.shift()??-1);print(a.join());print(a.toSorted().join());print(a.toReversed().join());print(a.with(0,9).join());a.fill(7,1,-1);a.reverse();print(a.join());let e:number[]=[];print(e.pop()??-1);print([true,false].join("|"));',"6\nr312\n-2\n0-1-4\n2\n-1\n2\n0\nfalse\n1\n2\n1\n5\n6\n5\n0\n3,1,2,4\n1,2,3,4\n4,2,1,3\n9,1,2,4\n4,7,7,3\n-1\ntrue|false\n"],
 ["array: splice, flat, keys/values/entries, Array.isArray/of/from y print como Node (#214)",'let a:number[]=[1,2,3,4,5];print(a.splice(1,2,9,8,7));print(a);print(a.splice(-2));print(a.toSpliced(0,1));print(a.keys());print(a.values().length);print(a.entries());const n:number[][]=[[1],[2,3]];print(n.flat());const d:number[][][]=[[[1]],[[2]]];print(d.flat(2));print(Array.isArray(a));print(Array.isArray(3));print(Array.of(1,2));print(Array.from("ab"));let s:Set<number>=new Set<number>();s.add(4);print(Array.from(s,(x:number,i:number):number=>x*10+i));for(const e of a.entries())console.log(e[0],e[1]);const vacio:number[]=[];print(vacio);print(["a","it\'s"]);print([true,false]);let m:Map<string,number>=new Map<string,number>();m.set("k",1);print(m);print(s);let many:number[]=[];for(let k:number=0;k<30;k=k+1)many.push(k*7);print(many);',"[ 2, 3 ]\n[ 1, 9, 8, 7, 4, 5 ]\n[ 4, 5 ]\n[ 9, 8, 7 ]\n[ 0, 1, 2, 3 ]\n4\n[ [ 0, 1 ], [ 1, 9 ], [ 2, 8 ], [ 3, 7 ] ]\n[ 1, 2, 3 ]\n[ 1, 2 ]\ntrue\nfalse\n[ 1, 2 ]\n[ 'a', 'b' ]\n[ 40 ]\n0 1\n1 9\n2 8\n3 7\n[]\n[ 'a', \"it's\" ]\n[ true, false ]\nMap(1) { 'k' => 1 }\nSet(1) { 4 }\n[\n    0,   7,  14,  21,  28,  35,  42,  49,\n   56,  63,  70,  77,  84,  91,  98, 105,\n  112, 119, 126, 133, 140, 147, 154, 161,\n  168, 175, 182, 189, 196, 203\n]\n"],
 ["print de arrays literales constantes resuelto al compilar (#214)",'print([1,2.5,-0]);print(["a","it\'s"]);print([true,false]);print([1,2,3,4,5,6,7]);let x:number=4;print([x,5]);',"[ 1, 2.5, -0 ]\n[ 'a', \"it's\" ]\n[ true, false ]\n[\n  1, 2, 3, 4,\n  5, 6, 7\n]\n[ 4, 5 ]\n"],
 ["Map y Set en orden de inserción, constructores, keys/values/entries y for-of con desestructuración","let m: Map<string, number> = new Map<string, number>([[\"z\", 1], [\"a\", 2]]);m.set(\"m\", 3); m.delete(\"a\"); m.set(\"a\", 4); m.set(\"z\", 9);for (const [k, v] of m) console.log(k, v);console.log(Array.from(m.keys()), Array.from(m.values()), Array.from(m.entries()), m.size);let s: Set<number> = new Set<number>([5, 1, 3, 1]);s.add(2);for (const x of s) console.log(x);console.log(Array.from(s.values()), s.has(3));m.forEach((v: number) => console.log(v));m.forEach((v: number, k: string) => console.log(k, v));s.forEach((x: number) => console.log(x * 2));const t: [string, number][] = [[\"x\", 1], [\"y\", 2]];for (const [name, value] of t) console.log(name, value);for (const [i, x] of [\"p\", \"q\"].entries()) console.log(i, x);let w: Map<number, string> = new Map<number, string>();for (let i = 0; i < 100; i = i + 1) w.set(i, \"v\" + i);for (let i = 0; i < 95; i = i + 1) w.delete(i);for (const [k, v] of w) console.log(k, v);","z 9\nm 3\na 4\n[ 'z', 'm', 'a' ] [ 9, 3, 4 ] [ [ 'z', 9 ], [ 'm', 3 ], [ 'a', 4 ] ] 3\n5\n1\n3\n2\n[ 5, 1, 3, 2 ] true\n9\n3\n4\nz 9\nm 3\na 4\n10\n2\n6\n4\nx 1\ny 2\n0 p\n1 q\n95 v95\n96 v96\n97 v97\n98 v98\n99 v99\n"],
 ["escapes de strings y templates (#248)","const s:string=\"a\\fb\\vc\\bd\\0e\";console.log(s.length,s.charCodeAt(1),s.charCodeAt(3),s.charCodeAt(5),s.charCodeAt(7));console.log(\"\\x41B\\u{43}\",\"\\u{1F600}\"==\"\ud83d\ude00\",\"\\q\");const t:string=`x\\fyA`;console.log(t.charCodeAt(1),t);","9 12 11 8 0\nABC true q\n12 x\fyA\n"],
 ["librerías del runtime estatic:math y estatic:number","import Math,{floor,PI,round,max,min,hypot,pow,sign,trunc,clz32,imul,fround} from \"estatic:math\";import Number,{parseInt,parseFloat,toFixed,toPrecision,toExponential,toString,isNaN} from \"estatic:number\";console.log(Math.floor(2.7),floor(-2.5),Math.PI,PI,round(-2.5),round(2.5),Math.max(1,5,3),max(),min(0,-0),hypot(3,4),Math.sign(-3),Math.round(-0.4),trunc(-4.7),clz32(1),imul(3,4),fround(5.5),Math.sqrt(16),Math.cbrt(27),Math.abs(-2));console.log(toFixed(2.5),toFixed(1.005,2),toPrecision(123.456,4),toPrecision(0.5),toExponential(12345),toExponential(1.5,3),toString(255,16),toString(0.5,2));console.log(parseInt(\"  42px\"),parseInt(\"0x1F\"),parseInt(\"ff\",16),parseInt(\"z\",37),parseInt(\"-12.9\"),parseInt(\"\"),parseFloat(\"3.14abc\"),parseFloat(\".5\"),parseFloat(\"-Infinityx\"),parseFloat(\"1e3x\"),parseFloat(\"1e\"),parseFloat(\"abc\"));console.log(Number.isInteger(5),Number.isInteger(5.5),Number.isSafeInteger(9007199254740992),Number.MAX_SAFE_INTEGER,Number.EPSILON,Number.MAX_VALUE,Number.MIN_VALUE,isNaN(Number.NaN),Number.parseInt(\"101\",2));","2 -3 3.141592653589793 3.141592653589793 -2 3 5 -Infinity -0 5 -1 -0 -4 31 12 5.5 4 3 2\n3 1.00 123.5 0.5 1.2345e+4 1.500e+0 ff 0.1\n42 31 255 NaN -12 NaN 3.14 0.5 -Infinity 1000 1 NaN\ntrue false false 9007199254740991 2.220446049250313e-16 1.7976931348623157e+308 5e-324 true 5\n"],
 ["parámetros ref<T>: asignar y escribir primitivos",'class S{paths:string[]=[];n:number=0;}class C{setPath(state:ref<S>,key:string,v:number):void{state.paths.push(key);state.n=v;}assign(state:ref<S>,right:S,k:boolean):void{state=(k?right:state);}restore(state:ref<S>,saved:constRef<S>):void{for(let at:number=0;at<saved.paths.length;at=at+1)this.setPath(state,saved.paths[at],at+1);}}let s=new S();let t=new S();t.paths.push("x");t.paths.push("y");t.paths.push("z");const c=new C();c.restore(s,t);print(s.paths.join(","));print(s.n);t.paths.pop();c.assign(s,t,true);print(s.paths.length);',"x,y,z\n3\n2\n"],
 ["=== y !== como == y !=",'print(1===1);print(2!==3);print("a"==="b");',"true\ntrue\nfalse\n"],
 ["print muestra los valores como JavaScript (#204, #208)",'print(true,false);print(3628800);print(0.1+0.2);print(123456789012);print("n="+0.000001);console.log(1.5,true,"x");',"truefalse\n3628800\n0.30000000000000004\n123456789012\nn=0.000001\n1.5 true x\n"],
 ["literales con exponente (#210)",'print(1e21);print(2.5e-3);print(1E3+1);',"1e+21\n0.0025\n1001\n"],
 ["cierre de genéricos seguido de = (#194)",'let m:Map<string,number>=new Map<string,number>();m.set("a",1);let xs:Array<Array<number>>=[[1]];print(m.size+xs.length);',"2\n"],
 ["push con un argumento que modifica this (#195)",'class G{names:string[];used:Map<string,number>;constructor(){this.names=[];this.used=new Map<string,number>();}name(label:string):string{this.used.set(label,1);return label;}fill():void{this.names.push(this.name("a"));}}let g=new G();g.fill();print(g.names.length);',"1\n"],
 ["T | undefined: literal, comparación y narrowing",'let x:number|undefined=undefined;if(x===undefined)print("vacio");x=5;if(x!==undefined)print(x+1);let y:string|undefined="hola";print(y===undefined);print(y!==undefined);',"vacio\n6\nfalse\ntrue\n"],
 ["T | undefined: retorno, ?? y parámetro opcional",'function buscar(n:number):string|undefined{if(n>0)return "positivo";return undefined;}const r=buscar(3);if(r!==undefined)print(r.toUpperCase());print(buscar(-1)??"nada");function f(a:number,b?:number):number{return b===undefined?a:a+b;}print(f(1));print(f(1,2));',"POSITIVO\nnada\n1\n3\n"],
 ["process argv and argc as Node properties",'print(process.argc);print(process.argv.length);print(process.argv[0]==process.argv[1]?"igual":"distinto");print(process.argv.slice(2).length);',"2\n2\nigual\n0\n"],
 ["update comptime exact integers",'const n:u64=comptime(():u64=>{let value:u64=9007199254740993;const old:u64=value++;const next:u64=++value;return old+(next-value);});print(n);',"9007199254740993\n"],
 ["update references fields and closures",'function inc(n:ref<number>):number{return n++;}let n=4;print(inc(n));print(n);class C{x:number=1;inc():number{return ++this.x;}}let c=new C();print(c.inc());function run():number{let value=0;const bump=():number=>++value;bump();return bump();}print(run());',"4\n5\n2\n2\n"],
 ["update numeric widths and exact integers",'let small:i8=126;print(small++);print(++small);let exact:u64=9007199254740993;print(exact++);print(++exact);let single:f32=1.5;print(single++);print(single);',"126\n-128\n9007199254740993\n9007199254740995\n1.5\n2.5\n"],
 ["update short circuit and continue",'let n=0;const a=false&&++n>0;const b=true||n++>0;print(n);for(let i=0;i<3;i++){if(i==1)continue;print(i);}let j=2;while(j-->0)print(j);',"0\n0\n2\n1\n0\n"],
 ["update expression values and destinations",'let i=0;print(i++);print(++i);print(i--);print(--i);for(let j=0;j<3;j++){print(j);}let xs=[4];let calls=0;function index():number{calls+=1;return 0;}print(xs[index()]++);print(++xs[index()]);print(calls);print(xs[0]);',"0\n2\n2\n0\n0\n1\n2\n4\n6\n2\n6\n"],
 ["void ternary effects",'let n=0;function condition(value:boolean):boolean{n+=1;return value;}function a():void{print("a");}function b():void{print("b");}condition(true)?a():b();condition(false)?a():b();true?(false?a():b()):a();print(n);print(false?7:8);',"a\nb\nb\n2\n8\n"],
 ["multiline object properties",'interface FetchOptions{method:string;body:string;contentType:string;}const defaults:FetchOptions={\n method:"GET",\n body:"",\n contentType:"application/json"\n};print(defaults.method);print(defaults.contentType);',"GET\napplication/json\n"],
 ["interface dispatch",'interface Named{name():string;}class A{name():string{return "A";}}class B{name():string{return "B";}}function f(x:Named):string{return x.name();}print(f(new A()));print(f(new B()));',"A\nB\n"],
 ["interface array dispatch",'interface I{f():number;}class A{f():number{return 2;}}class B{f():number{return 3;}}let xs:I[]=[new A(),new B()];print(xs[0].f());print(xs[1].f());',"2\n3\n"],
 ["interface value copy",'interface I{n:number;inc():void;}class C{n:number=1;inc():void{this.n+=1;}}let x:I=new C();let y:I=x;y.inc();print(x.n);print(y.n);',"1\n2\n"],
 ["generic interface",'interface I{get():number;}class C<T>{value:T;get():T{return this.value;}}function f(x:I):number{return x.get();}print(f(new C<number>(7)));',"7\n"],
 ["interface narrowing conversion",'interface A{f():number;}interface B{f():number;g():number;}class C{f():number{return 4;}g():number{return 5;}}let b:B=new C();let a:A=b;print(a.f());',"4\n"],
 ["intersection dispatch",'interface A{a():number;}interface B{b():number;}class C{a():number{return 2;}b():number{return 3;}}function f(x:A&B):number{return x.a()+x.b();}print(f(new C()));',"5\n"],
 ["interface recursive container",'interface I{render():string;}class Leaf{render():string{return "L";}}class Group{children:I[];render():string{let s="";for(const child of this.children)s+=child.render();return s;}}const x:I=new Group([new Leaf(),new Group([new Leaf()])]);print(x.render());',"LL\n"],
 ["interface named arguments",'interface I{f(a:number,b:number):number;}class C{f(a:number,b:number):number{return a*10+b;}}function call(x:I):number{return x.f(b:2,a:1);}print(call(new C()));',"12\n"],
 ["literales num\u00e9ricos con redondeo correcto (#250)","const m:number=1.7976931348623157e308;console.log(m,5e-324,2.4703282292062328e-324,0.1+0.2,1e21,0x1FFFFFFFFFFFFF1,9007199254740993,1_000.5,2.2250738585072011e-308);","1.7976931348623157e+308 5e-324 5e-324 0.30000000000000004 1e+21 144115188075855860 9007199254740992 1000.5 2.225073858507201e-308\n"],
 ["interface optional conversion",'interface I{f():number;}class C{f():number{return 8;}}const c:I=new C();const x=optionalSome(c);if(x.isPresent())print(x.value().f());',"8\n"],
 ["interface generic method",'interface I{id<T>(x:T):T;}class C{id<T>(x:T):T{return x;}}function f(i:I):void{print(i.id<number>(3));print(i.id<string>("s"));}f(new C());',"3\ns\n"],
 ["interface field projection",'interface A{n:number;}interface B{n:number;f():number;}class C{n:number=4;f():number{return this.n;}}const b:B=new C();const a:A=b;print(a.n);',"4\n"],
 ["temporary argument value semantics",'function size(xs:number[]):number{xs.pop();return xs.length;}let xs=[1,2];for(let n=0;n<3;n=n+1)print(size(xs));print(xs.length);',"1\n1\n1\n2\n"],
 ["temporary constructor value semantics",'class Box{items:number[];}function make(xs:number[]):Box{return new Box(xs);}let xs=[1,2];const box=make(xs);xs.push(3);print(box.items.length);print(xs.length);',"2\n3\n"],
 ["length snapshot semantics",'let xs=[1,2];const saved=xs;xs.push(3);print(saved.length);print(xs.length);',"2\n3\n"],
 ["length mutation ordering",'let xs=[1];function grow():number{xs.push(2);return xs.length;}print(xs.length);print(grow());print(xs.length);',"1\n2\n2\n"],
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
 ["array callbacks",'const a=[1,2,3];const b=a.map((n:number):number=>n*2);print(b.reduce((a:number,b:number):number=>a+b, 0));',"12\n"],
 ["owner callback",'class C{x:number=1;}const xs:ptr<C>[]=[new C()];xs.forEach((x:constRef<C>):void=>print(x.x));',"1\n"],
 ["readonly simple getter",'class C{x:number=7;get():number{return this.x;}}function read(c:constRef<C>):number{return c.get();}const c=new C();print(read(c));',"7\n"],
 ["readonly getter closure snapshot",'class C{x:number=1;get():number{return this.x;}}function make():()=>number{const c=new C();return ():number=>c.get();}const callback=make();print(callback());',"1\n"],
 ["readonly delegated getter",'class C{x:number=8;get():number{return this.x;}getAgain():number{return this.get();}}function read(c:constRef<C>):number{return c.getAgain();}const c=new C();print(read(c));',"8\n"],
 ["readonly generic class getter",'class Box<T>{value:T;get():T{return this.value;}}function read(box:constRef<Box<string>>):string{return box.get();}const box=new Box<string>("generic");print(read(box));',"generic\n"],
 ["readonly constPtr getter",'class C{x:number=9;get():number{return this.x;}}const c:constPtr<C> = new C();print(c.get());',"9\n"],
 ["readonly receiver with mutable output",'class C{x:number=4;copy(target:ref<number>):void{target=this.x;}}function read(c:constRef<C>):number{let n=0;c.copy(n);return n;}const c=new C();print(read(c));',"4\n"],
 ["readonly interface getter dispatch",'interface Named{name():string;}class A{name():string{return "A";}}class B{name():string{return "B";}}function read(value:Named):string{return value.name();}const a:Named=new A();const b:Named=new B();print(read(a));print(read(b));',"A\nB\n"],
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
 ["json runtime",'const value=JSON.parseValue("true");print(jsonIsBool(value));',"true\n"],
 ["boolean places",'function yes(n:ref<boolean>):void{n=true;}let a:boolean[]=[false];yes(a[0]);print(a[0]);const b=a.map((x:boolean):boolean=>!x);print(b[0]);',"true\nfalse\n"],
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
test("IR C++ executes readonly Node owner-array visit callbacks",()=>{
 const source=`class Node {
  private children:ptr<Node>[];
  constructor(private title:string,private className:string,private page:i16){this.children=[];}
  add(child:ptr<Node>):void{this.children.push(move(child));}
  getClass():string{return this.className;}
  getTitle():string{return this.title;}
  getPage():i16{return this.page;}
  visit(callback:(node:constRef<Node>)=>void):void{
   callback(this);
   this.children.forEach((child:constRef<Node>):void=>callback(child));
  }
 }
 function make():ptr<Node>{
  let root:ptr<Node> = new Node("Documento","Node",1);
  let child:ptr<Node> = new Node("Seccion","Node",2);
  root.add(move(child));
  return move(root);
 }
 let document:ptr<Node> = make();
 document.visit((node:constRef<Node>):void=>{
  if(node.getClass()=="Node"&&node.getPage()>0)print(node.getTitle());
 });`;
 assert.equal(execute(source),"Documento\nSeccion\n");
});
test("IR C++ native aggregate fast paths survive seed synchronization",{skip:!process.env.ESTATIC_NATIVE_CODEGEN},()=>{
 const project=ir('function count(xs:number[]):number{return xs.length;}function forward(xs:number[]):number{return count(xs);}let xs=[1,2];const n=forward(xs);print(n);print(xs.length);');
 const {cpp}=generateCppFromIr(project);
 // A size query must read the original place, not materialize an aggregate
 // snapshot first. Reintroducing that load makes compiler analysis quadratic.
 let fused=0,stores=0,calls=0;
 for(const f of project.functions){
  const uses=f.values.map(()=>0);
  for(const b of f.blocks){if(b.value>=0)uses[b.value]++;for(const i of b.instructions)for(const operand of i.operands)uses[operand]++;}
  for(const p of f.places)if(p.index>=0)uses[p.index]++;
  for(const value of f.frameValues)uses[value]++;
  for(const b of f.blocks)for(let at=0;at<b.instructions.length;at++){
   const i=b.instructions[at],next=b.instructions[at+1];
   if(i.op==='load'&&i.result>=0&&uses[i.result]===1&&i.place>=0&&f.places[i.place].kind!=='index'&&next?.op==='property'&&['length','size'].includes(next.text)&&next.operands[0]===i.result){
    assert.ok(cpp.includes(`v${next.result}.set(static_cast<double>((`),'length/size must bypass the aggregate load');fused++;
   }
   if(i.op==='store'&&i.operands.length===1&&uses[i.operands[0]]===1&&at>0&&b.instructions[at-1].result===i.operands[0]){
    assert.ok(cpp.includes(`.set(v${i.operands[0]}.take());`),'adjacent single-use stores must move the temporary');stores++;
   }
   if(i.op==='call')for(const value of i.operands)if(uses[value]===1&&b.instructions.slice(0,at).some(def=>def.result===value)&&project.typeDefinitions[f.values[value]].kind==='array'){
    assert.ok(cpp.includes(`v${value}.take()`),'single-use aggregate call arguments must move the temporary');calls++;
   }
  }
 }
 assert.ok(fused>0&&stores>0&&calls>0,'fixture must exercise all three fast paths');
});
test("IR C++ preserves escaped and template literal newlines",()=>{
 assert.equal(execute('print("A\\nB");print(\`C\\nD\`);'),"A\nB\nC\nD\n");
 assert.equal(execute('print(\`C\nD\`);'),"C\nD\n");
});

test("IR C++ initializes imported modules once",()=>assert.equal(execute('import {get} from "./dep";print(get());',{"dep.ets":'export let n=3;export function get():number{return n;}print("dep");'}),"dep\n3\n"));
test("IR C++ rejects unsuccessful projects and unsupported capabilities before emission",()=>{
 const p=ir('print(1);');p.success=false;assert.throws(()=>generateCppFromIr(p),/success:true/);p.success=true;p.functions[0].blocks[0].instructions[0].op="backendEscape";assert.throws(()=>generateCppFromIr(p),/Capacidad/);
 assert.throws(()=>generateCppFromIr(ir('class C{x:number=1;}print(new C());')),/contrato de impresión/);
 p.annotations=[{name:"cpp_type",source:p.functions[0].source,target:p.functions[0].source,arguments:["External"]}];assert.throws(()=>generateCppFromIr(p),/ABI externo/);
});

test("IR C++ explains unsupported Result<void> before invoking the C++ compiler",()=>{
 const project=ir('print(1);');
 // The minimal print fixture need not contain void or string in its IR type table.
 // Add explicit scalar types so this test reaches the Result<void> codegen guard.
 const scalar=project.typeDefinitions.find(def=>def.kind==="scalar");
 assert.ok(scalar);
 const ensureScalar=(name:string):number=>{
  const existing=project.types.indexOf(name);
  if(existing!==-1)return existing;
  const id=project.types.length;
  project.types.push(name);
  project.typeDefinitions.push({...scalar,arguments:[],fields:[],names:[],variants:[]});
  return id;
 };
 const voidId=ensureScalar("void");
 const stringId=ensureScalar("string");
 const id=project.types.length;
 project.types.push("Result<void>");
 project.typeDefinitions.push({kind:"Result",arguments:[voidId,stringId],fields:[],names:[],variants:[],numericKind:"",bits:0,signed:false,resource:false,length:0,tag:"",discriminator:"",discriminatorType:0,discriminatorValue:""});
 assert.throws(()=>new IrCppGenerator(project).type(id),error=>error instanceof IrCodegenError && /Result<void>/.test(error.message) && /std::optional<T>/.test(error.message));
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

test("IR C++ writes back builtin ref parameters through runtime references",()=>{
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
 const cli=join(root,"compiler/cli.ts"),dir=mkdtempSync(join(directory,"cli-"));
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
 const p=spawnSync(process.execPath,["--experimental-strip-types",join(root,"compiler/cli.ts"),"--config",config,"--frontend",lower,"--run"],{cwd:dir,encoding:"utf8",timeout:120000});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,"9\n");
 writeFileSync(source,'import {n} from "dep";print(n);');
 const checked=spawnSync(process.execPath,["--experimental-strip-types",join(root,"compiler/cli.ts"),source,"--frontend",lower,"--root",modules,"--cache",join(dir,"cache"),"--check"],{cwd:dir,encoding:"utf8",timeout:120000});assert.equal(checked.status,0,checked.stderr);
});


test("IR C++ recursive interface copies pass ASan/UBSan",()=>assert.equal(execute('interface I{render():string;}class Leaf{render():string{return "L";}}class Group{children:I[];render():string{let s="";for(const c of this.children)s+=c.render();return s;}}const x:I=new Group([new Leaf(),new Group([new Leaf()])]);const y:I=x;print(x.render());print(y.render());',{},["-fsanitize=address,undefined","-fno-omit-frame-pointer"]),"LL\nLL\n"));
