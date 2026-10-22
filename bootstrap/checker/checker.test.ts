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
test('native safety: owner in aggregate is rejected explicitly',()=>error(box+'const a:ptr<Box>[]=[];',/Ownership en agregados/));
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
