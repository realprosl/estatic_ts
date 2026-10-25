import { formatContracts } from "./format-contracts";
import { IrSource, IrProject } from "./model";
import { quoteSource } from "../frontend/frontend";
import { bindingNumbers, bindingBoolean } from "../binder/format";
import { formatIrSource } from "./format-source";
export function formatIr(project: IrProject): string {
  let types: string[] = []; for (const typeId of project.types) types.push(quoteSource(typeId));
  let definitions: string[] = [];
  for (const shape of project.typeDefinitions) {
    let names: string[] = []; for (const name of shape.names) names.push(quoteSource(name));
    let methods: string[] = []; for (const name of shape.methods) methods.push(quoteSource(name));
    definitions.push("{\"methods\":["+methods.join(",")+"],\"methodTypes\":"+bindingNumbers(shape.methodTypes)+",\"kind\":"+quoteSource(shape.kind)+",\"variants\":"+bindingNumbers(shape.variants)+",\"tag\":"+quoteSource(shape.tag)+",\"discriminator\":"+quoteSource(shape.discriminator)+",\"discriminatorType\":"+numberToString(shape.discriminatorType)+",\"discriminatorValue\":"+quoteSource(shape.discriminatorValue)+",\"numericKind\":"+quoteSource(shape.numericKind)+",\"bits\":"+numberToString(shape.bits)+",\"signed\":"+bindingBoolean(shape.isSigned)+",\"arguments\":"+bindingNumbers(shape.arguments)+",\"fields\":"+bindingNumbers(shape.fields)+",\"names\":["+names.join(",")+"],\"symbolId\":"+quoteSource(shape.symbolId)+",\"resource\":"+bindingBoolean(shape.resource)+",\"length\":"+numberToString(shape.length)+"}");
  }
  let dispatches: string[] = [];
  for (const d of project.dispatches) dispatches.push("{\"interfaceType\":"+numberToString(d.interfaceType)+",\"concreteType\":"+numberToString(d.concreteType)+",\"name\":"+quoteSource(d.name)+",\"signature\":"+numberToString(d.signature)+",\"callee\":"+numberToString(d.callee)+"}");
  let contracts: string[] = [];
  for (const contract of project.runtimeContracts) { let effects: string[] = []; for (const effect of contract.effects) effects.push(quoteSource(effect)); contracts.push("{\"name\":"+quoteSource(contract.name)+",\"parameters\":"+bindingNumbers(contract.parameters)+",\"returns\":"+numberToString(contract.returns)+",\"effects\":["+effects.join(",")+"],\"capability\":"+quoteSource(contract.capability)+"}"); }
  let output: string[] = ['{"dispatches":['+dispatches.join(",")+"],"+formatContracts(project)+",\"format\":\"ets-ir-2\",\"success\":"+bindingBoolean(project.success)+",\"types\":["+types.join(",")+"],\"typeDefinitions\":["+definitions.join(",")+"],\"runtimeContracts\":["+contracts.join(",")+"],\"entry\":"+numberToString(project.entry)+",\"initializationOrder\":"+bindingNumbers(project.initializationOrder)+",\"finalizationOrder\":"+bindingNumbers(project.finalizationOrder)+",\"modules\":["];
  let comma: string = "";
  for (const module of project.modules) { output.push(comma+"{\"id\":"+quoteSource(module.id)+",\"sourceHash\":"+quoteSource(module.sourceHash)+",\"file\":"+quoteSource(module.file)+",\"initializer\":"+numberToString(module.initializer)+",\"finalizer\":"+numberToString(module.finalizer)+"}"); comma = ","; }
  output.push("],\"globals\":["); comma = "";
  for (const p of project.globals) { output.push(comma+"{\"symbolId\":"+quoteSource(p.symbolId)+",\"kind\":"+quoteSource(p.kind)+",\"base\":"+numberToString(p.base)+",\"index\":"+numberToString(p.index)+",\"field\":"+numberToString(p.field)+",\"typeId\":"+numberToString(p.typeId)+",\"source\":"+formatIrSource(p.source)+"}"); comma = ","; }
  output.push("],\"functions\":["); comma = "";
  for (const f of project.functions) {
    let leases: string[] = []; for (const lease of f.leases) leases.push("{\"place\":"+numberToString(lease.place)+",\"value\":"+numberToString(lease.value)+",\"mode\":"+quoteSource(lease.mode)+"}");
    let symbols: string[] = []; let modes: string[] = []; for (const value of f.captureSymbols) symbols.push(quoteSource(value)); for (const value of f.captureModes) modes.push(quoteSource(value));
    output.push(comma+"{\"name\":"+quoteSource(f.name)+",\"effectContracts\":"+bindingNumbers(f.effectContracts)+",\"signature\":"+quoteSource(f.signature)+",\"leases\":["+leases.join(",")+"],\"captureSymbols\":["+symbols.join(",")+"],\"captureTypes\":"+bindingNumbers(f.captureTypes)+",\"captureModes\":["+modes.join(",")+"],\"symbolId\":"+quoteSource(f.symbolId)+",\"returns\":"+numberToString(f.returns)+",\"bodyReturns\":"+numberToString(f.bodyReturns)+",\"asynchronous\":"+bindingBoolean(f.asynchronous)+",\"frameValues\":"+bindingNumbers(f.frameValues)+",\"framePlaces\":"+bindingNumbers(f.framePlaces)+",\"parameterTypes\":"+bindingNumbers(f.parameterTypes)+",\"values\":"+bindingNumbers(f.values)+",\"source\":"+formatIrSource(f.source)+",\"places\":["); comma = ",";
    let separator: string = "";
    for (const p of f.places) { output.push(separator+"{\"symbolId\":"+quoteSource(p.symbolId)+",\"kind\":"+quoteSource(p.kind)+",\"base\":"+numberToString(p.base)+",\"index\":"+numberToString(p.index)+",\"field\":"+numberToString(p.field)+",\"typeId\":"+numberToString(p.typeId)+",\"global\":"+numberToString(p.global)+",\"parameter\":"+bindingBoolean(p.parameter)+",\"source\":"+formatIrSource(p.source)+"}"); separator = ","; }
    output.push("],\"blocks\":["); separator = "";
    for (const block of f.blocks) {
      output.push(separator+"{\"terminator\":"+quoteSource(block.terminator)+",\"value\":"+numberToString(block.value)+",\"targets\":"+bindingNumbers(block.targets)+",\"source\":"+formatIrSource(block.source)+",\"instructions\":["); separator = ",";
      let sep: string = "";
      for (const i of block.instructions) { let effects: string[] = []; for (const effect of i.effects) effects.push(quoteSource(effect)); let names: string[] = []; for (const name of i.names) names.push(quoteSource(name)); output.push(sep+"{\"op\":"+quoteSource(i.op)+",\"effects\":["+effects.join(",")+"],\"result\":"+numberToString(i.result)+",\"typeId\":"+numberToString(i.typeId)+",\"operands\":"+bindingNumbers(i.operands)+",\"place\":"+numberToString(i.place)+",\"callee\":"+numberToString(i.callee)+",\"contract\":"+numberToString(i.contract)+",\"lease\":"+numberToString(i.lease)+",\"continuation\":"+numberToString(i.continuation)+",\"signature\":"+numberToString(i.signature)+",\"text\":"+quoteSource(i.text)+",\"names\":["+names.join(",")+"],\"source\":"+formatIrSource(i.source)+"}"); sep = ","; }
      output.push("]}");
    }
    output.push("]}");
  }
  output.push("],\"diagnostics\":["); comma = "";
  for (const issue of project.diagnostics) { output.push(comma+"{\"code\":"+quoteSource(issue.code)+",\"message\":"+quoteSource(issue.message)+",\"source\":"+formatIrSource(issue.source)+"}"); comma = ","; }
  output.push("]}"); return output.join("");
}
