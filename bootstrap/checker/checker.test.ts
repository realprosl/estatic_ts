import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {spawnSync} from "node:child_process";
import {Lexer} from "../../src/lexer/lexer.ts";
import {Parser} from "../../src/parser/parser.ts";
import {TypeChecker} from "../../src/semantic/type-checker.ts";
import {DiagnosticError} from "../../src/core/diagnostic.ts";
import {buildLoader,root} from "../modules/build.ts";
const directory=mkdtempSync(join(root,"build-checker-test-")); let binary:string;
before(async()=>{binary=await buildLoader(join(directory,"binary"),"bootstrap/checker/demo.ets",true);});
after(()=>rmSync(directory,{recursive:true,force:true}));
function fixture(source:string,files:Record<string,string>={}){const dir=mkdtempSync(join(directory,"project-"));for(const[name,text]of Object.entries({"main.ets":source,...files})){mkdirSync(dirname(join(dir,name)),{recursive:true});writeFileSync(join(dir,name),text);}return{entry:join(dir,"main.ets"),cache:join(dir,"cache")};}
function run(f:ReturnType<typeof fixture>,status=0){const p=spawnSync(binary,[f.entry,"--cache",f.cache],{encoding:"utf8",timeout:60000,maxBuffer:64*1024*1024});assert.ifError(p.error);assert.equal(p.status,status,p.stderr+p.stdout.slice(-3000));const g=JSON.parse(p.stdout);assert.equal(g.success,status===0);return g;}
function check(source:string,files:Record<string,string>={}){return run(fixture(source,files));}
function error(source:string,pattern:RegExp,files:Record<string,string>={}){const g=run(fixture(source,files),1);assert.ok(g.diagnostics.some((d:any)=>d.phase==="checker"&&pattern.test(d.message)),JSON.stringify(g.diagnostics));return g;}
function types(g:any,kind:string){return g.files.flatMap((f:any)=>f.ast.nodes.map((n:any,i:number)=>n.kind===kind?f.types[i]:null).filter((x:any)=>x!==null));}
const valid:Record<string,string>={
 empty:"",
 primitives:'const n=1; const s="x"; const b=true; print(n); print(s); print(b);',
 arithmetic:'let x:number=1; x=x+2*3; x-=1; print(x);',
 strings:'const s="x"+2; print(s.toUpperCase()); print(s.charAt(0)); print(s.length);',
 condition:'let n=0; if(true){n=1;}else{n=2;} while(n<5){n+=1;}',
 loop:'for(let i=0;i<3;i=i+1){if(i==1)continue; break;}',
 function:'function f(x:number):number{return x+1;} const n=f(2);',
 forward:'const n=f(2); function f(x:number):number{return x;}',
 recursive:'function f(n:number):number{if(n==0)return 1; return n*f(n-1);} print(f(4));',
 returns:'function f(b:boolean):string{if(b)return "yes";else return "no";}',
 void:'function f():void{return;} f();',
 parameters:'function f(x:number=2,y?:string):number{return x;} print(f()); print(f(1)); print(f(1,"a"));',
 arrows:'const f=(n:number)=>n+1; print(f(2));',
 arrowBlock:'const f=(n:number):number=>{return n;}; print(f(2));',
 arrays:'let a:number[]=[]; a.push(1); a[0]=2; print(a[0]); print(a.length);',
 inferredArray:'const a=[1,2,3]; print(a[1]);',
 tuple:'const t:[number,string]=[1,"x"]; print(t[1]);',
 inferredTuple:'const t=[1,"x"]; print(t[0]);',
 arrayAlias:'const a:Array<number> =[1]; print(a[0]);',
 alias:'type N=number; type NN=N; const n:NN=1; print(n);',
 typeof:'const n=1; type N=typeof n; const x:N=2;',
 union:'let x:number|string=1; x="a";',
 ternary:'const x=true?1:2;',
 satisfies:'const n=1 satisfies number;',
 cast:'const s=1 as string;',
 template:'const n=1; const s=`hello ${n+1}`;',
 interface:'interface I{x:number; y?:string;} const i:I={x:1}; print(i.x);',
 contextualCall:'interface I{x:number;} function f(i:I):number{return i.x;} print(f({x:1}));',
 contextualArrayCall:'function f(a:number[]):number{return a.length;} print(f([]));',
 class:'class C{x:number=1; get():number{return this.x;}} let c=new C(); print(c.get()); c.x=2;',
 constructor:'class C{constructor(public x:number){}} let c=new C(2); print(c.x);',
 static:'class C{static x:number=1; static get():number{return C.x;}} print(C.get()); C.x=2;',
 privateInside:'class C{private x:number=1; get():number{return this.x;}} let c=new C(); print(c.get());',
 generic:'function id<T>(x:T):T{return x;} const n=id(2); const s=id<string>("x");',
 genericArray:'function first<T>(x:T[]):T{return x[0];} print(first([1,2]));',
 overload:'function f(x:number):number{return x;} function f(x:string):string{return x;} const n=f(1); const s=f("x");',
 numeric:'let x:i8=127; let y:u16=65535; x=-128; print(x+y);',
};
for(const[name,source]of Object.entries(valid))test(`checker accepts ${name}`,()=>{const g=check(source);assert.equal(g.diagnostics.length,0);});
const invalid:[string,string,RegExp][]=[
 ['variable','const n:number="x";',/incompatible/],
 ['assignment','let n=1; n="x";',/incompatible/],
 ['constant','const n=1; n=2;',/inmutable/],
 ['constField','class C{x:number=1;} const c=new C(); c.x=2;',/inmutable/],
 ['constIndex','const a=[1]; a[0]=2;',/inmutable/],
 ['condition','if(1)print(1);',/incompatible/],
 ['return','function f():number{return "x";}',/incompatible/],
 ['bareReturn','function f():number{return;}',/incompatible/],
 ['missingReturn','function f(b:boolean):number{if(b)return 1;}',/rutas/],
 ['topReturn','return 1;',/fuera/],
 ['arity','function f(n:number):number{return n;} f();',/firma/],
 ['argument','function f(n:number):number{return n;} f("x");',/firma/],
 ['notCallable','const x=1; x();',/invocable/],
 ['member','const x="s"; print(x.unknown);',/miembro/],
 ['methodArgument','print("x".charAt("a"));',/incompatible/],
 ['array','const a:number[]=["x"];',/incompatible/],
 ['emptyArray','const a=[];',/anotación/],
 ['tuple','const a:[number,string]=[1,2];',/incompatible/],
 ['tupleBounds','const a=[1,"x"]; print(a[2]);',/rango/],
 ['index','const a=[1]; print(a["s"]);',/incompatible/],
 ['interfaceMissing','interface I{x:number;} const i:I={};',/Falta/],
 ['interfaceExtra','interface I{x:number;} const i:I={x:1,y:2};',/desconocido/],
 ['interfaceField','interface I{x:number;} const i:I={x:"a"};',/incompatible/],
 ['private','class C{private x:number=1;} const c=new C(); print(c.x);',/privado/],
 ['readonly','class C{readonly x:number=1;} let c=new C(); c.x=2;',/inmutable/],
 ['staticReceiver','class C{static x:number=1;} const c=new C(); print(c.x);',/Receptor/],
 ['constructorArity','class C{} new C(1);',/constructor/],
 ['constructorType','class C{constructor(public x:number){}} new C("x");',/firma/],
 ['tdz','print(x); let x=1;',/antes de inicializar/],
 ['circular','const x=x;',/circular/],
 ['aliasCircular','type A=B; type B=A; const a:A=1;',/circular/],
 ['voidVariable','function f():void{} const x=f();',/void/],
 ['genericMismatch','function id<T>(x:T):T{return x;} id<string>(1);',/firma/],
 ['ambiguous','function f(x:number):number{return x;} function f(x:i32):i32{return x;} f(1);',/ambigua/],
 ['range','const x:u8=256;',/rango/],
 ['signedRange','const x:u8=-1;',/rango/],
 ['callRange','function f(x:i8):void{} f(128);',/rango/],
 ['break','break;',/fuera/],
];
for(const[name,source,pattern]of invalid)test(`checker rejects ${name}`,()=>error(source,pattern));
for(const[name,source]of Object.entries({
 fixed:'const a:number[2]=[1,2];',
 int64:'const n:i64=1;',
 object:'const x={a:1};',
 builtin:'print(Math.abs(-1));',
 destructuring:'const [x]=[1];',
 async:'async function f():number{return 1;}',
 constraints:'function f<T extends number>(x:T):T{return x;}',
 genericClass:'class C<T>{x:T;} ',
 genericAlias:'type A<T> = T;',
 spread:'const a=[1]; const b=[...a];',
 enum:'enum E{A,B}',
 out:'function f(out x:number):void{x=1;}',
 named:'function f(x:number):void{} f(x:1);',
}))test(`checker fails explicitly for pending ${name}`,()=>error(source,/pendiente/));

