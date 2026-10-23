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
 object:'const x={a:1};',
 out:'function f(out x:number):void{x=1;}',
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
test('checker: standalone ownership allocation is supported',()=>check('class C{} const c:ptr<C> = new C();'));
test('checker: reader captures now pass by value',()=>{const g=check('function f():()=>number{const x=1; return ():number=>x;}');assert.equal(g.captures[0].mode,'value');});

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

const box='class Box{value:number=1;} ';
const safetyValid:Record<string,string>={
 move:box+'let p:ptr<Box> = new Box(); const q:ptr<Box> = move(p); print(q.value);',
 reinitialize:box+'let p:ptr<Box> = new Box(); const q=move(p); p=new Box(); print(p.value);',
 branchReturn:box+'function f(p:ptr<Box>,b:boolean):number{if(b){const q=move(p); return q.value;} return p.value;}',
 branchReinit:box+'function f(p:ptr<Box>,b:boolean):number{if(b){const q=move(p); p=new Box();}return p.value;}',
 trueBranch:box+'let p:ptr<Box> = new Box(); if(false){const q=move(p);} print(p.value);',
 loopReinit:box+'let p:ptr<Box> = new Box(); let i=0; while(i<2){const q=move(p);p=new Box();i+=1;}print(p.value);',
 breakOnce:box+'let p:ptr<Box> = new Box(); while(true){const q=move(p);break;}',
 borrowedParameter:box+'function f(b:ref<Box>):void{b.value=2;} let b=new Box();f(b);',
 sharedParameter:box+'function f(b:constRef<Box>):number{return b.value;} const b=new Box();print(f(b));',
 localBorrow:box+'function f():void{let b=new Box(); const r:ref<Box> = ref(b); r.value=2;print(r.value);}',
 nll:box+'function f():void{let b=new Box();const a=ref(b);print(a.value);const c=ref(b);print(c.value);}',
 unusedBorrows:box+'function f():void{let b=new Box();const a=ref(b);const c=ref(b);}',
 sharedBorrows:box+'function f():void{let b=new Box();const a=constRef(b);const c=constRef(b);print(a.value+c.value);}',
 separateBorrowRoots:box+'function f():void{let b=new Box();let c=new Box();const a=ref(b);const d=ref(c);print(a.value+d.value);}',
 readonly:'let a:readonly number[]=[1];print(a[0]);',
 constOwner:box+'const p:constPtr<Box> = new Box();print(p.value);',
 localClosure:'function f():number{let x=0;const g=():number=>{x+=1;return x;};return g();}',
 returnedReader:'function f(x:number):()=>number{return ():number=>x;}',
 returnedReaderArray:'type Reader=()=>number;function f(x:number):Reader[]{const a:Reader[]=[():number=>x];return a;}',
 globalClosure:'let x=0;function f():()=>number{return ():number=>{x+=1;return x;};}',
 shadowClosure:'function f():()=>number{let x=0;const bad=():number=>{x+=1;return x;};{const bad=():number=>7;return bad;}}',
 fullRoutes:'function f(b:boolean):number{if(b)return 1;return 2;}',
 endless:'function f():number{while(true){}}',
 loopReturn:'function f():number{while(true){return 1;}}',
 unreachable:'function f():number{return 1;print(2);}',
};
for(const[name,source]of Object.entries(safetyValid))test(`native safety accepts ${name}`,()=>check(source));
const safetyInvalid:[string,string,RegExp][]=[
 ['useMoved',box+'let p:ptr<Box> = new Box(); const q=move(p);print(p.value);',/E4102/],
 ['doubleMove',box+'let p:ptr<Box> = new Box(); const q=move(p);const r=move(p);',/E4102/],
 ['copyOwner',box+'let p:ptr<Box> = new Box(); const q=p;',/E4101/],
 ['movePlain','let n=1;move(n);',/E4100/],
 ['maybeMove',box+'function f(p:ptr<Box>,b:boolean):number{if(b){const q=move(p);}return p.value;}',/E4103/],
 ['bothMove',box+'function f(p:ptr<Box>,b:boolean):number{if(b){const q=move(p);}else{const r=move(p);}return p.value;}',/E4102/],
 ['loopMove',box+'function f(p:ptr<Box>,b:boolean):number{while(b){const q=move(p);}return p.value;}',/E4103/],
 ['loopContinue',box+'function f(p:ptr<Box>,b:boolean):void{while(b){const q=move(p);continue;}}',/E4103/],
 ['zeroIteration',box+'function f(p:ptr<Box>,b:boolean):number{while(b){const q=move(p);break;}return p.value;}',/E4103/],
 ['argumentOrder',box+'function f(a:ptr<Box>,b:number):void{} let p:ptr<Box> = new Box(); f(move(p),p.value);',/E4102/],
 ['copyArgument',box+'function f(a:ptr<Box>):void{} let p:ptr<Box> = new Box(); f(p);',/E4101/],
 ['borrowField',box+'class C{b:ref<Box>;} ',/E4203/],
 ['borrowReturn',box+'function f(b:ref<Box>):ref<Box>{return b;}',/E4203/],
 ['borrowArray',box+'function f():void{const a:ref<Box>[]=[];}',/E4203/],
 ['borrowGlobal',box+'let b=new Box();const r=ref(b);',/E4203/],
 ['borrowTemporary',box+'function f():void{const r=ref(new Box());}',/E4208/],
 ['mutableConst',box+'function f(b:ref<Box>):void{} const b=new Box();f(b);',/E4208/],
 ['aliasArguments',box+'function f(a:ref<Box>,b:constRef<Box>):void{} let b=new Box();f(b,b);',/E4206/],
 ['overlap',box+'function f():void{let b=new Box();const a=ref(b);const c=ref(b);print(a.value+c.value);}',/E4206/],
 ['moveBorrowed',box+'function f():void{let p:ptr<Box> = new Box();const a=constRef(p);const q=move(p);print(a.value);}',/E4207/],
 ['writeBorrowed',box+'function f():void{let b=new Box();const a=constRef(b);b.value=2;print(a.value);}',/E4207/],
 ['readonlyWrite','let a:readonly number[]=[1];a[0]=2;',/E4300/],
 ['constOwnerWrite',box+'let p:constPtr<Box> = new Box();p.value=2;',/E4300/],
 ['memoryCast',box+'let b=new Box();const p=b as ptr<Box>;',/E4301/],
 ['closureBorrow',box+'function f(b:constRef<Box>):()=>number{return ():number=>b.value;}',/E4209/],
 ['closureOwner',box+'function f(p:ptr<Box>):()=>number{return ():number=>p.value;}',/E4209/],
 ['directEscape','function f():()=>number{let x=0;return ():number=>{x+=1;return x;};}',/E4210/],
 ['aliasEscape','function f():()=>number{let x=0;const g=():number=>{x+=1;return x;};const h=g;return h;}',/E4210/],
 ['arrayEscape','type Reader=()=>number;function f():Reader[]{let x=0;const g=():number=>{x+=1;return x;};return [g];}',/E4210/],
 ['pushEscape','type Reader=()=>number;function f():Reader[]{let x=0;const g=():number=>{x+=1;return x;};let a:Reader[]=[];a.push(g);return a;}',/E4210/],
 ['transitiveEscape','function f():()=>number{let x=0;const g=():number=>{x+=1;return x;};return ():number=>g();}',/E4210/],
 ['globalEscape','let global:()=>number=():number=>1;function f():void{let x=0;const g=():number=>{x+=1;return x;};global=g;}',/E4210/],

 ['indirectTdz','const n=f();let x=1;function f():number{return x;}',/E4001/],
 ['defaultTdz','function f(x:number=y,y:number=1):number{return x;}',/E4001/],
 ['creationTdz','function f():void{const g=():number=>x;let x=1;print(g());}',/E4001/],
 ['missingRoute','function f(b:boolean):number{while(b){return 1;}}',/rutas/],
];
for(const[name,source,pattern]of safetyInvalid)test(`native safety rejects ${name}`,()=>error(source,pattern));

for(const[name,source]of Object.entries({
 function:'class Hidden{} export function f(x:Hidden):void{}',
 field:'class Hidden{} export interface Public{value:Hidden;}',
 method:'class Hidden{} export interface Public{get():Hidden;}',
 alias:'type Hidden=number;export type Public=Hidden;',
 inferred:'class Hidden{} export const value=new Hidden();',
 array:'class Hidden{} export function f():Hidden[]{return [];}',
 aliasReturn:'type Hidden=number;export function f():Hidden{return 1;}',
}))test(`native public surface rejects private ${name}`,()=>error(source,/E4401/));
test('native public surface permits an explicitly exported alias identity',()=>check('class Hidden{} export {Hidden as Public};export function f():Hidden{return new Hidden();}'));
test('native public surface excludes private implementation fields',()=>check('class Hidden{} export class Public{private hidden:Hidden=new Hidden();get():number{return 1;}}'));
test('native public surface checks unused overload returns',()=>error('class Hidden{} export function f(x:number):number{return x;}export function f(x:string):Hidden{return new Hidden();}',/E4401/));
test('native public surface validates imported public types',()=>check('import {Box} from "./lib";export function f():Box{return new Box();}',{'lib.ets':'export class Box{value:number=1;}'}));

test('native safety: mutable scalar references write their referent',()=>check('function inc(x:ref<number>):void{x+=1;}function f():void{let n=1;const r=ref(n);r=2;inc(r);print(r);}'));
test('native safety: borrow of temporary call argument is rejected',()=>error(box+'function f(x:ref<Box>):void{}f(new Box());',/E4208/));
test('native safety: const borrow cannot become mutable',()=>error(box+'function f(x:constRef<Box>):void{const r=ref(x);}',/E4300|incompatible/));
test('native safety: readonly array cannot be mutated by a method',()=>error('let a:readonly number[]=[1];a.push(2);',/E4300/));
test('native safety: borrowed array element mutation remains allowed',()=>check('function f(a:ref<number[]>):void{a[0]=2;a.push(3);}let a=[1];f(a);'));
test('native safety: explicit transfer to an owning parameter',()=>check(box+'function f(p:ptr<Box>):number{return p.value;}let p:ptr<Box> = new Box();print(f(move(p)));'));
test('native safety: fresh allocation can initialize owning parameter',()=>check(box+'function f(p:ptr<Box>):number{return p.value;}print(f(new Box()));'));
test('native safety: factory returns ownership explicitly',()=>check(box+'function make():ptr<Box>{let p:ptr<Box> = new Box();return move(p);}let p=make();print(p.value);'));
test('native safety: shadowed move is an ordinary function',()=>check('function move(n:number):number{return n;}const n=move(1);print(n);'));
test('native safety: shadowed ref is an ordinary function',()=>check('function ref(n:number):number{return n;}const n=ref(1);print(n);'));
test('native safety: owner aggregate elements require explicit transfer',()=>error(box+'let p:ptr<Box> = new Box();const a:ptr<Box>[]=[p];',/E4101/));
test('native safety: borrowed return inside a stored callable is rejected',()=>error(box+'type F=(x:ref<Box>)=>ref<Box>;function use(f:F):void{}',/E4203/));
test('native safety: field initializer participates in TDZ',()=>error('class C{x:number=late;}const c=new C();let late=1;',/E4001/));
test('native safety: direct calls propagate global ownership state',()=>error(box+'let p:ptr<Box> = new Box();function take():void{const q=move(p);}take();print(p.value);',/E4102/));
test('native safety: hidden callee reads retain the original file',()=>{const g=error('const n=f();let late=1;function f():number{return late;}',/E4001/);assert.equal(g.diagnostics[0].file.endsWith('/main.ets'),true);});
test('native safety: branch with transfer and return does not poison continuation',()=>check(box+'function f(p:ptr<Box>,b:boolean):number{if(b){const q=move(p);return 1;}return p.value;}'));
test('native safety: short circuit may transfer ownership',()=>error(box+'function consume(p:ptr<Box>):boolean{return true;}function f(p:ptr<Box>,b:boolean):number{const ok=b&&consume(move(p));return p.value;}',/E4103/));
test('native safety: constant short circuit skips ownership transfer',()=>check(box+'function consume(p:ptr<Box>):boolean{return true;}let p:ptr<Box> = new Box();const ok=false&&consume(move(p));print(p.value);'));
test('native safety: aliases do not erase closure risk through cycles',()=>error('function f():()=>number{let x=0;const risky=():number=>{x+=1;return x;};let a:()=>number=():number=>1;let b=a;a=b;b=risky;return a;}',/E4210/));
test('native safety: unsafe array extraction retains provenance',()=>error('type Reader=()=>number;function f():Reader{let x=0;const a:Reader[]=[():number=>{x+=1;return x;}];return a[0];}',/E4210/));
test('native safety: callback field of a returned interface retains provenance',()=>error('interface I{run:()=>number;}function f():I{let x=0;const g=():number=>{x+=1;return x;};const i:I={run:g};return i;}',/E4210/));
test('native safety: local closure captures callee aliases by identity',()=>{const g=check('function f(x:number):()=>number{const a=():number=>x;return ():number=>a();}');assert.equal(g.captures.length,2);assert.ok(g.captures.every((c:any)=>c.mode==='value'));});
test('native safety: nested mutation marks all transported captures as references',()=>error('function f():()=>number{let x=0;let y=0;return ():number=>{const inc=():number=>{x+=1;y+=1;return x+y;};return inc();};}',/E4210/));
test('native safety: local mutation still records reference capture without escape',()=>{const g=check('function f():number{let x=0;const inc=():number=>{x+=1;return x;};return inc();}');assert.equal(g.captures[0].mode,'reference');});
test('native safety: NLL ranges distinguish uses on the same line',()=>{const g=check(safetyValid.nll);assert.equal(g.borrows.length,2);assert.ok(g.borrows[0].end<g.borrows[1].begin);});
test('native safety: a shared lease blocks a later mutable call',()=>error(box+'function consume(x:ref<Box>):void{}function f():void{let b=new Box();const r=constRef(b);consume(b);print(r.value);}',/E4207/));
test('native public surface: nominal type inside callback return is validated',()=>error('class Hidden{}export function f():()=>Hidden{return ():Hidden=>new Hidden();}',/E4401/));
test('native public surface: type-only reexport provides public identity',()=>check('class Hidden{}export type {Hidden as Public};export function f():Hidden{return new Hidden();}'));
test('native public surface: barrel cannot hide a private type leak',()=>error('import {make} from "./barrel";print(make().value);',/E4401/,{'barrel.ets':'export {make} from "./lib";','lib.ets':'class Hidden{value:number=1;}export function make():Hidden{return new Hidden();}'}));
test('native public surface: identical type names in another module do not publish a private origin',()=>error('import {Public} from "./a";export class Hidden{}',/E4401/,{'a.ets':'class Hidden{}export interface Public{value:Hidden;}'}));
test('native safety: field initializer may read a global initialized before construction',()=>check('class C{x:number=late;}let late=1;const c=new C();print(c.x);'));
test('native effects: reassigned safe callables are resolved',()=>check('let f:()=>number=():number=>1;const g=():number=>2;f=g;print(f());'));
test('native safety: interface method calls do not dereference a missing body',()=>check('interface I{get():number;}function f(i:I):number{return i.get();}'));
for(const name of ['move','borrowedParameter','sharedParameter','sharedBorrows','localClosure','returnedReader','globalClosure','fullRoutes'])test(`native safety differential accepts ${name}`,()=>{const source=safetyValid[name];const ast=new Parser(new Lexer(source).tokenize()).parseProgram();new TypeChecker().check(ast);check(source);});
for(const name of ['useMoved','doubleMove','movePlain','maybeMove','borrowField','borrowReturn','overlap','closureBorrow','directEscape','aliasEscape'])test(`native safety differential rejects ${name}`,()=>{const [,source]=safetyInvalid.find(([key])=>key===name)!;assert.throws(()=>{const ast=new Parser(new Lexer(source).tokenize()).parseProgram();new TypeChecker().check(ast);},DiagnosticError);run(fixture(source),1);});
test('native safety: unions cannot hide a borrowed lifetime',()=>error(box+'function f():void{let b=new Box();const r:ref<Box>|number=ref(b);}',/E4203/));
test('native safety: generic substitution cannot hide owner copying',()=>error(box+'function id<T>(x:T):T{return x;}let p:ptr<Box> = new Box();const q=id(move(p));',/genérica con contrato/));

