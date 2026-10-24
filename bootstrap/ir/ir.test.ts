import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildLoader, root } from "../modules/build.ts";
const directory = mkdtempSync(join(root, "build-ir-test-"));
let binary: string;
before(async () => { binary = await buildLoader(join(directory, "binary"), "bootstrap/ir/test-driver.ets", true); });
after(() => rmSync(directory, { recursive: true, force: true }));
function run(source: string, files: Record<string,string> = {}, mode = "", status = 0) {
  const dir = mkdtempSync(join(directory, "fixture-"));
  for (const [name, text] of Object.entries({"main.ets": source, ...files})) { mkdirSync(dirname(join(dir,name)), {recursive:true}); writeFileSync(join(dir,name), text); }
  const p = spawnSync(binary, [join(dir,"main.ets"), ...(mode ? [mode] : [])], {encoding:"utf8", timeout:30000});
  assert.ifError(p.error); assert.equal(p.status, status, p.stderr + p.stdout.slice(-5000));
  const ir = JSON.parse(p.stdout); assert.equal(ir.success, status === 0); return ir;
}
function instructions(ir: any) { return ir.functions.flatMap((f:any) => f.blocks.flatMap((b:any) => b.instructions)); }
// A small test oracle executes the public IR, independently of the AST/checker.
function execute(ir:any) {
  const globals:any[] = []; const output:string[] = []; let budget = 10000;
  const coerce=(v:any,typeId:number):any=>{const shape=ir.typeDefinitions[typeId]; if(shape.kind==="scalar"&&shape.numericKind==="integer"){const raw=BigInt(Math.trunc(Number(v)));return Number(shape.signed?BigInt.asIntN(shape.bits,raw):BigInt.asUintN(shape.bits,raw));}if(shape.numericKind==="float")return shape.bits===32?Math.fround(Number(v)):Number(v);return v;};
  const copy=(v:any):any=>v && typeof v==="object" ? v.irref||v.owner ? v : v instanceof Map ? new Map([...v].map(([k,x])=>[k,copy(x)])) : v instanceof Set ? new Set([...v].map(copy)) : Array.isArray(v) ? v.map(copy) : Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)])) : v;
  function call(index:number, args:any[] = [], environment:any[] = []):any {
    const f = ir.functions[index]; const values:any[] = []; const locals:any[] = []; let p = 0;
    f.places.forEach((place:any,i:number) => { if(place.parameter) locals[i]=args[p++]; });
    const access=(i:number):{read:()=>any,write:(v:any)=>void}=>{
      const place=f.places[i];
      if(place.global>=0)return{read:()=>globals[place.global],write:v=>{globals[place.global]=v;}};
      if(place.kind==="capture") return f.captureModes[place.field]==="reference" ? environment[place.field] : {read:()=>environment[place.field],write:v=>{environment[place.field]=v;}};
      if(place.kind==="field"||place.kind==="index") { const parent=access(place.base);const key=place.kind==="field"?ir.typeDefinitions[f.places[place.base].typeId].names[place.field]:values[place.index];return{read:()=>parent.read()[key],write:v=>{parent.read()[key]=v;}}; }
      if(place.kind==="checkedView") return access(place.base);
      if(place.kind==="deref") { const parent=access(place.base).read();return parent.irref?parent:{read:()=>parent.data,write:v=>{parent.data=v;}}; }
      return{read:()=>locals[i],write:v=>{locals[i]=v;}};
    };
    const load=(i:number)=>copy(access(i).read());
    const store=(i:number,v:any)=>access(i).write(copy(v));
    let block = 0; const resumed=new Map<number,any>();
    while (--budget > 0) {
      const b = f.blocks[block];
      for (const i of b.instructions) {
        const a = i.operands.map((v:number)=>values[v]); let result:any;
        if(i.op === "constant") result = ir.types[i.typeId] === "string" ? i.text : ir.types[i.typeId] === "boolean" ? i.text === "true" : Number(i.text.replaceAll("_", ""));
        else if(i.op === "load") result=load(i.place);
        else if(i.op === "store") store(i.place,a[0]);
        else if(i.op === "convert") {
          const from=ir.typeDefinitions[f.values[i.operands[0]]],to=ir.typeDefinitions[i.typeId];
          const input=a[0]?.irref?a[0].read():a[0];
          result = to.kind==="Optional" && from.kind!=="Optional" ? {some:true,value:input} : ir.types[i.typeId] === "string" ? String(input) : ir.types[i.typeId] === "boolean" ? Boolean(input) : to.kind==="scalar" ? coerce(input,i.typeId) : copy(input);
        }
        else if(i.op === "move") {result=access(i.place).read();if(ir.typeDefinitions[i.typeId].resource)access(i.place).write(undefined);}
        else if(i.op === "borrow") result={irref:true,...access(i.place)};
        else if(i.op === "own") result={owner:true,data:a[0]};
        else if(i.op === "dropRemaining") access(i.place).write(undefined);
        else if(i.op === "dropValue" || i.op === "endBorrow") result=undefined;
        else if(i.op === "address") result={irref:true,...access(i.place)};
        else if(i.op === "closure") result={closure:i.callee,environment:a};
        else if(i.op === "callIndirect") result=call(a[0].closure,a.slice(1),a[0].environment);
        else if(i.op === "none") result={some:false};
        else if(i.op === "some") result={some:true,value:a[0]};
        else if(i.op === "result") result={kind:i.text,value:a[0]};
        else if(i.op === "aggregate") result=a.flatMap((v:any,k:number)=>i.names[k]==="spread"?v:[v]);
        else if(i.op === "iterator") result={source:access(i.place),position:0,mode:i.text};
        else if(i.op === "iterHasNext") {const source=a[0].source.read();result=a[0].position < (source instanceof Map||source instanceof Set?source.size:source.length);}
        else if(i.op === "iterNext") {
          const cursor=a[0],source=cursor.source.read(),position=cursor.position++;
          const keys=source instanceof Map||source instanceof Set?[...source.keys()]:Object.keys(source);
          const key=keys[position];
          result=cursor.mode==="keys"?source instanceof Map?key:Number(key):source instanceof Map?[key,copy(source.get(key))]:source instanceof Set?[...source][position]:copy(source[key]);
          if(ir.typeDefinitions[i.typeId].kind==="constRef"||ir.typeDefinitions[i.typeId].kind==="ref")result={irref:true,read:()=>source[key]?.owner?source[key].data:source[key],write:(v:any)=>{source[key]=v;}};
        }
        else if(i.op === "isPresent") {const input=a[0]?.irref?a[0].read():a[0];result=input.some;}
        else if(i.op === "unwrap") result=a[0].value;
        else if(i.op === "typeTag") {let shape=ir.typeDefinitions[i.signature];let text=ir.types[i.signature];if(["ref","constRef"].includes(shape.kind))text=ir.types[shape.arguments[0]];result=text==="number"?"number":text==="string"?"string":text==="boolean"?"boolean":text==="void"?"undefined":"object";}
        else if(i.op === "typeTest") result=typeof (a[0]?.irref?a[0].read():a[0])===(ir.types[i.signature]==="number"?"number":ir.types[i.signature]);
        else if(i.op === "runtimeCall") {
          const name=ir.runtimeContracts[i.contract].name;
          const input=a[0]?.irref?a[0].read():a[0];
          if(name==="builtin.optionalSome")result={some:true,value:a[0]};
          else if(name==="builtin.optionalNone")result={some:false};
          else if(name==="builtin.optionalIsPresent"||name==="Optional.isPresent")result=input.some;
          else if(name==="builtin.optionalValue"||name==="Optional.value")result=input.value;
          else if(name==="builtin.numberToString"||name==="builtin.booleanToString")result=String(a[0]);
          else if(name==="Console.log"||name==="Console.info")output.push(a.join(" "));
          else if(name==="array.push")input.push(...a.slice(1));
          else if(name==="array.pop")input.pop();
          else if(name==="array.delete")input.splice(a[1],1);
          else if(name==="Map.set")input.set(a[1],a[2]);
          else if(name==="Map.get")result=input.get(a[1]);
          else if(name==="Map.size")result=input.size;
          else if(name==="Set.add")input.add(a[1]);
          else if(name==="Map.delete"||name==="Set.delete")result=input.delete(a[1]);
          else if(name==="array.map")result=input.map((value:any,index:number)=>call(a[1].closure,[value,index],a[1].environment));
          else assert.fail(name);
        }
        else if(i.op === "collection") result=ir.typeDefinitions[i.typeId].kind==="Map"?new Map():new Set();
        else if(i.op === "emptyRecord") result={};
        else if(i.op === "variant") {const shape=ir.typeDefinitions[i.typeId];result={kind:shape.tag,...Object.fromEntries(i.names.map((name:string,k:number)=>[name,a[k]]))};if(shape.discriminator)result[shape.discriminator]=shape.discriminatorValue;}
        else if(i.op === "record") result=Object.fromEntries(i.names.map((name:string,k:number)=>[name,a[k]]));
        else if(i.op === "property") {const input=a[0]?.irref?a[0].read():a[0];result=i.text==="length"?input.length:i.text==="size"?input.size:input[i.text];}
        else if(i.op === "extractIndex") result=copy(a[0][a[1]]);
        else if(i.op === "call") result=call(i.callee,a);
        else if(i.op === "taskCreate") result={owner:true,task:()=>call(i.callee,a)};
        else if(i.op === "resume") result=resumed.get(i.continuation);
        else if(i.op === "dropFrame") {for(const value of f.frameValues)if(ir.typeDefinitions[f.values[value]].resource)values[value]=undefined;for(const place of f.framePlaces)if(ir.typeDefinitions[f.places[place].typeId].resource)access(place).write(undefined);}
        else if(i.op === "intrinsic") output.push(a.map((v:any)=>v?.irref?v.read():v).join(" "));
        else if(i.op === "unary") result = i.text === "!" ? !a[0] : i.text === "-" ? -a[0] : +a[0];
        else if(i.op === "binary") {
          const ops:Record<string,()=>any> = { "+":()=>a[0]+a[1], "-":()=>a[0]-a[1], "*":()=>a[0]*a[1], "/":()=>a[0]/a[1], "%":()=>a[0]%a[1], "<":()=>a[0]<a[1], ">":()=>a[0]>a[1], "<=":()=>a[0]<=a[1], ">=":()=>a[0]>=a[1], "==":()=>a[0]===a[1], "!=":()=>a[0]!==a[1] };
          assert.ok(ops[i.text],i.text); result=ops[i.text]();
        } else assert.fail(i.op);
        if(i.result >= 0) values[i.result]=result;
      }
      if(b.terminator === "return") return b.value >= 0 ? values[b.value] : undefined;
      if(b.terminator === "suspend"){const task=values[b.value];resumed.set(block,task.task());values[b.value]=undefined;block=b.targets[0];continue;}
      if(b.terminator === "cancel") return undefined;
      if(b.terminator === "jump") block=b.targets[0];
      else if(b.terminator === "branch") block=b.targets[values[b.value] ? 0 : 1];
      else assert.fail("Reached " + b.terminator);
    }
    assert.fail("IR execution budget");
  }
  for(const initializer of ir.initializationOrder) call(initializer);
  return output;
}
test("native IR: empty project and source identities", () => {
  const ir=run(""); assert.equal(ir.format,"ets-ir-2"); assert.deepEqual(execute(ir),[]);
  assert.equal(ir.functions[ir.entry].source.moduleId,ir.modules[0].id); assert.ok(ir.modules[0].sourceHash);
});
test("native IR: arithmetic, mutable places and numeric conversions", () => {
  const ir=run('let n:i32=2; n+=3; print(n*2);'); assert.deepEqual(execute(ir),["10"]); assert.ok(instructions(ir).some((i:any)=>i.op==="convert"));
});
test("native IR: recursive calls and returns", () => {
  assert.deepEqual(execute(run('function fact(n:number):number{if(n==0)return 1;return n*fact(n-1);} print(fact(5));')),["120"]);
});
test("native IR: loops, nested break and continue", () => {
  assert.deepEqual(execute(run('let sum=0; for(let i=0;i<6;i+=1){if(i==1)continue;if(i==5)break;sum+=i;} while(sum<12){sum+=1;} print(sum);')),["12"]);
});
test("native IR: boolean short circuit and ternary preserve effects", () => {
  const ir=run('let n=0; function touch():boolean{n+=1;return true;} const a=false&&touch();const b=true||touch();const c=true?7:8;print(n,a,b,c);');
  assert.deepEqual(execute(ir),["0 false true 7"]); assert.ok(!instructions(ir).some((i:any)=>["&&","||"].includes(i.text)));
});
test("native IR: named arguments evaluate in source order", () => {
  const ir=run('let n=0;function next():number{n+=1;return n;}function pair(a:number,b:number):number{return a*10+b;} print(pair(b:next(),a:next()));');
  assert.deepEqual(execute(ir),["21"]);
});
test("native IR: modules initialize dependencies once, aliases use symbol identities", () => {
  const ir=run('import {get as first} from "./dep";import {get as second} from "./dep";print(first(),second());',{"dep.ets":'export let value=3;export function get():number{return value;} print("dep");'});
  assert.equal(ir.initializationOrder.length,2); assert.deepEqual(execute(ir),["dep","3 3"]);
});
test("native IR: string constants, unary and void functions", () => {
  assert.deepEqual(execute(run('function f():void{print("hola",!false,-2);return;} f();')),["hola true -2"]);
});
for(const mode of ["input","table","hash","identity"]) test(`native IR rejects ${mode} contract`,()=>{const ir=run('const x=1;',{},mode,1);assert.equal(ir.diagnostics[0].code,"IR_INPUT");});
for(const mode of ["entry","order","target","terminator","result","use","duplicate","operator","place","return","callee"]) test(`native verifier rejects ${mode}`,()=>{
  const ir=run('function f(n:number):number{return -n;} print(f(1));',{},mode,1); assert.ok(ir.diagnostics.some((d:any)=>d.code==="IR_INVALID"));
});
test("native verifier checks dominance across arms",()=>{const ir=run('function f(b:boolean):number{if(b)return 1;else return 2;} print(f(true));',{},"dominance",1);assert.ok(ir.diagnostics.some((d:any)=>/domina/.test(d.message)));});
test("native verifier checks initialization at joins",()=>{const ir=run('function f(b:boolean):number{return b?1:2;} print(f(true));',{},"uninitialized",1);assert.ok(ir.diagnostics.some((d:any)=>/inicializar/.test(d.message)));});

