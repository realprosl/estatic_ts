import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { buildLoader, root } from "../modules/build.ts";

// Exercise verifier contracts directly: malformed IR must not be hidden by a
// frontend rejection or depend on a particular lowering instruction sequence.
test("native IR verifier: readonly receivers preserve capabilities", async () => {
  const directory = mkdtempSync(join(root, "build-readonly-verifier-"));
  try {
    const entry = join(directory, "main.ets");
    writeFileSync(entry, `
import { IrProject, IrType, IrSource, IrFunction, IrPlace, IrInstruction, IrDispatch } from "../bootstrap/ir/model";
import { IrVerifier } from "../bootstrap/ir/verify";
import { irAssignable } from "../bootstrap/ir/verify-shapes";
import { verifyFunctionContracts } from "../bootstrap/ir/verify-contracts";
function expect(value:boolean, label:string):void { if (!value) { printError(label); exitProcess(1); } }
function run():void {
  let p = new IrProject();
  p.types = ["number","void","Node","ref<Node>","constRef<Node>","I","ref<I>","constRef<I>","()=>number","readonly Node","constPtr<Node>"];
  for (const kind of ["scalar","scalar","record","ref","constRef","interface","ref","constRef","function","readonly","constPtr"]) p.typeDefinitions.push(new IrType(kind));
  p.typeDefinitions[3].arguments = [2]; p.typeDefinitions[4].arguments = [2];
  p.typeDefinitions[6].arguments = [5]; p.typeDefinitions[7].arguments = [5];
  p.typeDefinitions[8].arguments = [0]; p.typeDefinitions[9].arguments = [2]; p.typeDefinitions[10].arguments = [2];
  p.typeDefinitions[5].variants = [2];
  const source = new IrSource("test","hash","test.ets",0,0,1);
  let f = new IrFunction("caller","caller",1,source); f.values = [3,4,0,7,6];
  f.places.push(new IrPlace("loan",4,-1,true,source));
  let deref = new IrPlace("node",2,-1,false,source); deref.kind = "deref"; deref.base = 0; f.places.push(deref);
  let field = new IrPlace("field",0,-1,false,source); field.kind = "field"; field.base = 1; f.places.push(field);
  // A dispatch target keeps a mutable receiver: the polymorphic call
  // resolves the concrete handle at runtime. The verifier copies the project,
  // so the dispatch must exist before it is created.
  let dispatched = new IrFunction("get","get",0,source); dispatched.receiverType = 3; dispatched.parameterTypes = [3]; p.functions.push(dispatched);
  p.dispatches.push(new IrDispatch(5,2,"get",8,p.functions.length-1));
  let v = new IrVerifier(p);
  expect(v.readonlyPlace(f,1),"constRef deref must be readonly");
  expect(v.readonlyPlace(f,2),"constRef field projection must be readonly");
  expect(!v.readonlyPlace(f,0),"constRef handle storage is not readonly");
  for (const wrapper of [9,10]) { f.places[0].typeId = wrapper; expect(v.readonlyPlace(f,2),"readonly/constPtr ancestry"); }
  f.places[0].typeId = 4;
  let borrow = new IrInstruction("borrow",1,4,source); borrow.place = 1;
  v.instruction(f,borrow); expect(v.issues.length == 0,"readonly reborrow accepted");
  borrow.result = 0; borrow.typeId = 3; v.instruction(f,borrow);
  expect(v.issues.length > 0,"mutable reborrow rejected"); v.issues = [];
  let address = new IrInstruction("address",0,3,source); address.place = 1;
  v.instruction(f,address); expect(v.issues.length > 0,"mutable address rejected"); v.issues = [];
  address.result = 1; address.typeId = 4;
  v.instruction(f,address); expect(v.issues.length > 0,"address stays ref-only"); v.issues = [];
  let store = new IrInstruction("store",-1,-1,source); store.place = 2; store.operands = [2];
  v.instruction(f,store); expect(v.issues.length > 0,"projected readonly store rejected"); v.issues = [];
  let load = new IrInstruction("load",2,0,source); load.place = 2;
  v.instruction(f,load); expect(v.issues.length == 0,"projected readonly load accepted");
  let move = new IrInstruction("move",2,0,source); move.place = 2;
  v.instruction(f,move); expect(v.issues.length > 0,"projected readonly move rejected"); v.issues = [];
  p.typeDefinitions[2].resource = true;
  let drop = new IrInstruction("dropRemaining",-1,-1,source); drop.place = 1;
  v.instruction(f,drop); expect(v.issues.length > 0,"readonly drop rejected"); v.issues = [];
  f.places[0].typeId = 3; f.places[0].readOnly = true;
  expect(v.readonlyPlace(f,0),"readonly field storage protected");
  expect(!v.readonlyPlace(f,1),"shallow readonly field does not freeze mutable pointee");
  f.places[0].readOnly = false;
  address.result = 0; address.typeId = 3;
  v.instruction(f,address); expect(v.issues.length == 0,"mutable address accepted");
  expect(irAssignable(p,3,4,0),"exact ref to constRef widening");
  expect(!irAssignable(p,4,3,0),"constRef to ref rejected");
  let target = new IrFunction("get","get",0,source); target.receiverType = 4; target.parameterTypes = [4]; p.functions.push(target);
  expect(verifyFunctionContracts(p,target).length == 0,"constRef receiver contract accepted");
  target.parameterTypes = [3]; expect(verifyFunctionContracts(p,target).length > 0,"receiver metadata cannot disagree with first parameter"); target.parameterTypes = [4];
  // A dispatch target keeps a mutable receiver: the polymorphic call
  // resolves the concrete handle at runtime.
  let call = new IrInstruction("interfaceCall",2,0,source); call.signature = 8; call.text = "get"; call.operands = [4];
  v.instruction(f,call); expect(v.issues.length == 0,"interface call with mutable dispatch accepted"); v.issues = [];
  call.operands = [3];
  v.instruction(f,call); expect(v.issues.length > 0,"interface call must use a mutable receiver"); v.issues = [];
  print("readonly verifier ok");
}
run();
`);
    const binary = await buildLoader(join(directory, "binary"), relative(root, entry), true);
    const result = spawnSync(binary, [], { encoding: "utf8", timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /readonly verifier ok/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