for(const name of ['nll','unusedBorrows'])test(`native safety known stage-zero line-granularity limitation: ${name}`,()=>{assert.throws(()=>{const ast=new Parser(new Lexer(safetyValid[name]).tokenize()).parseProgram();new TypeChecker().check(ast);},DiagnosticError);check(safetyValid[name]);});
test('native safety: default arguments are evaluated at the actual call site',()=>error('const n=f();let late=1;function f(x:number=late):number{return x;}',/E4001/));
test('native safety: omitted defaults may read an already initialized global',()=>check('let late=1;const n=f();function f(x:number=late):number{return x;}'));
test('native safety: write before let initialization remains TDZ',()=>error('x=1;let x=2;',/E4001/));
test('native safety: callee return paths participate in caller ownership join',()=>error(box+'let p:ptr<Box> = new Box();function consume(b:boolean):void{if(b){const q=move(p);return;}}consume(true);print(p.value);',/E4103|E4102/));
test('native safety: a direct callee cannot mutate a borrowed global',()=>error(box+'let b=new Box();function write():void{b.value=2;}function f():void{const r=constRef(b);write();print(r.value);}',/E4207/));
test('native safety: a read-only closure snapshot is independent of a later loan',()=>check('function f():number{let x=1;const g=():number=>x;const r=ref(x);print(g());return r;}'));
test('native safety: generic function arrays preserve callable element identity',()=>check('type Reader=()=>number;function first<T>(xs:T[]):T{return xs[0];}const xs:Reader[]=[():number=>1];const f=first(xs);print(f());'));

test('native safety: known push may retain a reference closure within its own local scope',()=>check('type Reader=()=>number;function f():number{let x=0;const g=():number=>{x+=1;return x;};let a:Reader[]=[];a.push(g);const h=a[0];return h();}'));

test('native effects: known callback writes cannot bypass an active loan',()=>error(box+'let b=new Box();const write=():number=>{b.value=2;return 2;};function consume(cb:()=>number):void{print(cb());}function f():void{const r=constRef(b);consume(write);print(r.value);}',/E4207/));

// Summary and call-site regressions: these intentionally extend v63.
const effectValid:Record<string,string>={
 ephemeral:'function consume(f:()=>number):void{print(f());}function f():void{let x=0;consume(():number=>{x+=1;return x;});}f();',
 alias:'const first=():number=>1;const second=first;print(second());',
 branchTargets:'const a=():number=>1;const b=():number=>2;let f=true?a:b;print(f());',
 arrayTargets:'type Reader=()=>number;let a:Reader[]=[():number=>1];const f=a[0];print(f());',
 factory:'function make():()=>number{return ():number=>1;}const f=make();print(f());',
 identity:'function identity(f:()=>number):()=>number{return f;}function use():number{let n=0;const f=():number=>{n+=1;return n;};const g=identity(f);return g();}print(use());',
 localCarrier:'type Reader=()=>number;function consume(a:Reader[]):number{const f=a[0];return f();}function use():number{let n=0;return consume([():number=>{n+=1;return n;}]);}print(use());',
 defaultCallback:'function consume(f:()=>number=():number=>1):number{return f();}print(consume());',
 forwardEffects:'function a():number{return b();}function b():number{return 1;}print(a());',
 unrelatedOwner:box+'let p:ptr<Box> = new Box();function count(n:number):number{if(n==0)return 0;return count(n-1);}print(count(2));print(p.value);',
 recursiveOwner:box+'function consume(p:ptr<Box>,n:number):void{if(n==0)return;consume(move(p),n-1);}let p:ptr<Box> = new Box();consume(move(p),2);',
 mutualOwner:box+'let p:ptr<Box> = new Box();function a(n:number):number{if(n==0)return 0;return b(n-1);}function b(n:number):number{if(n==0)return 0;return a(n-1);}print(a(2));print(p.value);',
 recursiveBorrow:box+'function visit(b:constRef<Box>,n:number):number{if(n==0)return b.value;return visit(b,n-1);}let b=new Box();print(visit(b,2));',
 borrowerWrite:box+'function write(b:ref<Box>):void{b.value=2;}let b=new Box();write(b);',
 borrowerAlias:box+'function write(b:ref<Box>):void{const r=ref(b);r.value=2;}let b=new Box();write(b);',
 nestedBorrow:box+'function write(b:ref<Box>):void{b.value=2;}function outer(b:ref<Box>):void{write(b);}let b=new Box();outer(b);',
 readCallback:'let n=1;function apply(f:()=>number):number{return f();}function use():number{const r=constRef(n);const x=apply(():number=>n);return x+r;}print(use());',
 protectedUnrelated:'let n=1;let other=2;function apply(f:()=>number):number{return f();}function use():number{const r=ref(n);const x=apply(():number=>other);return x+r;}print(use());',
 interfaceTarget:'interface I{read():number;}const i:I={read:():number=>1};print(i.read());',
 interfaceField:'interface I{read:()=>number;}const i:I={read:():number=>1};const f=i.read;print(f());',
 transitiveUse:'function inner(f:()=>number):number{return f();}function outer(f:()=>number):number{return inner(f);}function use():number{let n=0;return outer(():number=>{n+=1;return n;});}print(use());',
 nestedUse:'function apply(f:()=>number):number{const g=():number=>f();return g();}function use():number{let n=0;return apply(():number=>{n+=1;return n;});}print(use());',
};
for(const[name,source]of Object.entries(effectValid))test(`native effects accepts ${name}`,()=>check(source));
const effectInvalid:[string,string,RegExp][]=[
 ['retained','let saved:()=>number=():number=>1;function keep(f:()=>number):void{saved=f;}function use():void{let n=0;keep(():number=>{n+=1;return n;});}',/E4210/],
 ['transitiveRetained','let saved:()=>number=():number=>1;function keep(f:()=>number):void{saved=f;}function outer(f:()=>number):void{keep(f);}function use():void{let n=0;outer(():number=>{n+=1;return n;});}',/E4210/],
 ['nestedRetained','let saved:()=>number=():number=>1;function keep(f:()=>number):void{const g=():void=>{saved=f;};g();}function use():void{let n=0;keep(():number=>{n+=1;return n;});}',/E4210/],
 ['identityEscape','function identity(f:()=>number):()=>number{return f;}function use():()=>number{let n=0;return identity(():number=>{n+=1;return n;});}',/E4210/],
 ['globalOwnerTarget',box+'let p:ptr<Box> = new Box();let f=():number=>1;const g=():number=>{const q=move(p);return q.value;};f=g;print(f());print(p.value);',/E4102|E4103/],
 ['targetLoan','let n=1;let f=():number=>1;const write=():number=>{n=2;return n;};f=write;function use():number{const r=constRef(n);const x=f();return r+x;}',/E4207/],
 ['borrowCallback',box+'let b=new Box();function apply(x:ref<Box>,f:()=>number):number{return f()+x.value;}const write=():number=>{b.value=2;return 1;};print(apply(b,write));',/E4207/],
 ['sharedBorrowCallback',box+'let b=new Box();function apply(x:constRef<Box>,f:()=>number):number{return f()+x.value;}const write=():number=>{b.value=2;return 1;};print(apply(b,write));',/E4207/],
 ['nestedBorrowCallback',box+'let b=new Box();function apply(x:ref<Box>,f:()=>number):number{return f()+x.value;}function outer(x:ref<Box>,f:()=>number):number{return apply(x,f);}const write=():number=>{b.value=2;return 1;};print(outer(b,write));',/E4207/],
 ['hiddenRead','const read=():number=>n;const f=read;print(f());let n=1;',/E4001/],
 ['factoryRead','function make():()=>number{return ():number=>n;}const f=make();print(f());let n=1;',/E4001/],
 ['recursiveGlobalMove',box+'let p:ptr<Box> = new Box();function f(n:number):void{if(n==0){const q=move(p);return;}f(n-1);}f(2);print(p.value);',/E4102|E4103/],
 ['recursiveOpaque','function apply(f:()=>number,n:number):number{if(n==0)return f();return apply(f,n-1);}',/E4104/],
];
for(const[name,source,pattern]of effectInvalid)test(`native effects rejects ${name}`,()=>error(source,pattern));
function effect(g:any,name:string){const s=g.effects.find((s:any)=>g.binding.files[s.module].nodes[s.node].name===name);assert.ok(s,`missing summary ${name}`);return s;}
function names(g:any,ids:number[]){return ids.map(i=>g.binding.symbols[i].name);}
test('native effects exposes direct and transitive symbol effects',()=>{
 const g=check('let n=1;function write():void{n=2;}function outer():void{write();}outer();');
 assert.ok(names(g,effect(g,'write').writes).includes('n'));assert.ok(names(g,effect(g,'outer').writes).includes('n'));
});
test('native effects distinguishes invoked, retained and returned callback parameters',()=>{
 const g=check('let saved:()=>number=():number=>1;function invoke(cb:()=>number):number{return cb();}function keep(cb:()=>number):void{saved=cb;}function identity(cb:()=>number):()=>number{return cb;}');
 assert.deepEqual(names(g,effect(g,'invoke').invokes),['cb']);assert.deepEqual(effect(g,'invoke').retains,[]);
 assert.ok(names(g,effect(g,'keep').retains).includes('cb'));assert.ok(names(g,effect(g,'identity').returned).includes('cb'));
});
test('native effects marks both members of a recursive component',()=>{const g=check('function a(n:number):number{if(n==0)return 0;return b(n-1);}function b(n:number):number{if(n==0)return 0;return a(n-1);}');assert.equal(effect(g,'a').recursive,true);assert.equal(effect(g,'b').recursive,true);});
test('native effects keeps callback borrow obligations',()=>{const g=check(box+'function apply(b:constRef<Box>,cb:()=>number):number{return cb()+b.value;}');const s=effect(g,'apply');assert.ok(s.borrows.some((b:any)=>g.binding.symbols[b.root].name==='b'&&b.mode==='constRef'));});
test('native effects preserves aliases and origin files across modules',()=>{
 const g=error('import {write as f} from "./barrel";let n=f();',/E4001/,{'barrel.ets':'export {write} from "./lib";','lib.ets':'export function write():number{return value;}export const early=write();let value=1;'});assert.ok(g.diagnostics.some((d:any)=>d.file.endsWith('/lib.ets')));
});
test('native effects summaries repeat unchanged across process/cache reuse',()=>{const f=fixture('function apply(cb:()=>number):number{return cb();}print(apply(():number=>1));');assert.deepEqual(run(f),run(f));});
test('native effects propagates borrow obligations through a wrapper',()=>{
 const g=check(box+'function inner(b:constRef<Box>,cb:()=>number):number{return cb()+b.value;}function outer(b:constRef<Box>,cb:()=>number):number{return inner(b,cb);}');
 const s=effect(g,'outer');assert.ok(s.borrows.some((b:any)=>g.binding.symbols[b.root].name==='b'&&g.binding.symbols[b.callback].name==='cb'));
});
test('native effects propagates callback obligations under a wrapper local loan',()=>{
 const g=check('let n=1;function inner(cb:()=>number):number{return cb();}function outer(cb:()=>number):number{const r=constRef(n);const value=inner(cb);return value+r;}');
 const s=effect(g,'outer');assert.ok(s.borrows.some((b:any)=>g.binding.symbols[b.root].name==='n'));
});
test('native effects keeps transitive callback invocation symbolic',()=>{
 const g=check('function inner(cb:()=>number):number{return cb();}function outer(cb:()=>number):number{return inner(cb);}');assert.deepEqual(names(g,effect(g,'outer').invokes),['cb']);
});
test('native effects rejects a recursive wrapper around a symbolic callback',()=>error('function inner(cb:()=>number):number{return cb();}function outer(cb:()=>number,n:number):number{if(n==0)return inner(cb);return outer(cb,n-1);}',/E4104/));
test('native effects composes summaries beyond the precise-call expansion limit',()=>{
 const source=Array.from({length:80},(_,i)=>`function f${i}():number{return ${i===79?'1':`f${i+1}()`};}`).join('');const g=check(source+'print(f0());');assert.equal(effect(g,'f0').unknown,false);
});
test('native effects resolves imported callback aliases',()=>check('import {reader as f} from "./barrel";print(f());',{'barrel.ets':'export {reader} from "./lib";','lib.ets':'export const reader=():number=>1;'}));
test('native effects joins alternative ownership effects conservatively',()=>error(box+'let p:ptr<Box> = new Box();const a=():number=>1;const b=():number=>{const q=move(p);return q.value;};const f=true?a:b;print(f());print(p.value);',/E4103|E4102/));
test('native effects preserves opaque interface callback retention',()=>error('interface I{keep(cb:()=>number):void;}function use(i:I):void{let n=0;i.keep(():number=>{n+=1;return n;});}',/E4210/));

