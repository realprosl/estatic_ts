import { IrSource, IrProject } from "./model";
import { quoteSource } from "../frontend/frontend";
import { bindingNumbers, bindingBoolean } from "../binder/format";
function formatIrSource(source: IrSource): string {
  return "{\"moduleId\":"+quoteSource(source.moduleId)+",\"sourceHash\":"+quoteSource(source.sourceHash)+",\"file\":"+quoteSource(source.file)+",\"node\":"+numberToString(source.node)+",\"start\":"+numberToString(source.start)+",\"end\":"+numberToString(source.end)+"}";
}
export function formatIr(project: IrProject): string {
  let types: string[] = []; for (const typeId of project.types) types.push(quoteSource(typeId));
  let output: string[] = ["{\"format\":\"ets-ir-1\",\"success\":"+bindingBoolean(project.success)+",\"types\":["+types.join(",")+"],\"entry\":"+numberToString(project.entry)+",\"initializationOrder\":"+bindingNumbers(project.initializationOrder)+",\"modules\":["];
  let comma: string = "";
  for (const module of project.modules) { output.push(comma+"{\"id\":"+quoteSource(module.id)+",\"sourceHash\":"+quoteSource(module.sourceHash)+",\"file\":"+quoteSource(module.file)+",\"initializer\":"+numberToString(module.initializer)+"}"); comma = ","; }
  output.push("],\"globals\":["); comma = "";
  for (const p of project.globals) { output.push(comma+"{\"symbolId\":"+quoteSource(p.symbolId)+",\"typeId\":"+numberToString(p.typeId)+",\"source\":"+formatIrSource(p.source)+"}"); comma = ","; }
  output.push("],\"functions\":["); comma = "";
  for (const f of project.functions) {
    output.push(comma+"{\"name\":"+quoteSource(f.name)+",\"symbolId\":"+quoteSource(f.symbolId)+",\"returns\":"+numberToString(f.returns)+",\"parameterTypes\":"+bindingNumbers(f.parameterTypes)+",\"values\":"+bindingNumbers(f.values)+",\"source\":"+formatIrSource(f.source)+",\"places\":["); comma = ",";
    let separator: string = "";
    for (const p of f.places) { output.push(separator+"{\"symbolId\":"+quoteSource(p.symbolId)+",\"typeId\":"+numberToString(p.typeId)+",\"global\":"+numberToString(p.global)+",\"parameter\":"+bindingBoolean(p.parameter)+",\"source\":"+formatIrSource(p.source)+"}"); separator = ","; }
    output.push("],\"blocks\":["); separator = "";
    for (const block of f.blocks) {
      output.push(separator+"{\"terminator\":"+quoteSource(block.terminator)+",\"value\":"+numberToString(block.value)+",\"targets\":"+bindingNumbers(block.targets)+",\"source\":"+formatIrSource(block.source)+",\"instructions\":["); separator = ",";
      let sep: string = "";
      for (const i of block.instructions) { output.push(sep+"{\"op\":"+quoteSource(i.op)+",\"result\":"+numberToString(i.result)+",\"typeId\":"+numberToString(i.typeId)+",\"operands\":"+bindingNumbers(i.operands)+",\"place\":"+numberToString(i.place)+",\"callee\":"+numberToString(i.callee)+",\"text\":"+quoteSource(i.text)+",\"source\":"+formatIrSource(i.source)+"}"); sep = ","; }
      output.push("]}");
    }
    output.push("]}");
  }
  output.push("],\"diagnostics\":["); comma = "";
  for (const issue of project.diagnostics) { output.push(comma+"{\"code\":"+quoteSource(issue.code)+",\"message\":"+quoteSource(issue.message)+",\"source\":"+formatIrSource(issue.source)+"}"); comma = ","; }
  output.push("]}"); return output.join("");
}