test('checker: inferred node and symbol types plus selected overload',()=>{const g=check(valid.overload);assert.deepEqual(types(g,'CallExpression'),['number','string']);assert.equal(g.files[0].selected.filter((n:number)=>n>=0).length,2);const symbols=g.binding.symbols;assert.equal(g.symbolTypes[symbols.findIndex((s:any)=>s.name==='n')],'number');});
test('checker: imported function and alias use original types',()=>{const g=check('import {f,N} from "./lib"; const n:N=f(2);',{'lib.ets':'export type N=number; export function f(x:N):N{return x;}'});assert.equal(g.files.length,2);assert.ok(types(g,'CallExpression').includes('number'));});
test('checker: namespace call uses selected origin',()=>check('import * as ns from "./lib"; print(ns.f(1));',{'lib.ets':'export function f(x:number):string{return "x";}'}));
test('checker: imported function rejects wrong type',()=>error('import {f} from "./lib"; f("x");',/firma/,{'lib.ets':'export function f(x:number):number{return x;}'}));
test('checker: module homonyms have distinct nominal types',()=>error('import {C as A} from "./a"; import {C as B} from "./b"; const a:A=new B();',/incompatible/,{'a.ets':'export class C{x:number=1;}','b.ets':'export class C{x:number=1;}'}));
test('checker: reexport default type identity',()=>check('import C from "./barrel"; const c:C=new C(); print(c.x);',{'barrel.ets':'export {default} from "./lib";','lib.ets':'export default class C{x:number=1;}'}));
test('checker: import cannot be reassigned',()=>error('import {x} from "./lib"; x=2;',/import/,{'lib.ets':'export let x=1;'}));
test('checker: type-only typeof query',()=>check('import type {f} from "./lib"; type F=typeof f; const g:F=():number=>1; print(g());',{'lib.ets':'export function f():number{return 1;}'}));
test('checker: upstream errors short circuit type tables',()=>{for(const source of ['import "./absent";','const x=;','print(missing);']){const g=run(fixture(source),1);assert.equal(g.files.length,0);assert.equal(g.symbolTypes.length,0);assert.ok(g.diagnostics.every((d:any)=>d.phase!=='checker'));}});
test('checker: Unicode CRLF positions survive',()=>{const g=error('const s="🙂";\r\nconst n:number="x";',/incompatible/);assert.equal(g.diagnostics[0].line,2);assert.equal(g.diagnostics[0].column,16);assert.equal(g.diagnostics[0].offset,'const s="🙂";\r\nconst n:number='.length);});
test('checker: cold/warm processes preserve complete typed output',()=>{const f=fixture('import {f} from "./lib"; const n=f(1);',{'lib.ets':'export function f(n:number):number{return n+1;}'});const first=run(f);const second=run(f);assert.deepEqual(second,first);writeFileSync(join(dirname(f.entry),'lib.ets'),'export function f(n:number):string{return "x";}');const third=run(f);assert.deepEqual(types(third,'CallExpression'),['string']);});
test('checker: real hello example checks natively',()=>{const g=check(readFileSync(join(root,'examples/hello.ets'),'utf8'));assert.ok(types(g,'CallExpression').includes('number'));});