// Native numeric coverage: values must be checked in the C++ frontend, not
// accepted merely because the lexer retained an opaque raw token.
for(const [name,source] of Object.entries({
 hex:'const a:u8=0xff;const b:i16=-0x8000;',
 binary:'const a:u8=0b11111111;',
 octal:'const a:u16=0o177777;',
 separators:'const a:u32=4_294_967_295;',
 fractions:'const a:f32=1.5;const b:f64=2.25;const c:i16=2.0;',
}))test(`native numeric accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 hexOverflow:'const a:u8=0x100;',
 negativeUnsigned:'const a:u16=-0o1;',
 fractionalInteger:'const a:i32=1.5;',
 badSeparator:'const a=1__0;',
 trailingSeparator:'const a=1_;',
 prefixSeparator:'const a=0x_ff;',
 missingDigits:'const a=0x;',
 nonfinite:`const a:f64=${'9'.repeat(400)};`,
 untypedNonfinite:`const a=${'9'.repeat(400)};`,
 f32Overflow:`const a:f32=${'9'.repeat(40)};`,
 floatBits:'let a:f32=1.5;print(a&1);',
 floatComplement:'let a:f64=1.5;print(~a);',
}))test(`native numeric rejects ${name}`,()=>error(source,/numérico|rango|enteros/));
for(const [left,right,expected] of [
 ['i8','i16','i32'],['i16','u32','u32'],['u32','i8','u32'],
 ['f32','i32','f32'],['i32','f64','f64'],['f32','number','number'],
] as const)test(`native numeric promotes ${left} plus ${right}`,()=>{
 const g=check(`let a:${left}=1;let b:${right}=2;const c=a+b;`);
 assert.deepEqual(types(g,'BinaryExpression'),[expected]);
});
test('native numeric promotes shift from left operand',()=>{
 const g=check('let a:i8=1;let b:u32=2;const c=a<<b;');
 assert.deepEqual(types(g,'BinaryExpression'),['i32']);
});
test('native numeric promotes unary narrow integer',()=>{
 const g=check('let a:u8=1;const b=-a;');
 assert.deepEqual(types(g,'UnaryExpression'),['i32']);
});

test('native satisfies preserves the expression type instead of the checked union',()=>{
 const g=check('const n=1;const x=n satisfies number|string;print(x+1);');
 assert.deepEqual(types(g,'SatisfiesExpression'),['number']);
});
test('native satisfies preserves concrete numeric type',()=>{
 const g=check('const n:i8=1;const x=n satisfies number;');
 assert.deepEqual(types(g,'SatisfiesExpression'),['i8']);
});
test('native satisfies still rejects incompatible operands',()=>error('const x=1 satisfies string;',/incompatible/));
test('native numeric preserves legacy number shift result',()=>{
 const g=check('let a:i8=1;const c=a<<2;');
 assert.deepEqual(types(g,'BinaryExpression'),['number']);
});

for(const [target,raw,expected] of [
 ['u64','18446744073709551615','18446744073709551615'],
 ['i64','9223372036854775807','9223372036854775807'],
 ['i64','-9223372036854775808','-9223372036854775808'],
 ['u64','0xffff_ffff_ffff_ffff','18446744073709551615'],
 ['i64','-0x8000000000000000','-9223372036854775808'],
 ['u64','0o1777777777777777777777','18446744073709551615'],
 ['u64','0b'+'1'.repeat(64),'18446744073709551615'],
 ['u64','9_007_199_254_740_993','9007199254740993'],
 ['u64','-0','0'],
] as const)test(`native exact64 ${target} ${raw}`,()=>{
 const g=check(`const x:${target}=${raw};print(x);`);
 assert.ok(g.files[0].exactIntegers.includes(expected));
});
for(const [target,raw] of [
 ['u64','18446744073709551616'],['i64','9223372036854775808'],
 ['i64','-9223372036854775809'],['u64','-1'],['i64','0xffffffffffffffff'],
 ['u64','0x10000000000000000'],['u64','1.5'],
] as const)test(`native exact64 rejects ${target} ${raw}`,()=>error(`const x:${target}=${raw};`,/rango/));
test('native exact64 arithmetic and mixed comparisons preserve types',()=>{
 const g=check('let a:i64=9007199254740993;let b:u64=2;const x=a+b;const y=1+a;const z=a<9007199254740994;');
 assert.deepEqual(types(g,'BinaryExpression'),['u64','i64','boolean']);
 assert.ok(g.files[0].exactIntegers.includes('9007199254740994'));
});
test('native exact64 checks literal returns and defaults',()=>{
 const g=check('function f(x:u64=18446744073709551615):i64{return -9223372036854775808;}f();');
 assert.ok(g.files[0].exactIntegers.includes('-9223372036854775808'));
});
test('native exact64 rejects overflowing return literal',()=>error('function f():u64{return 18446744073709551616;}',/rango/));
test('native exact64 publishes instantiated call conversions',()=>{
 const g=check('function id<T>(x:T):T{return x;}const x=id<u64>(9007199254740993);');
 assert.ok(g.files[0].exactIntegers.includes('9007199254740993'));
 assert.ok(g.files[0].conversions.includes('u64'));
});
test('native numeric rejects narrow integer overflow in returns',()=>error('function f():i8{return 128;}',/rango/));

for(const [name,source] of Object.entries({
 primitive:'const a:u8[2]=[1,255];print(a.length);print(a[0]);',
 constant:'const N=2;const a:number[N]=[1,2];',
 aliasConstant:'const N=2;const M=N;const a:number[M]=[1,2];',
 aliasType:'type Pair=number[2];const a:Pair=[1,2];',
 nested:'const a:number[2][2]=[[1,2],[3,4]];print(a[0][1]);',
 genericElement:'function first<T>(x:T[2]):T{return x[0];}',
 exact64:'const a:u64[2]=[9007199254740993,18446744073709551615];',
 function:'function f(a:number[2]):number[2]{return a;}const b=f([1,2]);',
}))test(`native fixed arrays accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 length:'const a:number[2]=[1];',
 fractional:'const a:number[1.5]=[1];',
 zero:'const a:number[0]=[];',
 mutableSize:'let N=2;const a:number[N]=[1,2];',
 tooLarge:'const a:number[4294967296]=[1];',
 upperBound:'const a:number[2]=[1,2];print(a[0x2]);',
 lowerBound:'const a:number[2]=[1,2];print(a[-1]);',
 fractionalIndex:'const a:number[2]=[1,2];print(a[0.5]);',
 elementRange:'const a:u8[2]=[1,256];',
 borrowedElement:'class C{}function f(c:ref<C>):void{const a:ref<C>[1]=[c];}',
 ownersRemainChecked:'class C{}let p:ptr<C> = new C();const a:ptr<C>[1]=[p];',
 readonly:'const a:number[2]=[1,2];a[0]=2;',
}))test(`native fixed arrays rejects ${name}`,()=>run(fixture(source),1));
test('native fixed arrays preserve exact integer element metadata',()=>{
 const g=check('const a:u64[1]=[18446744073709551615];');
 assert.ok(g.files[0].exactIntegers.includes('18446744073709551615'));
});

for(const [name,source] of Object.entries({
 array:'const a=[1,2];for(const x of a){print(x);}',
 index:'const a=[1,2];for(const i in a){print(a[i]);}',
 string:'for(const c of "hello"){print(c);}',
 fixed:'const a:i16[2]=[1,2];for(const x of a){const y:i16=x;}',
 nested:'const a=[1,2];for(const x of a){for(const i in a){if(i==0)continue;break;}}',
 copy:'class C{n:number=1;}const a=[new C()];for(let c of a){c.n=2;}',
}))test(`native iteration accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 nonIterable:'for(const x of 1){}',
 mismatchedBinding:'for(const x:string of [1,2]){}',
 outsideScope:'for(const x of [1]){}print(x);',
 mutation:'let a=[1,2];for(const x of a){a.push(x);}',
 indirectMutation:'let a=[1,2];function f():void{a.push(3);}for(const x of a){f();}',
 maybeMoved:box+'let p:ptr<Box> = new Box();for(const x of [1]){const q=move(p);}print(p.value);',
 repeatedMove:box+'let p:ptr<Box> = new Box();for(const x of [1,2]){const q=move(p);}',
 closureEscape:'function f():()=>number{let n=0;const a=[():number=>{n+=1;return n;}];for(const cb of a){return cb;}return ():number=>0;}',
}))test(`native iteration rejects ${name}`,()=>run(fixture(source),1));
test('native iteration binding has resolved element type',()=>{
 const g=check('for(const x of ["a","b"]){print(x);}');
 const sid=g.binding.symbols.findIndex((s:any)=>s.name==='x');assert.equal(g.symbolTypes[sid],'string');
});

for(const [name,source] of Object.entries({
 array:'const [a,b]=[1,2];print(a+b);',
 object:'interface I{x:number;}const i:I={x:1};const {x:y}=i;print(y);',
 tuple:'const [a,b]=[1,"s"];print(a);print(b);',
 mutable:'let [a,b]=[1,2];a=3;b=4;',
 typed:'const [a:u8,b:u8]:u8[]=[1,255];',
 defaults:'const [a:number=1]=[];print(a);',
 inferredDefault:'const [a=1]=[];print(a);',
 earlierDefault:'const [a:number=1,b:number=a]=[];print(b);',
 class:'class C{x:number=1;}const c=new C();const {x:y}=c;print(y);',
 localReader:'function f():()=>number{const [x]=[1];return ():number=>x;}',
 empty:'const []:number[]=[1,2];',
}))test(`native destructuring accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 constBinding:'const [a]=[1];a=2;',
 incompatibleBinding:'const [a:string]=[1];',
 badDefault:'const [a:number="s"]=[];',
 noMember:'class C{x:number=1;}const c=new C();const {y}=c;',
 noArray:'const [a]=1;',
 tdz:'print(a);const [a]=[1];',
 laterDefault:'const [a:number=b,b:number=1]=[];',
 readonlyCapture:'function f():()=>number{let [x]=[1];return ():number=>{x+=1;return x;};}',
 closureCarrier:'function f():()=>number{let n=0;const [cb]=[():number=>{n+=1;return n;}];return cb;}',
}))test(`native destructuring rejects ${name}`,()=>run(fixture(source),1));
test('native destructuring publishes types for each binding',()=>{
 const g=check('const [a,b]=[1,"s"];');
 for(const [name,type] of [['a','number'],['b','string']]){const sid=g.binding.symbols.findIndex((s:any)=>s.name===name);assert.equal(g.symbolTypes[sid],type);}
});

for(const [name,source] of Object.entries({
 basic:'enum Color{Red,Green}const c:Color=Color.Green;print(c);',
 string:'enum Color{Red="red",Green="green"}const c:Color=Color.Red;const s:string=c;',
 numericConversion:'enum E{A=1,B=2}const n:number=E.A;',
 boundary:'enum E{A=2147483647}const c:E=E.A;',
 usingScalar:'using x=1;print(x);',
 usingOwner:box+'using p:ptr<Box> = new Box();print(p.value);',
 usingTransfer:box+'let p:ptr<Box> = new Box();using q=move(p);print(q.value);',
}))test(`native enums and using accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 enumOverflow:'enum E{A=2147483648}',
 enumImplicitOverflow:'enum E{A=2147483647,B}',
 enumFraction:'enum E{A=1.5}',
 enumHomonyms:'enum A{X}enum B{X}const n:A=B.X;',
 enumMissing:'enum E{A}const n=E.B;',
 enumWrite:'enum E{A}E.A=2;',
 usingImmutable:'using x=1;x=2;',
 usingCopy:box+'let p:ptr<Box> = new Box();using q=p;',
 usingMoved:box+'let p:ptr<Box> = new Box();using q=move(p);print(p.value);',
}))test(`native enums and using reject ${name}`,()=>run(fixture(source),1));
test('native enum identity survives import aliases',()=>check('import {E as F} from "./lib";const x:F=F.A;',{'lib.ets':'export enum E{A=2}'}));

for(const [name,source] of Object.entries({
 numeric:'function f(n:number):number{switch(n){case 0:return 1;default:return 2;}}',
 string:'function f(s:string):number{switch(s){case "x":return 1;default:return 2;}}',
 defaultFirst:'function f(n:number):number{switch(n){default:print(n);case 1:return 2;}}',
 fallthrough:'function f(n:number):number{switch(n){case 0:case 1:return 2;default:return 3;}}',
 loopContinue:'for(let i=0;i<3;i+=1){switch(i){case 0:continue;default:break;}print(i);}',
 enum:'enum E{A,B}function f(e:E):number{switch(e){case E.A:return 1;default:return 0;}}',
 nested:'switch(1){case 1:switch(2){case 2:break;default:break;}break;default:break;}',
 namedCapture:'function f():number{const n=1;function g():number{return n;}return g();}',
 namedMutable:'function f():number{let n=1;function g():number{n+=1;return n;}return g();}',
 namedReaderReturn:'function f():()=>number{const n=1;function g():number{return n;}return g;}',
}))test(`native switch and nested captures accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 missingReturn:'function f(n:number):number{switch(n){case 0:return 1;}}',
 breakNoReturn:'function f(n:number):number{switch(n){case 0:break;default:return 2;}}',
 duplicate:'switch(1){case 1:break;case 0x1:break;}',
 duplicateAlias:'const n=1;switch(1){case n:break;case 1:break;}',
 wrongLabel:'switch(1){case "x":break;}',
 dynamicLabel:'let n=1;switch(1){case n:break;}',
 continueOutside:'switch(1){case 1:continue;}',
 functionBoundary:'switch(1){case 1:function f():void{break;}break;}',
 maybeMove:box+'let p:ptr<Box> = new Box();switch(1){case 1:{const q=move(p);break;}default:break;}print(p.value);',
 fallthroughMove:box+'let p:ptr<Box> = new Box();switch(1){case 1:{const q=move(p);}case 2:print(p.value);break;default:break;}',
 namedEscape:'function f():()=>number{let n=0;function g():number{n+=1;return n;}return g;}',
}))test(`native switch and nested captures reject ${name}`,()=>run(fixture(source),1));
test('native switch exposes canonical labels for later consumers',()=>{
 const g=check('switch(1){case 0x1:break;default:break;}');assert.ok(g.files[0].caseValues.includes('number:1'));
});

