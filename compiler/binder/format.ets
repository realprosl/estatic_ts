import { AttributeKind, nodeKindName } from "../parser/ast-schema";
import { BindingResult } from "./binder";
import { ModuleGraph } from "../modules/loader";
import { quoteSource, formatDiagnostic } from "../frontend/frontend";
export function bindingBoolean(value: boolean): string { return value ? "true" : "false"; }
export function bindingNumbers(values: number[]): string {
  let output: string[] = []; for (const value of values) output.push(numberToString(value)); return "[" + output.join(",") + "]";
}
export function formatBinding(result: BindingResult, graph: ModuleGraph): string {
  let output: string[] = ["{\"success\":" + bindingBoolean(result.success) + ",\"files\":["]; let comma: string = "";
  for (let m: number = 0; m < graph.modules.length; m = m + 1) {
    output.push(comma + "{\"file\":" + quoteSource(graph.modules[m].file));
    if (m < result.files.length) output.push(",\"scope\":" + numberToString(result.files[m].scope) + ",\"nodeScopes\":" + bindingNumbers(result.files[m].nodeScopes) + ",\"declarations\":" + bindingNumbers(result.files[m].declarations));
    output.push(",\"nodes\":["); let separator: string = "";
    for (const node of graph.modules[m].cached.result.ast.nodes) {
      output.push(separator + "{\"kind\":" + quoteSource(nodeKindName(node.kind)) + ",\"name\":" + quoteSource(node.get(AttributeKind.Name)) + ",\"offset\":" + numberToString(node.start.offset) + "}"); separator = ",";
    }
    output.push("]}"); comma = ",";
  }
  output.push("],\"scopes\":["); comma = "";
  for (const scope of result.scopes) {
    output.push(comma + "{\"parent\":" + numberToString(scope.parent) + ",\"module\":" + numberToString(scope.module) + ",\"node\":" + numberToString(scope.node) + ",\"kind\":" + quoteSource(scope.kind) + ",\"symbols\":" + bindingNumbers(scope.symbols) + "}"); comma = ",";
  }
  output.push("],\"symbols\":["); comma = "";
  for (const symbol of result.symbols) {
    output.push(comma + "{\"name\":" + quoteSource(symbol.name) + ",\"kind\":" + quoteSource(symbol.kind) + ",\"scope\":" + numberToString(symbol.scope) + ",\"module\":" + numberToString(symbol.module)
      + ",\"node\":" + numberToString(symbol.node) + ",\"declarations\":" + bindingNumbers(symbol.declarations) + ",\"values\":" + bindingBoolean(symbol.values) + ",\"types\":" + bindingBoolean(symbol.types)
      + ",\"target\":" + numberToString(symbol.target) + ",\"namespaceModule\":" + numberToString(symbol.namespaceModule) + ",\"typeOnly\":" + bindingBoolean(symbol.typeOnly) + "}"); comma = ",";
  }
  output.push("],\"references\":["); comma = "";
  for (const ref of result.references) {
    output.push(comma + "{\"module\":" + numberToString(ref.module) + ",\"node\":" + numberToString(ref.node) + ",\"scope\":" + numberToString(ref.scope) + ",\"name\":" + quoteSource(ref.name)
      + ",\"space\":" + quoteSource(ref.space) + ",\"symbol\":" + numberToString(ref.symbol) + ",\"target\":" + numberToString(ref.target) + ",\"deferred\":" + bindingBoolean(ref.deferred) + "}"); comma = ",";
  }
  output.push("],\"exports\":["); comma = "";
  for (const entry of result.exports) {
    output.push(comma + "{\"module\":" + numberToString(entry.module) + ",\"name\":" + quoteSource(entry.name) + ",\"symbol\":" + numberToString(entry.symbol) + ",\"typeOnly\":" + bindingBoolean(entry.typeOnly) + "}"); comma = ",";
  }
  output.push("],\"diagnostics\":["); comma = "";
  for (const diagnostic of result.diagnostics) {
    output.push(comma + formatDiagnostic(diagnostic)); comma = ",";
  }
  output.push("]}"); return output.join("");
}