test('checker: interface construction is stopped by binding',()=>{const g=run(fixture('interface I{x:number;} new I();'),1);assert.equal(g.diagnostics[0].phase,'binder');assert.equal(g.files.length,0);});

test('checker: increment expression is actually checked',()=>error('for(let i=0;i<3;i="x"){}',/incompatible/));
test('checker: receiver writes are checked inside constructor',()=>check('class C{x:number; constructor(x:number){this.x=x;}} let c=new C(1); c.x=2;'));
test('checker: mutating method requires mutable receiver',()=>error('class C{x:number=0; set():void{this.x=1;}} const c=new C(); c.set();',/inmutable/));
test('checker: array pop returns void as in stage zero',()=>error('let a=[1]; const n=a.pop();',/void/));
test('checker: string includes keeps the required offset parameter',()=>{check('print("abc".includes("b",0));');error('print("abc".includes("b"));',/Aridad/);});
test('checker: join only supports string elements',()=>error('const a=[1]; print(a.join(","));',/miembro/));
test('checker: no string index writes',()=>error('let s="abc"; s[0]="x";',/string por índice/));
test('checker: class name is not a runtime value',()=>error('class C{} const c=C;',/requiere new/));
test('checker: overload context does not impose the first array element type',()=>{const g=check('function f(x:number[]):number{return 1;} function f(x:string[]):string{return "x";} const s=f(["x"]);');assert.deepEqual(types(g,'CallExpression'),['string']);});
test('checker: dotted typeof remains a parser limitation',()=>{const g=run(fixture('import * as ns from "./lib"; type F=typeof ns.f;',{'lib.ets':'export function f():number{return 1;}'}),1);assert.equal(g.diagnostics[0].phase,'parser');assert.equal(g.files.length,0);});
test('checker: unsupported ownership annotation is explicit',()=>error('class C{} const c:ptr<C>=new C();'.replace('>=','> ='),/pendiente/));
test('checker: captured local escape checking is explicitly pending',()=>error('function f():()=>number{const x=1; return ():number=>x;}',/captura/));