for(const [name,source] of Object.entries({
 alias:'type List<T> = T[];const a:List<number> =[1,2];',
 nestedAlias:'type A<T> = T[];type B<U> = A<U>;const a:B<string> =["a"];',
 aliasDefault:'type A<T=number> = T[];const a:A=[1,2];',
 class:'class Box<T>{constructor(public value:T){}}const b=new Box<number>(1);print(b.value);',
 inferredClass:'class Box<T>{constructor(public value:T){}}const b=new Box(1);print(b.value);',
 contextualClass:'class Box<T>{constructor(public value:T){}}const b:Box<u64> = new Box(9007199254740993);',
 classMethod:'class Box<T>{constructor(public value:T){}get():T{return this.value;}}const b=new Box<string>("s");const s:string=b.get();',
 classDefault:'class Box<T=number>{constructor(public value:T){}}const b=new Box(1);',
 constraint:'function id<T extends number>(x:T):T{return x;}const a=id(1);',
 functionDefault:'function f<T=number>():T[]{const a:T[]=[];return a;}const x=f();',
 dependentDefault:'function f<T,U=T>(x:T,y:U):U{return y;}const x=f<number>(1,2);',
}))test(`native generic instances accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 classMismatch:'class Box<T>{constructor(public value:T){}}const a:Box<number> = new Box<string>("s");',
 constraint:'function id<T extends number>(x:T):T{return x;}id("s");',
 aliasConstraint:'type A<T extends number> = T[];const x:A<string> =["s"];',
 missingAliasArgument:'type A<T> = T[];const x:A=[];',
 tooManyArguments:'type A<T> = T[];const x:A<number,string> =[1];',
 wrongConstructor:'class Box<T>{constructor(public value:T){}}const b=new Box<number>("s");',
 memberMismatch:'class Box<T>{constructor(public value:T){}}const b=new Box<number>(1);const s:string=b.value;',
 ownershipRemainsChecked:box+'class Holder<T>{constructor(public value:T){}}let p:ptr<Box> = new Box();const h=new Holder<ptr<Box>>(move(p));const copy=h;',
}))test(`native generic instances reject ${name}`,()=>run(fixture(source),1));
test('native generic class field has concrete instantiated type',()=>{
 const g=check('class Box<T>{constructor(public value:T){}}const b=new Box<number>(1);const n=b.value;');
 const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.equal(g.symbolTypes[sid],'number');
});

for(const [name,source] of Object.entries({
 classShape:'interface I{x:number;}class C{x:number=1;}const i:I=new C();',
 interfaceShape:'interface I{x:number;}interface J{x:number;y:string;}const j:J={x:1,y:"s"};const i:I=j;',
 optionalShape:'interface I{x:number;y?:string;}class C{x:number=1;}const i:I=new C();',
 intersection:'interface A{x:number;}interface B{y:string;}const a:A&B={x:1,y:"s"};print(a.x);print(a.y);',
 intersectionClass:'interface A{x:number;}interface B{y:string;}class C{x:number=1;y:string="s";}const a:A&B=new C();',
 methodShape:'interface I{get(x:number):number;}class C{get(x:number):number{return x;}}const i:I=new C();',
 constrainedShape:'interface I{x:number;}function read<T extends I>(x:T):number{return x.x;}class C{x:number=1;}print(read(new C()));',
 callableNumeric:'const f:(x:number)=>number=(x:i32):i32=>x;',
}))test(`native structural types accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 missing:'interface I{x:number;}class C{y:number=1;}const i:I=new C();',
 private:'interface I{x:number;}class C{private x:number=1;}const i:I=new C();',
 incompatible:'interface I{x:number;}class C{x:string="s";}const i:I=new C();',
 intersectionMissing:'interface A{x:number;}interface B{y:string;}const a:A&B={x:1};',
 intersectionWrong:'interface A{x:number;}interface B{y:string;}const a:A&B={x:1,y:2};',
 intersectionEscape:'interface A{cb:()=>number;}interface B{x:number;}function f():A&B{let n=0;const a:A&B={cb:():number=>{n+=1;return n;},x:1};return a;}',
 callableWrong:'const f:(x:string)=>number=(x:number):number=>x;',
}))test(`native structural types reject ${name}`,()=>run(fixture(source),1));

for(const [name,source] of Object.entries({
 optional:'const o:Optional<number> = optionalSome(1);print(optionalValueOr(o,0));',
 none:'const o:Optional<number> = optionalNone();print(o.isPresent());',
 nullish:'const o:Optional<number> = optionalSome(1);print(o??0);',
 contextualNullish:'const n:number=optionalNone()??1;',
 exact:'const o:Optional<u64> = optionalSome(18446744073709551615);',
 result:'const r:Result<number> = ok(1);print(r.isOk());',
 resultAlias:'const r:Result<number,string> = resultOk(1);print(resultValueOr(r,0));',
 failure:'const r:Result<number> = err("bad");print(r.error());',
 optionalChain:box+'const b:Optional<Box> = optionalSome(new Box());const n=b?.value??0;',
 callbackLocal:'function f():number{let n=0;const o=optionalSome(():number=>{n+=1;return n;});const cb=o.value();return cb();}',
}))test(`native optional/result accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 wrongPayload:'const o:Optional<number> = optionalSome("s");',
 noContext:'const o=optionalNone();',
 wrongDefault:'const o=optionalSome(1);print(optionalValueOr(o,"s"));',
 nullishType:'const o=optionalSome(1);print(o??"s");',
 notOptional:'print(1??0);',
 optionalArity:'const o:Optional<number,string> = optionalSome(1);',
 chainNonOptional:box+'const b=new Box();print(b?.value);',
 chainWrite:box+'let b:Optional<Box> = optionalSome(new Box());b?.value=optionalSome(2);',
 void:'const o=optionalSome(print(1));',
 exactOverflow:'const o:Optional<u64> = optionalSome(18446744073709551616);',
 callbackEscape:'function f():()=>number{let n=0;const o=optionalSome(():number=>{n+=1;return n;});return o.value();}',
}))test(`native optional/result rejects ${name}`,()=>run(fixture(source),1));
test('native satisfies checks without adding a conversion to the expression',()=>{
 const g=check('const n:i8=1;const x=n satisfies number;');const f=g.files[0];const id=f.ast.nodes.findIndex((n:any)=>n.kind==='SatisfiesExpression');assert.equal(f.types[id],'i8');assert.equal(f.conversions[id],'');
});
test('native satisfies checks numeric literal range',()=>error('const x=128 satisfies i8;',/rango/));

test('native optional parameter body models absence explicitly',()=>{
 const g=check('function f(x?:number):number{return optionalValueOr(x,0);}print(f());print(f(1));');
 const sid=g.binding.symbols.findIndex((s:any)=>s.name==='x');assert.equal(g.symbolTypes[sid],'Optional<number>');assert.ok(g.files[0].conversions.includes('Optional<number>'));
});
test('native optional parameters reject unguarded scalar use',()=>run(fixture('function f(x?:number):number{return x+1;}'),1));
test('native optional parameter keeps explicit Optional unwrapped once',()=>check('function f(x?:Optional<number>):number{return x.valueOr(0);}f(optionalSome(1));'));
test('native optional generic parameter infers payload',()=>check('function f<T>(x?:T):Optional<T>{return x;}const x=f(1);'));

for(const [name,source] of Object.entries({
 globals:'print(length("s"));print(charAt("abc",1));print(lineCount("x"));',
 arrayLength:'const a=[1,2];print(length(a));',
 math:'print(Math.sqrt(4));print(Math.max(1,2));print(Math.PI);',
 json:'const s=JSON.parse("{}");const j:JsonValue=JSON.parseValue("{}");print(jsonIsObject(j));',
 console:'console.log("x",1,true);console.warn("warning");',
 files:'const r:Result<string> = readFile("input.txt");',
 date:'const n=Date.now();print(n);',
}))test(`native builtin contracts accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 wrongLength:'print(length(1));',
 wrongMath:'print(Math.sqrt("s"));',
 wrongMathArity:'print(Math.min(1));',
 unknownMath:'Math.notAMethod();',
 wrongJson:'const j=JSON.parseValue(1);',
 wrongFile:'const r=readFile(1);',
 voidPrint:'function f():void{}print(f());',
}))test(`native builtin contracts reject ${name}`,()=>run(fixture(source),1));
test('native effects preserve external effects separately from symbol reads',()=>{
 const g=check('function inner():void{console.log("x");}function outer():void{inner();}');assert.equal(effect(g,'inner').external,true);assert.equal(effect(g,'outer').external,true);
});

for(const [name,source] of Object.entries({
 arrow:'const f=(x:number)=>{return x+1;};const n:number=f(1);',
 branches:'const f=(b:boolean)=>{if(b)return 1;return 2;};print(f(true));',
 nested:'const f=()=>{const inner=()=>{return "s";};return 1;};const n:number=f();',
 empty:'const f=()=>{};f();',
 bare:'const f=()=>{return;};f();',
 capture:'function outer():number{const n=1;const f=()=>{return n;};return f();}',
 owner:box+'const f=()=>{let p:ptr<Box> = new Box();return move(p);};const p:ptr<Box> = f();',
}))test(`native block return inference accepts ${name}`,()=>check(source));
test('native block return inference preserves the inferred signature',()=>{
 const g=check('const f=(x:number)=>{return x+1;};');assert.deepEqual(types(g,'ArrowFunctionExpression'),['(number)=>number']);
});
test('native block return inference rejects incomplete return paths',()=>error('const f=(b:boolean)=>{if(b)return 1;};',/rutas/));
test('native block return inference retains escape checking',()=>error('function f():()=>number{let n=0;return ()=>{n+=1;return n;};}',/E4210/));
test('native fixed arrays distinguish tuple elements from tuple syntax',()=>check('type Pair=[number,string];const a:Pair[2]=[[1,"a"],[2,"b"]];const t:Pair=a[0];const s:string=t[1];'));
test('native dynamic arrays preserve tuple element types',()=>check('type Pair=[number,string];const a:Pair[]=[[1,"a"]];const t:Pair=a[0];const s:string=t[1];'));
test('native tuples preserve fixed array members',()=>check('const a:[number[2],string]=[[1,2],"s"];const n:number[2]=a[0];'));