test("native IR preserves exact i64/u64 literal text",()=>{
  const ir=run('const a:i64=-9223372036854775808;const b:u64=18446744073709551615;print(a,b);');
  const constants=instructions(ir).filter((i:any)=>i.op==="constant");
  assert.ok(constants.some((i:any)=>ir.types[i.typeId]==="i64"&&i.text==="-9223372036854775808"));
  assert.ok(constants.some((i:any)=>ir.types[i.typeId]==="u64"&&i.text==="18446744073709551615"));
});
test("native verifier rejects malformed numeric constants",()=>{
  const ir=run('function f():number{return 1;} print(f());',{},"constant",1);
  assert.ok(ir.diagnostics.some((d:any)=>/numérica/.test(d.message)));
});
test("native IR rejects cyclic runtime initialization",()=>{
  const ir=run('import "./dep";print("main");',{"dep.ets":'import "./main";print("dep");'},"",1);
  assert.ok(ir.diagnostics.some((d:any)=>d.code==="IR_INPUT"||/Ciclo/.test(d.message)));
});

for(const [name,source,expected] of [
 ["arrays",'let a:number[]=[1,2];a[1]=3;print(a[0],a[1],a.length);',["1 3 2"]],
 ["tuple",'let a:[number,string]=[1,"x"];a[0]=2;print(a[0],a[1]);',["2 x"]],
 ["records",'interface I{x:number;y:string;}let a:I={x:1,y:"s"};a.x=4;print(a.x,a.y);',["4 s"]],
 ["spread",'const a=[1,2];const b=[0,...a,3];print(b.length,b[2]);',["4 2"]],
 ["for of/in",'let s=0;for(const n of [2,3,4]){if(n==3)continue;s+=n;}for(const i in [7,8])s+=i;print(s);',["7"]],
 ["switch",'let s="";switch(2){case 1:s+="a";break;case 2:s+="b";default:s+="c";}print(s);',["bc"]],
 ["template",'const n=2;print(`n=${n+1}!`);',["n=3!"]],
 ["defaults",'let n=0;function next():number{n+=1;return n;}function f(a:number=next(),b:number=next()):number{return a*10+b;}print(f(),f(5),n);',["12 53 3"]],
 ["rest",'function total(...xs:number[]):number{let n=0;for(const x of xs)n+=x;return n;}print(total(1,2,3));',["6"]],
 ["generic",'function id<T>(x:T):T{return x;}print(id(2),id("s"));',["2 s"]],
 ["arrow",'const f=(x:number):number=>x+1;print(f(2));',["3"]],
 ["escaping capture",'function make(n:number):(x:number)=>number{return (x:number):number=>n+x;}const f=make(10);print(f(2));',["12"]],
 ["mutable capture",'let n=0;const f=():number=>{n+=1;return n;};print(f(),f());',["1 2"]],
 ["local reference capture",'function f():number{let n=0;const bump=():void=>{n+=1;};bump();bump();return n;}print(f());',["2"]],
 ["nested function",'function f(n:number):number{function add(x:number):number{return n+x;}return add(2);}print(f(3));',["5"]],
] as const) test(`native IR extended ${name}`,()=>assert.deepEqual(execute(run(source)),expected));

