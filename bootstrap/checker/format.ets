import { CheckResult } from "./checker";
import { BindingResult } from "../binder/binder";
import { ModuleGraph } from "../modules/loader";
import { formatBinding, bindingBoolean, bindingNumbers } from "../binder/format";
import { quoteSource } from "../frontend/frontend";
import { formatAst } from "../parser/parser";
export function formatChecked(result: CheckResult, binding: BindingResult, graph: ModuleGraph): string {
  let output: string[] = ["{\"success\":" + bindingBoolean(result.success) + ",\"binding\":" + formatBinding(binding,graph) + ",\"files\":["]; let comma: string = "";
  for (let m: number = 0; m < result.files.length; m = m + 1) {
    const file = result.files[m]; let types: string[] = []; for (const valueType of file.types) types.push(quoteSource(valueType));
    let signatures: string[] = []; for (const signature of file.signatures) signatures.push(quoteSource(signature));
    let exactIntegers: string[] = []; for (const value of file.exactIntegers) exactIntegers.push(quoteSource(value));
    let conversions: string[] = []; for (const value of file.conversions) conversions.push(quoteSource(value));
    let caseValues: string[] = []; for (const value of file.caseValues) caseValues.push(quoteSource(value));
    output.push(comma + "{\"file\":" + quoteSource(graph.modules[m].file) + ",\"ast\":" + formatAst(graph.modules[m].cached.result.ast) + ",\"types\":[" + types.join(",") + "],\"members\":" + bindingNumbers(file.members) + ",\"selected\":" + bindingNumbers(file.selected) + ",\"selectedModules\":" + bindingNumbers(file.selectedModules) + ",\"argumentParameters\":" + bindingNumbers(file.argumentParameters) + ",\"signatures\":[" + signatures.join(",") + "],\"exactIntegers\":[" + exactIntegers.join(",") + "],\"conversions\":[" + conversions.join(",") + "],\"caseValues\":[" + caseValues.join(",") + "]}"); comma = ",";
  }
  let symbols: string[] = []; for (const valueType of result.symbolTypes) symbols.push(quoteSource(valueType));
  output.push("],\"symbolTypes\":[" + symbols.join(",") + "],\"diagnostics\":["); comma = "";
  for (const d of result.diagnostics) {
    output.push(comma + "{\"file\":" + quoteSource(d.file) + ",\"phase\":" + quoteSource(d.phase) + ",\"message\":" + quoteSource(d.message) + ",\"offset\":" + numberToString(d.token.offset) + ",\"line\":" + numberToString(d.token.line) + ",\"column\":" + numberToString(d.token.column) + "}"); comma = ",";
  }
  output.push("],\"captures\":["); comma = "";
  for (const c of result.captures) {
    output.push(comma + "{\"module\":" + numberToString(c.module) + ",\"closure\":" + numberToString(c.closure) + ",\"symbol\":" + numberToString(c.symbol) + ",\"mode\":" + quoteSource(c.mode) + "}"); comma = ",";
  }
  output.push("],\"borrows\":["); comma = "";
  for (const b of result.borrows) {
    output.push(comma + "{\"module\":" + numberToString(b.module) + ",\"symbol\":" + numberToString(b.symbol) + ",\"root\":" + numberToString(b.root) + ",\"begin\":" + numberToString(b.begin) + ",\"end\":" + numberToString(b.end) + ",\"mode\":" + quoteSource(b.mode) + "}"); comma = ",";
  }
  output.push("],\"effects\":["); comma = "";
  for (const s of result.effects) {
    output.push(comma + "{\"module\":" + numberToString(s.module) + ",\"node\":" + numberToString(s.node) + ",\"parameters\":" + bindingNumbers(s.parameters) + ",\"reads\":" + bindingNumbers(s.reads) + ",\"writes\":" + bindingNumbers(s.writes) + ",\"moves\":" + bindingNumbers(s.moves) + ",\"invokes\":" + bindingNumbers(s.invokes) + ",\"retains\":" + bindingNumbers(s.retains) + ",\"returned\":" + bindingNumbers(s.returned) + ",\"callees\":" + bindingNumbers(s.callees) + ",\"unknown\":" + bindingBoolean(s.unknown) + ",\"recursive\":" + bindingBoolean(s.recursive) + ",\"external\":" + bindingBoolean(s.external) + ",\"borrows\":[");
    let separator: string = "";
    for (const b of s.borrows) { output.push(separator + "{\"call\":" + numberToString(b.call) + ",\"callback\":" + numberToString(b.callback) + ",\"root\":" + numberToString(b.root) + ",\"mode\":" + quoteSource(b.mode) + "}"); separator = ","; }
    output.push("]}"); comma = ",";
  }
  output.push("]}"); return output.join("");
}