for(const [name,source] of Object.entries({
 reorder:'function f(x:number,y:string):string{return y+x;}print(f(y:"s",x:1));',
 omitted:'function f(x:number=1,y:string="s"):string{return y+x;}print(f(y:"a"));',
 optional:'function f(x?:number,y:string="s"):string{return y;}print(f(y:"a"));',
 generic:'function f<T>(x:number,value:T):T{return value;}const n:string=f(value:"s",x:1);',
 method:'class C{f(x:number,y:string):string{return y+x;}}const c=new C();print(c.f(y:"s",x:1));',
 callback:'function apply(n:number,cb:()=>number):number{return cb()+n;}let n=1;print(apply(cb:():number=>{n+=1;return n;},n:2));',
 owner:box+'function take(n:number,p:ptr<Box>):number{return p.value+n;}let p:ptr<Box> = new Box();print(take(p:move(p),n:1));',
}))test(`native named arguments accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 unknown:'function f(x:number):void{}f(y:1);',
 duplicate:'function f(x:number):void{}f(x:1,x:2);',
 missing:'function f(x:number,y:number):void{}f(y:1);',
 wrongType:'function f(x:number,y:string):void{}f(y:1,x:"s");',
 positionalAfter:'function f(x:number,y:number):void{}f(y:1,2);',
 positionalDuplicate:'function f(x:number,y:number):void{}f(1,x:2);',
 overflow:'function f(x:i8,y:number):void{}f(y:1,x:128);',
 callbackEscape:'let stored:()=>number=():number=>0;function f(n:number,cb:()=>number):void{stored=cb;}function g():void{let x=1;f(cb:():number=>{x+=1;return x;},n:0);}',
 aliasBorrow:box+'function f(a:ref<Box>,b:constRef<Box>):void{}let p:ptr<Box> = new Box();f(b:constRef(p),a:ref(p));',
 movedOrder:box+'function f(x:number,p:ptr<Box>):void{}let p:ptr<Box> = new Box();f(p:move(p),x:p.value);',
}))test(`native named arguments reject ${name}`,()=>run(fixture(source),1));
test('native named arguments publish correspondence without reordering AST',()=>{
 const g=check('function f(x:number,y:string):void{}f(y:"s",x:1);');const f=g.files[0];const named=f.ast.nodes.map((n:any,i:number)=>({n,i})).filter(({n}:any)=>n.kind==='NamedArgumentExpression');assert.deepEqual(named.map(({i}:any)=>f.argumentParameters[i]),[1,0]);
});
test('native Result error payload keeps callable provenance',()=>{
 const g=check('function f():number{let n=0;const r:Result<number,()=>number> = resultErr(():number=>{n+=1;return n;});const cb=r.error();cb();return n;}print(f());');const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(effect(g,'f').writes.includes(sid));
});
for(const [name,source] of Object.entries({
 rest:'function first(...xs:number[]):number{return xs[0];}print(first(1,2));',
 empty:'function count(...xs:number[]):number{return xs.length;}print(count());',
 head:'function f(head:string,...xs:number[]):number{return xs.length;}print(f("s",1,2));',
 spread:'function f(...xs:number[]):number{return xs.length;}const a=[1,2];print(f(...a));',
 interleaved:'function f(...xs:number[]):number{return xs.length;}const a=[1,2];print(f(0,...a,3,...a));',
 alias:'function f(...xs:number[]):number{return xs.length;}const g=f;print(g(1,2));',
 generic:'function f<T>(...xs:T[]):T{return xs[0];}const n:string=f("s","a");',
 genericSpread:'function f<T>(...xs:T[]):T{return xs[0];}const a=[1,2];const n:number=f(...a);',
 arraySpread:'const a=[1,2];const b=[0,...a,3];const n:number=b[1];',
 arrayMultiple:'const a=[1,2];const b=[...a,...a];',
 fixedSpread:'const a:number[2]=[1,2];const b:number[3]=[0,...a];',
}))test(`native rest/spread accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 restType:'function f(...xs:number[]):void{}f(1,"s");',
 restNotLast:'function f(...xs:number[],n:number):void{}',
 restDefault:'function f(...xs:number[]=[1]):void{}',
 restNonArray:'function f(...xs:number):void{}',
 missingHead:'function f(head:string,...xs:number[]):void{}f();',
 spreadScalar:'function f(...xs:number[]):void{}f(...1);',
 spreadFixedParams:'function f(x:number,y:number):void{}const a=[1,2];f(...a);',
 arraySpreadScalar:'const a=[...1];',
 unknownFixedSize:'const a=[1,2];const b:number[2]=[...a];',
 overflow:'function f(...xs:i8[]):void{}f(1,128);',
 restCallableNotArray:'function f(...xs:(x:number)=>number[]):void{}',
}))test(`native rest/spread rejects ${name}`,()=>run(fixture(source),1));
test('native rest callbacks retain effects when invoked by iteration',()=>{
 const g=check('type Fn=()=>number;function apply(...callbacks:Fn[]):number{let total=0;for(const cb of callbacks){total+=cb();}return total;}function run():number{let n=0;apply(():number=>{n+=1;return n;},():number=>{n+=2;return n;});return n;}print(run());');const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(effect(g,'run').writes.includes(sid));
});
test('native rest callbacks cannot escape through global aggregate storage',()=>error('type Fn=()=>number;let saved:Fn[]=[];function retain(...callbacks:Fn[]):void{saved=callbacks;}function run():void{let n=0;retain(():number=>{n+=1;return n;});}',/E4210/));
for(const [name,source] of Object.entries({
 map:'let m:Map<string,number> = new Map<string,number>();m.set("a",1);print(m.has("a"));print(m.size);m.delete("a");m.clear();',
 contextual:'let m:Map<string,number> = new Map();m.set("a",1);',
 set:'let s:Set<string> = new Set<string>();print(s.add("a"));print(s.has("a"));print(s.size);s.delete("a");s.clear();',
 deleteMap:'let m=new Map<string,number>();m.set("a",1);delete m["a"];',
 deleteSet:'let s=new Set<string>();s.add("a");delete s["a"];',
 deleteArray:'let a=[1,2];delete a[0];',
 forOf:'let m=new Map<string,number>();m.set("a",1);for(const entry of m){const key:string=entry[0];const value:number=entry[1];}',
 forIn:'let m=new Map<string,number>();for(const key in m){const s:string=key;}',
 forSet:'let s=new Set<string>();for(const value of s){const a:string=value;}',
 readOnly:'const s=new Set<string>();print(s.has("a"));',
}))test(`native Map/Set accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 key:'let m=new Map<string,number>();m.set(1,2);',
 value:'let m=new Map<string,number>();m.set("s","bad");',
 immutable:'const m=new Map<string,number>();m.set("s",1);',
 deleteConstant:'const m=new Map<string,number>();delete m["s"];',
 wrongDelete:'let m=new Map<string,number>();delete m[1];',
 size:'let m=new Map<string,number>();m.size=1;',
 iteratorMutation:'let m=new Map<string,number>();for(const key in m){m.set(key,1);}',
 constructor:'let m=new Map<string,number>(1);',
 classKey:box+'let m=new Map<Box,number>();',
 ownerValue:box+'let m=new Map<string,ptr<Box>>();let p:ptr<Box> = new Box();m.set("s",p);',
 capturedEscape:'type Fn=()=>number;let m=new Map<string,Fn>();function f():void{let n=0;m.set("s",():number=>{n+=1;return n;});}',
}))test(`native Map/Set rejects ${name}`,()=>run(fixture(source),1));
test('native array push cannot retain a reference closure in global storage',()=>error('type Fn=()=>number;let saved:Fn[]=[];function f():void{let n=0;saved.push(():number=>{n+=1;return n;});}',/E4210/));
test('native readonly collection properties cannot be assigned',()=>error('let a=[1,2];a.length=1;',/readonly/));
for(const [name,source] of Object.entries({
 direct:'class C{readonly x:number;constructor(){this.x=1;}}const c=new C();print(c.x);',
 branches:'class C{readonly x:number;constructor(b:boolean){if(b)this.x=1;else this.x=2;}}const c=new C(true);',
 mutable:'class C{x:number;constructor(){this.x=1;this.x=2;}}const c=new C();',
 parameter:'class C{constructor(public readonly x:number){}}const c=new C(1);',
 earlyReturn:'class C{readonly x:number;constructor(b:boolean){if(b){this.x=1;return;}this.x=2;}}const c=new C(true);',
 nestedNew:'class C{readonly x:number;constructor(){const s=new D();this.x=s.y;}}class D{readonly y:number;constructor(){this.y=1;}}const c=new C();',
 default:'class C{readonly x:number=1;constructor(){print(this.x);}}const c=new C();',
}))test(`native constructor field initialization accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 missing:'class C{readonly x:number;constructor(){}}',
 missingMutable:'class C{x:number;constructor(){}}',
 branch:'class C{readonly x:number;constructor(b:boolean){if(b)this.x=1;}}',
 duplicate:'class C{readonly x:number;constructor(){this.x=1;this.x=2;}}',
 maybeDuplicate:'class C{readonly x:number;constructor(b:boolean){if(b)this.x=1;this.x=2;}}',
 initializedDefault:'class C{readonly x:number=1;constructor(){this.x=2;}}',
 readBeforeWrite:'class C{x:number;constructor(){print(this.x);this.x=1;}}',
 compound:'class C{readonly x:number;constructor(){this.x+=1;}}',
 earlyReturn:'class C{x:number;constructor(b:boolean){if(b)return;this.x=1;}}',
 methodBeforeInit:'class C{x:number;constructor(){this.read();this.x=1;}read():number{return this.x;}}',
 otherReceiver:'class C{readonly x:number=1;constructor(other:C){other.x=2;}}',
 nestedFunction:'class C{readonly x:number;constructor(){const f=():void=>{this.x=1;};f();}}',
 parameterAssigned:'class C{constructor(public readonly x:number){this.x=2;}}',
}))test(`native constructor field initialization rejects ${name}`,()=>run(fixture(source),1));
for(const [name,source] of Object.entries({
 map:'const a=[1,2];const b:string[]=a.map((x:number):string=>numberToString(x));',
 filter:'const a=[1,2];const b:number[]=a.filter((x:number):boolean=>x>1);',
 reduce:'const a=[1,2];const n:number=a.reduce(0,(s:number,x:number):number=>s+x);',
 forEach:'const a=[1,2];a.forEach((x:number):void=>{print(x);});',
 find:'const a=[1,2];const o:Optional<number> = a.find((x:number):boolean=>x>1);',
 some:'const a=[1,2];const b:boolean=a.some((x:number):boolean=>x>1);',
 every:'const a=[1,2];const b:boolean=a.every((x:number):boolean=>x>0);',
 flatMap:'const a=[1,2];const b:number[]=a.flatMap((x:number):number[]=>[x,x]);',
 sort:'let a=[2,1];const b:number[]=a.sort((x:number,y:number):number=>x-y);',
 defaultSort:'let a=[2,1];a.sort();',
 concat:'const a=[1,2];const b:number[]=a.concat([3],[4,5]);',
 inferred:'const a=[1,2];const b:number[]=a.map((x:number)=>{return x+1;});',
 symbolic:'function apply(a:number[],cb:(x:number)=>number):number[]{return a.map(cb);}const a=apply([1,2],(x:number):number=>x+1);',
 state:'function f():number{let n=0;const a=[1,2];a.forEach((x:number):void=>{n+=x;});return n;}print(f());',
 returnedValueCapture:'type Fn=()=>number;function f():Fn[]{const a=[1,2];return a.map((x:number):Fn=>():number=>x);}',
}))test(`native array callbacks accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 predicate:'const a=[1,2];a.filter((x:number):number=>x);',
 result:'const a=[1,2];const b:string[]=a.map((x:number):number=>x);',
 void:'const a=[1,2];a.map((x:number):void=>{});',
 arity:'const a=[1,2];a.reduce(0);',
 reduceReturn:'const a=[1,2];a.reduce(0,(s:number,x:number):string=>"s");',
 flatMap:'const a=[1,2];a.flatMap((x:number):number=>x);',
 sortConstant:'const a=[2,1];a.sort();',
 sortReturn:'let a=[2,1];a.sort((x:number,y:number):boolean=>x>y);',
 mutation:'let a=[1,2];a.forEach((x:number):void=>{a.push(x);});',
 indirectMutation:'let a=[1,2];function mutate(x:number):void{a.push(x);}a.forEach(mutate);',
 returnedReference:'type Fn=()=>number;function f():Fn[]{let n=0;const a=[1];return a.map((x:number):Fn=>():number=>{n+=x;return n;});}',
}))test(`native array callbacks reject ${name}`,()=>run(fixture(source),1));
test('native array callback effects propagate through consumers',()=>{
 const g=check('function f():number{let n=0;const a=[1,2];a.forEach((x:number):void=>{n+=x;});return n;}print(f());');const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(effect(g,'f').writes.includes(sid));
});
test('native map identity cannot hide a reference callback escape',()=>error('type Fn=()=>number;function f():Fn[]{let n=0;const cb:Fn=():number=>{n+=1;return n;};const a:Fn[]=[cb];return a.map((fn:Fn):Fn=>fn);}',/E4210/));
test('native overload values choose the contextual signature and its effects',()=>{
 const g=check('let n=0;function f(x:number):number{return x;}function f(x:string):string{n+=1;return x;}function run():number{const cb:(x:number)=>number=f;return cb(1);}print(run());');const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(!effect(g,'run').writes.includes(sid));const f=g.files[0];const node=f.ast.nodes.findIndex((n:any,i:number)=>n.kind==='IdentifierExpression'&&f.signatures[i]==='(number)=>number');assert.ok(node>=0);assert.ok(f.selected[node]>=0);
});
test('native overload values reject incompatible context',()=>error('function f(x:number):number{return x;}function f(x:string):string{return x;}const g:(x:boolean)=>boolean=f;',/sobrecarga compatible/));
test('native overload values can be passed to typed consumers',()=>check('function f(x:number):number{return x;}function f(x:string):string{return x;}function apply(cb:(x:number)=>number):number{return cb(1);}print(apply(f));'));
test('native declared union constructors instantiate generic payloads',()=>check('union Outcome<T,E> = Ok(T)|Err(E);const r:Outcome<number,string> = Outcome<number,string>.Ok(1);'));
test('native union constructors support contextual and unqualified forms',()=>check('union Maybe<T> = Some(T)|None;const a:Maybe<number> = Some(1);const b:Maybe<number> = None();'));
test('native union payloads reject wrong types',()=>error('union Maybe<T> = Some(T)|None;const a:Maybe<number> = Some("s");',/incompatible/));
test('native union payloads reject borrowed storage',()=>error('class Box{x:number=1;}union U=Borrowed(ref<Box>)|None;let p:ptr<Box> = new Box();const u=Borrowed(ref(p));',/E4203/));
for(const [name,source] of Object.entries({
 discriminate:'union R={ok:true;value:number}|{ok:false;error:string};function f(r:R):number{if(r.ok==true)return r.value;return 0;}',
 guard:'union R={ok:true;value:number}|{ok:false;error:string};function f(r:R):string{if(r.ok==true)return "ok";return r.error;}',
 both:'union R={ok:true;value:number}|{ok:false;error:string};function f(r:R):string{if(r.ok)return numberToString(r.value);else return r.error;}',
 object:'union R={ok:true;value:number}|{ok:false;error:string};const r:R={ok:true,value:1};const n:number=r.value;',
 instance:'class A{x:number=1;}class B{y:number=2;}function f(v:A|B):number{if(v instanceof A)return v.x;return v.y;}',
 inferred:'union R={ok:true;value:number}|{ok:false;error:string};const f=(r:R)=>{if(r.ok)return r.value;return 0;};',
}))test(`native narrowing accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 unguarded:'union R={ok:true;value:number}|{ok:false;error:string};function f(r:R):number{return r.value;}',
 wrongBranch:'union R={ok:true;value:number}|{ok:false;error:string};function f(r:R):number{if(r.ok==false)return r.value;return 0;}',
 objectMissing:'union R={ok:true;value:number}|{ok:false;error:string};const r:R={ok:true};',
 mutateTag:'union R={ok:true;value:number}|{ok:false;error:string};let r:R={ok:true,value:1};r.ok=false;',
 instancePrimitive:'class A{x:number=1;}const b=1 instanceof A;',
 instanceTarget:'class A{x:number=1;}const a=new A();const b=a instanceof number;',
}))test(`native narrowing rejects ${name}`,()=>run(fixture(source),1));
test('native narrowing invalidates facts after branch assignments',()=>error('union R={ok:true;value:number}|{ok:false;error:string};function f(r:R,b:boolean):number{if(r.ok){if(b)r={ok:false,error:"s"};return r.value;}return 0;}',/narrowing/));
test('native inferred returns cannot reuse facts after calls',()=>error('union R={ok:true;value:number}|{ok:false;error:string};const f=(r:R)=>{if(r.ok){print(1);return r.value;}return 0;};',/narrowing/));

test('native union payload callbacks preserve effects',()=>{
 const g=check('union U=Action(()=>number)|None;let n=0;function run():number{const u:U=Action(():number=>{n+=1;return n;});return u.value();}print(run());');const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(effect(g,'run').writes.includes(sid));
});
test('native union record callbacks preserve effects',()=>{
 const g=check('union U={kind:"Action";cb:()=>number}|{kind:"None"};let n=0;function run():number{const u:U={kind:"Action",cb:():number=>{n+=1;return n;}};const cb:()=>number=u.cb;return cb();}print(run());');const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(effect(g,'run').writes.includes(sid));
});
test('native union callbacks cannot hide a reference capture on return',()=>error('union U=Action(()=>number)|None;function f():U{let n=0;return Action(():number=>{n+=1;return n;});}',/E4210/));
test('native union narrowing distributes across remaining variants',()=>check('union U={kind:"A";a:number}|{kind:"B";b:number}|{kind:"C";c:number};function f(u:U):number{if(u.kind=="A")return u.a;if(u.kind=="B")return u.b;return u.c;}'));

