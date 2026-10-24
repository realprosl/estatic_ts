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
  function call(index:number, args:any[] = []):any {
    const f = ir.functions[index]; const values:any[] = []; const locals:any[] = []; let p = 0;
    f.places.forEach((place:any,i:number) => { if(place.parameter) locals[i]=args[p++]; });
    const load = (i:number) => f.places[i].global >= 0 ? globals[f.places[i].global] : locals[i];
    const store = (i:number,v:any) => { if(f.places[i].global >= 0) globals[f.places[i].global]=v; else locals[i]=v; };
    let block = 0;
    while (--budget > 0) {
      const b = f.blocks[block];
      for (const i of b.instructions) {
        const a = i.operands.map((v:number)=>values[v]); let result:any;
        if(i.op === "constant") result = ir.types[i.typeId] === "string" ? i.text : ir.types[i.typeId] === "boolean" ? i.text === "true" : Number(i.text.replaceAll("_", ""));
        else if(i.op === "load") result=load(i.place);
        else if(i.op === "store") store(i.place,a[0]);
        else if(i.op === "convert") result = ir.types[i.typeId] === "string" ? String(a[0]) : ir.types[i.typeId] === "boolean" ? Boolean(a[0]) : Number(a[0]);
        else if(i.op === "call") result=call(i.callee,a);
        else if(i.op === "intrinsic") output.push(a.join(" "));
        else if(i.op === "unary") result = i.text === "!" ? !a[0] : i.text === "-" ? -a[0] : +a[0];
        else if(i.op === "binary") {
          const ops:Record<string,()=>any> = { "+":()=>a[0]+a[1], "-":()=>a[0]-a[1], "*":()=>a[0]*a[1], "/":()=>a[0]/a[1], "%":()=>a[0]%a[1], "<":()=>a[0]<a[1], ">":()=>a[0]>a[1], "<=":()=>a[0]<=a[1], ">=":()=>a[0]>=a[1], "==":()=>a[0]===a[1], "!=":()=>a[0]!==a[1] };
          assert.ok(ops[i.text],i.text); result=ops[i.text]();
        } else assert.fail(i.op);
        if(i.result >= 0) values[i.result]=result;
      }
      if(b.terminator === "return") return b.value >= 0 ? values[b.value] : undefined;
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
  const ir=run(""); assert.equal(ir.format,"ets-ir-1"); assert.deepEqual(execute(ir),[]);
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
for(const [name,source] of Object.entries({ resource:'class C{} const p:ptr<C> = new C();', closure:'const f=(x:number):number=>x+1;print(f(1));', opaque:'print(readFile("x"));', defaults:'function f(x:number=1):number{return x;}print(f());', generic:'function id<T>(x:T):T{return x;}print(id(1));', comptime:'@comptime function value():number{return 1;} const n=value();' })) {
  test(`native IR rejects unsupported ${name}`,()=>{const ir=run(source,{},"",1); assert.ok(ir.diagnostics.some((d:any)=>/IR_UNSUPPORTED|IR_INPUT/.test(d.code)));});
}
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