for(const [name,source,expected] of [
 ["composition",'class C{x:number;y:string;}const c=new C(2,"s");print(c.x,c.y);',["2 s"]],
 ["field defaults",'class C{x:number=2;}let c=new C();c.x+=3;print(c.x);',["5"]],
 ["constructor",'class C{x:number;constructor(n:number){this.x=n+1;}}const c=new C(2);print(c.x);',["3"]],
 ["property constructor",'class C{constructor(public x:number){}}const c=new C(4);print(c.x);',["4"]],
 ["method",'class C{x:number=1;inc(n:number):number{this.x+=n;return this.x;}}let c=new C();print(c.inc(2),c.x);',["3 3"]],
 ["generic class",'class Box<T>{value:T;}const c=new Box<number>(3);print(c.value);',["3"]],
] as const) test(`native IR classes ${name}`,()=>assert.deepEqual(execute(run(source)),expected));

test("native IR retains every numeric width and signedness",()=>{
  const names=["i8","u8","i16","u16","i32","u32","i64","u64","f32","f64","number"];
  const ir=run(names.map((name,k)=>`const n${k}:${name}=1;print(n${k});`).join(""));
  for(const name of names){const index=ir.types.indexOf(name);assert.ok(index>=0,name);const shape=ir.typeDefinitions[index];assert.equal(shape.bits,name==="number"?64:Number(name.slice(1)));assert.equal(shape.numericKind,name==="number"||name.startsWith("f")?"float":"integer");assert.equal(shape.signed,!name.startsWith("u"));}
});
test("native IR records narrow integer promotions explicitly",()=>{
  const ir=run('const a:i8=1;const b:i8=2;const c=a+b;print(c);');
  const sum=instructions(ir).find((i:any)=>i.op==="binary"&&i.text==="+");assert.equal(ir.types[sum.typeId],"i32");
  assert.deepEqual(execute(ir),["3"]);
});