for(const name of ['primitives','arithmetic','strings','function','forward','recursive','returns','void','arrays','inferredArray','tuple','alias','satisfies','cast','template','interface','class','constructor','static','generic','numeric'])test(`checker differential stage zero accepts ${name}`,()=>{
 const ast=new Parser(new Lexer(valid[name]).tokenize()).parseProgram(); const reference=new TypeChecker(); reference.check(ast); check(valid[name]);
});
for(const name of ['variable','assignment','constant','return','bareReturn','arity','argument','notCallable','member','array','emptyArray','interfaceMissing','interfaceExtra','private','staticReceiver','constructorType','range','signedRange'])test(`checker differential stage zero rejects ${name}`,()=>{
 const [,source]=invalid.find(([n])=>n===name)!;
 assert.throws(()=>{const ast=new Parser(new Lexer(source).tokenize()).parseProgram();new TypeChecker().check(ast);},DiagnosticError);
 run(fixture(source),1);
});
for(const [source,expected]of [['const x=1+2;','number'],['const x="a"+1;','string'],['const x=true;','boolean'],['const x=[1,2];','number[]'],['const x=(n:number)=>n+1;','(number)=>number']])test(`checker differential inferred type ${expected}`,()=>{
 const ast=new Parser(new Lexer(source).tokenize()).parseProgram();const reference=new TypeChecker();reference.check(ast);
 const declaration=ast.statements[0];assert.equal(declaration.kind,'VariableDeclaration');if(declaration.kind!=='VariableDeclaration')throw new Error('variable');
 assert.equal(reference.typeOf(declaration.initializer),expected); const g=check(source);const sid=g.binding.symbols.findIndex((s:any)=>s.name==='x');assert.equal(g.symbolTypes[sid],expected);
});

// Preserve observed divergences explicitly: parity is not claimed for these cases.
for(const name of ['typeof','genericArray'])test(`checker known stage-zero limitation: ${name}`,()=>{
 assert.throws(()=>{const ast=new Parser(new Lexer(valid[name]).tokenize()).parseProgram();new TypeChecker().check(ast);},DiagnosticError); check(valid[name]);
});
for(const name of ['readonly','callRange'])test(`checker stricter native validation: ${name}`,()=>{
 const [,source]=invalid.find(([n])=>n===name)!;const ast=new Parser(new Lexer(source).tokenize()).parseProgram();new TypeChecker().check(ast);run(fixture(source),1);
});
test('checker: qualified homonyms remain distinct in one annotation',()=>{const g=check('import * as a from "./a"; import * as b from "./b"; const c:a.C|b.C=new a.C();',{'a.ets':'export class C{x:number=1;}','b.ets':'export class C{x:number=1;}'});const sid=g.binding.symbols.findIndex((s:any)=>s.name==='c');const union=g.symbolTypes[sid].split('|');assert.equal(union.length,2);assert.notEqual(union[0],union[1]);});

test('checker: instantiated generic signature is preserved for future codegen',()=>{const g=check('function id<T>(x:T):T{return x;} const n=id(1);');const file=g.files[0];const call=file.ast.nodes.findIndex((n:any)=>n.kind==='CallExpression');assert.equal(file.signatures[call],'(number)=>number');assert.equal(file.selectedModules[call],0);});
