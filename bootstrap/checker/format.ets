import { CheckResult } from "./checker";
import { BindingResult } from "../binder/binder";
import { ModuleGraph } from "../modules/loader";
import { formatBinding, bindingBoolean, bindingNumbers } from "../binder/format";
import { quoteSource } from "../frontend/frontend";
import { formatAst } from "../parser/parser";
import { syntaxIdentity } from "../modules/platform";
export function formatChecked(result: CheckResult, binding: BindingResult, graph: ModuleGraph): string {
  let entryId: string = ""; for (const record of result.moduleRecords) if (record.file == graph.entry) entryId = record.id;
  let output: string[] = ["{\"format\":\"ets-checked-1\",\"frontendIdentity\":" + quoteSource(syntaxIdentity()) + ",\"entry\":" + quoteSource(graph.entry) + ",\"entryModuleId\":" + quoteSource(entryId) + ",\"success\":" + bindingBoolean(result.success) + ",\"binding\":" + formatBinding(binding,graph) + ",\"files\":["]; let comma: string = "";
  for (let m: number = 0; m < result.files.length; m = m + 1) {
    const file = result.files[m]; let types: string[] = []; for (const valueType of file.types) types.push(quoteSource(valueType));
    let matchCoverage: string[] = []; for (const coverage of file.matchCoverage) matchCoverage.push(quoteSource(coverage));
    let receivers: string[] = []; for (const receiver of file.receivers) receivers.push(quoteSource(receiver));
    let signatures: string[] = []; for (const signature of file.signatures) signatures.push(quoteSource(signature));
    let exactIntegers: string[] = []; for (const value of file.exactIntegers) exactIntegers.push(quoteSource(value));
    let conversions: string[] = []; for (const value of file.conversions) conversions.push(quoteSource(value));
    let codes: string[] = []; for (const code of file.constantCodes) codes.push(quoteSource(code));
    let constants: string[] = []; let constantStates: string[] = []; for (const value of file.constantValues) constants.push(quoteSource(value)); for (const value of file.constantStates) constantStates.push(quoteSource(value));
    let fields: string[] = []; for (const members of file.constructionFields) fields.push(bindingNumbers(members));
    let tasks: string[] = []; for (const sources of file.taskSources) tasks.push(bindingNumbers(sources));
    let caseValues: string[] = []; for (const value of file.caseValues) caseValues.push(quoteSource(value));
    let analysisRanges: string[] = []; for (const node of graph.modules[m].cached.result.ast.nodes) analysisRanges.push("["+numberToString(node.analysisStart)+","+numberToString(node.analysisEnd)+"]");
    output.push(comma + "{\"file\":" + quoteSource(graph.modules[m].file) + ",\"moduleId\":" + quoteSource(result.moduleRecords[m].id) + ",\"sourceHash\":" + quoteSource(result.moduleRecords[m].sourceHash) + ",\"ast\":" + formatAst(graph.modules[m].cached.result.ast) + ",\"constantCodes\":[" + codes.join(",") + "],\"constantValues\":[" + constants.join(",") + "],\"constantStates\":[" + constantStates.join(",") + "],\"constructionFields\":[" + fields.join(",") + "],\"taskSources\":[" + tasks.join(",") + "],\"types\":[" + types.join(",") + "],\"members\":" + bindingNumbers(file.members) + ",\"selected\":" + bindingNumbers(file.selected) + ",\"selectedModules\":" + bindingNumbers(file.selectedModules) + ",\"argumentElements\":" + bindingNumbers(file.argumentElements) + ",\"argumentParameters\":" + bindingNumbers(file.argumentParameters) + ",\"matchCoverage\":[" + matchCoverage.join(",") + "],\"receivers\":[" + receivers.join(",") + "],\"signatures\":[" + signatures.join(",") + "],\"exactIntegers\":[" + exactIntegers.join(",") + "],\"conversions\":[" + conversions.join(",") + "],\"analysisRanges\":[" + analysisRanges.join(",") + "],\"caseValues\":[" + caseValues.join(",") + "]}"); comma = ",";
  }
  let symbols: string[] = []; for (const valueType of result.symbolTypes) symbols.push(quoteSource(valueType));
  output.push("],\"symbolTypes\":[" + symbols.join(",") + "],\"symbolIds\":["); comma = "";
  for (const id of result.symbolIds) { output.push(comma + quoteSource(id)); comma = ","; }
  output.push("],\"moduleRecords\":["); comma = "";
  for (const record of result.moduleRecords) {
    let deps: string[] = []; for (const id of record.dependencies) deps.push(quoteSource(id)); let bodies: string[] = []; for (const id of record.bodyDependencies) bodies.push(quoteSource(id));
    output.push(comma + "{\"file\":" + quoteSource(record.file) + ",\"id\":" + quoteSource(record.id) + ",\"sourceHash\":" + quoteSource(record.sourceHash) + ",\"interfaceHash\":" + quoteSource(record.interfaceHash) + ",\"implementationHash\":" + quoteSource(record.implementationHash) + ",\"semanticKey\":" + quoteSource(record.semanticKey) + ",\"requiresBody\":" + bindingBoolean(record.requiresBody) + ",\"dependencies\":[" + deps.join(",") + "],\"bodyDependencies\":[" + bodies.join(",") + "]}"); comma = ",";
  }
  output.push("],\"generatedSources\":["); comma = "";
  for (const source of graph.generatedSources) {
    output.push(comma + "{\"id\":" + quoteSource(source.id) + ",\"module\":" + numberToString(source.module) + ",\"call\":" + numberToString(source.call) + ",\"generatorModule\":" + numberToString(source.generatorModule) + ",\"generator\":" + numberToString(source.generator) + ",\"parentId\":" + quoteSource(source.parentId) + ",\"source\":" + quoteSource(source.source) + ",\"offset\":" + numberToString(source.start.offset) + ",\"line\":" + numberToString(source.start.line) + ",\"column\":" + numberToString(source.start.column) + "}"); comma = ",";
  }
  output.push("],\"diagnostics\":["); comma = "";
  for (const d of result.diagnostics) {
    let generated: string = "";
    if (d.generatedId != "") generated = ",\"generated\":{\"sourceId\":" + quoteSource(d.generatedId) + ",\"offset\":" + numberToString(d.generatedToken.offset) + ",\"line\":" + numberToString(d.generatedToken.line) + ",\"column\":" + numberToString(d.generatedToken.column) + "}";
    output.push(comma + "{\"file\":" + quoteSource(d.file) + ",\"phase\":" + quoteSource(d.phase) + ",\"message\":" + quoteSource(d.message) + ",\"offset\":" + numberToString(d.token.offset) + ",\"line\":" + numberToString(d.token.line) + ",\"column\":" + numberToString(d.token.column) + generated + "}"); comma = ",";
  }
  output.push("],\"captures\":["); comma = "";
  for (const c of result.captures) {
    output.push(comma + "{\"module\":" + numberToString(c.module) + ",\"closure\":" + numberToString(c.closure) + ",\"symbol\":" + numberToString(c.symbol) + ",\"mode\":" + quoteSource(c.mode) + "}"); comma = ",";
  }
  output.push("],\"borrows\":["); comma = "";
  for (const b of result.borrows) {
    output.push(comma + "{\"module\":" + numberToString(b.module) + ",\"symbol\":" + numberToString(b.symbol) + ",\"root\":" + numberToString(b.root) + ",\"begin\":" + numberToString(b.begin) + ",\"end\":" + numberToString(b.end) + ",\"mode\":" + quoteSource(b.mode) + "}"); comma = ",";
  }
  output.push("],\"queries\":["); comma = "";
  for (const q of result.queries) { output.push(comma + "{\"module\":" + numberToString(q.module) + ",\"node\":" + numberToString(q.node) + ",\"text\":" + quoteSource(q.text) + ",\"type\":" + quoteSource(q.typeName) + ",\"symbols\":" + bindingNumbers(q.symbols) + "}"); comma = ","; }
  output.push("],\"decorators\":["); comma = "";
  for (const d of result.decorators) { let args: string[] = []; for (const arg of d.arguments) args.push(quoteSource(arg)); output.push(comma + "{\"module\":" + numberToString(d.module) + ",\"node\":" + numberToString(d.node) + ",\"target\":" + numberToString(d.target) + ",\"name\":" + quoteSource(d.name) + ",\"arguments\":[" + args.join(",") + "]}"); comma = ","; }
  output.push("],\"effects\":["); comma = "";
  for (const s of result.effects) {
    output.push(comma + "{\"module\":" + numberToString(s.module) + ",\"node\":" + numberToString(s.node) + ",\"phase\":" + quoteSource(s.phase) + ",\"creation\":" + numberToString(s.creation) + ",\"parameters\":" + bindingNumbers(s.parameters) + ",\"reads\":" + bindingNumbers(s.reads) + ",\"writes\":" + bindingNumbers(s.writes) + ",\"moves\":" + bindingNumbers(s.moves) + ",\"invokes\":" + bindingNumbers(s.invokes) + ",\"retains\":" + bindingNumbers(s.retains) + ",\"returned\":" + bindingNumbers(s.returned) + ",\"callees\":" + bindingNumbers(s.callees) + ",\"unknown\":" + bindingBoolean(s.unknown) + ",\"recursive\":" + bindingBoolean(s.recursive) + ",\"external\":" + bindingBoolean(s.external) + ",\"borrows\":[");
    let separator: string = "";
    for (const b of s.borrows) { output.push(separator + "{\"call\":" + numberToString(b.call) + ",\"callback\":" + numberToString(b.callback) + ",\"root\":" + numberToString(b.root) + ",\"mode\":" + quoteSource(b.mode) + "}"); separator = ","; }
    output.push("]}"); comma = ",";
  }
  output.push("]}"); return output.join("");
}