test("native IR preserves opaque runtime requirements explicitly",()=>{
  const ir=run('const result=readFile("input.txt");print(result);');
  const contract=ir.runtimeContracts.find((c:any)=>c.name==="builtin.readFile");assert.ok(contract);assert.ok(contract.effects.includes("opaque"));assert.equal(contract.capability,"runtime:builtin.readFile");
});
for(const [name,source,expected] of [
 ["owner move",'class C{n:number=3;}let p:ptr<C> = new C();const q=move(p);print(q.n);',["3"]],
 ["local cleanup",'class C{n:number=2;}function f():number{let p:ptr<C> = new C();return p.n;}print(f());',["2"]],
 ["borrow",'function f():void{let n=1;const r=constRef(n);print(r);n=2;print(n);}f();',["1","2"]],
] as const) test(`native IR memory ${name}`,()=>{const ir=run(source);if(name!=="borrow")assert.ok(instructions(ir).some((i:any)=>i.op==="dropRemaining"));assert.deepEqual(execute(ir),expected);});

for(const [name,source,expected] of [
 ["task body",'async function f():Promise<number>{return 3;}print(await f());',["3"]],
 ["nested await",'async function one():Promise<number>{return 1;}async function f():Promise<number>{const n=await one();return n+2;}print(await f());',["3"]],
 ["task variable",'async function one():Promise<number>{return 2;}const task=one();print(await task);',["2"]],
 ["owner frame",'class C{n:number=2;}async function one():Promise<number>{return 3;}async function f():Promise<number>{const p:ptr<C> = new C();return p.n+await one();}print(await f());',["5"]],
] as const) test(`native IR async ${name}`,()=>{const ir=run(source);assert.ok(ir.functions.some((f:any)=>f.blocks.some((b:any)=>b.terminator==="suspend")));assert.deepEqual(execute(ir),expected);});

