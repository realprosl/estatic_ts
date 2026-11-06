// Construct IR directly so profiling excludes loading, binding and checking.
import { IrProject, IrSource, IrType, IrFunction, IrBlock, IrPlace, IrInstruction } from "./model";
import { IrVerifier } from "./verify";
import { traceAnalysis } from "../frontend/analysis-trace";
import { irPlacePath } from "./verify-memory";

// Preserve the previous scan as an independent oracle for transition semantics.
function scanInitialization(f: constRef<IrFunction>, paths: string[], place: number, op: string, initialized: boolean[]): boolean[] {
  const key: string = paths[place];
  if (op == "store") {
    for (let p: number = 0; p < f.places.length; p = p+1) if (paths[p] == key || paths[p].startsWith(key+".")) initialized[p] = true;
    let parent: number = f.places[place].base;
    while (parent >= 0) {
      let all: boolean = true;
      for (let p: number = 0; p < f.places.length; p = p+1) if (f.places[p].base == parent && !initialized[p]) all = false;
      if (all) initialized[parent] = true;
      parent = f.places[parent].base;
    }
  }
  if (op == "move" || op == "dropRemaining") for (let p: number = 0; p < f.places.length; p = p+1) if (paths[p] == key || paths[p].startsWith(key+".") || key.startsWith(paths[p]+".")) initialized[p] = false;
  return initialized;
}

function checkRelations(): void {
  const source = new IrSource("profile","profile","profile.ets",0,0,0);
  let project = new IrProject(); project.types.push("ptr<number>");
  let shape = new IrType("ptr"); shape.resource = true; project.typeDefinitions.push(shape);
  let f = new IrFunction("relations","relations",0,source);
  // Duplicate fields, a checked-view alias, nested fields, dereferences,
  // constant indices 1/10 (prefix boundary), a dynamic index and another root.
  for (let p: number = 0; p < 11; p = p+1) f.places.push(new IrPlace("p"+numberToString(p),0,-1,false,source));
  for (let p: number = 1; p < 10; p = p+1) f.places[p].base = 0;
  f.places[1].kind = "field"; f.places[1].field = 0;
  f.places[2].kind = "field"; f.places[2].field = 1;
  f.places[3].kind = "field"; f.places[3].field = 0;
  f.places[4].kind = "checkedView"; f.places[4].base = 1;
  f.places[5].kind = "field"; f.places[5].base = 4; f.places[5].field = 2;
  f.places[6].kind = "deref";
  let block = new IrBlock(source);
  for (let p: number = 7; p < 10; p = p+1) { f.places[p].kind = "index"; f.places[p].index = p-7; }
  let ten = new IrInstruction("constant",0,0,source); ten.text = "10"; block.instructions.push(ten);
  let one = new IrInstruction("constant",1,0,source); one.text = "1"; block.instructions.push(one);
  f.blocks.push(block);
  let verifier = new IrVerifier(project);
  for (let p: number = 0; p < f.places.length; p = p+1) verifier.placePaths.push(irPlacePath(f,p,0));
  verifier.indexInitialization(f);
  let checks: number = 0;
  for (let sample: number = 0; sample < 32; sample = sample+1) for (let place: number = 0; place < f.places.length; place = place+1) for (const op of ["store","move","dropRemaining"]) {
    let state: boolean[] = [];
    for (let p: number = 0; p < f.places.length; p = p+1) state.push((sample*(p+3))%7 < 3);
    const expected: boolean[] = scanInitialization(f,verifier.placePaths,place,op,state);
    let instruction = new IrInstruction(op,-1,-1,source); instruction.place = place;
    const actual: boolean[] = verifier.updateInitialization(f,instruction,state);
    for (let p: number = 0; p < state.length; p = p+1) if (actual[p] != expected[p]) { printError("Transition mismatch"); exitProcess(3); }
    checks = checks+1;
  }
  // Reusing a verifier for another function must discard all previous edges.
  let empty = new IrFunction("empty","empty",0,source); verifier.placePaths = []; verifier.indexInitialization(empty);
  if (verifier.placeNodes.length != 0 || verifier.initializationNodes.length != 0 || verifier.physicalChildren.length != 0) exitProcess(3);
  print("{\"success\":true,\"checks\":"+numberToString(checks)+"}");
}

function profileVerification(): void {
  if (argumentCount() == 2 && argument(1) == "relations") { checkRelations(); return; }
  if (argumentCount() != 3) exitProcess(2);
  const mode: string = argument(1);
  const size: string = argument(2);
  const count: number = size == "256" ? 256 : size == "512" ? 512 : size == "1024" ? 1024 : 0;
  if (count == 0 || (mode != "stores" && mode != "cfg" && mode != "uninitialized")) exitProcess(2);
  const source = new IrSource("profile","profile","profile.ets",0,0,0);
  let project = new IrProject();
  project.types.push("void"); project.typeDefinitions.push(new IrType("scalar"));
  project.types.push("number"); project.typeDefinitions.push(new IrType("scalar"));
  let f = new IrFunction("profile","profile",0,source);
  for (let p: number = 0; p < count; p = p+1) {
    f.places.push(new IrPlace("local"+numberToString(p),1,-1,mode == "cfg",source));
    if (mode == "cfg") f.parameterTypes.push(1);
  }
  const blocks: number = mode == "cfg" ? count : 1;
  for (let b: number = 0; b < blocks; b = b+1) {
    let block = new IrBlock(source);
    block.terminator = "return";
    if ((b+1) < blocks) block.terminator = "jump";
    if ((b+1) < blocks) block.targets.push(b+1);
    f.blocks.push(block);
  }
  if (mode == "stores") {
    f.values.push(1);
    let value = new IrInstruction("constant",0,1,source); value.text = "1";
    f.blocks[0].instructions.push(value);
    for (let p: number = 0; p < count; p = p+1) {
      let store = new IrInstruction("store",-1,-1,source); store.place = p; store.operands.push(0);
      f.blocks[0].instructions.push(store);
    }
  }
  if (mode != "cfg") for (let p: number = 0; p < count; p = p+1) {
    const result: number = f.values.length; f.values.push(1);
    let load = new IrInstruction("load",result,1,source); load.place = p;
    f.blocks[0].instructions.push(load);
  }
  let verifier = new IrVerifier(project);
  traceAnalysis(true,"verify.profile","BEGIN");
  verifier.functionBody(f);
  traceAnalysis(true,"verify.profile","END");
  const expected: number = mode == "uninitialized" ? count : 0;
  if (verifier.issues.length != expected) {
    for (const issue of verifier.issues) printError(issue.message);
    exitProcess(3);
  }
  print("{\"success\":true,\"issues\":"+numberToString(verifier.issues.length)+"}");
}
profileVerification();
