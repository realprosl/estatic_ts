import { IrSource, IrProject } from "./model";
import { quoteSource } from "../frontend/frontend";
import { bindingNumbers, bindingBoolean } from "../binder/format";
import { formatIrSource } from "./format-source";
function strings(values: string[]): string { let result: string[] = []; for (const value of values) result.push(quoteSource(value)); return "["+result.join(",")+"]"; }
export function formatContracts(project: constRef<IrProject>): string {
  let contracts: string[] = [];
  for (const effect of project.effectContracts) {
    let borrows: string[] = [];
    for (const lease of effect.borrows) borrows.push("{\"source\":"+formatIrSource(lease.source)+",\"callback\":"+quoteSource(lease.callback)+",\"root\":"+quoteSource(lease.root)+",\"mode\":"+quoteSource(lease.mode)+"}");
    contracts.push("{\"source\":"+formatIrSource(effect.source)+",\"phase\":"+quoteSource(effect.phase)+",\"creation\":"+numberToString(effect.creation)+",\"callees\":"+bindingNumbers(effect.callees)+",\"parameters\":"+strings(effect.parameters)+",\"reads\":"+strings(effect.reads)+",\"writes\":"+strings(effect.writes)+",\"moves\":"+strings(effect.moves)+",\"invokes\":"+strings(effect.invokes)+",\"retains\":"+strings(effect.retains)+",\"returned\":"+strings(effect.returned)+",\"borrows\":["+borrows.join(",")+"],\"unknown\":"+bindingBoolean(effect.unknown)+",\"recursive\":"+bindingBoolean(effect.recursive)+",\"external\":"+bindingBoolean(effect.external)+"}");
  }
  let annotations: string[] = []; for (const annotation of project.annotations) annotations.push("{\"source\":"+formatIrSource(annotation.source)+",\"target\":"+formatIrSource(annotation.target)+",\"name\":"+quoteSource(annotation.name)+",\"arguments\":"+strings(annotation.arguments)+"}");
  return "\"effectContracts\":["+contracts.join(",")+"],\"annotations\":["+annotations.join(",")+"]";
}