for(const [name,source] of Object.entries({
 value:'const n=match(1,[when(1,():number=>2),otherwise(():number=>0)]);const x:number=n;',
 subject:'const n=match(1,[when(1,(x:number):number=>x+1),otherwise((x:number):number=>x)]);',
 type:'function f(x:number|string):number{return match(x,[whenType<number>((n:number):number=>n),whenType<string>((s:string):number=>s.length)]);}',
 discriminator:'union U=A(number)|B(string);function f(u:U):number{return match(u,"kind",[when("A",():number=>1),otherwise(():number=>0)]);}',
 returns:'function f(x:number):number|string{return match(x,[when(1,():number=>2),otherwise(():string=>"s")]);}',
}))test(`native match accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 arity:'const n=match(1);',
 cases:'const n=match(1,1);',
 pattern:'const n=match(1,[when("s",():number=>2)]);',
 duplicate:'const n=match(1,[when(1,():number=>2),when(1,():number=>3)]);',
 fallbackOrder:'const n=match(1,[otherwise(():number=>2),when(1,():number=>3)]);',
 callback:'const n=match(1,[when(1,(s:string):number=>2)]);',
 empty:'const n=match(1,[]);',
 standalone:'const c=when(1,():number=>2);',
 wrongType:'const n=match(1,[whenType<string>(():number=>2)]);',
}))test(`native match rejects ${name}`,()=>run(fixture(source),1));
test('native match composes callback effects',()=>{const g=check('let n=0;function f():number{return match(1,[when(1,():number=>{n+=1;return n;}),otherwise(():number=>0)]);}print(f());');const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(effect(g,'f').writes.includes(sid));});
test('native match preserves escaping callback return provenance',()=>error('type Fn=()=>number;function f():Fn{let n=0;return match(1,[otherwise(():Fn=>():number=>{n+=1;return n;})]);}',/E4210/));

test('native tuple spread checks each contextual position',()=>check('const a:[number,string]=[1,"s"];const b:[boolean,number,string]=[true,...a];'));
test('native tuple spread rejects an incompatible contextual position',()=>error('const a:[number,string]=[1,"s"];const b:[boolean,string,number]=[true,...a];',/incompatible/));
test('native fixed spread preserves repeated positions in heterogeneous inference',()=>{const g=check('const a:number[2]=[1,2];const b=[true,...a];const n:number=b[2];');const s=g.binding.symbols.findIndex((s:any)=>s.name==='b');assert.equal(g.symbolTypes[s],'[boolean,number,number]');});

test('native match callback writes respect an active loan',()=>error('let n=0;const loan=constRef(n);match(1,[otherwise(():number=>{n+=1;return n;})]);print(loan);',/E4207/));
test('native match returned subject callbacks preserve capture provenance',()=>error('type Fn=()=>number;function f():Fn{let n=0;const cb:Fn=():number=>{n+=1;return n;};return match(cb,[otherwise((fn:Fn):Fn=>fn)]);}',/E4210/));

for(const [name,source] of Object.entries({
 and:'union U={ok:true;value:number}|{ok:false;error:string};function f(u:U):boolean{return u.ok&&u.value>0;}',
 or:'union U={ok:true;value:number}|{ok:false;error:string};function f(u:U):boolean{return u.ok||u.error=="s";}',
 ternary:'union U={ok:true;value:number}|{ok:false;error:string};function f(u:U):number{return u.ok?u.value:u.error.length;}',
}))test(`native conditional narrowing accepts ${name}`,()=>check(source));
test('native conditional narrowing cannot leak a branch fact',()=>error('union U={ok:true;value:number}|{ok:false;error:string};function f(u:U):number{const n=u.ok?u.value:0;return u.value;}',/narrowing/));

for(const [name,source] of Object.entries({
 map:'const m=new Map<string,number>();m.forEach((v:number,k:string):void=>{print(v);print(k);});',
 set:'const s=new Set<number>();s.forEach((v:number):void=>{print(v);});',
}))test(`native collection callbacks accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 parameter:'const m=new Map<string,number>();m.forEach((v:string,k:number):void=>{});',
 result:'const s=new Set<number>();s.forEach((v:number):number=>v);',
 mutation:'let m=new Map<string,number>();m.forEach((v:number,k:string):void=>{m.set(k,v);});',
 indirect:'let s=new Set<number>();function mutate(v:number):void{s.add(v);}s.forEach(mutate);',
}))test(`native collection callbacks reject ${name}`,()=>run(fixture(source),1));
test('native collection callbacks compose effects',()=>{const g=check('let n=0;function f(m:Map<string,number>):void{m.forEach((v:number,k:string):void=>{n+=v;});}');const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(effect(g,'f').writes.includes(sid));});

test('native public union payloads cannot expose private types',()=>error('class Hidden{x:number=1;}export union U=Value(Hidden)|Empty;',/E4401/));
test('native public union record fields cannot expose private types',()=>error('class Hidden{x:number=1;}export union U={kind:"Value";data:Hidden}|{kind:"Empty"};',/E4401/));
test('native public union payloads allow exported types',()=>check('export class Box{x:number=1;}export union U=Value(Box)|Empty;'));

for(const [name,source] of Object.entries({
 inferred:'function show<...T>(...values:T):void{print(values);}show(1,"s",true);',
 explicit:'function show<...T>(...values:T):void{print(values);}show<number,string>(1,"s");',
 empty:'function show<...T>(...values:T):void{print(values);}show();',
 forwarding:'function show<...T>(...values:T):void{print(values);}function forward<...T>(...values:T):void{show(values);}forward(1,"s");',
 spreadForwarding:'function show<...T>(...values:T):void{print(values);}function forward<...T>(...values:T):void{show(...values);}forward(1,"s");',
 fixed:'function f<A,...T>(head:A,...values:T):A{print(values);return head;}const n:number=f(1,"s",true);',
 fixedExplicit:'function f<A,...T>(head:A,...values:T):A{print(values);return head;}const n:number=f<number,string,boolean>(1,"s",true);',
 tuple:'function f<...T>(...values:T):void{print(values);}const t:[number,string]=[1,"s"];f(...t);',
 variadicPrint:'print();print(1,"s",true);',
}))test(`native generic packs accept ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 unused:'function f<...T>():void{}',
 notLast:'function f<...T,U>(...values:T):void{}',
 duplicate:'function f<...T,...U>(...a:T,...b:U):void{}',
 scalar:'function f<T>(...values:T):void{}',
 wrongCount:'function f<...T>(...values:T):void{}f<number,string>(1);',
 wrongType:'function f<...T>(...values:T):void{}f<number>("s");',
 wrongHead:'function f<A,...T>(head:A,...values:T):A{return head;}const n=f<number,string>("s","s");',
 missingHead:'function f<A,...T>(head:A,...values:T):A{return head;}f();',
 stored:'function f<...T>(...values:T):void{const v=values;}',
 returned:'function f<...T>(...values:T):T{return values;}',
 fixedUse:'function f<...T>(values:T,...rest:T):void{}',
 dynamicSpread:'function f<...T>(...values:T):void{}const a=[1,2];f(...a);',
 named:'function f<...T>(...values:T):void{}f(values:1);',
 range:'function f<...T>(...values:T):void{}f<i8>(128);',
 hiddenOwner:'class Box{x:number=1;}function f<...T>(...values:T):void{}let p:ptr<Box> = new Box();f(move(p));',
}))test(`native generic packs reject ${name}`,()=>run(fixture(source),1));
test('native generic packs publish the ordered instantiated signature',()=>{
 const g=check('function f<...T>(...values:T):void{}f<number,string>(1,"s");');const f=g.files[0];const id=f.ast.nodes.findIndex((n:any)=>n.kind==='CallExpression'&&n.attributes.some((a:any)=>a.name==='callee'&&a.value==='f'));assert.equal(f.signatures[id],'(...pack<number,string>)=>void');const args=f.ast.nodes[id].edges.filter((e:any)=>e.role==='args');assert.deepEqual(args.map((e:any)=>f.argumentParameters[e.node]),[0,0]);
});

const ownerBox='class Box{value:number=1;}';
const ownerHolder=ownerBox+'class Holder{p:ptr<Box> = new Box();q:ptr<Box> = new Box();}';
for(const [name,source] of Object.entries({
 field:ownerHolder+'let h=new Holder();print(h.p.value);',
 array:ownerBox+'let a:ptr<Box>[]=[];let p:ptr<Box> = new Box();a.push(move(p));',
 literal:ownerBox+'let p:ptr<Box> = new Box();let a:ptr<Box>[]=[move(p)];',
 whole:ownerHolder+'let h=new Holder();const next=move(h);print(next.p.value);',
 returned:ownerHolder+'function f():Holder{let h=new Holder();return move(h);}const h=f();',
 argument:ownerHolder+'function consume(h:Holder):void{print(h.p.value);}let h=new Holder();consume(move(h));',
 partial:ownerHolder+'let h=new Holder();const p=move(h.p);print(h.q.value);',
 reinitialize:ownerHolder+'let h=new Holder();const p=move(h.p);h.p=new Box();const next=move(h);',
 disjoint:ownerHolder+'let h=new Holder();const p=move(h.p);const q=move(h.q);',
 tuple:ownerBox+'let t:[ptr<Box>,ptr<Box>]=[new Box(),new Box()];const p=move(t[0]);print(t[1].value);t[0]=new Box();const next=move(t);',
 arrayIndex:ownerBox+'let a:ptr<Box>[]=[new Box(),new Box()];const p=move(a[0]);print(a[1].value);a[0]=new Box();const next=move(a);',
 fieldBranches:ownerHolder+'function f(b:boolean):void{let h=new Holder();if(b){const p=move(h.p);h.p=new Box();}print(h.p.value);}',
 nested:ownerHolder+'class Outer{h:Holder=new Holder();}let o=new Outer();const p=move(o.h.p);print(o.h.q.value);o.h.p=new Box();const next=move(o);',
 map:ownerBox+'let m=new Map<string,ptr<Box>>();let p:ptr<Box> = new Box();m.set("a",move(p));',
 optional:ownerBox+'let p:ptr<Box> = new Box();const o=optionalSome(move(p));',
 borrowedCallback:ownerBox+'let a:ptr<Box>[]=[new Box()];a.forEach((p:constRef<Box>):void=>{print(p.value);});',
}))test(`native aggregate ownership accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 copy:ownerHolder+'let h=new Holder();const copy=h;',
 arrayCopy:ownerBox+'let a:ptr<Box>[]=[];const b=a;',
 argument:ownerHolder+'function consume(h:Holder):void{}let h=new Holder();consume(h);',
 return:ownerHolder+'function f():Holder{let h=new Holder();return h;}',
 fieldCopy:ownerBox+'let p:ptr<Box> = new Box();class C{p:ptr<Box> = p;}',
 literalCopy:ownerBox+'let p:ptr<Box> = new Box();let a:ptr<Box>[]=[p];',
 doubleMove:ownerHolder+'let h=new Holder();const p=move(h.p);const q=move(h.p);',
 partialRead:ownerHolder+'let h=new Holder();const p=move(h.p);print(h.p.value);',
 partialWhole:ownerHolder+'let h=new Holder();const p=move(h.p);const next=move(h);',
 partialCopy:ownerHolder+'let h=new Holder();const p=move(h.p);const next=h;',
 conditional:ownerHolder+'function f(b:boolean):void{let h=new Holder();if(b){const p=move(h.p);}print(h.p.value);}',
 loop:ownerHolder+'function f(b:boolean):void{let h=new Holder();while(b){const p=move(h.p);}}',
 parent:ownerHolder+'class Outer{h:Holder=new Holder();}let o=new Outer();const h=move(o.h);o.h.p=new Box();',
 movedTuple:ownerBox+'let t:[ptr<Box>,ptr<Box>]=[new Box(),new Box()];const p=move(t[0]);print(t[0].value);',
 wildcard:ownerBox+'function f(index:number):void{let a:ptr<Box>[]=[new Box(),new Box()];const p=move(a[index]);print(a[0].value);}',
 wildcardRestore:ownerBox+'function f(index:number):void{let a:ptr<Box>[]=[new Box(),new Box()];const p=move(a[index]);a[index]=new Box();const next=move(a);}',
 borrowed:ownerHolder+'let h=new Holder();const loan=constRef(h);const p=move(h.p);print(loan.q.value);',
 readonly:ownerBox+'class H{readonly p:ptr<Box> = new Box();}let h=new H();const p=move(h.p);',
 callbackCopy:ownerBox+'let a:ptr<Box>[]=[new Box()];a.forEach((p:ptr<Box>):void=>{});',
 optionalCopy:ownerBox+'let p:ptr<Box> = new Box();const o=optionalSome(p);',
 capture:ownerHolder+'function f():void{let h=new Holder();const cb=():number=>h.p.value;}',
}))test(`native aggregate ownership rejects ${name}`,()=>run(fixture(source),1));

for(const [name,source] of Object.entries({
 genericMove:ownerHolder+'function identity<T>(x:T):T{return move(x);}let h=new Holder();const q=identity(move(h));',
 genericPrimitive:'function identity<T>(x:T):T{return x;}const n=identity(1);',
 fixedArray:ownerBox+'let a:ptr<Box>[1]=[new Box()];const p=move(a[0]);a[0]=new Box();const b=move(a);',
}))test(`native aggregate substitution accepts ${name}`,()=>check(source));
for(const [name,source] of Object.entries({
 genericCopy:ownerHolder+'function identity<T>(x:T):T{return x;}let h=new Holder();const q=identity(move(h));',
 genericLocal:ownerHolder+'function copy<T>(x:T):void{const y=x;}let h=new Holder();copy(move(h));',
 genericNested:ownerHolder+'function copy<T>(x:T):void{const y=x;}function outer<T>(x:T):void{copy(move(x));}let h=new Holder();outer(move(h));',
 genericCapture:ownerHolder+'function f<T>(x:T):void{const cb=():T=>x;}let h=new Holder();f(move(h));',
 methodCopy:ownerBox+'class H<T>{constructor(public value:T){}copy():void{const y=this.value;}}let p:ptr<Box> = new Box();let h=new H<ptr<Box>>(move(p));h.copy();',
 methodReturn:ownerBox+'class H<T>{constructor(public value:T){}get():T{return this.value;}}let p:ptr<Box> = new Box();let h=new H<ptr<Box>>(move(p));const q=h.get();',
}))test(`native aggregate substitution rejects ${name}`,()=>run(fixture(source),1));

test('native aggregate ownership allows consuming spread',()=>check(ownerBox+'let a:ptr<Box>[]=[new Box()];const b:ptr<Box>[]=[...move(a)];'));
test('native aggregate ownership rejects copying spread',()=>error(ownerBox+'let a:ptr<Box>[]=[new Box()];const b:ptr<Box>[]=[...a];',/E4101/));
test('native aggregate ownership rejects erasing casts',()=>error(ownerHolder+'class Empty{}let h=new Holder();const x=h as Empty;',/E4101/));
test('native aggregate ownership rejects erasing generic casts',()=>error(ownerHolder+'function erase<T>(x:T):number{return x as number;}let h=new Holder();print(erase(move(h)));',/E4101/));
test('native aggregate ownership rejects reusing a property parameter',()=>error(ownerBox+'class H{constructor(public p:ptr<Box>){const q=move(p);}}',/E4102/));

test('native aggregate ownership transports partial moves through methods',()=>check(ownerBox+'class H{p:ptr<Box> = new Box();q:ptr<Box> = new Box();take():ptr<Box>{return move(this.p);}}let h=new H();const p=h.take();print(h.q.value);h.p=new Box();const next=move(h);'));
test('native aggregate ownership rejects a method reading its moved field',()=>error(ownerBox+'class H{p:ptr<Box> = new Box();take():ptr<Box>{return move(this.p);}}let h=new H();const p=h.take();print(h.p.value);',/E4102/));
test('native aggregate ownership treats a moving method as mutation',()=>error(ownerBox+'class H{p:ptr<Box> = new Box();take():ptr<Box>{return move(this.p);}}const h=new H();const p=h.take();',/inmutable/));