for(const [mode,source,pattern] of [
 ["numeric-bits",'const n:i8=1;print(n);',/Anchura/],
 ["no-end",'function f():void{let n=1;const r=constRef(n);print(r);n=2;}f();',/préstamo|préstamos/],
 ["no-drop",'class C{}function f():void{const p:ptr<C> = new C();}f();',/recurso/],
 ["no-frame-drop",'class C{}async function one():Promise<number>{return 1;}async function f(p:ptr<C>):Promise<number>{return await one();}print(await f(new C()));',/recurso/],
] as const) test(`native verifier rejects ${mode} contract`,()=>{const ir=run(source,{},mode,1);assert.ok(ir.diagnostics.some((d:any)=>pattern.test(d.message)),JSON.stringify(ir.diagnostics));});

for(const [name,source,expected] of [
 ["optional fallback",'let n=0;function fallback():number{n+=1;return 9;}const a=optionalSome(2);const b=optionalNone<number>();print(a??fallback(),b??fallback(),n);',["2 9 1"]],
 ["optional access",'class C{x:number=3;}const a=optionalSome(new C());const b=optionalNone<C>();print(a?.x??0,b?.x??0);',["3 0"]],
 ["optional arguments",'class C{x:number=1;get(n:number):number{return n;}}let n=0;function next():number{n+=1;return n;}const a=optionalNone<C>();const x=a?.get(next());print(x??9,n);',["9 0"]],
 ["implicit ref argument",'function inc(n:ref<number>):void{n=n+1;}let n=1;inc(n);print(n);',["2"]],
 ["pointer method",'class C{x:number=1;inc():void{this.x+=1;}}let p:ptr<C> = new C();p.inc();print(p.x);',["2"]],
 ["destructure",'const [a,b]=[1,"s"];print(a,b);',["1 s"]],
 ["destructure default",'const [a:number=2,b:number=a+1]=[];print(a,b);',["2 3"]],
 ["destructure object",'interface C{x:number;y:string;}const {x:a,y:b}:C={x:1,y:"s"};print(a,b);',["1 s"]],
 ["array methods",'let a=[1,2];a.push(3);delete a[0];print(a[0],a.length);',["2 2"]],
 ["map iteration",'let m=new Map<string,number>();m.set("a",1);m.set("b",2);let sum=0;for(const pair of m)sum+=pair[1];print(sum);',["3"]],
 ["for await",'async function one(n:number):Promise<number>{return n;}const tasks=[one(1),one(2)];let n=0;for await(const x of tasks)n+=x;print(n);',["3"]],
] as const) test(`native IR complete constructs ${name}`,()=>assert.deepEqual(execute(run(source)),expected));

