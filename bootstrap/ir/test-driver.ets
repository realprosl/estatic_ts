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
  let ir = lowerProject(project.graph,project.binding,project.checked);
  if (ir.success && mode == "") {
    const again = lowerProject(project.graph,project.binding,project.checked);
    if (formatIr(ir) != formatIr(again)) { printError("Non deterministic lowering"); exitProcess(3); }
  }
  if (ir.success && mode != "") {
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