test('native aggregate ownership rejects copying slice',()=>error(ownerBox+'let a:ptr<Box>[]=[new Box()];const b=a.slice(0,1);',/E4101/));
test('native aggregate ownership rejects copying concat receiver',()=>error(ownerBox+'let a:ptr<Box>[]=[new Box()];const b=a.concat([]);',/E4101/));
test('native aggregate ownership rejects shifting a moved element',()=>error(ownerBox+'let a:ptr<Box>[]=[new Box(),new Box()];const p=move(a[1]);delete a[0];print(a[0].value);',/E4102/));
test('native aggregate ownership allows consuming slice',()=>check(ownerBox+'let a:ptr<Box>[]=[new Box()];const b=move(a).slice(0,1);'));

test('native generic packs cannot hide aggregate owners',()=>error(ownerHolder+'function show<...T>(...values:T):void{print(values);}let h=new Holder();show(h);',/E4203/));
test('native aggregate ownership can display an owner without copying it',()=>check(ownerHolder+'let h=new Holder();print(h);print(h.p.value);'));
test('native aggregate ownership rejects moving a displayed owner in the same call',()=>error(ownerHolder+'let h=new Holder();print(h,move(h));',/E4206/));

for(const [name,source] of Object.entries({
 simple:'async function f():Promise<number>{await sleep(1);return 1;}const n:number=await f();',
 arrow:'const f=async (x:number):Promise<number> =>{await sleep(1);return x;};const n:number=await f(1);',
 inferredArrow:'const f=async (x:number)=>x+1;const n:number=await f(1);',
 void:'async function f():Promise<void>{await sleep(1);}await f();',
 top:'await sleep(1);',
 stored:'async function f():Promise<number>{return 1;}const t=f();const n:number=await t;',
 forwarded:'async function f():Promise<number>{return 1;}function make():Promise<number>{return f();}const t=make();const n:number=await t;',
 moved:'async function f():Promise<number>{return 1;}const t=f();const u=move(t);print(await u);',
 owner:'class B{n:number=1;}async function f(p:ptr<B>):Promise<number>{await sleep(1);return p.n;}let p:ptr<B> = new B();print(await f(move(p)));',
 ownerReturn:'class B{}async function f():Promise<ptr<B>>{return new B();}const p:ptr<B> = await f();',
 forAwait:'async function f(xs:Promise<number>[]):Promise<void>{for await(const x of xs){print(x);}}',
 forAwaitCall:'async function one():Promise<number>{return 1;}const xs:Promise<number>[]=[one()];for await(const n of xs){print(n);}',
 endedLoan:'async function test():Promise<void>{let n=0;const r=constRef(n);print(r);await sleep(1);n=1;}',
 laterLoan:'async function test():Promise<void>{let n=0;await sleep(1);const r=constRef(n);print(r);}',
 unusedLoan:'async function test():Promise<void>{let n=0;const r=constRef(n);await sleep(1);}',
 localFrame:'async function use(cb:()=>number):Promise<number>{await sleep(1);return cb();}async function outer():Promise<number>{let n=0;const t=use(():number=>{n+=1;return n;});return await t;}',
 detached:'async function f():Promise<void>{await sleep(1);print(1);}spawn(f());',
 notStarted:'class B{}async function f():Promise<void>{const q=move(p);}const t=f();let p:ptr<B> = new B();await t;',
 defaultAtCreation:'class B{}let p:ptr<B> = new B();async function f(x:ptr<B> = move(p)):Promise<void>{}const t=f();p=new B();const q=move(p);await t;',
}))test(`native async accepts ${name}`,()=>check(source));
for(const [name,source,pattern] of [
 ['returnType','async function f():number{return 1;}',/Promise/],
 ['returnValue','async function f():Promise<number>{return "s";}',/incompatible/],
 ['missingReturn','async function f():Promise<number>{await sleep(1);}',/rutas/],
 ['syncAwait','function f():void{await sleep(1);}',/await/],
 ['nestedSync','async function f():Promise<void>{function g():void{await sleep(1);}g();}',/await/],
 ['notTask','const n=await 1;',/Promise/],
 ['taskCopy','const a=sleep(1);const b=a;',/E4101/],
 ['doubleAwait','const t=sleep(1);await t;await t;',/E4102/],
 ['afterMove','const t=sleep(1);const u=move(t);await t;',/E4102/],
 ['spawnCopy','const t=sleep(1);spawn(t);',/E4101/],
 ['spawnAgain','const t=sleep(1);spawn(move(t));await t;',/E4102/],
 ['borrowParameter','class B{}async function f(x:ref<B>):Promise<void>{}',/E4204/],
 ['sharedParameter','class B{}async function f(x:constRef<B>):Promise<void>{}',/E4204/],
 ['liveLoan','async function test():Promise<void>{let n=0;const r=constRef(n);await sleep(1);print(r);}',/E4204/],
 ['liveMutLoan','async function test():Promise<void>{let n=0;const r=ref(n);await sleep(1);print(r);}',/E4204/],
 ['indirectSuspend','async function test():Promise<void>{async function f():Promise<void>{await sleep(1);}let n=0;const r=constRef(n);await f();print(r);}',/E4204/],
 ['forAwaitLoan','async function test():Promise<void>{async function one():Promise<number>{return 1;}const xs:Promise<number>[]=[one()];let n=0;const r=constRef(n);for await(const x of xs){print(x);}print(r);}',/E4204/],
 ['forAwaitElement','for await(const n of [1]){print(n);}',/Promise/],
 ['forAwaitConsumed','const xs:Promise<void>[]=[sleep(1)];for await(const x of xs){}print(xs.length);',/E4102/],
 ['bodyAtAwait','class B{}let p:ptr<B> = new B();async function f():Promise<void>{const q=move(p);}const t=f();const q=move(p);await t;',/E4102/],
 ['defaultAtCall','class B{}async function f(x:ptr<B> = move(p)):Promise<void>{}const t=f();let p:ptr<B> = new B();await t;',/E4001/],
 ['noDefaultReplay','class B{}let p:ptr<B> = new B();async function f(x:ptr<B> = move(p)):Promise<void>{}const t=f();await t;const q=move(p);',/E4102/],
 ['escapingFrame','async function use(cb:()=>number):Promise<number>{return cb();}function make():Promise<number>{let n=0;return use(():number=>{n+=1;return n;});}',/E4210/],
 ['spawnFrame','async function use(cb:()=>void):Promise<void>{cb();}function f():void{let n=0;spawn(use(():void=>{n+=1;}));}',/E4210/],
 ['detachedOwner','class B{}let p:ptr<B> = new B();async function f():Promise<void>{const q=move(p);}spawn(f());',/E4204/],
] as const)test(`native async rejects ${name}`,()=>error(source,pattern));
test('native async separates creation and deferred body effects',()=>{
 const g=check('let n=0;function init():number{n+=1;return n;}async function work(x:number=init()):Promise<number>{n+=1;return x;}function create():Promise<number>{return work();}async function run():Promise<number>{return await work();}');
 const sid=g.binding.symbols.findIndex((s:any)=>s.name==='n');
 const work=g.binding.symbols.find((s:any)=>s.name==='work'&&s.kind==='FunctionDeclaration');
 const phases=g.effects.filter((e:any)=>e.node===work.node);assert.equal(phases.length,2);
 assert.ok(phases.find((e:any)=>e.phase==='creation').writes.includes(sid));
 assert.ok(phases.find((e:any)=>e.phase==='body').writes.includes(sid));
 const h=check('let n=0;async function work():Promise<number>{n+=1;return n;}function create():Promise<number>{return work();}');
 const n=h.binding.symbols.findIndex((s:any)=>s.name==='n');assert.ok(!effect(h,'create').writes.includes(n));
});
test('native async publishes task provenance and awaited callable targets',()=>{
 const g=check('type F=()=>number;async function make():Promise<F>{return ():number=>1;}const t=make();const cb=await t;print(cb());');
 assert.ok(g.files[0].taskSources.some((s:number[])=>s.length>0));assert.ok(types(g,'AwaitExpression').includes('()=>number'));
});

test('native async may create a task during a loan that ends before awaiting',()=>check('async function work():Promise<void>{await sleep(1);}async function run():Promise<void>{let n=0;const r=constRef(n);const t=work();print(r);await t;}'));
test('native async result does not inherit an unrelated frame reference capture',()=>check('type F=()=>number;async function work(cb:()=>number):Promise<F>{cb();return ():number=>1;}async function outer():Promise<F>{let n=0;const t=work(():number=>{n+=1;return n;});return await t;}'));
test('native async returned callback retains the capture of its input',()=>error('type F=()=>number;async function identity(cb:F):Promise<F>{return cb;}async function outer():Promise<F>{let n=0;return await identity(():number=>{n+=1;return n;});}',/E4210/));
test('native async rejects use after consuming a task field',()=>error('class H{t:Promise<void> = sleep(1);}let h=new H();await h.t;await h.t;',/E4102/));
test('native async restores a consumed task field explicitly',()=>check('class H{t:Promise<void> = sleep(1);}let h=new H();await h.t;h.t=sleep(1);await h.t;'));
test('native async joins possibly consumed tasks across branches',()=>error('const t=sleep(1);if(true){await t;}await t;',/E4102/));
test('native async rejects a task consumed again by a loop',()=>error('const t=sleep(1);for(let n=0;n<2;n=n+1){await t;}',/E410[23]/));
test('native async checks code after a possibly empty for-of',()=>error('for(const x of [1]){}print(n);let n=1;',/E4001/));

for(const [name,source] of Object.entries({
 all:'async function f():Promise<number>{return 1;}const xs=all([f(),f()]);const n:number=xs[0];',
 race:'async function f():Promise<number>{return 1;}const n:number=race([f(),f()]);',
 alias:'async function f():Promise<number>{return 1;}const xs=promiseAll([f()]);const n:number=promiseRace([f()]);',
 moved:'async function f():Promise<number>{return 1;}const ts:Promise<number>[]=[f()];const xs=all(move(ts));',
 empty:'const xs:number[]=all<number>([]);',
}))test(`native async combinators accept ${name}`,()=>check(source));
for(const [name,source,pattern] of [
 ['copy','const ts:Promise<void>[]=[sleep(1)];all(ts);',/E4101/],
 ['type','const n=all([1]);',/Promise/],
 ['loan','async function f():Promise<void>{let n=0;const r=constRef(n);all([sleep(1)]);print(r);}',/E4204/],
 ['duplicateMove','class B{}let p:ptr<B> = new B();async function f():Promise<number>{const q=move(p);return 1;}all([f(),f()]);',/E410[23]/],
] as const)test(`native async combinators reject ${name}`,()=>error(source,pattern));

test('native async ends a loan used only to create the awaited task',()=>check('function make(n:number):Promise<void>{return sleep(n);}async function test():Promise<void>{let n=1;const r=constRef(n);await make(r);n=2;}'));

test('native async rejects a task frame escaping the block of a reference capture',()=>error('async function use(cb:()=>void):Promise<void>{cb();}async function run():Promise<void>{let t=sleep(1);{let n=0;t=use(():void=>{n+=1;});}await t;}',/E4210/));
test('native async permits a reference frame awaited inside its block',()=>check('async function use(cb:()=>void):Promise<void>{cb();}async function run():Promise<void>{{let n=0;const t=use(():void=>{n+=1;});await t;}}'));

test('native async does not waive the return of a synchronous Task factory',()=>error('function make():Promise<void>{}',/rutas/));
test('native async requires a return after a possibly empty for-await',()=>error('async function make(xs:Promise<number>[]):Promise<number>{for await(const n of xs){return n;}}',/rutas/));
test('native async external task creation keeps unknown effects',()=>error('class B{}let p:ptr<B> = new B();async function external():Promise<void>;const t=external();',/E4104/));
test('native async external code cannot silently retain a local reference closure',()=>error('async function external(cb:()=>void):Promise<void>;async function run():Promise<void>{let n=0;const t=external(():void=>{n+=1;});await t;}',/E4210/));

test('native async summaries preserve origins stored in a returned task frame',()=>{
 const g=check('async function use(cb:()=>number):Promise<number>{return cb();}function factory(cb:()=>number):Promise<number>{return use(cb);}');
 const summary=effect(g,'factory');assert.ok(summary.returned.includes(summary.parameters[0]));
});

test('native async rejects suspension in a field without a constructor lifetime contract',()=>error('async function make():Promise<number>{return 1;}class H{n:number = await make();}const h=new H();',/E4204/));
test('native async rejects an implicit blocking suspension in a field initializer',()=>error('async function make():Promise<number>{return 1;}class H{n:number = race([make()]);}const h=new H();',/E4204/));
test('native async permits task creation without suspension in a field initializer',()=>check('class H{t:Promise<void> = sleep(1);}let h=new H();await h.t;'));

