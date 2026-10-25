import { ModuleLoader, LoaderOptions } from "../modules/loader";
import { analyzeProject } from "../checker/expansion";
import { lowerProject } from "./lower";
import { verifyIr } from "./verify";
import { formatIr } from "./format";
import { IrInstruction } from "./model";
function testIr(): void {
  let loader = new ModuleLoader(new LoaderOptions()); const graph = loader.load(argument(1)); let project = analyzeProject(graph);
  const mode: string = argumentCount() > 2 ? argument(2) : "";
  if (mode == "input") project.checked.success = false;
  if (mode == "table") project.checked.files[0].types.pop();
  if (mode == "hash") project.checked.moduleRecords[0].sourceHash = "stale";
  if (mode == "identity") project.binding.files[0].valueTargets[0] = 999999;
  if (mode == "member-table") project.checked.files[0].members = [];
  if (mode == "signature-table") project.checked.files[0].signatures = [];
  if (mode == "constant-table") project.checked.files[0].constantStates = [];
  if (mode == "symbol-table") project.checked.symbolTypes = [];
  let ir = lowerProject(project.graph,project.binding,project.checked);
  if (ir.success && mode == "") {
    const again = lowerProject(project.graph,project.binding,project.checked);
    if (formatIr(ir) != formatIr(again)) { printError("Non deterministic lowering"); exitProcess(3); }
  }
  if (ir.success && mode != "") {
    if (mode == "early-end-arm") {
      let end = new IrInstruction("endBorrow",-1,-1,ir.functions[0].source); end.lease = 0;
      ir.functions[0].blocks[1].instructions.push(end);
    }
    if (mode == "fixed-count") for (let f: number = 0; f < ir.functions.length; f = f+1) for (let b: number = 0; b < ir.functions[f].blocks.length; b = b+1) for (let at: number = 0; at < ir.functions[f].blocks[b].instructions.length; at = at+1) {
      const i = ir.functions[f].blocks[b].instructions[at]; if (i.op == "aggregate" && ir.typeDefinitions[i.typeId].kind == "fixedArray") { ir.functions[f].blocks[b].instructions[at].operands.pop(); ir.functions[f].blocks[b].instructions[at].names.pop(); }
    }
    if (mode == "resource-flag") for (let at: number = 0; at < ir.typeDefinitions.length; at = at+1) ir.typeDefinitions[at].resource = false;
    if (mode == "finalizer") ir.modules[0].finalizer = 999999;
    if (mode == "finalization-order") ir.finalizationOrder = [];
    if (mode == "module-id") ir.modules[0].id = "";
    if (mode == "shape-kind") ir.typeDefinitions[0].kind = "imaginary";
    if (mode == "shape-child") for (let at: number = 0; at < ir.typeDefinitions.length; at = at+1) if (ir.typeDefinitions[at].arguments.length > 0) ir.typeDefinitions[at].arguments[0] = 999999;
    if (mode == "runtime-type") ir.runtimeContracts[0].returns = 999999;
    if (mode == "place-type") ir.functions[0].places[0].typeId = 999999;
    if (mode == "value-type") ir.functions[0].values[0] = 999999;
    if (mode == "capture-table") for (let f: number = 0; f < ir.functions.length; f = f+1) if (ir.functions[f].captureTypes.length > 0) ir.functions[f].captureModes = [];
    if (mode == "lease-mode") for (let f: number = 0; f < ir.functions.length; f = f+1) if (ir.functions[f].leases.length > 0) ir.functions[f].leases[0].mode = "invalid";
    if (mode == "frame-values" || mode == "frame-places" || mode == "frame-index" || mode == "no-resume" || mode == "duplicate-resume" || mode == "resume-entry") for (let f: number = 0; f < ir.functions.length; f = f+1) if (ir.functions[f].asynchronous) {
      if (mode == "frame-values") ir.functions[f].frameValues = [];
      if (mode == "frame-places") ir.functions[f].framePlaces = [];
      if (mode == "frame-index") ir.functions[f].frameValues.push(999999);
      for (let b: number = 0; b < ir.functions[f].blocks.length; b = b+1) {
        let retained: IrInstruction[] = [];
        for (const i of ir.functions[f].blocks[b].instructions) { if (!(mode == "no-resume" && i.op == "resume")) retained.push(i); if (mode == "duplicate-resume" && i.op == "resume") retained.push(i); }
        ir.functions[f].blocks[b].instructions = retained;
        if (mode == "resume-entry" && ir.functions[f].blocks[b].terminator == "suspend") ir.functions[f].blocks[b].targets[1] = ir.functions[f].blocks[b].targets[0];
      }
    }
    if (mode == "numeric-bits") for (let at: number = 0; at < ir.types.length; at = at+1) if (ir.types[at] == "i8") ir.typeDefinitions[at].bits = 64;
    if (mode == "no-end" || mode == "no-drop" || mode == "no-frame-drop") for (let f: number = 0; f < ir.functions.length; f = f+1) for (let b: number = 0; b < ir.functions[f].blocks.length; b = b+1) {
      let retained: IrInstruction[] = []; for (const i of ir.functions[f].blocks[b].instructions) if (!(mode == "no-end" && i.op == "endBorrow") && !(mode == "no-drop" && i.op == "dropRemaining") && !(mode == "no-frame-drop" && i.op == "dropFrame")) retained.push(i); ir.functions[f].blocks[b].instructions = retained;
    }
    if (mode == "entry") ir.entry = 999;
    if (mode == "order") ir.initializationOrder = [];
    if (mode == "constant") ir.functions[0].blocks[0].instructions[0].text = "invalid-number";
    if (mode == "target") ir.functions[0].blocks[0].targets = [999];
    if (mode == "terminator") ir.functions[0].blocks[0].terminator = "missing";
    if (mode == "result") ir.functions[0].blocks[0].instructions[0].result = 999;
    if (mode == "use") ir.functions[0].blocks[0].instructions[1].operands = [999];
    if (mode == "duplicate") ir.functions[0].blocks[0].instructions[1].result = ir.functions[0].blocks[0].instructions[0].result;
    if (mode == "operator") ir.functions[0].blocks[0].instructions[1].text = "unknown";
    if (mode == "place") ir.functions[0].blocks[0].instructions[0].place = 999;
    if (mode == "return") ir.functions[0].blocks[0].value = -1;
    if (mode == "callee") for (let f: number = 0; f < ir.functions.length; f = f+1) for (let b: number = 0; b < ir.functions[f].blocks.length; b = b+1) for (let i: number = 0; i < ir.functions[f].blocks[b].instructions.length; i = i+1) if (ir.functions[f].blocks[b].instructions[i].op == "call") ir.functions[f].blocks[b].instructions[i].callee = 999;
    if (mode == "dominance") {
      const source = ir.functions[0].source; const typeId: number = ir.functions[0].values[0];
      const value: number = ir.functions[0].values.length; ir.functions[0].values.push(typeId);
      let definition = new IrInstruction("constant",value,typeId,source); definition.text = "1";
      ir.functions[0].blocks[1].instructions.push(definition);
      ir.functions[0].blocks[2].value = value;
    }
    if (mode == "uninitialized") {
      // Turn one arm's store into a second load. The join may no longer read the place.
      for (let i: number = 0; i < ir.functions[0].blocks[1].instructions.length; i = i+1) if (ir.functions[0].blocks[1].instructions[i].op == "store") {
        const p: number = ir.functions[0].blocks[1].instructions[i].place;
        ir.functions[0].blocks[1].instructions[i].op = "load";
        ir.functions[0].blocks[1].instructions[i].operands = [];
        ir.functions[0].blocks[1].instructions[i].typeId = ir.functions[0].places[p].typeId;
        ir.functions[0].blocks[1].instructions[i].result = ir.functions[0].values.length;
        ir.functions[0].values.push(ir.functions[0].places[p].typeId);
      }
    }
    ir.diagnostics = verifyIr(ir); ir.success = ir.diagnostics.length == 0;
  }
  print(formatIr(ir)); if (!ir.success) exitProcess(1);
}
testIr();
