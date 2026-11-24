import { AttributeKind, EdgeRole, NodeKind, attributeKindName, edgeRoleName, isCallableNodeKind, nodeKindName } from "../parser/index";
import { ModuleGraph } from "../modules/index";
import { contentHash, syntaxIdentity } from "../platform/index";
import { BindingResult, callableBinding } from "../binder/index";
import { CheckResult, NativeInterfaceEntry, NativeModuleRecord } from "./model";
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
  // Sin copias del grafo, el enlace ni el resultado: se reciben prestados (#344).
  scopeKeys: string[]; effectIndex: Map<string,number[]>;
  constructor() { this.scopeKeys = []; this.effectIndex = new Map<string,number[]>(); }
  origin(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>, sid: number): number {
    let remaining: number = binding.symbols.length;
    while (sid >= 0 && binding.symbols[sid].target >= 0 && remaining > 0) { sid = binding.symbols[sid].target; remaining = remaining-1; }
    return sid;
  }
  prepareScopes(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>): void {
    // Ordinal entre hermanos del mismo tipo y nombre: contado con un índice en vez
    // de recorrer todos los ámbitos anteriores por cada ámbito (cuadrático, #344).
    let siblings: Map<string,number> = new Map<string,number>();
    for (let scope: number = 0; scope < binding.scopes.length; scope = scope+1) {
      const parent: number = binding.scopes[scope].parent; const module: number = binding.scopes[scope].module; const node: number = binding.scopes[scope].node; const kind: string = binding.scopes[scope].kind;
      let key: string = parent >= 0 ? this.scopeKeys[parent] : "";
      if (module >= 0 && node >= 0) {
        const nodeKind: NodeKind = graph.modules[module].cached.result.ast.nodes[node].kind; const name: string = graph.modules[module].cached.result.ast.nodes[node].get(AttributeKind.Name);
        const sibling: string = numberToString(parent) + "|" + numberToString(module) + "|" + framed(kind) + framed(nodeKindName(nodeKind)) + framed(name);
        const found: Optional<number> = siblings.get(sibling); const ordinal: number = found.isPresent() ? found.value() : 0; siblings.set(sibling,ordinal+1);
        key = key + framed(kind) + framed(nodeKindName(nodeKind)) + framed(name) + framed(numberToString(ordinal));
      }
      this.scopeKeys.push(key);
    }
  }
  symbolKey(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>, input: number): string {
    const sid: number = this.origin(graph,binding,checked,input); if (sid < 0) return "unresolved";
    const s = binding.symbols[sid];
    if ((s.module) < 0) return "builtin:" + framed(s.kind) + framed(s.name);
    if (s.namespaceModule >= 0) return "namespace:" + checked.moduleRecords[s.namespaceModule].id;
    return "symbol:" + contentHash(framed(checked.moduleRecords[s.module].id) + framed((s.scope >= 0 ? this.scopeKeys[s.scope] : "")) + framed(s.kind) + framed(s.name));
  }
  typeTokens(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>, text: string): string {
    let output: string = ""; let at: number = 0;
    while (at < text.length) {
      const marker: string = text.charAt(at);
      if (marker == "#" || marker == "@") {
        let end: number = at+1; let sid: number = 0;
        while (end < text.length) { const code: number = text.charCodeAt(end)-48; if (code < 0 || code > 9) break; sid = sid*10+code; end = end+1; }
        if (end > at+1 && sid < checked.symbolIds.length) { output = output + marker + framed(checked.symbolIds[sid]); at = end; continue; }
      }
      output = output + marker; at = at+1;
    }
    return output;
  }
  stableType(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>, input: string): string {
    const text: string = ungroupElement(input);
    if (functionClose(text) >= 0) { let params: string[] = []; for (const p of functionParams(text)) params.push(this.stableType(graph,binding,checked,p)); return "fn(" + framedList(params) + ")" + framed(this.stableType(graph,binding,checked,functionReturn(text))); }
    for (const separator of ["|","&"]) { const parts: string[] = splitTypes(text,separator); if (parts.length > 1) { let values: string[] = []; for (const part of parts) values.push(framed(this.stableType(graph,binding,checked,part))); return separator + values.join(""); } }
    if (text.endsWith("[]")) return "array:" + framed(this.stableType(graph,binding,checked,semanticElement(text)));
    const fixed: number = fixedArraySize(text); if (fixed >= 0) return "fixed:" + numberToString(fixed) + framed(this.stableType(graph,binding,checked,fixedArrayElement(text)));
    if (semanticTuple(text)) { let values: string[] = []; for (const part of splitTypes(text.slice(1,text.length-1),",")) values.push(framed(this.stableType(graph,binding,checked,part))); return "tuple:" + values.join(""); }
    const base: string = genericBase(text);
    if (base != "") {
      const args: string[] = genericArguments(text); let values: string[] = [];
      if (base == "variant" && args.length == 2 && args[0].startsWith("#")) {
        let sid: number = 0; for (let at: number = 1; at < args[0].length; at = at+1) sid = sid*10+args[0].charCodeAt(at)-48;
        let node: number = 0; for (let at: number = 0; at < args[1].length; at = at+1) node = node*10+args[1].charCodeAt(at)-48;
        if (sid < binding.symbols.length && binding.symbols[sid].module >= 0) { const nodes = graph.modules[binding.symbols[sid].module].cached.result.ast.nodes; if (node < nodes.length) return "variant:" + framed(this.stableType(graph,binding,checked,args[0])) + framed(nodes[node].get(AttributeKind.Name)); }
      }
      for (const part of args) values.push(framed(this.stableType(graph,binding,checked,part))); return this.typeTokens(graph,binding,checked,base) + "<" + values.join("") + ">";
    }
    return this.typeTokens(graph,binding,checked,text);
  }
  // Tipo legible y estable para --emit-interface: los "#<sid>" internos (que
  // cambian al añadir módulos) se sustituyen por el nombre del símbolo.
  readableType(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>, text: string): string {
    let output: string = ""; let at: number = 0;
    while (at < text.length) {
      if (text.charCodeAt(at) == 35 && at + 1 < text.length && text.charCodeAt(at+1) >= 48 && text.charCodeAt(at+1) <= 57) {
        let sid: number = 0; let end: number = at + 1;
        while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) { sid = sid*10 + text.charCodeAt(end) - 48; end = end + 1; }
        output = output + (sid < binding.symbols.length ? binding.symbols[sid].name : text.slice(at,end)); at = end;
      } else { output = output + text.slice(at,at+1); at = at + 1; }
    }
    return output;
  }
  effectsOf(checked: constRef<CheckResult>, module: number, node: number): number[] {
    if (this.effectIndex.size == 0) for (let at: number = 0; at < checked.effects.length; at = at+1) {
      const key: string = numberToString(checked.effects[at].module) + ":" + numberToString(checked.effects[at].node);
      const found: Optional<number[]> = this.effectIndex.get(key); let list: number[] = found.isPresent() ? found.value() : []; list.push(at); this.effectIndex.set(key,list);
    }
    const found: Optional<number[]> = this.effectIndex.get(numberToString(module) + ":" + numberToString(node)); return found.isPresent() ? found.value() : [];
  }
  effects(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>, module: number, node: number): string {
    let result: string[] = [];
    for (const at of this.effectsOf(checked,module,node)) { const effect = checked.effects[at];
      let parts: string[] = [effect.phase, effect.unknown ? "opaque" : "known", effect.external ? "external" : "internal", effect.recursive ? "recursive" : "acyclic"];
      for (const group of [effect.reads,effect.writes,effect.moves,effect.invokes,effect.retains,effect.returned]) {
        let symbols: string[] = [];
        for (const sid of group) {
          const s = binding.symbols[sid]; let local: boolean = false; let scope: number = s.scope;
          if (["VariableDeclaration","UsingDeclaration","ArrayBinding","ObjectBinding"].includes(s.kind)) while (scope >= 0) { const owner = binding.scopes[scope]; if (owner.module >= 0 && owner.node >= 0 && isCallableNodeKind(graph.modules[owner.module].cached.result.ast.nodes[owner.node].kind)) local = true; scope = owner.parent; }
          if (!local) symbols.push(checked.symbolIds[sid]);
        }
        symbols.sort(compareKeys); parts.push(framedList(symbols));
      }
      for (const lease of effect.borrows) parts.push("borrow:" + framed(lease.root >= 0 ? checked.symbolIds[lease.root] : "unknown") + framed(lease.mode));
      result.push(framedList(parts));
    }
    return framedList(result);
  }
  contract(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>, module: number, node: number, depth: number): string {
    if (depth > 128) return "deep:" + checked.moduleRecords[module].sourceHash;
    const n = graph.modules[module].cached.result.ast.nodes[node];
    let parts: string[] = [nodeKindName(n.kind), this.stableType(graph,binding,checked,checked.files[module].types[node])];
    for (const attr of n.attributes) if (![AttributeKind.GeneratedSource,AttributeKind.GeneratedOffset,AttributeKind.GeneratedEndOffset,AttributeKind.GeneratedLine,AttributeKind.GeneratedColumn,AttributeKind.GeneratedOriginalName].includes(attr.name)) {
      let value: string = attr.value;
      if (attr.name == AttributeKind.GeneratedDefinition) for (let m: number = 0; m < checked.moduleRecords.length; m = m+1) if (attr.value == numberToString(m)) value = checked.moduleRecords[m].id;
      parts.push(framed(attributeKindName(attr.name)) + framed(value));
    }
    parts.push(this.effects(graph,binding,checked,module,node));
    for (const edge of n.edges) if (edge.role != EdgeRole.Body) parts.push(framed(edgeRoleName(edge.role)) + this.contract(graph,binding,checked,module,edge.node,depth+1));
    return framedList(parts);
  }
  needsBody(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: constRef<CheckResult>, module: number, node: number, depth: number): boolean {
    if (depth > 128) return true;
    const n = graph.modules[module].cached.result.ast.nodes[node];
    if ((n.kind == NodeKind.VariableDeclaration || n.kind == NodeKind.UsingDeclaration) && n.get(AttributeKind.Mutable) != "true") return true;
    for (const edge of n.edges) { if ([EdgeRole.TypeParameters,EdgeRole.DefaultValue].includes(edge.role)) return true; if (edge.role != EdgeRole.Body && this.needsBody(graph,binding,checked,module,edge.node,depth+1)) return true; }
    return false;
  }
  run(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: ref<CheckResult>): void {
    checked.moduleRecords = []; checked.symbolIds = []; this.scopeKeys = [];
    for (const module of graph.modules) checked.moduleRecords.push(new NativeModuleRecord(module.file, "module:" + contentHash(module.file), module.cached.record.hash));
    this.prepareScopes(graph,binding,checked);
    for (let sid: number = 0; sid < binding.symbols.length; sid = sid+1) { const identity: string = this.symbolKey(graph,binding,checked,sid); checked.symbolIds.push(identity); }
    for (let m: number = 0; m < graph.modules.length; m = m+1) {
      let record = checked.moduleRecords[m]; let contracts: string[] = [];
      if (m < checked.files.length) for (const state of checked.files[m].constantStates) if (state != "") record.requiresBody = true;
      for (const decorator of checked.decorators) if (decorator.module == m && ["comptime","etsgen","cppgen"].includes(decorator.name)) record.requiresBody = true;
      if (checked.success) for (const entry of binding.exports) if (entry.module == m) {
        const sid: number = this.origin(graph,binding,checked,entry.symbol); if (sid < 0) continue; const s = binding.symbols[sid];
        let parts: string[] = [entry.name,entry.typeOnly ? "type" : "value",checked.symbolIds[sid],this.stableType(graph,binding,checked,checked.symbolTypes[sid])];
        let entryBody: boolean = false;
        if (s.namespaceModule >= 0) { const dependency = checked.moduleRecords[s.namespaceModule]; parts.push(dependency.interfaceHash); if (dependency.requiresBody) { record.requiresBody = true; entryBody = true; } }
        else if (s.module >= 0) for (const declaration of s.declarations) { parts.push(this.contract(graph,binding,checked,s.module,declaration,0)); if (this.needsBody(graph,binding,checked,s.module,declaration,0)) { record.requiresBody = true; entryBody = true; } for (const decorator of checked.decorators) if (decorator.module == s.module && decorator.target == declaration && decorator.name == "comptime") { record.requiresBody = true; entryBody = true; } }
        contracts.push(framedList(parts));
        const kind: string = entry.typeOnly || s.kind == "InterfaceDeclaration" || s.kind == "TypeAliasDeclaration" ? "type" : "value";
        record.exports.push(new NativeInterfaceEntry(entry.name,kind,s.kind,this.readableType(graph,binding,checked,checked.symbolTypes[sid]),contentHash("ets-contract-1" + framedList(parts)),entryBody));
      }
      contracts.sort(compareKeys); let interfaces: string[] = []; let implementations: string[] = []; let semantic: string[] = [];
      let dependencies: string[] = graph.modules[m].dependencies; dependencies.sort(compareKeys);
      for (const filename of dependencies) for (let d: number = 0; d < graph.modules.length; d = d+1) if (graph.modules[d].file == filename) {
        const dependency = checked.moduleRecords[d]; record.dependencies.push(dependency.id);
        interfaces.push(framed(dependency.id) + framed(dependency.interfaceHash)); implementations.push(framed(dependency.id) + framed(dependency.implementationHash));
        if (dependency.requiresBody) { record.bodyDependencies.push(dependency.id); semantic.push(framed(dependency.id) + framed(dependency.implementationHash)); }
      }
      if (checked.success) {
        record.interfaceHash = contentHash("ets-interface-1" + framed(contracts.join("")) + framedList(interfaces));
        record.implementationHash = contentHash("ets-implementation-1" + framed(record.sourceHash) + framedList(implementations));
        if (syntaxIdentity() != "") record.semanticKey = contentHash("ets-semantic-1" + framed(syntaxIdentity()) + framed(record.sourceHash) + framed(record.interfaceHash) + framedList(semantic) + (record.requiresBody ? record.implementationHash : ""));
      }
      checked.moduleRecords[m] = record;
    }
  }
}
export function attachModuleRecords(graph: constRef<ModuleGraph>, binding: constRef<BindingResult>, checked: ref<CheckResult>): void { let builder = new ModuleRecordBuilder(); builder.run(graph,binding,checked); }