function nativeConstants(g:any){return g.files.flatMap((f:any)=>f.constantValues.filter((s:string)=>s!=="").map((s:string)=>JSON.parse(s)));}
function constantNumberResult(body:string, expected:number, helpers=""){
 const g=check(helpers+'const answer:number=comptime(():number=>{'+body+'});');
 assert.equal(nativeConstants(g).at(-1).value,expected);return g;
}
for(const [name,body,expected] of [
 ['arithmetic','return 1+2*3;',7],
 ['block shadow','let x=10;{let x=99;x+=1;}return x;',10],
 ['outer assignment','let sum=0;{sum+=3;{sum+=4;}}return sum;',7],
 ['for scope','let i=100;let sum=0;for(let i=0;i<3;i+=1){sum+=i;}return i+sum;',103],
 ['continue','let sum=0;for(let i=0;i<5;i+=1){if(i==2)continue;sum+=i;}return sum;',8],
 ['break','let n=0;while(true){n+=1;if(n==3)break;}return n;',3],
 ['nested return','for(let i=0;i<4;i+=1){if(i==2){{return 12;}}}return 0;',12],
 ['array map','const xs=[1,2,3].map((x:number):number=>x*2);return xs[2];',6],
 ['array reduce','return [1,2,3].reduce(0,(s:number,x:number):number=>s+x);',6],
 ['callback capture','let sum=0;[1,2,3].forEach((x:number):void=>{sum+=x;});return sum;',6],
 ['callback shadow','let x=10;const xs=[1,2].map((x:number):number=>x+1);return x+xs[0];',12],
 ['array filter','const xs=[1,2,3].filter((x:number):boolean=>x>1);return xs.length;',2],
 ['array mutation','let xs:number[]=[];xs.push(2);xs.push(4);xs.pop();return xs[0];',2],
 ['array assignment','let xs=[1,2];xs[0]=7;return xs[0];',7],
 ['for of','let n=0;for(const x of [1,2,3]){n+=x;}return n;',6],
 ['destructure','const [x,y]=[2,3];return x+y;',5],
 ['math','return Math.floor(2.9)+Math.sqrt(4);',4],
 ['short circuit','let n=0;const ignored=true||((n+=1)>0);return n;',0],
 ['short circuit error','const ignored=false&&(1/0>0);return 1;',1],
 ['ternary','return true?7:1/0;',7],
 ['local helper','function twice(x:number):number{return x*2;}return twice(3);',6],
] as const)test(`native comptime evaluates ${name}`,()=>constantNumberResult(body,expected));
test('native comptime invokes recursive helpers with lexical environments',()=>constantNumberResult('return fact(5);',120,'function fact(n:number):number{if(n<=1)return 1;return n*fact(n-1);}'));
test('native comptime uses selected overload bodies',()=>constantNumberResult('return f(2);',3,'function f(x:number):number{return x+1;}function f(x:string):number{return x.length;}'));
test('native comptime preserves strings and templates',()=>{
 const g=check('const s:string=comptime(():string=>{const n=2;return `España ${n+1}`;});');assert.equal(nativeConstants(g).at(-1).value,'España 3');
});
test('native comptime preserves literal aggregate values',()=>{
 const g=check('const xs:number[]=comptime(():number[]=>[1,2,3]);');assert.deepEqual(nativeConstants(g).at(-1).value.map((v:any)=>v.value),[1,2,3]);
});
for(const [name,source,expected] of [
 ['u64','const n:u64=18446744073709551615;return n;','18446744073709551615'],
 ['u64 wrap','const n:u64=18446744073709551615;return n+1;','0'],
 ['i64 min','const n:i64=-9223372036854775808;return n;','-9223372036854775808'],
 ['exact intermediate','const n:u64=9007199254740993;return n+2;','9007199254740995'],
 ['integer cast','const n:u64=18446744073709551615;return i64(n);','-1'],
] as const)test(`native comptime preserves ${name}`,()=>{
 const resultType=name==='i64 min'||name==='integer cast'?'i64':'u64';
 const g=check('const n:'+resultType+'=comptime(():'+resultType+'=>{'+source+'});');assert.equal(nativeConstants(g).at(-1).exactInteger,expected);
});
for(const [name,source,pattern] of [
 ['division','const n=comptime(():number=>1/0);',/COMPTIME_(FLOAT|INTEGER)_DIVISION_ZERO/],
 ['instructions','const n=comptime(():number=>{while(true){}return 1;});',/COMPTIME_INSTRUCTION_LIMIT/],
 ['recursion','function f(n:number):number{return f(n+1);}const n=comptime(():number=>f(0));',/COMPTIME_RECURSION_LIMIT/],
 ['values','const n=comptime(():string=>"xx".repeat(1048576));',/COMPTIME_VALUE_LIMIT/],
 ['effect','const n=comptime(():number=>{print(1);return 2;});',/COMPTIME_FORBIDDEN_EFFECT/],
 ['random','const n=comptime(():number=>Math.random());',/COMPTIME_FORBIDDEN_EFFECT/],
 ['precision','const n=comptime(():number=>{const x:u64=9007199254740993;return Math.sqrt(x);});',/COMPTIME_INTEGER_PRECISION/],
 ['overflow','const n=comptime(():i64=>{const x:i64=9223372036854775807;return x+1;});',/COMPTIME_INTEGER_OVERFLOW/],
 ['semantic first','const n=comptime(():number=>{const x:number="s";return 1;});',/incompatible/],
 ['no void','const n=comptime(():void=>{});',/COMPTIME_NON_LITERAL/],
] as const)test(`native comptime rejects ${name}`,()=>error(source,pattern));
test('native comptime evaluates decorated calls and publishes metadata',()=>{
 const g=check('@comptime function f(n:number):number{return n+1;}const n=f(2);');assert.equal(nativeConstants(g).at(-1).value,3);assert.equal(g.decorators[0].name,'comptime');
});
test('native comptime defers only unavailable runtime arguments',()=>{
 const g=check('@comptime function f(n:number):number{return n+1;}function runtime(n:number):number{return f(n);}');assert.ok(g.files[0].constantStates.includes('deferred'));
});
test('native comptime never defers a genuine decorated body error',()=>error('@comptime function f():number{return 1/0;}const n=f();',/COMPTIME_(FLOAT|INTEGER)_DIVISION_ZERO/));
test('native comptime never defers an external effect in a decorated body',()=>error('@comptime function f():number{return argumentCount();}const n=f();',/COMPTIME_FORBIDDEN_EFFECT/));
for(const [name,source] of Object.entries({
 deprecated:'@deprecated("use g") function f():number{return 1;}',
 sealed:'@sealed class C{x:number=1;}',
 headers:'@include("local.hpp")\n@link("local")\nconst n=1;',
}))test(`native decorators preserve ${name}`,()=>{const g=check(source);assert.ok(g.decorators.length>0);});
for(const [name,source,pattern] of [
 ['unknown','@mystery function f():number{return 1;}',/Decorador/],
 ['argument','@deprecated(1) function f():number{return 1;}',/string/],
 ['duplicate','@deprecated @deprecated function f():number{return 1;}',/duplicado/],
 ['sealed target','@sealed function f():number{return 1;}',/clase/],
 ['comptime async','@comptime async function f():Promise<number>{return 1;}',/síncrona/],
] as const)test(`native decorators reject ${name}`,()=>error(source,pattern));

test('native comptime applies aggregate destination conversions',()=>{
 const g=check('const xs:i8[]=comptime(():i8[]=>[1,2]);');assert.deepEqual(nativeConstants(g).at(-1).value.map((v:any)=>[v.type,v.exactInteger]),[['i8','1'],['i8','2']]);
});
test('native comptime converts annotated object fields',()=>{
 const g=check('interface I{x:i8;}const obj:I=comptime(():I=>({x:2}));');assert.equal(nativeConstants(g).at(-1).value.x.exactInteger,'2');
});
test('native comptime reads a preceding local capture',()=>{
 const g=check('function run():number{const n=2;return comptime(():number=>n+1);}');assert.equal(nativeConstants(g).at(-1).value,3);
});
test('native comptime cannot reuse a stale mutable capture',()=>error('let n=1;n=2;const x=comptime(():number=>n);',/COMPTIME_VALUE_UNAVAILABLE/));
test('native comptime defers a decorated call after a runtime mutation',()=>{
 const g=check('let n=1;function set():void{n=2;}@comptime function f(x:number):number{return x;}set();const y=f(n);');assert.ok(g.files[0].constantCodes.includes('COMPTIME_VALUE_UNAVAILABLE'));
});
test('native comptime evaluates assignment lvalues before their right side',()=>constantNumberResult('let xs=[0,0];let n=0;xs[n+=1]=(n+=1);return xs[1]*10+n;',22));
test('native comptime reads a compound lvalue only once',()=>constantNumberResult('let xs=[1,2];let n=0;xs[n+=1]+=(n+=1);return xs[1]*10+n;',42));
test('native comptime treats arrays as values on assignment',()=>constantNumberResult('let xs=[1];let ys=xs;ys[0]=7;return xs[0]+ys[0];',8));
test('native comptime evaluates defaults in parameter order',()=>constantNumberResult('function f(x:number=2,y:number=x+1):number{return y;}return f();',3));
test('native comptime preserves named argument evaluation order',()=>constantNumberResult('let n=0;function f(x:number,y:number):number{return x*10+y;}return f(y:n+=1,x:n+=1);',21));
test('native comptime expands rest arguments',()=>constantNumberResult('function f(...xs:number[]):number{return xs.length+xs[1];}return f(1,3);',5));
test('native comptime evaluates switch fallthrough',()=>constantNumberResult('let n=0;switch(2){case 1:n+=1;break;case 2:n+=2;default:n+=3;}return n;',5));
test('native comptime isolates shadowed destructuring bindings',()=>constantNumberResult('let n=1;{const [n]=[7];}return n;',1));
test('native comptime indexes strings with narrow integers',()=>{
 const g=check('const s=comptime(():string=>{const n:i8=1;return "abc".charAt(n);});');assert.equal(nativeConstants(g).at(-1).value,'b');
});
test('native comptime preserves implicit f32 rounding',()=>constantNumberResult('const n:f32=16777217;return n;',16777216));
test('native comptime handles mixed exact comparisons',()=>{
 const g=check('const n=comptime(():boolean=>{const x:i64=-1;const y:u64=18446744073709551615;return x==y;});');assert.equal(nativeConstants(g).at(-1).value,true);
});
test('native comptime preserves a structured deferred reason',()=>{
 const g=check('@comptime function f(n:number):number{return n;}function run(n:number):number{return f(n);}');assert.ok(g.files[0].constantCodes.includes('COMPTIME_VALUE_UNAVAILABLE'));
});
test('native comptime imports constants and functions by original symbol identity',()=>{
 const g=check('import {f,n} from "./lib";const v=comptime(():number=>f(n));',{'lib.ets':'export const n=3;export function f(n:number):number{return n+2;}'});assert.equal(nativeConstants(g).at(-1).value,5);
});
test('native comptime evaluates decorated namespace calls',()=>{
 const g=check('import * as lib from "./lib";const v=lib.f(3);',{'lib.ets':'@comptime export function f(n:number):number{return n+2;}'});assert.equal(nativeConstants(g).at(-1).value,5);
});
test('native comptime evaluates namespace constants inside callbacks',()=>{
 const g=check('import * as lib from "./lib";const v=comptime(():number=>lib.n+1);',{'lib.ets':'export const n=3;'});assert.equal(nativeConstants(g).at(-1).value,4);
});

test('native comptime never converts the boolean result of a comparison to an operand type',()=>{
 const g=check('const a:i64=1;const b:u64=2;const n=a<b;');const f=g.files[0];const id=f.ast.nodes.findIndex((n:any)=>n.kind==='BinaryExpression');assert.equal(f.types[id],'boolean');assert.equal(f.conversions[id],'');
});
test('native comptime detects signed i32 overflow',()=>error('const n=comptime(():i32=>{const x:i32=2147483647;const y:i32=1;return x+y;});',/COMPTIME_INTEGER_OVERFLOW/));
test('native comptime detects signed minimum remainder overflow',()=>error('const n=comptime(():i64=>{const x:i64=-9223372036854775808;const y:i64=-1;return x%y;});',/COMPTIME_INTEGER_OVERFLOW/));
test('native comptime checks shift counts against the promoted left width',()=>error('const n=comptime(():i32=>{const x:i32=1;const y:u64=32;return x<<y;});',/COMPTIME_INTEGER_SHIFT/));
test('native comptime preserves signed right shift with an unsigned count',()=>{
 const g=check('const n=comptime(():i32=>{const x:i32=-4;const y:u64=1;return x>>y;});');assert.equal(nativeConstants(g).at(-1).exactInteger,'-2');
});
test('native comptime converts u64 directly to f32 without double rounding',()=>{
 const value=(1n<<63n)+(1n<<39n)+1n;
 const g=check('const n=comptime(():f32=>{const x:u64='+value+';return x;});');assert.equal(nativeConstants(g).at(-1).value,2**63+2**40);
});
test('native comptime preserves negative zero in a float result',()=>{
 const g=check('const n=comptime(():f64=>-0.0);');assert.ok(Object.is(nativeConstants(g).at(-1).value,-0));
});
test('native comptime materialization rejects nonfinite float results',()=>error('const n=comptime(():f64=>Math.sqrt(-1));',/COMPTIME_FLOAT_RANGE/));
test('native comptime checks nonfinite integer casts before conversion',()=>error('const n=comptime(():i32=>i32(Math.sqrt(-1)));',/COMPTIME_INTEGER_CAST/));
test('native comptime allows an explicitly rounded Math argument',()=>{
 const g=check('const n=comptime(():number=>{const x:u64=9007199254740993;return Math.sqrt(f64(x));});');assert.ok(Number.isFinite(nativeConstants(g).at(-1).value));
});
test('native comptime rounds map results before indexing the temporary',()=>constantNumberResult('const xs:f64[]=[16777217];return xs.map<f32>((x:f64):f64=>x)[0];',16777216));
test('native comptime supports typed object destructuring defaults',()=>constantNumberResult('interface I{x:number;}const a:I={x:3};const {x:n}=a;return n;',3));
test('native comptime uses fresh cells in each loop iteration',()=>constantNumberResult('let sum=0;for(let i=0;i<3;i+=1){let n=i;sum+=n;}return sum;',3));
test('native comptime evaluates array predicates only until their answer is known',()=>constantNumberResult('let count=0;const yes=[1,2,3].some((x:number):boolean=>{count+=1;return x==1;});return count;',1));
test('native comptime computes nested calls in one root environment',()=>{
 const g=check('@comptime function twice(n:number):number{return n*2;}@comptime function outer(n:number):number{return twice(n+1);}const n=outer(3);');assert.equal(nativeConstants(g).at(-1).value,8);
});
test('native comptime does not reset a budget through helper calls',()=>error('function spin():number{let n=0;while(n<10000){n+=1;}return n;}const n=comptime(():number=>spin());',/COMPTIME_INSTRUCTION_LIMIT/));
test('native comptime resets its budget for independent roots',()=>{
 const source=Array.from({length:4},(_,i)=>'const n'+i+'=comptime(():number=>{let sum=0;for(let n=0;n<150;n+=1){sum+=1;}return sum;});').join('');
 const g=check(source);assert.deepEqual(nativeConstants(g).map((v:any)=>v.value),[150,150,150,150]);
});
test('native comptime records an error code independent of message text',()=>{
 const g=error('const n=comptime(():number=>1/0);',/COMPTIME_FLOAT_DIVISION_ZERO/);assert.ok(g.files[0].constantCodes.includes('COMPTIME_FLOAT_DIVISION_ZERO'));
});
test('native comptime rejects unknown runtime captures instead of inventing a constant',()=>error('const input=argument(0);const n=comptime(():string=>input);',/COMPTIME_VALUE_UNAVAILABLE/));
test('native comptime rejects forward global reads with a TDZ diagnostic',()=>error('const n=comptime(():number=>later);const later=2;',/COMPTIME_TDZ|E4001/));
test('native comptime does not discard source errors in an unused result',()=>error('const n=comptime(():number=>{const xs:number[]=["s"];return 1;});',/incompatible/));
for(const [name,source] of Object.entries({
 arity:'i8();',
 extra:'i8(1,2);',
 value:'const cast=i64;',
 typeArgument:'class C{}i8<C>(1);',
 named:'i8(value:1);',
 string:'i8("s");',
}))test(`native numeric casts reject ${name}`,()=>run(fixture(source),1));