for(const [name,source,expected] of [
 ["comptime primitive",'const n=comptime(():number=>1+2*3);print(n);',["7"]],
 ["comptime aggregate",'const a=comptime(():number[]=>[2,3]);print(a[0],a[1]);',["2 3"]],
 ["comptime exact",'@comptime function f(n:u8):i8{return n;}const n:i64=511;print(f(n));',["-1"]],
 ["integer wrapping",'function f(n:u8):u8{n+=255;return n;}print(f(1));',["0"]],
 ["recursive generic",'function count<T>(n:number,x:T):number{if(n==0)return 0;return 1+count(n-1,x);}print(count(3,"s"));',["3"]],
] as const) test(`native IR semantic constants ${name}`,()=>assert.deepEqual(execute(run(source)),expected));

for(const [name,source,expected] of [
 ["tagged variants",'union Choice = A(number) | B; function show(c:Choice):number { if(c.kind == "A") return c.value; return 0; } print(show(Choice.A(7))); print(show(Choice.B()));',["7","0"]],
 ["literal match",'function f(n:number):string{return match(n,[when(1,():string=>"one"),otherwise(():string=>"many")]);} print(f(1));print(f(2));',["one","many"]],
 ["variant match",'union Shape = Circle | Square; function f(s:Shape):string{return match(s,"kind",[when("Circle",(s:Shape):string=>"circle"),otherwise((s:Shape):string=>"other")]);} print(f(Shape.Circle())); print(f(Shape.Square()));',["circle","other"]],
 ["type match",'let x:string|number="yes";match(x,[whenType<string>(()=>print("string")),whenType<number>(()=>print("number"))]);',["string"]],
] as const) test(`native IR variants and match ${name}`,()=>assert.deepEqual(execute(run(source)),expected));

