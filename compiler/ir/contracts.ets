import { IrSource, IrProject, IrAnnotation, IrEffectContract, IrEffectBorrow } from "./model";
import { ModuleGraph } from "../modules/loader";
import { CheckResult } from "../checker/model";
function contractSource(graph: constRef<ModuleGraph>, checked: constRef<CheckResult>, module: number, id: number): IrSource {
  const n = graph.modules[module].cached.result.ast.nodes[id]; const record = checked.moduleRecords[module];
  let source = new IrSource(record.id,record.sourceHash,graph.modules[module].file,id,n.start.offset,n.end.endOffset);
  if (n.generatedId != "") { source.generatedId = n.generatedId; source.generatedStart = n.generatedStart.offset; source.generatedEnd = n.generatedEnd.endOffset; } return source;
}
function contractSymbols(checked: constRef<CheckResult>, symbols: number[]): string[] {
  let result: string[] = []; for (const symbol of symbols) result.push(symbol >= 0 && symbol < checked.symbolIds.length ? checked.symbolIds[symbol] : "unknown"); return result;
}
export function preserveContracts(graph: constRef<ModuleGraph>, checked: constRef<CheckResult>, project: IrProject): IrProject {
  // Own table order provides a one-to-one relocation of frontend summary edges.
  for (const effect of checked.effects) {
    let result = new IrEffectContract(contractSource(graph,checked,effect.module,effect.node));
    result.phase = effect.phase; result.creation = effect.creation; result.callees = effect.callees;
    result.parameters = contractSymbols(checked,effect.parameters); result.reads = contractSymbols(checked,effect.reads); result.writes = contractSymbols(checked,effect.writes); result.moves = contractSymbols(checked,effect.moves); result.invokes = contractSymbols(checked,effect.invokes); result.retains = contractSymbols(checked,effect.retains); result.returned = contractSymbols(checked,effect.returned);
    result.unknown = effect.unknown; result.recursive = effect.recursive; result.external = effect.external;
    for (const lease of effect.borrows) result.borrows.push(new IrEffectBorrow(contractSource(graph,checked,effect.module,lease.call),checked.symbolIds[lease.callback],checked.symbolIds[lease.root],lease.mode));
    project.effectContracts.push(result);
  }
  for (let f: number = 0; f < project.functions.length; f = f+1) for (let at: number = 0; at < project.effectContracts.length; at = at+1) if (project.functions[f].source.moduleId == project.effectContracts[at].source.moduleId && project.functions[f].source.node == project.effectContracts[at].source.node) project.functions[f].effectContracts.push(at);
  for (const annotation of checked.decorators) project.annotations.push(new IrAnnotation(contractSource(graph,checked,annotation.module,annotation.node),contractSource(graph,checked,annotation.module,annotation.target),annotation.name,annotation.arguments));
  return project;
}
