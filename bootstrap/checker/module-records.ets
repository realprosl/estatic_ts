import { ModuleGraph } from "../modules/loader";
import { contentHash, syntaxIdentity } from "../modules/platform";
import { BindingResult, callableBinding } from "../binder/binder";
import { CheckResult, NativeModuleRecord } from "./model";
import { splitTypes, functionClose, functionParams, functionReturn, semanticElement, semanticTuple, fixedArraySize, fixedArrayElement, genericBase, genericArguments, ungroupElement } from "./types";

function framed(text: string): string { return numberToString(text.length) + ":" + text; }
function compareKeys(a: string, b: string): number {
  const length: number = Math.min(a.length,b.length);
  for (let at: number = 0; at < length; at = at+1) { const difference: number = a.charCodeAt(at)-b.charCodeAt(at); if (difference != 0) return difference; }
  return a.length-b.length;
}
function framedList(values: string[]): string { let output: string = ""; for (const value of values) output = output + framed(value); return output; }

// Frontend fingerprints only. These records do not authorize reusing backend
// artifacts: a backend must add its own target/options/build identity.
export class ModuleRecordBuilder {
  graph: ModuleGraph; binding: BindingResult; checked: CheckResult; scopeKeys: string[];
  constructor(graph: ModuleGraph, binding: BindingResult, checked: CheckResult) { this.graph = graph; this.binding = binding; this.checked = checked; this.scopeKeys = []; }
  origin(sid: number): number {
    let remaining: number = this.binding.symbols.length;
    while (sid >= 0 && this.binding.symbols[sid].target >= 0 && remaining > 0) { sid = this.binding.symbols[sid].target; remaining = remaining-1; }
    return sid;
  }
  prepareScopes(): void {
    for (let scope: number = 0; scope < this.binding.scopes.length; scope = scope+1) {
      const item = this.binding.scopes[scope]; let key: string = item.parent >= 0 ? this.scopeKeys[item.parent] : "";
      if (item.module >= 0 && item.node >= 0) {
        const n = this.graph.modules[item.module].cached.result.ast.nodes[item.node]; let ordinal: number = 0;
        for (let at: number = 0; at < scope; at = at+1) if (this.binding.scopes[at].parent == item.parent && this.binding.scopes[at].module == item.module && this.binding.scopes[at].kind == item.kind && this.binding.scopes[at].node >= 0) {
          const candidate = this.graph.modules[item.module].cached.result.ast.nodes[this.binding.scopes[at].node];
          if (candidate.kind == n.kind && candidate.get("name") == n.get("name")) ordinal = ordinal+1;
        }
        key = key + framed(item.kind) + framed(n.kind) + framed(n.get("name")) + framed(numberToString(ordinal));
      }
      this.scopeKeys.push(key);
    }
  }
  symbolKey(input: number): string {
    const sid: number = this.origin(input); if (sid < 0) return "unresolved";
    const s = this.binding.symbols[sid];
    if ((s.module) < 0) return "builtin:" + framed(s.kind) + framed(s.name);
    if (s.namespaceModule >= 0) return "namespace:" + this.checked.moduleRecords[s.namespaceModule].id;
    return "symbol:" + contentHash(framed(this.checked.moduleRecords[s.module].id) + framed((s.scope >= 0 ? this.scopeKeys[s.scope] : "")) + framed(s.kind) + framed(s.name));
  }
  typeTokens(text: string): string {
    let output: string = ""; let at: number = 0;
    while (at < text.length) {
      const marker: string = text.charAt(at);
      if (marker == "#" || marker == "@") {
        let end: number = at+1; let sid: number = 0;
        while (end < text.length) { const code: number = text.charCodeAt(end)-48; if (code < 0 || code > 9) break; sid = sid*10+code; end = end+1; }
        if (end > at+1 && sid < this.checked.symbolIds.length) { output = output + marker + framed(this.checked.symbolIds[sid]); at = end; continue; }
      }
      output = output + marker; at = at+1;
    }
    return output;
  }
  stableType(input: string): string {
    const text: string = ungroupElement(input);
    if (functionClose(text) >= 0) { let params: string[] = []; for (const p of functionParams(text)) params.push(this.stableType(p)); return "fn(" + framedList(params) + ")" + framed(this.stableType(functionReturn(text))); }
    for (const separator of ["|","&"]) { const parts: string[] = splitTypes(text,separator); if (parts.length > 1) { let values: string[] = []; for (const part of parts) values.push(framed(this.stableType(part))); return separator + values.join(""); } }
    if (text.endsWith("[]")) return "array:" + framed(this.stableType(semanticElement(text)));
    const fixed: number = fixedArraySize(text); if (fixed >= 0) return "fixed:" + numberToString(fixed) + framed(this.stableType(fixedArrayElement(text)));
    if (semanticTuple(text)) { let values: string[] = []; for (const part of splitTypes(text.slice(1,text.length-1),",")) values.push(framed(this.stableType(part))); return "tuple:" + values.join(""); }
    const base: string = genericBase(text);
    if (base != "") {
      const args: string[] = genericArguments(text); let values: string[] = [];
      if (base == "variant" && args.length == 2 && args[0].startsWith("#")) {
        let sid: number = 0; for (let at: number = 1; at < args[0].length; at = at+1) sid = sid*10+args[0].charCodeAt(at)-48;
        let node: number = 0; for (let at: number = 0; at < args[1].length; at = at+1) node = node*10+args[1].charCodeAt(at)-48;
        if (sid < this.binding.symbols.length && this.binding.symbols[sid].module >= 0) { const nodes = this.graph.modules[this.binding.symbols[sid].module].cached.result.ast.nodes; if (node < nodes.length) return "variant:" + framed(this.stableType(args[0])) + framed(nodes[node].get("name")); }
      }
      for (const part of args) values.push(framed(this.stableType(part))); return this.typeTokens(base) + "<" + values.join("") + ">";
    }
    return this.typeTokens(text);
  }
  effects(module: number, node: number): string {
    let result: string[] = [];
    for (const effect of this.checked.effects) if (effect.module == module && effect.node == node) {
      let parts: string[] = [effect.phase, effect.unknown ? "opaque" : "known", effect.external ? "external" : "internal", effect.recursive ? "recursive" : "acyclic"];
      for (const group of [effect.reads,effect.writes,effect.moves,effect.invokes,effect.retains,effect.returned]) {
        let symbols: string[] = [];
        for (const sid of group) {
          const s = this.binding.symbols[sid]; let local: boolean = false; let scope: number = s.scope;
          if (["VariableDeclaration","UsingDeclaration","ArrayBinding","ObjectBinding"].includes(s.kind)) while (scope >= 0) { const owner = this.binding.scopes[scope]; if (owner.module >= 0 && owner.node >= 0 && callableBinding(this.graph.modules[owner.module].cached.result.ast.nodes[owner.node].kind)) local = true; scope = owner.parent; }
          if (!local) symbols.push(this.checked.symbolIds[sid]);
        }
        symbols.sort(compareKeys); parts.push(framedList(symbols));
      }
      for (const lease of effect.borrows) parts.push("borrow:" + framed(lease.root >= 0 ? this.checked.symbolIds[lease.root] : "unknown") + framed(lease.mode));
      result.push(framedList(parts));
    }
    return framedList(result);
  }
  contract(module: number, node: number, depth: number): string {
    if (depth > 128) return "deep:" + this.checked.moduleRecords[module].sourceHash;
    const n = this.graph.modules[module].cached.result.ast.nodes[node];
    let parts: string[] = [n.kind, this.stableType(this.checked.files[module].types[node])];
    for (const attr of n.attributes) if (!["generatedSource","generatedOffset","generatedEndOffset","generatedLine","generatedColumn","generatedOriginalName"].includes(attr.name)) {
      let value: string = attr.value;
      if (attr.name == "generatedDefinition") for (let m: number = 0; m < this.checked.moduleRecords.length; m = m+1) if (attr.value == numberToString(m)) value = this.checked.moduleRecords[m].id;
      parts.push(framed(attr.name) + framed(value));
    }
    parts.push(this.effects(module,node));
    for (const edge of n.edges) if (edge.role != "body") parts.push(framed(edge.role) + this.contract(module,edge.node,depth+1));
    return framedList(parts);
  }
  needsBody(module: number, node: number, depth: number): boolean {
    if (depth > 128) return true;
    const n = this.graph.modules[module].cached.result.ast.nodes[node];
    if ((n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") && n.get("mutable") != "true") return true;
    for (const edge of n.edges) { if (["typeParameters","defaultValue"].includes(edge.role)) return true; if (edge.role != "body" && this.needsBody(module,edge.node,depth+1)) return true; }
    return false;
  }
  run(): CheckResult {
    this.checked.moduleRecords = []; this.checked.symbolIds = []; this.scopeKeys = [];
    for (const module of this.graph.modules) this.checked.moduleRecords.push(new NativeModuleRecord(module.file, "module:" + contentHash(module.file), module.cached.record.hash));
    this.prepareScopes();
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) this.checked.symbolIds.push(this.symbolKey(sid));
    for (let m: number = 0; m < this.graph.modules.length; m = m+1) {
      let record = this.checked.moduleRecords[m]; let contracts: string[] = [];
      if (m < this.checked.files.length) for (const state of this.checked.files[m].constantStates) if (state != "") record.requiresBody = true;
      for (const decorator of this.checked.decorators) if (decorator.module == m && ["comptime","etsgen","cppgen"].includes(decorator.name)) record.requiresBody = true;
      if (this.checked.success) for (const entry of this.binding.exports) if (entry.module == m) {
        const sid: number = this.origin(entry.symbol); if (sid < 0) continue; const s = this.binding.symbols[sid];
        let parts: string[] = [entry.name,entry.typeOnly ? "type" : "value",this.checked.symbolIds[sid],this.stableType(this.checked.symbolTypes[sid])];
        if (s.namespaceModule >= 0) { const dependency = this.checked.moduleRecords[s.namespaceModule]; parts.push(dependency.interfaceHash); if (dependency.requiresBody) record.requiresBody = true; }
        else if (s.module >= 0) for (const declaration of s.declarations) { parts.push(this.contract(s.module,declaration,0)); if (this.needsBody(s.module,declaration,0)) record.requiresBody = true; for (const decorator of this.checked.decorators) if (decorator.module == s.module && decorator.target == declaration && decorator.name == "comptime") record.requiresBody = true; }
        contracts.push(framedList(parts));
      }
      contracts.sort(compareKeys); let interfaces: string[] = []; let implementations: string[] = []; let semantic: string[] = [];
      let dependencies: string[] = this.graph.modules[m].dependencies; dependencies.sort(compareKeys);
      for (const filename of dependencies) for (let d: number = 0; d < this.graph.modules.length; d = d+1) if (this.graph.modules[d].file == filename) {
        const dependency = this.checked.moduleRecords[d]; record.dependencies.push(dependency.id);
        interfaces.push(framed(dependency.id) + framed(dependency.interfaceHash)); implementations.push(framed(dependency.id) + framed(dependency.implementationHash));
        if (dependency.requiresBody) { record.bodyDependencies.push(dependency.id); semantic.push(framed(dependency.id) + framed(dependency.implementationHash)); }
      }
      if (this.checked.success) {
        record.interfaceHash = contentHash("ets-interface-1" + framed(contracts.join("")) + framedList(interfaces));
        record.implementationHash = contentHash("ets-implementation-1" + framed(record.sourceHash) + framedList(implementations));
        if (syntaxIdentity() != "") record.semanticKey = contentHash("ets-semantic-1" + framed(syntaxIdentity()) + framed(record.sourceHash) + framed(record.interfaceHash) + framedList(semantic) + (record.requiresBody ? record.implementationHash : ""));
      }
      this.checked.moduleRecords[m] = record;
    }
    return this.checked;
  }
}
export function attachModuleRecords(graph: ModuleGraph, binding: BindingResult, checked: CheckResult): CheckResult { let builder = new ModuleRecordBuilder(graph,binding,checked); return builder.run(); }