test("native IR typeof is static and does not execute its operand",()=>assert.deepEqual(execute(run('print(typeof print("unused")); print(typeof [1,2]); print(typeof 1);')),["undefined","object","number"]));
test("native IR variadic substitution flattens packs",()=>assert.deepEqual(execute(run('function f<...T>(...values:T):void{print(values);} f(1,"a"); f<boolean>(true);')),["1,a","true"]));
test("native IR reads resource container length without copying",()=>{const ir=run('class C{x:number=1;}let xs:ptr<C>[]=[new C()];print(xs.length);');assert.ok(instructions(ir).some((i:any)=>i.op==="borrow"));assert.deepEqual(execute(ir),["1"]);});
test("native IR materializes floating exponent constants",()=>assert.deepEqual(execute(run('const x=comptime(():number=>10000000000*10000000000*100);print(x>0);')),["true"]));

test("native IR initializes static fields once and resolves static methods",()=>assert.deepEqual(execute(run('class C{static count:number=1;static next():number{C.count+=1;return C.count;}}print(C.next(),C.next(),C.count);')),["2 3 3"]));
test("native IR preserves effect contracts with persistent symbol identities",()=>{const ir=run('let n=0;function bump():void{n+=1;}bump();');const f=ir.functions.find((f:any)=>f.name==="bump");assert.ok(f.effectContracts.length);const effects=f.effectContracts.map((id:number)=>ir.effectContracts[id]);assert.ok(effects.some((e:any)=>e.writes.includes(ir.globals[0].symbolId)));for(const e of ir.effectContracts)for(const x of [...e.reads,...e.writes,...e.moves,...e.parameters])assert.equal(typeof x,"string");});

test("native IR resource assignment transfers ownership exactly once",()=>assert.deepEqual(execute(run('class C{children:ptr<C>[];constructor(){this.children=[];}}let root:ptr<C> = new C();print(root.children.length);')),["0"]));
