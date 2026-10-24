import { EffectAnalyzer } from "./effects";
import { resourceType, resourceSubstitution } from "./ownership";
import { nativeNumericLiteral } from "./numeric";
import { ModuleGraph } from "../modules/loader";
import { BindingResult, BindingSymbol, bindingChild, callableBinding } from "../binder/binder";
import { AstNode, nodeBegin, nodeEnd } from "../parser/parser";
import { diagnosticAt, SourceDiagnostic } from "../frontend/frontend";
import { CheckResult, NativeCapture, BorrowLease, argumentParameter } from "./model";
import { memoryMode, memoryInner, memoryValue, ownedType, borrowedType, readonlyType, semanticElement, semanticTuple, splitTypes, functionClose, functionParams, functionReturn, argumentType, fixedArraySize, fixedArrayElement, localBinding, genericBase, genericArguments, replaceType, canonicalSymbol } from "./types";

export class SafetyState {
  slots: number[]; paths: string[]; resources: number[]; exit: string;
  constructor(count: number) { this.slots = []; this.paths = []; this.resources = []; this.exit = ""; for (let i: number = 0; i < count; i = i + 1) this.slots.push(1); }
}
export class SafetyEdge {
  source: number; target: number;
  constructor(source: number, target: number) { this.source = source; this.target = target; }
}
export class EscapeSite {
  module: number; node: number; vertex: number; reason: string;
  constructor(module: number, node: number, vertex: number, reason: string) { this.module = module; this.node = node; this.vertex = vertex; this.reason = reason; }
}
export class LifetimeStore {
  module: number; node: number; vertex: number; scope: number;
  constructor(module: number, node: number, vertex: number, scope: number) { this.module = module; this.node = node; this.vertex = vertex; this.scope = scope; }
}
export class SafetyCallSite {
  module: number; node: number;
  constructor(module: number, node: number) { this.module = module; this.node = node; }
}
export class SafetyArgument {
  parameter: number; module: number; node: number; root: number;
  constructor(parameter: number, module: number, node: number, root: number) { this.parameter = parameter; this.module = module; this.node = node; this.root = root; }
}
export class SafetyTarget {
  module: number; node: number;
  constructor(module: number, node: number) { this.module = module; this.node = node; }
}

// A separate semantic pass: no syntax, binding or type table is annotated here.
// Flow joins preserve possible moves; provenance is a monotone graph keyed by
// symbol identity, independent of source order and aliases.
export class SafetyAnalyzer {
  graph: ModuleGraph; binding: BindingResult; result: CheckResult; effects: EffectAnalyzer; arguments: SafetyArgument[];
  offsets: number[]; nodes: number; edges: SafetyEdge[]; seeds: number[]; escapes: EscapeSite[]; owners: number[]; trace: boolean; resourceTypes: Map<string,boolean>; valueTypes: Map<string,boolean>; carrierTypes: Map<string,boolean>; plainTypes: Map<string,boolean>; defaultReads: Map<number,boolean>; valueDefaults: Map<number,boolean>;
  substitutions: string[]; substitutionTypes: string[]; memoryPath: string[]; borrowSources: number[]; leases: BorrowLease[]; breaks: SafetyState[]; continues: SafetyState[]; returns: SafetyState[]; sites: SafetyCallSite[];
  visits: number;
  constructor(graph: ModuleGraph, binding: BindingResult, result: CheckResult) {
    this.graph = graph; this.binding = binding; this.result = result; this.effects = new EffectAnalyzer(graph,binding,result); this.arguments = []; this.offsets = []; this.nodes = 0;
    this.substitutions = []; this.substitutionTypes = []; this.edges = []; this.seeds = []; this.escapes = []; this.memoryPath = []; this.borrowSources = []; this.leases = []; this.breaks = []; this.continues = []; this.returns = []; this.sites = []; this.arguments = [];
    for (const m of graph.modules) { this.offsets.push(this.nodes); this.nodes = this.nodes + m.cached.result.ast.nodes.length; }
    for (const s of binding.symbols) this.borrowSources.push(-1);
    this.owners = []; for (const scope of binding.scopes) this.owners.push(-2); this.trace = false; this.resourceTypes = new Map<string,boolean>(); this.valueTypes = new Map<string,boolean>(); this.carrierTypes = new Map<string,boolean>(); this.plainTypes = new Map<string,boolean>();
    this.defaultReads = new Map<number,boolean>(); this.valueDefaults = new Map<number,boolean>();
    this.visits = 0;
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  report(module: number, id: number, message: string): void {
    const token = this.node(module,id).start;
    const candidate = diagnosticAt("checker",message,this.graph.modules[module].file,this.node(module,id));
    for (const d of this.result.diagnostics) if (d.file == this.graph.modules[module].file && d.token.offset == token.offset && d.code == candidate.code && d.message == candidate.message && d.generatedId == this.node(module,id).generatedId && d.generatedToken.offset == this.node(module,id).generatedStart.offset) return;
    this.result.diagnostics.push(candidate);
  }
  origin(sid: number): number { let at: number = sid; while (at >= 0 && this.binding.symbols[at].target >= 0) at = this.binding.symbols[at].target; return at; }
  reference(module: number, id: number): number {
    return id < 0 ? -1 : this.binding.files[module].valueTargets[id];
  }
  helper(module: number, id: number): string {
    if (id < 0 || this.node(module,id).kind != "CallExpression") return "";
    const sid: number = this.reference(module,id);
    return sid >= 0 && (this.binding.symbols[sid].module) < 0 ? this.binding.symbols[sid].name : "";
  }
  owner(scope: number): number {
    if (scope >= 0 && this.owners[scope] != -2) return this.owners[scope];
    let at: number = scope;
    while (at >= 0) {
      const s = this.binding.scopes[at];
      if (s.kind == "function" || s.kind == "arrow") { const result: number = this.offsets[s.module] + s.node; this.owners[scope] = result; return result; }
      at = s.parent;
    } if (scope >= 0) this.owners[scope] = -1; return -1;
  }
  vertex(module: number, id: number): number { return this.offsets[module] + id; }
  symbolVertex(sid: number): number { return this.nodes + this.origin(sid); }
  directRoot(module: number, id: number): number {
    let at: number = id;
    while (at >= 0) {
      const n: AstNode = this.node(module,at);
      if (n.kind == "IdentifierExpression") return this.reference(module,at);
      if (n.kind == "NamedArgumentExpression") at = bindingChild(n,"value");
      else if (n.kind == "SpreadElement") at = bindingChild(n,"expression");
      else if (n.kind == "MemberExpression" || n.kind == "IndexExpression") at = bindingChild(n,"object");
      else if (["ref","constRef","move"].includes(this.helper(module,at))) at = bindingChild(n,"args");
      else return -1;
    } return -1;
  }
  root(module: number, id: number): number {
    let at: number = id;
    while (at >= 0) {
      const n: AstNode = this.node(module,at);
      if (n.kind == "IdentifierExpression") {
        let sid: number = this.reference(module,at); let remaining: number = this.binding.symbols.length;
        while (sid >= 0 && remaining > 0) {
          let source: number = this.borrowSources[sid];
          if (this.borrowedSymbol(sid) || this.binding.symbols[sid].kind == "receiver") for (let a: number = this.arguments.length - 1; a >= 0; a = a - 1) if (this.arguments[a].parameter == sid) { source = this.arguments[a].root; break; }
          if (source < 0 || source == sid) break; sid = source; remaining = remaining - 1;
        } return sid;
      }
      if (n.kind == "NamedArgumentExpression") at = bindingChild(n,"value");
      else if (n.kind == "SpreadElement") at = bindingChild(n,"expression");
      else if (n.kind == "MemberExpression" || n.kind == "IndexExpression") at = bindingChild(n,"object");
      else if (this.helper(module,at) == "ref" || this.helper(module,at) == "constRef" || this.helper(module,at) == "move") at = bindingChild(n,"args");
      else return -1;
    } return -1;
  }
  projectionKey(module: number, id: number): string {
    let at: number = id; let currentModule: number = module; let suffix: string = "";
    for (let remaining: number = 0; remaining < 128 && at >= 0; remaining = remaining + 1) {
      const n: AstNode = this.node(currentModule,at);
      if (n.kind == "IdentifierExpression") {
        const sid: number = this.reference(currentModule,at); if (sid < 0) return ""; let substituted: boolean = false;
        if (this.borrowedSymbol(sid) || this.binding.symbols[sid].kind == "receiver") {
          for (let a: number = this.arguments.length-1; a >= 0; a = a-1) if (this.arguments[a].parameter == sid) {
            const argument = this.arguments[a]; at = argument.node; currentModule = argument.module; substituted = true; break;
          }
          if (!substituted && this.borrowSources[sid] >= 0) {
            const symbol = this.binding.symbols[sid]; const init: number = bindingChild(this.node(symbol.module,symbol.node),"initializer");
            if (init >= 0) { currentModule = symbol.module; at = init; substituted = true; }
          }
        }
        if (substituted) continue;
        return "s" + numberToString(sid) + suffix;
      }
      if (n.kind == "MemberExpression") {
        const member: number = this.result.files[currentModule].members[at]; suffix = "/f" + (member >= 0 ? numberToString(member) : n.get("member")) + suffix; at = bindingChild(n,"object");
      } else if (n.kind == "IndexExpression") {
        const index: AstNode = this.node(currentModule,bindingChild(n,"index")); let key: string = "*";
        if (index.kind == "LiteralExpression" && index.get("literalType") == "number") { const value = nativeNumericLiteral(index.get("raw")); if (value.valid) key = "i" + numberToString(value.value); }
        suffix = "/" + key + suffix; at = bindingChild(n,"object");
      } else if (n.kind == "NamedArgumentExpression") at = bindingChild(n,"value");
      else if (n.kind == "SpreadElement") at = bindingChild(n,"expression");
      else if (["ref","constRef","move"].includes(this.helper(currentModule,at))) at = bindingChild(n,"args");
      else return "";
    }
    if (at >= 0) this.report(module,id,"E4104: no se puede estabilizar la procedencia del lvalue");
    return "";
  }
  overlaps(left: string, right: string): boolean {
    const a: string[] = splitTypes(left,"/"); const b: string[] = splitTypes(right,"/");
    for (let at: number = 0; at < a.length && at < b.length; at = at+1) if (a[at] != b[at] && a[at] != "*" && b[at] != "*") return false;
    return true;
  }
  pathState(state: constRef<SafetyState>, projectionKey: string): number { for (let at: number = 0; at < state.paths.length; at = at+1) if (state.paths[at] == projectionKey) return state.resources[at]; return 1; }
  setPath(out state: SafetyState, projectionKey: string, value: number): void {
    if (projectionKey == "") return;
    for (let at: number = 0; at < state.paths.length; at = at+1) if (state.paths[at] == projectionKey) { state.resources[at] = value; return; }
    state.paths.push(projectionKey); state.resources.push(value);
  }
  readPaths(module: number, id: number, state: constRef<SafetyState>): void {
    const projectionKey: string = this.projectionKey(module,id); if (projectionKey == "") return;
    for (let at: number = 0; at < state.paths.length; at = at+1) if (state.resources[at] != 1 && this.overlaps(projectionKey,state.paths[at])) this.report(module,id,state.resources[at] == 2 ? "E4102: acceso a un agregado o campo movido parcialmente" : "E4103: agregado o campo posiblemente movido parcialmente");
  }
  writePaths(module: number, id: number, state: constRef<SafetyState>): void {
    const projectionKey: string = this.projectionKey(module,id); if (projectionKey == "") return; const depth: number = splitTypes(projectionKey,"/").length;
    for (let at: number = 0; at < state.paths.length; at = at+1) if (state.resources[at] != 1 && (splitTypes(state.paths[at],"/").length) < depth && this.overlaps(projectionKey,state.paths[at])) this.report(module,id,"E4102: escritura a través de un campo padre movido");
  }
  initializePath(out state: SafetyState, projectionKey: string): void {
    if (projectionKey == "" || projectionKey.indexOf("/*",0) >= 0) return;
    for (let at: number = 0; at < state.paths.length; at = at+1) if (state.paths[at] == projectionKey || state.paths[at].startsWith(projectionKey + "/")) state.resources[at] = 1;
  }
  restorePaths(out state: SafetyState, saved: constRef<SafetyState>, sid: number): void {
    const prefix: string = "s" + numberToString(sid);
    this.initializePath(state,prefix);
    for (let at: number = 0; at < saved.paths.length; at = at+1) if (saved.paths[at] == prefix || saved.paths[at].startsWith(prefix + "/")) this.setPath(state,saved.paths[at],saved.resources[at]);
  }
  samePaths(left: constRef<SafetyState>, right: constRef<SafetyState>): boolean {
    for (let at: number = 0; at < left.paths.length; at = at+1) if (left.resources[at] != this.pathState(right,left.paths[at])) return false;
    for (let at: number = 0; at < right.paths.length; at = at+1) if (right.resources[at] != this.pathState(left,right.paths[at])) return false;
    return true;
  }
  projection(module: number, id: number): boolean {
    const parent: number = this.binding.files[module].parents[id]; if (parent < 0) return false; const n: AstNode = this.node(module,parent);
    return ["MemberExpression","IndexExpression"].includes(n.kind) && bindingChild(n,"object") == id;
  }
  edge(source: number, target: number): void { if (source >= 0 && target >= 0) this.edges.push(new SafetyEdge(source,target)); }
  carrier(text: string, seen: number[]): boolean {
    if (seen.length == 0) { if (this.carrierTypes.has(text)) return true; if (this.plainTypes.has(text)) return false; }
    const result: boolean = this.carrierInner(text,seen);
    if (seen.length == 0) { if (result) this.carrierTypes.set(text,true); else this.plainTypes.set(text,true); }
    return result;
  }
  carrierInner(text: string, seen: number[]): boolean {
    if (functionClose(text) >= 0) return true;
    if (genericBase(text) == "Promise") return true;
    if (memoryMode(text) != "") return this.carrier(memoryInner(text),seen);
    const contracts: string[] = splitTypes(text,"&"); if (contracts.length > 1) { for (const part of contracts) if (this.carrier(part,seen)) return true; return false; }
    if (fixedArraySize(text) >= 0) return this.carrier(fixedArrayElement(text),seen);
    const generic: number = text.indexOf("<",0);
    if (generic > 0 && text.endsWith(">")) for (const part of splitTypes(text.slice(generic+1,text.length-1),",")) if (this.carrier(part,seen)) return true;
    if (text.endsWith("[]")) return this.carrier(semanticElement(text),seen);
    if (semanticTuple(text)) { for (const item of splitTypes(text.slice(1,text.length-1),",")) if (this.carrier(item,seen)) return true; return false; }
    const unions: string[] = splitTypes(text,"|"); if (unions.length > 1) { for (const item of unions) if (this.carrier(item,seen)) return true; return false; }
    const sid: number = canonicalSymbol(text);
    if (sid >= 0 && sid < this.binding.symbols.length) {
      if (seen.includes(sid)) return false; let next: number[] = seen; next.push(sid);
      const s: BindingSymbol = this.binding.symbols[sid];
      if (s.kind == "UnionDeclaration") for (const edge of this.node(s.module,s.node).edges) if (edge.role == "variants") {
        const variant: number = this.binding.files[s.module].declarations[edge.node];
        if (variant >= 0) for (const payload of functionParams(this.result.symbolTypes[variant])) if (this.carrier(payload,next)) return true;
      }
      for (let member: number = 0; member < this.binding.symbols.length; member = member + 1) {
        const f: BindingSymbol = this.binding.symbols[member];
        if (f.module == s.module && f.scope >= 0 && this.binding.scopes[f.scope].node == s.node && (f.kind == "ClassField" || f.kind == "InterfaceField")) if (this.carrier(this.result.symbolTypes[member],next)) return true;
      }
    } return false;
  }
  resolved(text: string): string {
    let value: string = text;
    for (let at: number = this.substitutions.length-1; at >= 0; at = at-1) value = replaceType(value,this.substitutions[at],this.substitutionTypes[at]);
    while (genericBase(value) == "pack") { const parts: string[] = genericArguments(value); if (parts.length != 1 || genericBase(parts[0]) != "pack") break; value = parts[0]; }
    return value;
  }
  borrowedSymbol(sid: number): boolean { return sid >= 0 && (borrowedType(this.resolved(this.result.symbolTypes[sid])) || this.effects.borrowedSymbol(sid)); }
  borrowMode(sid: number): string { return this.effects.borrowedSymbol(sid) ? this.effects.borrowMode(sid) : memoryMode(this.resolved(this.result.symbolTypes[sid])); }
  transferType(text: string): boolean {
    const value: string = this.resolved(text);
    if (this.resourceTypes.has(value)) return true; if (this.valueTypes.has(value)) return false;
    const result: boolean = resourceType(this.graph,this.binding,this.result,value,[]);
    if (result) this.resourceTypes.set(value,true); else this.valueTypes.set(value,true); return result;
  }
  transferValue(module: number, id: number): void {
    if (id >= 0 && this.transferType(this.result.files[module].types[id]) && !this.freshTransfer(module,id)) this.report(module,id,"E4101: transferir ownership requiere move(lvalue), también tras sustitución genérica");
  }
  freshTransfer(module: number, id: number): boolean {
    const n: AstNode = this.node(module,id);
    if (["AsExpression","SpreadElement"].includes(n.kind)) return this.freshTransfer(module,bindingChild(n,"expression"));
    if (n.kind == "SatisfiesExpression") return this.freshTransfer(module,bindingChild(n,"operand"));
    return ["AwaitExpression","CallExpression","MemberCallExpression","NewExpression","ArrayLiteralExpression","ObjectLiteralExpression","TernaryExpression"].includes(n.kind);
  }
  parameterProperty(module: number, node: number): boolean {
    for (const symbol of this.binding.symbols) if (symbol.module == module && symbol.node == node && symbol.kind == "ClassField") return true;
    return false;
  }
  memoryType(module: number, id: number, text: string, position: string): void {
    const key: string = position + ":" + text; if (this.memoryPath.includes(key)) return;
    if (this.memoryPath.length > 128) { this.report(module,id,"Límite de análisis de tipos de memoria excedido"); return; }
    this.memoryPath.push(key); this.memoryTypeInner(module,id,text,position); this.memoryPath.pop();
  }
  memoryTypeInner(module: number, id: number, text: string, position: string): void {
    if (text == "") return;
    if (text.startsWith("...")) { this.memoryType(module,id,text.slice(3,text.length),position); return; }
    const mode: string = memoryMode(text);
    if (mode != "") {
      if (borrowedType(text) && position != "parameter" && position != "local") this.report(module,id,"E4203: un préstamo no puede almacenarse ni retornarse en " + position);
      this.memoryType(module,id,memoryInner(text),"argument"); return;
    }
    if (functionClose(text) >= 0) {
      for (const p of functionParams(text)) this.memoryType(module,id,p,"parameter");
      this.memoryType(module,id,functionReturn(text),"retorno"); return;
    }
    const contracts: string[] = splitTypes(text,"&"); if (contracts.length > 1) { for (const part of contracts) this.memoryType(module,id,part,position); return; }
    if (fixedArraySize(text) >= 0) { this.memoryType(module,id,fixedArrayElement(text),"argument"); return; }
    if (text.endsWith("[]")) { this.memoryType(module,id,semanticElement(text),"argument"); return; }
    if (semanticTuple(text)) { for (const p of splitTypes(text.slice(1,text.length-1),",")) this.memoryType(module,id,p,"argument"); return; }
    const sid: number = canonicalSymbol(text);
    if (sid >= 0 && sid < this.binding.symbols.length) {
      const owner = this.binding.symbols[sid];
      if (owner.kind == "UnionDeclaration") for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == "variants") {
        const variant: number = this.binding.files[owner.module].declarations[edge.node];
        if (variant >= 0) for (const payload of functionParams(this.result.symbolTypes[variant])) this.memoryType(module,id,payload,"argument");
      }
    }
    const generic: number = text.indexOf("<",0);
    if (generic > 0 && text.endsWith(">")) for (const part of splitTypes(text.slice(generic+1,text.length-1),",")) this.memoryType(module,id,part,"argument");
    const unions: string[] = splitTypes(text,"|"); if (unions.length > 1) for (const p of unions) this.memoryType(module,id,p,"argument");
  }
  memoryContracts(): void {
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
      const s: BindingSymbol = this.binding.symbols[sid]; if ((s.module) < 0 || (s.node) < 0 || s.target >= 0) continue;
      const text: string = this.result.symbolTypes[sid];
      if (s.kind == "Parameter") this.memoryType(s.module,s.node,text,"parameter");
      else if (localBinding(s.kind)) this.memoryType(s.module,s.node,text,this.owner(s.scope) < 0 ? "global" : "local");
      else if (s.kind == "ClassField" || s.kind == "InterfaceField" || s.kind == "UnionVariantBinding") {
        this.memoryType(s.module,s.node,text,"campo");
      }
      else if (callableBinding(s.kind)) this.memoryType(s.module,s.node,text,"firma");
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.result.files[m].types.length; id = id + 1) {
      const n: AstNode = this.node(m,id); const sid: number = this.binding.files[m].declarations[id];
      if (this.binding.files[m].nodeScopes[id] < 0) continue;
      if ((n.kind == "ForOfStatement" || n.kind == "ForInStatement") && n.get("await") != "true") {
        const source: number = bindingChild(n,n.kind == "ForOfStatement" ? "iterable" : "target"); const root: number = this.root(m,source);
        const binding: number = bindingChild(n,"binding"); const bindingSymbol: number = this.binding.files[m].declarations[binding];
        if (root >= 0 && bindingSymbol >= 0) {
          let lease: BorrowLease = new BorrowLease(m,bindingSymbol,root,this.owner(this.binding.files[m].nodeScopes[id]),nodeBegin(this.node(m,bindingChild(n,"body"))),"constRef");
          lease.end = nodeEnd(this.node(m,bindingChild(n,"body"))); this.leases.push(lease);
        }
      }
      if (n.kind == "ArrayLiteralExpression" || n.kind == "ObjectProperty" || n.kind == "TernaryExpression") for (const edge of n.edges) if (["elements","value","thenBranch","elseBranch"].includes(edge.role)) {
        if (this.transferType(this.result.files[m].types[edge.node]) && !this.freshTransfer(m,edge.node)) this.report(m,edge.node,"E4101: un agregado no puede copiar ownership; requiere move(lvalue)");
      }
      if ((n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration" || n.kind == "ClassField") || n.kind == "AssignmentExpression" || n.kind == "ReturnStatement") {
        const value: number = bindingChild(n,n.kind == "ClassField" ? "defaultValue" : (n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") ? "initializer" : "value");
        if (value >= 0 && this.transferType(this.result.files[m].types[value]) && !this.freshTransfer(m,value)) this.report(m,value,"E4101: transferir ownership requiere move(identifier)");
        if ((n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") && sid >= 0 && this.borrowedSymbol(sid)) {
          const root: number = this.root(m,value);
          if (root < 0) this.report(m,id,"E4208: no se puede demostrar el origen del préstamo local");
          else {
            this.borrowSources[sid] = root;
            let lease: BorrowLease = new BorrowLease(m,sid,root,this.owner(this.binding.symbols[sid].scope),nodeEnd(n),memoryMode(this.result.symbolTypes[sid]));
            for (const r of this.binding.references) if (r.target == sid && r.module == m && this.owner(r.scope) == lease.owner) {
              const offset: number = nodeBegin(this.node(m,r.node)); if (offset > lease.end) lease.end = offset;
            }
            this.leases.push(lease);
          }
        }
      }
    }
    // Alias use extends the source lease, including aliases declared later.
    for (let pass: number = 0; pass < this.leases.length; pass = pass + 1) for (let a: number = 0; a < this.leases.length; a = a + 1) for (let b: number = 0; b < this.leases.length; b = b + 1) {
      const left: BorrowLease = this.leases[a]; const right: BorrowLease = this.leases[b];
      const init: number = bindingChild(this.node(right.module,this.binding.symbols[right.symbol].node),"initializer");
      if (this.reference(right.module,init) == left.symbol && right.end > left.end) this.leases[a].end = right.end;
    }
    for (let a: number = 0; a < this.leases.length; a = a + 1) for (let b: number = 0; b < a; b = b + 1) {
      const left: BorrowLease = this.leases[a]; const right: BorrowLease = this.leases[b];
      if (left.module == right.module && left.owner == right.owner && left.root == right.root && (left.begin) < right.end && (right.begin) < left.end && (left.mode == "ref" || right.mode == "ref")) {
        // A reborrow through an existing handle is intentionally unsupported.
        this.report(left.module,this.binding.symbols[left.symbol].node,"E4206: préstamos mutables/compartidos con duraciones solapadas");
      }
    }
  }
  captures(): void {
    for (const r of this.binding.references) {
      if (r.deferred || r.space != "value" || (r.target) < 0) continue;
      const s: BindingSymbol = this.binding.symbols[r.target];
      if ((s.module) < 0 || (!localBinding(s.kind) && !["Parameter","receiver"].includes(s.kind)) || this.owner(s.scope) < 0) continue;
      let scope: number = r.scope;
      while (scope >= 0 && scope != s.scope) {
        const owner = this.binding.scopes[scope];
        if ((owner.kind == "arrow" || owner.kind == "function") && this.owner(s.scope) != this.vertex(owner.module,owner.node)) {
          {
            let found: boolean = false; for (const c of this.result.captures) if (c.module == owner.module && c.closure == owner.node && c.symbol == r.target) found = true;
            if (!found) this.result.captures.push(new NativeCapture(owner.module,owner.node,r.target));
          }
        }
        scope = owner.parent;
      }
    }
    for (let c: number = 0; c < this.result.captures.length; c = c + 1) {
      const capture: NativeCapture = this.result.captures[c]; const text: string = this.result.symbolTypes[capture.symbol];
      const receiver: boolean = this.binding.symbols[capture.symbol].kind == "receiver";
      if (!receiver && (borrowedType(text) || this.transferType(text))) this.report(capture.module,capture.closure,"E4209: captura de préstamo/owner sin lifetime demostrado");
      const closureScope: number = this.binding.files[capture.module].nodeScopes[capture.closure];
      let mutates: boolean = false;
      for (let id: number = 0; id < this.result.files[capture.module].types.length; id = id + 1) {
        let scope: number = this.binding.files[capture.module].nodeScopes[id]; let inside: boolean = false;
        while (scope >= 0) { if (scope == closureScope) inside = true; scope = this.binding.scopes[scope].parent; }
        if (!inside) continue;
        const n: AstNode = this.node(capture.module,id); let target: number = -1;
        if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression" || n.kind == "DeleteStatement") target = bindingChild(n,"target");
        else if (n.kind == "MemberCallExpression" && this.mutating(capture.module,id)) target = bindingChild(n,"object");
        if (target >= 0 && this.root(capture.module,target) == capture.symbol) mutates = true;
      }
      if (mutates || receiver) this.seeds.push(this.vertex(capture.module,capture.closure));
      this.edge(this.symbolVertex(capture.symbol),this.vertex(capture.module,capture.closure));
    }
    for (let c: number = 0; c < this.result.captures.length; c = c + 1) if (this.seeds.includes(this.vertex(this.result.captures[c].module,this.result.captures[c].closure))) this.result.captures[c].mode = "reference";
  }
  mutating(module: number, id: number): boolean {
    const n: AstNode = this.node(module,id); if (n.kind != "MemberCallExpression") return false;
    if (["push","pop","sort"].includes(n.get("method"))) return true;
    if (["Map","Set"].includes(genericBase(memoryValue(this.result.files[module].types[bindingChild(n,"object")])))) return ["set","add","delete","clear"].includes(n.get("method"));
    const target: number = this.result.files[module].selected[id]; const targetModule: number = this.result.files[module].selectedModules[id];
    if (target < 0 || targetModule < 0) return false;
    let work: number[] = [target];
    while (work.length > 0) {
      const nodeId: number = work[work.length-1]; const item: AstNode = this.node(targetModule,nodeId); work.pop();
      let at: number = -1;
      if (item.kind == "AssignmentExpression" || item.kind == "CompoundAssignmentExpression") at = bindingChild(item,"target");
      else if (item.kind == "MemberCallExpression") at = bindingChild(item,"object");
      else if (this.helper(targetModule,nodeId) == "move") at = bindingChild(item,"args");
      while (at >= 0) {
        const receiver: AstNode = this.node(targetModule,at);
        if (receiver.kind == "IdentifierExpression" && receiver.get("name") == "this") return true;
        if (receiver.kind != "MemberExpression" && receiver.kind != "IndexExpression") break;
        at = bindingChild(receiver,"object");
      }
      for (const edge of item.edges) work.push(edge.node);
    } return false;
  }
  within(scope: number, ancestor: number): boolean {
    let at: number = scope; while (at >= 0) { if (at == ancestor) return true; at = this.binding.scopes[at].parent; } return false;
  }
  provenance(): void {
    let stores: LifetimeStore[] = [];
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.result.files[m].types.length; id = id + 1) {
      if (this.binding.files[m].nodeScopes[id] < 0) continue;
      const n: AstNode = this.node(m,id); const vertex: number = this.vertex(m,id);
      if (n.kind == "CallExpression" || n.kind == "MemberCallExpression") for (const target of this.effects.callTargets(m,id)) if (this.effects.asynchronous(target)) {
        const summary = this.effects.summaries[target]; let position: number = 0;
        for (const edge of this.node(summary.module,summary.node).edges) if (edge.role == "params") {
          const actual: number = this.effects.actualInput(m,id,position); const fallback: number = bindingChild(this.node(summary.module,edge.node),"defaultValue");
          if (actual >= 0) this.edge(this.vertex(m,actual),this.symbolVertex(summary.parameters[position]));
          else if (fallback >= 0) { this.edge(this.vertex(summary.module,fallback),this.symbolVertex(summary.parameters[position])); this.edge(this.vertex(summary.module,fallback),vertex); }
          position = position+1;
        }
      }
      if (n.kind == "FunctionDeclaration") {
        const sid: number = this.binding.files[m].declarations[id]; if (sid >= 0) this.edge(vertex,this.symbolVertex(sid));
      }
      if (n.kind == "ForOfStatement" && n.get("await") != "true") {
        const sid: number = this.binding.files[m].declarations[bindingChild(n,"binding")];
        if (sid >= 0) this.edge(this.vertex(m,bindingChild(n,"iterable")),this.symbolVertex(sid));
      }
      if (n.kind == "ObjectProperty") { const value: number = bindingChild(n,"value"); if (value >= 0) this.edge(this.vertex(m,value),vertex); }
      if (n.kind == "IdentifierExpression") {
        const selected: number = this.result.files[m].selected[id];
        if (selected >= 0) this.edge(this.vertex(this.result.files[m].selectedModules[id],selected),vertex);
        else { const sid: number = this.reference(m,id); if (sid >= 0) this.edge(this.symbolVertex(sid),vertex); }
      }
      if (n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") {
        const sid: number = this.binding.files[m].declarations[id]; const value: number = bindingChild(n,"initializer");
        if (sid >= 0 && value >= 0) { this.edge(this.vertex(m,value),this.symbolVertex(sid)); stores.push(new LifetimeStore(m,id,this.vertex(m,value),this.binding.symbols[sid].scope)); }
        if (sid >= 0 && this.owner(this.binding.symbols[sid].scope) < 0 && value >= 0) this.escapes.push(new EscapeSite(m,id,this.vertex(m,value),"almacenamiento global"));
        for (const edge of n.edges) if (edge.role == "arrayBindings" || edge.role == "objectBindings") {
          const target: number = this.binding.files[m].declarations[edge.node]; const fallback: number = bindingChild(this.node(m,edge.node),"defaultValue");
          if (target >= 0) {
            if (value >= 0) this.edge(this.vertex(m,value),this.symbolVertex(target));
            if (fallback >= 0) this.edge(this.vertex(m,fallback),this.symbolVertex(target));
            if (this.owner(this.binding.symbols[target].scope) < 0) { if (value >= 0) this.escapes.push(new EscapeSite(m,edge.node,this.vertex(m,value),"binding global")); if (fallback >= 0) this.escapes.push(new EscapeSite(m,edge.node,this.vertex(m,fallback),"default global")); }
          }
        }
      }
      if (n.kind == "AssignmentExpression") {
        const value: number = bindingChild(n,"value"); const target: number = this.root(m,bindingChild(n,"target"));
        if (target >= 0) {
          this.edge(this.vertex(m,value),this.symbolVertex(target)); stores.push(new LifetimeStore(m,id,this.vertex(m,value),this.binding.symbols[target].scope));
          if (this.owner(this.binding.symbols[target].scope) != this.owner(this.binding.files[m].nodeScopes[id])) this.escapes.push(new EscapeSite(m,id,this.vertex(m,value),"almacenamiento fuera del ámbito de captura"));
        }
      }
      if (n.kind == "MemberCallExpression" && ["push","set","add"].includes(n.get("method"))) {
        const target: number = this.root(m,bindingChild(n,"object"));
        if (target >= 0) for (const edge of n.edges) if (edge.role == "args") { this.edge(this.vertex(m,edge.node),this.symbolVertex(target)); stores.push(new LifetimeStore(m,id,this.vertex(m,edge.node),this.binding.symbols[target].scope)); }
      }
      if (this.effects.synchronousCallbacks(m,id).length > 0) {
        const inputs: number[] = this.effects.callbackInputs(m,id);
        for (const target of this.effects.callTargets(m,id)) {
          const summary = this.effects.summaries[target];
          for (let p: number = 0; p < inputs.length && p < summary.parameters.length; p = p + 1) this.edge(this.vertex(m,inputs[p]),this.symbolVertex(summary.parameters[p]));
        }
      }
      if (n.kind == "ForOfStatement" && n.get("await") == "true") {
        const sid: number = this.binding.files[m].declarations[bindingChild(n,"binding")];
        if (sid >= 0) this.edge(vertex,this.symbolVertex(sid));
      }
      if (this.carrier(this.result.files[m].types[id],[]) || (n.kind == "ForOfStatement" && n.get("await") == "true")) {
        if (this.effects.suspensionNode(m,id)) {
          for (const target of this.effects.callTargets(m,id)) {
            const summary = this.effects.summaries[target]; const body: number = bindingChild(this.node(summary.module,summary.node),"body");
            if (body >= 0 && this.node(summary.module,body).kind != "BlockStatement") this.edge(this.vertex(summary.module,body),vertex);
            for (let child: number = 0; child < this.result.files[summary.module].types.length; child = child+1) if (this.node(summary.module,child).kind == "ReturnStatement" && this.owner(this.binding.files[summary.module].nodeScopes[child]) == this.vertex(summary.module,summary.node)) {
              const value: number = bindingChild(this.node(summary.module,child),"value"); if (value >= 0) this.edge(this.vertex(summary.module,value),vertex);
            }
          }
        } else if (this.effects.synchronousCallbacks(m,id).length > 0) {
          if (["filter","find","sort"].includes(n.get("method"))) this.edge(this.vertex(m,bindingChild(n,"object")),vertex);
          if (n.get("method") == "reduce") this.edge(this.vertex(m,bindingChild(n,"args")),vertex);
          for (const target of this.effects.callTargets(m,id)) {
            const summary = this.effects.summaries[target]; const body: number = bindingChild(this.node(summary.module,summary.node),"body");
            if (body >= 0 && this.node(summary.module,body).kind != "BlockStatement") this.edge(this.vertex(summary.module,body),vertex);
            for (let child: number = 0; child < this.result.files[summary.module].types.length; child = child + 1) if (this.node(summary.module,child).kind == "ReturnStatement" && this.owner(this.binding.files[summary.module].nodeScopes[child]) == this.vertex(summary.module,summary.node)) {
              const value: number = bindingChild(this.node(summary.module,child),"value"); if (value >= 0) this.edge(this.vertex(summary.module,value),vertex);
            }
          }
        } else if (n.kind != "ArrowFunctionExpression") for (const edge of n.edges) this.edge(this.vertex(m,edge.node),vertex);
        if (n.kind == "CallExpression") { const sid: number = this.reference(m,id); if (sid >= 0) this.edge(this.symbolVertex(sid),vertex); }
      }
      if (n.kind == "ReturnStatement") {
        const value: number = bindingChild(n,"value");
        if (value >= 0) this.escapes.push(new EscapeSite(m,id,this.vertex(m,value),"retorno"));
      }
      if (n.kind == "ArrowFunctionExpression") {
        const body: number = bindingChild(n,"body");
        if (this.node(m,body).kind != "BlockStatement") this.escapes.push(new EscapeSite(m,body,this.vertex(m,body),"retorno implícito"));
      }
      if (n.kind == "CallExpression" || n.kind == "MemberCallExpression" || n.kind == "NewExpression") {
        const knownPush: boolean = n.kind == "MemberCallExpression" && ["push","set","add"].includes(n.get("method"));
        const root: number = knownPush ? this.root(m,bindingChild(n,"object")) : -1;
        const localPush: boolean = root >= 0 && this.owner(this.binding.symbols[root].scope) == this.owner(this.binding.files[m].nodeScopes[id]);
        let argumentIndex: number = 0;
        if (!knownPush || !localPush) for (const edge of n.edges) if (edge.role == "args") {
          if ((knownPush && !localPush) || this.effects.canRetain(m,id,argumentIndex)) this.escapes.push(new EscapeSite(m,edge.node,this.vertex(m,edge.node),"callback retenido o retención no demostrada"));
          argumentIndex = argumentIndex + 1;
        }
      }
    }
    let risk: number[] = []; for (let i: number = 0; i < this.nodes + this.binding.symbols.length; i = i + 1) risk.push(-1);
    let pending: number[] = []; for (const seed of this.seeds) if (risk[seed] < 0) { risk[seed] = seed; pending.push(seed); }
    for (let at: number = 0; at < pending.length; at = at + 1) for (const e of this.edges) if (e.source == pending[at] && risk[e.target] < 0) { risk[e.target] = risk[e.source]; pending.push(e.target); }
    for (const site of this.escapes) if (risk[site.vertex] >= 0) this.report(site.module,site.node,"E4210: closure con captura por referencia escapa por " + site.reason);
    // A frame/closure stored outside a block can outlive the locals it borrows,
    // even when both declarations belong to the same function.
    for (const seed of this.seeds) {
      let reached: number[] = [seed];
      for (let at: number = 0; at < reached.length; at = at+1) for (const edge of this.edges) if (edge.source == reached[at] && !reached.includes(edge.target)) reached.push(edge.target);
      for (const store of stores) if (reached.includes(store.vertex)) for (const capture of this.result.captures) if (capture.mode == "reference" && this.vertex(capture.module,capture.closure) == seed) {
        const scope: number = this.binding.symbols[capture.symbol].scope;
        if (this.owner(scope) == this.owner(store.scope) && !this.within(store.scope,scope)) this.report(store.module,store.node,"E4210: un frame o closure almacenado fuera del bloque sobrevive a una captura por referencia");
      }
    }
  }
  isPublic(sid: number): boolean {
    const s: BindingSymbol = this.binding.symbols[sid];
    for (const entry of this.binding.exports) if (entry.module == s.module && this.origin(entry.symbol) == sid) return true;
    return false;
  }
  publicType(module: number, id: number, text: string): void {
    for (let at: number = 0; at < text.length; at = at + 1) if (text.charAt(at) == "#") {
      let sid: number = 0; at = at + 1;
      while (at < text.length && text.charCodeAt(at) >= 48 && text.charCodeAt(at) <= 57) { sid = sid * 10 + text.charCodeAt(at) - 48; at = at + 1; }
      at = at - 1;
      if (sid < this.binding.symbols.length && !this.isPublic(sid)) this.report(module,id,"E4401: la API pública expone el tipo privado '" + this.binding.symbols[sid].name + "'");
    }
    for (const ref of this.binding.references) if (ref.module == module && ref.node == id && ref.space == "type" && ref.target >= 0) {
      const s: BindingSymbol = this.binding.symbols[ref.target];
      if (s.kind == "TypeAliasDeclaration" && !this.isPublic(ref.target)) this.report(module,id,"E4401: la API pública expone el alias privado '" + s.name + "'");
      if (["ClassDeclaration","InterfaceDeclaration","UnionDeclaration","EnumDeclaration"].includes(s.kind) && !this.isPublic(ref.target)) this.report(module,id,"E4401: la API pública expone el tipo privado '" + s.name + "'");
    }
  }
  publicSurface(module: number, id: number): void {
    const n: AstNode = this.node(module,id); const sid: number = this.binding.files[module].declarations[id];
    this.publicType(module,id,callableBinding(n.kind) ? this.result.files[module].types[id] : sid >= 0 ? this.result.symbolTypes[this.origin(sid)] : this.result.files[module].types[id]);
    for (const edge of n.edges) if (["params","typeParameters","fields","methods","variants","bindings"].includes(edge.role)) {
      const child: AstNode = this.node(module,edge.node);
      if ((edge.role == "fields" || edge.role == "methods") && child.get("access") != "" && child.get("access") != "public") continue;
      this.publicSurface(module,edge.node);
    }
  }
  visibility(): void {
    let seen: number[] = [];
    for (const entry of this.binding.exports) {
      const sid: number = this.origin(entry.symbol); if (seen.includes(sid)) continue; seen.push(sid);
      const s: BindingSymbol = this.binding.symbols[sid];
      if (s.module >= 0 && s.node >= 0 && (s.namespaceModule) < 0) for (const declaration of s.declarations) this.publicSurface(s.module,declaration);
    }
  }
  join(left: constRef<SafetyState>, right: constRef<SafetyState>): SafetyState {
    if (left.exit != "") return right;
    if (right.exit != "") return left;
    let result: SafetyState = left;
    for (let sid: number = 0; sid < left.slots.length; sid = sid + 1) {
      const a: number = left.slots[sid]; const b: number = right.slots[sid];
      if (a == b) result.slots[sid] = a; else if (this.binding.symbols[sid].kind == "ClassField") result.slots[sid] = 3; else if (a == 0 || b == 0) result.slots[sid] = 0; else result.slots[sid] = 3;
    }
    for (let at: number = 0; at < left.paths.length; at = at+1) { const a: number = left.resources[at]; const b: number = this.pathState(right,left.paths[at]); this.setPath(result,left.paths[at],a == b ? a : 3); }
    for (let at: number = 0; at < right.paths.length; at = at+1) { const a: number = this.pathState(left,right.paths[at]); const b: number = right.resources[at]; this.setPath(result,right.paths[at],a == b ? a : 3); }
    return result;
  }
  constructorClass(module: number, id: number): number {
    let scope: number = this.binding.files[module].nodeScopes[id];
    while (scope >= 0) {
      const current = this.binding.scopes[scope];
      if (current.kind == "function" || current.kind == "arrow") {
        const owner: AstNode = this.node(current.module,current.node);
        return owner.kind == "ClassMethod" && owner.get("name") == "constructor" ? current.parent : -1;
      }
      scope = current.parent;
    } return -1;
  }
  constructorFields(module: number, id: number): number[] {
    const scope: number = this.constructorClass(module,id); let fields: number[] = [];
    if (scope < 0) return fields;
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
      const s = this.binding.symbols[sid];
      if (s.scope == scope && s.kind == "ClassField" && this.node(s.module,s.node).get("isStatic") != "true") fields.push(sid);
    } return fields;
  }
  initializeFields(module: number, id: number, out state: SafetyState): void {
    for (const sid of this.constructorFields(module,id)) {
      const s = this.binding.symbols[sid]; const field: AstNode = this.node(s.module,s.node);
      if (field.kind == "Parameter" || bindingChild(field,"defaultValue") >= 0) state.slots[sid] = 1; else state.slots[sid] = 0;
    }
  }
  fieldsInitialized(module: number, id: number, state: constRef<SafetyState>): void {
    for (const sid of this.constructorFields(module,id)) if (state.slots[sid] != 1) this.report(module,id,"Campo no inicializado en todas las rutas: '" + this.binding.symbols[sid].name + "'");
  }
  constructorField(module: number, id: number): number {
    const n: AstNode = this.node(module,id); if (n.kind != "MemberExpression") return -1;
    const object: number = bindingChild(n,"object");
    if (this.node(module,object).kind != "IdentifierExpression" || this.node(module,object).get("name") != "this") return -1;
    const sid: number = this.result.files[module].members[id];
    return sid >= 0 && this.constructorFields(module,id).includes(sid) ? sid : -1;
  }
  access(module: number, id: number, sid: number, mode: string): void {
    if (sid < 0) return; const handle: number = this.directRoot(module,id); if (handle >= 0 && (this.borrowSources[handle] >= 0 || this.borrowedSymbol(handle) || this.binding.symbols[handle].kind == "receiver")) return; const position: number = nodeBegin(this.node(module,id));
    const currentOwner: number = this.owner(this.binding.files[module].nodeScopes[id]);
    for (const c of this.result.captures) if (this.vertex(c.module,c.closure) == currentOwner && c.symbol == sid && c.mode == "value") return;
    for (const lease of this.leases) {
      if (lease.root != sid || lease.end <= lease.begin || (lease.mode != "ref" && mode == "read")) continue;
      let live: boolean = lease.module == module && lease.owner == currentOwner && (lease.begin) <= position && position <= lease.end;
      for (const site of this.sites) {
        const offset: number = nodeBegin(this.node(site.module,site.node));
        if (lease.module == site.module && lease.owner == this.owner(this.binding.files[site.module].nodeScopes[site.node]) && (lease.begin) <= offset && offset <= lease.end) live = true;
      }
      if (live) this.report(module,id,"E4207: acceso a la fuente durante un préstamo activo");
    }
  }
  read(module: number, id: number, sid: number, state: constRef<SafetyState>): void {
    if (sid < 0 || (this.binding.symbols[sid].module) < 0) return;
    const s: BindingSymbol = this.binding.symbols[sid]; if (!localBinding(s.kind) && !["Parameter","receiver"].includes(s.kind)) return;
    if (state.slots[sid] == 0) this.report(module,id,"E4001: uso antes de inicializar '" + s.name + "'");
    if (state.slots[sid] == 2 || state.slots[sid] == 3) this.report(module,id,state.slots[sid] == 2 ? "E4102: uso de owner movido '" + s.name + "'" : "E4103: uso de owner posiblemente movido '" + s.name + "'");
    if (this.borrowSources[sid] < 0) this.access(module,id,sid,"read");
  }
  callBorrows(module: number, id: number): void {
    const n: AstNode = this.node(module,id); const params: string[] = functionParams(this.result.files[module].signatures[id]);
    const display: boolean = ["print","printError","write","writeError"].includes(this.helper(module,id)) || (n.kind == "MemberCallExpression" && this.result.files[module].types[bindingChild(n,"object")] == "Console");
    const comparison: boolean = n.kind == "MemberCallExpression" && n.get("method") == "includes" && memoryValue(this.result.files[module].types[bindingChild(n,"object")]).endsWith("[]");
    let roots: number[] = []; let modes: string[] = []; let at: number = 0;
    for (const edge of n.edges) if (edge.role == "args") {
      const position: number = argumentParameter(this.result.files[module],edge.node,at);
      const arg: number = this.node(module,edge.node).kind == "NamedArgumentExpression" ? bindingChild(this.node(module,edge.node),"value") : edge.node;
      const actual: string = this.resolved(this.result.files[module].types[arg]); let expected: string = this.resolved(position < params.length ? argumentType(params[position],this.node(module,edge.node).kind == "SpreadElement") : actual);
      if (position < params.length && params[position].startsWith("...") && genericBase(params[position].slice(3,params[position].length)) == "pack") {
        const bundle: string = this.resolved(params[position].slice(3,params[position].length)); const elements: string[] = genericArguments(bundle); const slot: number = this.result.files[module].argumentElements[edge.node];
        this.memoryType(module,id,bundle,"argument");
        expected = (this.node(module,edge.node).kind == "SpreadElement" ? bundle : slot >= 0 && slot < elements.length ? elements[slot] : actual);
      }
      const root: number = this.root(module,arg); const mode: string = borrowedType(expected) ? memoryMode(expected) : this.helper(module,arg) == "move" ? "move" : (display || comparison) && this.transferType(actual) ? "constRef" : "read";
      if (!display && !comparison && this.transferType(expected) && (borrowedType(actual) || (this.transferType(actual) && !this.freshTransfer(module,arg)))) this.report(module,arg,"E4101: argumento owner requiere move(identifier)");
      if (borrowedType(expected) && root < 0) this.report(module,arg,"E4208: un argumento prestado necesita un lvalue con origen conocido");
      if (borrowedType(expected) && root >= 0) this.access(module,arg,root,mode == "ref" ? "write" : "read");
      if (mode == "ref" && root >= 0) {
        const s: BindingSymbol = this.binding.symbols[root];
        if (s.module >= 0 && localBinding(s.kind)) {
          const declaration: number = s.kind == "ArrayBinding" || s.kind == "ObjectBinding" ? this.binding.files[s.module].parents[s.node] : s.node;
          if (this.node(s.module,declaration).get("mutable") != "true") this.report(module,arg,"E4208: préstamo mutable de una constante");
        }
        if (readonlyType(actual)) this.report(module,arg,"E4300: préstamo mutable de readonly");
      }
      for (let i: number = 0; i < roots.length; i = i + 1) if (root >= 0 && root == roots[i] && (mode == "ref" || modes[i] == "ref" || (mode == "move" && borrowedType(modes[i] + "<x>")) || (modes[i] == "move" && borrowedType(mode + "<x>")))) this.report(module,arg,"E4206: argumentos con préstamos/ownership incompatibles sobre la misma fuente");
      roots.push(root); modes.push(mode); at = at + 1;
    }
  }
  targets(module: number, id: number): number[] {
    const callback: number = this.effects.arrayCallback(module,id);
    const sid: number = this.reference(module,callback >= 0 ? callback : id);
    if (sid >= 0) for (let at: number = this.arguments.length - 1; at >= 0; at = at - 1) if (this.arguments[at].parameter == sid) {
      const actual = this.arguments[at]; return this.effects.points[this.effects.vertex(actual.module,actual.node)].targets;
    }
    return this.effects.callTargets(module,id);
  }
  observable(summaryId: number, sid: number, module: number, id: number): number {
    const parameters: number[] = this.effects.summaries[summaryId].parameters;
    for (let at: number = 0; at < parameters.length; at = at + 1) if (sid == parameters[at]) {
      if (!this.borrowedSymbol(sid)) return -1;
      return this.root(module,this.effects.actualInput(module,id,at));
    }
    if (this.binding.symbols[sid].kind == "receiver") return this.root(module,bindingChild(this.node(module,id),"object"));
    if (this.owner(this.binding.symbols[sid].scope) == this.vertex(this.effects.summaries[summaryId].module,this.effects.summaries[summaryId].node)) return -1;
    for (const c of this.result.captures) if (c.module == this.effects.summaries[summaryId].module && c.closure == this.effects.summaries[summaryId].node && c.symbol == sid && c.mode == "value") return -1;
    return sid;
  }
  summaryPosition(summaryId: number, symbol: number, module: number, id: number): number {
    const parameters: number[] = this.effects.summaries[summaryId].parameters;
    for (let at: number = 0; at < parameters.length; at = at+1) if (parameters[at] == symbol && this.borrowedSymbol(symbol)) { const argument: number = this.effects.actualInput(module,id,at); return argument >= 0 ? argument : id; }
    if (this.binding.symbols[symbol].kind == "receiver") { const object: number = bindingChild(this.node(module,id),"object"); if (object >= 0) return object; }
    return id;
  }
  summary(summaryId: number, module: number, id: number, out state: SafetyState): void {
    const summary = this.effects.summaries[summaryId];
    if (summary.invokes.length > 0) { this.report(module,id,"E4104: resumen recursivo con callbacks simbólicos todavía no demostrados"); return; }
    if (summary.unknown) this.unknown(module,id,state);
    for (const sid of summary.reads) { const root: number = this.observable(summaryId,sid,module,id); if (root >= 0) this.read(module,this.summaryPosition(summaryId,sid,module,id),root,state); }
    for (const sid of summary.writes) { const root: number = this.observable(summaryId,sid,module,id); if (root >= 0) this.access(module,this.summaryPosition(summaryId,sid,module,id),root,"write"); }
    for (const sid of summary.moves) {
      const root: number = this.observable(summaryId,sid,module,id);
      if (root >= 0) { const position: number = this.summaryPosition(summaryId,sid,module,id); this.read(module,position,root,state); this.access(module,position,root,"move"); if (state.slots[root] != 2) state.slots[root] = 3; }
    }
  }
  defaultsNeedFlow(summaryId: number): boolean {
    if (this.defaultReads.has(summaryId)) return true; if (this.valueDefaults.has(summaryId)) return false;
    let declarations: number[] = [summaryId];
    for (let at: number = 0; at < declarations.length; at = at+1) {
      const target: number = declarations[at]; if (this.defaultReads.has(target)) { this.defaultReads.set(summaryId,true); return true; }
      if (this.valueDefaults.has(target)) continue;
      const declaration = this.effects.summaries[target];
      for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == "params") {
        const value: number = bindingChild(this.node(declaration.module,edge.node),"defaultValue");
        if (value >= 0) { const expression: AstNode = this.node(declaration.module,value);
          const unary: number = expression.kind == "UnaryExpression" ? bindingChild(expression,"operand") : -1;
          if (expression.kind != "LiteralExpression" && !(expression.kind == "ArrayLiteralExpression" && expression.edges.length == 0) && !(unary >= 0 && this.node(declaration.module,unary).kind == "LiteralExpression")) { this.defaultReads.set(summaryId,true); return true; }
        }
      }
      for (const callee of declaration.callees) if (!declarations.includes(callee)) declarations.push(callee);
    }
    this.valueDefaults.set(summaryId,true); return false;
  }
  summaryReason(summaryId: number, reason: string): boolean {
    if (this.trace && (this.visits) < 40) { const summary = this.effects.summaries[summaryId]; printError("frontend: precise "+this.graph.modules[summary.module].file+":"+this.node(summary.module,summary.node).get("name")+" "+reason); }
    return false;
  }
  valueSummary(summaryId: number, module: number, id: number, state: constRef<SafetyState>): boolean {
    const summary = this.effects.summaries[summaryId]; const call: AstNode = this.node(module,id);
    // Opaque calls still run unknown() through summary(); replaying a value-only
    // body cannot expose additional caller storage. Borrowed/resource inputs,
    // captures and defaults remain on the precise path below.
    if (summary.invokes.length > 0 || summary.moves.length > 0 || call.kind == "NewExpression") return this.summaryReason(summaryId,"effects invokes="+numberToString(summary.invokes.length)+" moves="+numberToString(summary.moves.length));
    const frame: number = this.owner(this.binding.files[module].nodeScopes[id]);
    if (frame >= 0 && this.node(module,frame-this.offsets[module]).get("name") == "constructor") {
      for (const field of this.constructorFields(module,id)) if (state.slots[field] != 1) return this.summaryReason(summaryId,"constructor fields pending");
    }
    for (const input of functionParams(this.result.files[module].signatures[id])) {
      const value: string = input.startsWith("...") ? input.slice(3,input.length) : input;
      if (borrowedType(value) || this.transferType(value) || this.carrier(value,[])) return this.summaryReason(summaryId,"parameter "+value);
    }
    const returns: string = this.result.files[module].types[id]; if (this.transferType(returns) || this.carrier(returns,[])) return this.summaryReason(summaryId,"result "+returns);
    if (call.kind == "MemberCallExpression") {
      const receiver: string = this.effects.receiver(module,id);
      if ((borrowedType(receiver) && summary.unknown) || this.transferType(receiver) || this.carrier(receiver,[])) return this.summaryReason(summaryId,"receiver "+receiver);
    }
    // Defaults with runtime reads/effects require the precise supplied-argument path.
    if (this.defaultsNeedFlow(summaryId)) return this.summaryReason(summaryId,"defaults");
    for (const group of [summary.reads,summary.writes]) for (const symbol of group) {
      const root: number = this.observable(summaryId,symbol,module,id); if (root < 0) continue;
      const value: string = this.result.symbolTypes[root];
      // A method's receiver already denotes the caller's authorized handle.
      // summaryPosition preserves that expression, and summary() checks every
      // projected access. Other borrowed roots still require precise replay.
      if ((this.borrowedSymbol(root) && (this.binding.symbols[symbol].kind != "receiver" || summary.unknown)) || this.transferType(value) || this.carrier(value,[])) return this.summaryReason(summaryId,"root "+value);
      // summary() checks each projected read/write against live caller leases.
      // A lexical lease elsewhere is not a reason to replay the whole body.
    }
    for (const symbol of summary.writes) { const root: number = this.observable(summaryId,symbol,module,id); if (root >= 0 && state.slots[root] != 1) return this.summaryReason(summaryId,"uninitialized write"); }
    return true;
  }
  unknown(module: number, id: number, state: constRef<SafetyState>): void {
    // A symbolic callback parameter is an obligation on callers. Definitions
    // with no concrete caller keep that obligation in their effect summary.
    const callback: number = this.effects.arrayCallback(module,id);
    let symbolic: number = this.reference(module,callback >= 0 ? callback : id); let remaining: number = this.arguments.length + 1;
    while (symbolic >= 0 && this.binding.symbols[symbolic].kind == "Parameter" && remaining > 0) {
      let found: number = -1;
      for (let at: number = this.arguments.length - 1; at >= 0; at = at - 1) if (this.arguments[at].parameter == symbolic) { found = at; break; }
      if (found < 0) return;
      const actual = this.arguments[found]; const next: number = this.directRoot(actual.module,actual.node);
      if (next == symbolic) break; symbolic = next; remaining = remaining - 1;
    }
    for (const lease of this.leases) if (lease.end > lease.begin) {
      let live: boolean = lease.module == module && lease.owner == this.owner(this.binding.files[module].nodeScopes[id]) && (lease.begin) <= nodeBegin(this.node(module,id)) && (nodeBegin(this.node(module,id))) <= lease.end;
      for (const site of this.sites) if (lease.module == site.module && lease.owner == this.owner(this.binding.files[site.module].nodeScopes[site.node]) && (lease.begin) <= nodeBegin(this.node(site.module,site.node)) && (nodeBegin(this.node(site.module,site.node))) <= lease.end) live = true;
      if (live) {
        const current: number = this.owner(this.binding.files[module].nodeScopes[id]); let reachable: boolean = this.owner(this.binding.symbols[lease.root].scope) < 0;
        for (const edge of this.node(module,id).edges) if (edge.role == "args" && this.root(module,edge.node) == lease.root) reachable = true;
        for (const target of this.effects.callTargets(module,id)) if (this.effects.opaque(this.effects.summaries[target].module,this.effects.summaries[target].node)) {
          if (this.owner(this.binding.symbols[lease.root].scope) == current) reachable = true;
          for (const argument of this.arguments) if (argument.root == lease.root && this.owner(this.binding.symbols[argument.parameter].scope) == current && this.borrowedSymbol(argument.parameter)) reachable = true;
        }
        if (reachable) this.report(module,id,"E4104: efectos opacos durante un préstamo activo no demostrados");
      }
    }
    for (let global: number = 0; global < this.binding.symbols.length; global = global + 1) {
      const s = this.binding.symbols[global];
      if (localBinding(s.kind) && this.owner(s.scope) < 0 && (this.transferType(this.result.symbolTypes[global]) || state.slots[global] == 2 || state.slots[global] == 3)) this.report(module,id,"E4104: efectos opacos sobre globals no demostrados");
    }
  }
  suspension(module: number, id: number): void {
    const offset: number = this.node(module,id).kind == "AwaitExpression" ? nodeEnd(this.node(module,id)) : nodeBegin(this.node(module,id)); const owner: number = this.owner(this.binding.files[module].nodeScopes[id]);
    for (const lease of this.leases) if (lease.end > lease.begin) {
      let live: boolean = lease.module == module && lease.owner == owner && lease.begin <= offset && offset < lease.end;
      for (const site of this.sites) {
        const use: number = this.node(site.module,site.node).kind == "AwaitExpression" ? nodeEnd(this.node(site.module,site.node)) : nodeBegin(this.node(site.module,site.node));
        if (lease.module == site.module && lease.owner == this.owner(this.binding.files[site.module].nodeScopes[site.node]) && lease.begin <= use && use < lease.end) live = true;
      }
      if (live) this.report(module,id,"E4204: un préstamo vivo no puede atravesar una suspensión");
    }
  }
  consumeTask(module: number, id: number, out state: SafetyState): void {
    const root: number = this.root(module,id); this.access(module,id,root,"move");
    if (this.helper(module,id) == "move") return;
    if (this.node(module,id).kind == "IdentifierExpression") { if (root >= 0) state.slots[root] = 2; }
    else if (this.node(module,id).kind == "MemberExpression" || this.node(module,id).kind == "IndexExpression") this.setPath(state,this.projectionKey(module,id),2);
  }
  awaitTasks(module: number, id: number, input: number, out state: SafetyState, active: number[], detached: boolean = false): void {
    const sources: number[] = this.effects.taskSources(module,input); const before: SafetyState = state; let joined: SafetyState = state; joined.exit = "unreachable";
    if (sources.length == 0) { if (!this.effects.taskCollection(module,id) && this.node(module,id).kind != "ForOfStatement") this.unknown(module,id,state); return; }
    for (const source of sources) {
      let choice: SafetyState = before;
      if (source < 0) { this.unknown(module,id,choice); joined = this.join(joined,choice); continue; }
      const m: number = this.effects.sourceModule(source); const creation: number = source-this.effects.offsets[m];
      if (!this.effects.builtin(m,creation)) for (const target of this.effects.callTargets(m,creation)) {
        if (!this.effects.asynchronous(target)) continue;
        const summary = this.effects.summaries[target]; const owner: number = this.vertex(summary.module,summary.node);
        if (detached) {
          if (summary.unknown) this.report(module,id,"E4204: spawn requiere efectos de la tarea demostrados");
          for (const sid of summary.reads) if (this.owner(this.binding.symbols[sid].scope) < 0 && (this.transferType(this.result.symbolTypes[sid]) || state.slots[sid] != 1)) this.report(module,id,"E4204: spawn no puede retener un global con ownership o sin inicializar");
          for (const sid of summary.moves) if (this.owner(this.binding.symbols[sid].scope) < 0) this.report(module,id,"E4204: spawn no puede mover un global sin duración demostrada");
          for (const sid of summary.writes) if (this.owner(this.binding.symbols[sid].scope) < 0 && this.transferType(this.result.symbolTypes[sid])) this.report(module,id,"E4204: spawn no puede modificar un global con ownership");
        } else if (active.includes(owner) || active.length >= 64) this.summary(target,module,id,choice);
        else {
          this.sites.push(new SafetyCallSite(module,id));
          this.invokeTarget(m,creation,new SafetyTarget(summary.module,summary.node),choice,active,"resume"); this.sites.pop();
        }
      }
      joined = this.join(joined,choice);
    }
    state = joined;
  }
  invoke(module: number, id: number, out state: SafetyState, active: number[], repeat: boolean = true): void {
    if (this.effects.builtin(module,id)) return;
    if (repeat && this.effects.arrayCallback(module,id) >= 0) {
      const n: AstNode = this.node(module,id); let object: number = bindingChild(n,"object");
      if (object < 0 && this.effects.callbackInputs(module,id).length > 0) object = this.effects.callbackInputs(module,id)[0];
      const root: number = this.root(module,object);
      const leaseStart: number = this.leases.length;
      if (root >= 0) {
        const owner: number = this.owner(this.binding.files[module].nodeScopes[id]);
        let lease: BorrowLease = new BorrowLease(module,-1,root,owner,nodeBegin(n),"constRef"); lease.end = nodeEnd(n); this.leases.push(lease);
      }
      if (genericBase(memoryValue(this.result.files[module].types[object])) == "Optional") {
        let choice: SafetyState = state; this.invoke(module,id,choice,active,false); state = this.join(state,choice);
        while (this.leases.length > leaseStart) this.leases.pop(); return;
      }
      let head: SafetyState = state;
      while (true) {
        let iteration: SafetyState = head; this.invoke(module,id,iteration,active,false);
        const merged: SafetyState = this.join(head,iteration); let same: boolean = true;
        for (let sid: number = 0; sid < head.slots.length; sid = sid + 1) if (head.slots[sid] != merged.slots[sid]) same = false;
        if (!this.samePaths(head,merged)) same = false; head = merged; if (same) break;
      }
      state = head; while (this.leases.length > leaseStart) this.leases.pop(); return;
    }
    const targets: number[] = this.targets(module,id);
    if (targets.length == 0) { this.unknown(module,id,state); return; }
    const before: SafetyState = state; let joined: SafetyState = state;
    joined.exit = "unreachable";
    for (const summaryId of targets) {
      const summary = this.effects.summaries[summaryId]; let choice: SafetyState = before;
      const target: SafetyTarget = new SafetyTarget(summary.module,summary.node); const owner: number = this.vertex(target.module,target.node);
      if (!this.effects.implemented(target.module,target.node)) this.unknown(module,id,choice);
      else if (this.effects.asynchronous(summaryId)) {
        if (active.includes(owner) || active.length >= 64) this.summary(summary.creation,module,id,choice);
        else this.invokeTarget(module,id,target,choice,active,"creation");
      }
      else if (active.includes(owner) || active.length >= 64 || this.valueSummary(summaryId,module,id,choice)) this.summary(summaryId,module,id,choice);
      else this.invokeTarget(module,id,target,choice,active);
      joined = this.join(joined,choice);
    }
    state = joined;
  }
  invokeTarget(module: number, id: number, target: SafetyTarget, out state: SafetyState, active: number[], phase: string = "body"): void {
    this.visits = this.visits+1;
    if (this.trace && this.visits % 10000 == 0) printError("frontend: flow calls "+numberToString(this.visits)+" "+this.graph.modules[target.module].file+":"+this.node(target.module,target.node).get("name")+" depth "+numberToString(active.length));
    const owner: number = this.vertex(target.module,target.node);
    const substitutionStart: number = this.substitutions.length;
    let classScope: number = this.binding.files[target.module].nodeScopes[target.node];
    while (classScope >= 0 && this.binding.scopes[classScope].kind != "ClassDeclaration") classScope = this.binding.scopes[classScope].parent;
    if (classScope >= 0) {
      const scope = this.binding.scopes[classScope]; const declaration: AstNode = this.node(scope.module,scope.node); const object: number = bindingChild(this.node(module,id),"object");
      const receiver: string = this.resolved(memoryValue(object >= 0 ? this.effects.receiver(module,id) : this.result.files[module].types[id])); const inputs: string[] = genericArguments(receiver); let at: number = 0;
      for (const edge of declaration.edges) if (edge.role == "typeParameters") { if (at < inputs.length) { this.substitutions.push("@" + numberToString(this.binding.files[scope.module].declarations[edge.node])); this.substitutionTypes.push(inputs[at]); } at = at+1; }
    }
    const patterns: string[] = functionParams(this.result.files[target.module].types[target.node]); const values: string[] = functionParams(this.result.files[module].signatures[id]);
    for (const edge of this.node(target.module,target.node).edges) if (edge.role == "typeParameters") {
      const token: string = "@" + numberToString(this.binding.files[target.module].declarations[edge.node]); let inferred: string = "";
      for (let at: number = 0; at < patterns.length && at < values.length; at = at+1) {
        const value: string = resourceSubstitution(patterns[at],this.resolved(values[at]),token); if (value != "") inferred = value;
      }
      if (inferred != "") { this.substitutions.push(token); this.substitutionTypes.push(inferred); }
    }
    const argumentStart: number = this.arguments.length; const leaseStart: number = this.leases.length;
    let saved: SafetyState = state; const returnStart: number = this.returns.length; if (phase != "resume") this.sites.push(new SafetyCallSite(module,id));
    this.initializeFields(target.module,target.node,state);
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (this.owner(this.binding.symbols[sid].scope) == owner) {
      state.slots[sid] = (this.binding.symbols[sid].kind == "receiver" ? 1 : 0); this.initializePath(state,"s" + numberToString(sid));
      const object: number = bindingChild(this.node(module,id),"object");
      if (this.binding.symbols[sid].kind == "receiver" && object >= 0) this.arguments.push(new SafetyArgument(sid,module,object,this.root(module,object)));
    }
    let next: number[] = active; next.push(owner);
    let parameterIndex: number = 0; let actualNodes: number[] = [];
    for (const edge of this.node(target.module,target.node).edges) if (edge.role == "params") actualNodes.push(-1);
    let sourcePosition: number = 0;
    for (const edge of this.node(module,id).edges) if (edge.role == "args") {
      const position: number = argumentParameter(this.result.files[module],edge.node,sourcePosition);
      if (position < actualNodes.length) {
        let value: number = edge.node; if (this.node(module,edge.node).kind == "NamedArgumentExpression") value = bindingChild(this.node(module,edge.node),"value");
        else if (this.node(module,edge.node).kind == "SpreadElement") value = bindingChild(this.node(module,edge.node),"expression");
        actualNodes[position] = value;
      }
      sourcePosition = sourcePosition + 1;
    }
    if (this.effects.synchronousCallbacks(module,id).length > 0) actualNodes = this.effects.callbackInputs(module,id);
    for (const edge of this.node(target.module,target.node).edges) if (edge.role == "params") {
      if (phase != "resume" && actualNodes[parameterIndex] < 0) this.expression(target.module,bindingChild(this.node(target.module,edge.node),"defaultValue"),state,next);
      const parameter: number = this.binding.files[target.module].declarations[edge.node]; if (parameter >= 0) state.slots[parameter] = 1;
      const value: number = actualNodes[parameterIndex] >= 0 ? actualNodes[parameterIndex] : bindingChild(this.node(target.module,edge.node),"defaultValue");
      const valueModule: number = actualNodes[parameterIndex] >= 0 ? module : target.module;
      if (value >= 0) {
        const root: number = this.root(valueModule,value); this.arguments.push(new SafetyArgument(parameter,valueModule,value,root));
        if (root >= 0 && this.borrowedSymbol(parameter)) {
          const bodyNode: number = bindingChild(this.node(target.module,target.node),"body");
          let lease: BorrowLease = new BorrowLease(target.module,parameter,root,owner,nodeBegin(this.node(target.module,bodyNode)),this.borrowMode(parameter));
          lease.end = nodeEnd(this.node(target.module,bodyNode)); this.leases.push(lease);
        }
      }
      if (parameter >= 0 && this.parameterProperty(target.module,edge.node) && this.transferType(this.result.symbolTypes[parameter])) state.slots[parameter] = 2;
      parameterIndex = parameterIndex + 1;
    }
    const body: number = bindingChild(this.node(target.module,target.node),"body");
    const breakStart: number = this.breaks.length; const continueStart: number = this.continues.length;
    if (phase != "creation") { if (this.node(target.module,body).kind == "BlockStatement") this.walk(target.module,body,state,next); else this.expression(target.module,body,state,next); }
    if (state.exit == "") this.fieldsInitialized(target.module,target.node,state);
    for (let at: number = returnStart; at < this.returns.length; at = at + 1) state = this.join(state,this.returns[at]);
    while (this.returns.length > returnStart) this.returns.pop(); if (phase != "resume") this.sites.pop();
    state.exit = "";
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (this.owner(this.binding.symbols[sid].scope) == owner) { state.slots[sid] = saved.slots[sid]; this.restorePaths(state,saved,sid); }
    for (const sid of this.constructorFields(target.module,target.node)) state.slots[sid] = saved.slots[sid];
    while (this.arguments.length > argumentStart) this.arguments.pop(); while (this.leases.length > leaseStart) this.leases.pop();
    while (this.breaks.length > breakStart) this.breaks.pop(); while (this.continues.length > continueStart) this.continues.pop();
    while (this.substitutions.length > substitutionStart) { this.substitutions.pop(); this.substitutionTypes.pop(); }
  }
  constant(module: number, id: number): string {
    if (id < 0) return "true"; const n: AstNode = this.node(module,id);
    return n.kind == "LiteralExpression" && n.get("literalType") == "boolean" ? n.get("value") : "";
  }
  presence(module: number, id: number): string {
    const helper: string = this.helper(module,id);
    if (helper == "optionalSome") return "true";
    if (helper == "optionalNone") return "false";
    return "";
  }
  expression(module: number, id: number, out state: SafetyState, active: number[]): void {
    if (id < 0) return; const n: AstNode = this.node(module,id);
    if (this.substitutions.length > 0) {
      if (n.kind == "AsExpression") {
        const source: string = this.result.files[module].types[bindingChild(n,"expression")]; const target: string = this.result.files[module].types[id];
        if (this.transferType(source) != this.transferType(target)) this.report(module,id,"E4101: un cast genérico no puede borrar ni fabricar ownership");
      }
      if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression") {
        let target: number = bindingChild(n,"target");
        while (target >= 0) {
          const current: AstNode = this.node(module,target); if (!["MemberExpression","IndexExpression"].includes(current.kind)) break;
          const object: number = bindingChild(current,"object");
          if (readonlyType(this.resolved(this.result.files[module].types[object]))) this.report(module,target,"E4300: escritura genérica a través de una vista readonly"); target = object;
        }
        if (n.kind == "AssignmentExpression") this.transferValue(module,bindingChild(n,"value"));
      }
      if (n.kind == "ArrayLiteralExpression" || n.kind == "ObjectProperty" || n.kind == "TernaryExpression") for (const edge of n.edges) if (["elements","value","thenBranch","elseBranch"].includes(edge.role)) this.transferValue(module,edge.node);
    }
    if (n.kind == "SpreadElement" && genericBase(this.result.files[module].types[id]) == "pack") this.transferValue(module,bindingChild(n,"expression"));
    if (n.kind == "AwaitExpression") {
      const input: number = bindingChild(n,"operand"); this.expression(module,input,state,active);
      this.suspension(module,id); this.consumeTask(module,input,state); this.awaitTasks(module,id,input,state,active); return;
    }
    if (n.kind == "IdentifierExpression") {
      this.read(module,id,this.reference(module,id),state);
      const alias: number = this.reference(module,id); const aliasRoot: number = this.root(module,id);
      if (alias >= 0) { const symbol = this.binding.symbols[alias]; if (symbol.kind == "Parameter" && this.node(symbol.module,symbol.node).get("out") == "true" && aliasRoot != alias) this.read(module,id,aliasRoot,state); }
      if (!this.projection(module,id)) this.readPaths(module,id,state);
      if (n.get("name") == "this") {
        const parent: number = this.binding.files[module].parents[id];
        if (parent < 0 || this.node(module,parent).kind != "MemberExpression") this.fieldsInitialized(module,id,state);
      } return;
    }
    if ((n.kind == "MemberExpression" || n.kind == "IndexExpression") && !this.projection(module,id)) this.readPaths(module,id,state);
    if (n.kind == "MemberExpression") {
      const field: number = this.constructorField(module,id);
      if (field >= 0 && state.slots[field] != 1) this.report(module,id,"Lectura de campo antes de inicializar '" + this.binding.symbols[field].name + "'");
    }
    if (n.kind == "ArrowFunctionExpression") { for (const c of this.result.captures) if (c.module == module && c.closure == id) {
      this.read(module,id,c.symbol,state);
      if (this.substitutions.length > 0 && (this.transferType(this.result.symbolTypes[c.symbol]) || borrowedType(this.resolved(this.result.symbolTypes[c.symbol])))) this.report(module,id,"E4209: una instancia genérica no puede ocultar captura de ownership");
    } return; }
    if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression") {
      const target: number = bindingChild(n,"target"); const value: number = bindingChild(n,"value");
      this.expression(module,value,state,active);
      const field: number = this.constructorField(module,target);
      if (n.kind == "AssignmentExpression" && ["MemberExpression","IndexExpression"].includes(this.node(module,target).kind)) {
        const object: number = bindingChild(this.node(module,target),"object");
        // Read storage/projection roots without reading the moved field being replaced.
        const root: number = this.directRoot(module,object); this.read(module,object,root,state);
        const index: number = bindingChild(this.node(module,target),"index"); if (index >= 0) this.expression(module,index,state,active);
      } else if (this.node(module,target).kind != "IdentifierExpression" || n.kind == "CompoundAssignmentExpression") this.expression(module,target,state,active);
      if (field >= 0) {
        const f = this.binding.symbols[field];
        if (this.node(f.module,f.node).get("readonly") == "true" && state.slots[field] != 0) this.report(module,target,"Campo readonly ya inicializado en alguna ruta: '" + f.name + "'");
        state.slots[field] = 1;
      }
      const sid: number = this.root(module,target);
      if (sid >= 0 && this.node(module,target).kind == "IdentifierExpression" && state.slots[sid] == 0) this.report(module,target,"E4001: escritura antes de inicializar");
      this.access(module,target,sid,"write");
      this.writePaths(module,target,state); this.initializePath(state,this.projectionKey(module,target));
      if (this.node(module,target).kind == "IdentifierExpression" && sid >= 0) state.slots[sid] = 1;
      return;
    }
    if (n.kind == "BinaryExpression" && (n.get("operator") == "&&" || n.get("operator") == "||")) {
      const left: number = bindingChild(n,"left"); this.expression(module,left,state,active);
      const known: string = this.constant(module,left); const skip: string = n.get("operator") == "&&" ? "false" : "true";
      if (known == skip) return;
      let right: SafetyState = state; this.expression(module,bindingChild(n,"right"),right,active);
      state = (known == "" ? this.join(state,right) : right); return;
    }
    if (n.kind == "BinaryExpression" && n.get("operator") == "??") {
      const left: number = bindingChild(n,"left"); this.expression(module,left,state,active);
      const present: string = this.presence(module,left); if (present == "true") return;
      let fallback: SafetyState = state; this.expression(module,bindingChild(n,"right"),fallback,active);
      if (present == "false") state = fallback; else state = this.join(state,fallback); return;
    }
    if (n.kind == "TernaryExpression") {
      const condition: number = bindingChild(n,"condition"); this.expression(module,condition,state,active);
      let yes: SafetyState = state; let no: SafetyState = state; const known: string = this.constant(module,condition);
      if (known != "false") this.expression(module,bindingChild(n,"thenBranch"),yes,active);
      if (known != "true") this.expression(module,bindingChild(n,"elseBranch"),no,active);
      if (known == "true") state = yes; else if (known == "false") state = no; else state = this.join(yes,no); return;
    }
    if (n.kind == "CallExpression" || n.kind == "MemberCallExpression" || n.kind == "NewExpression") {
      if (n.kind == "CallExpression") this.read(module,id,this.reference(module,id),state);
      const object: number = bindingChild(n,"object"); if (object >= 0) this.expression(module,object,state,active);
      const conditional: boolean = n.kind == "MemberCallExpression" && n.get("optional") == "true";
      const present: string = conditional ? this.presence(module,object) : "true";
      if (conditional && present == "false") return;
      const skipped: SafetyState = state;
      if (n.kind == "NewExpression") for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
        const s: BindingSymbol = this.binding.symbols[sid];
        if ((this.result.files[module].types[id] == "#" + numberToString(sid) || this.result.files[module].types[id].startsWith("#" + numberToString(sid) + "<")) && s.kind == "ClassDeclaration") for (const edge of this.node(s.module,s.node).edges) if (edge.role == "fields" && this.node(s.module,edge.node).get("isStatic") != "true") this.expression(s.module,bindingChild(this.node(s.module,edge.node),"defaultValue"),state,active);
      }
      for (const edge of n.edges) if (edge.role == "args") this.expression(module,edge.node,state,active);
      if (this.helper(module,id) == "move") {
        const arg: number = bindingChild(n,"args"); const sid: number = this.root(module,arg); this.access(module,id,sid,"move");
        if (this.node(module,arg).kind == "IdentifierExpression") { if (sid >= 0) state.slots[sid] = 2; }
        else { const projectionKey: string = this.projectionKey(module,arg); if (projectionKey == "") this.report(module,arg,"E4104: move requiere una procedencia de campo demostrada"); else this.setPath(state,projectionKey,2); }
      } else if (this.helper(module,id) != "ref" && this.helper(module,id) != "constRef") {
        this.callBorrows(module,id);
        if (this.mutating(module,id) && object >= 0) { if (readonlyType(this.resolved(this.effects.receiver(module,id)))) this.report(module,id,"E4300: método mutante sobre una vista readonly"); this.access(module,object,this.root(module,object),"write"); }
        if (this.effects.taskCollection(module,id)) {
          this.suspension(module,id); let head: SafetyState = state;
          while (true) {
            let iteration: SafetyState = head; this.awaitTasks(module,id,bindingChild(n,"args"),iteration,active);
            const merged: SafetyState = this.join(head,iteration); let same: boolean = this.samePaths(head,merged);
            for (let sid: number = 0; sid < head.slots.length; sid = sid+1) if (head.slots[sid] != merged.slots[sid]) same = false;
            head = merged; if (same) break;
          } state = head;
        }
        if (this.helper(module,id) == "spawn") this.awaitTasks(module,id,bindingChild(n,"args"),state,active,true);
        if (this.helper(module,id) == "" || this.helper(module,id) == "match") this.invoke(module,id,state,active);
      }
      if (conditional && present == "") state = this.join(skipped,state);
      return;
    }
    for (const edge of n.edges) this.expression(module,edge.node,state,active);
  }
  loop(module: number, id: number, out state: SafetyState, active: number[]): void {
    const n: AstNode = this.node(module,id); const init: number = bindingChild(n,"initializer"); if (init >= 0) this.walk(module,init,state,active);
    const iteration: boolean = n.kind == "ForOfStatement" || n.kind == "ForInStatement";
    if (iteration) this.expression(module,bindingChild(n,n.kind == "ForOfStatement" ? "iterable" : "target"),state,active);
    if (n.kind == "ForOfStatement" && n.get("await") == "true") { this.suspension(module,id); this.consumeTask(module,bindingChild(n,"iterable"),state); }
    const condition: number = bindingChild(n,"condition"); const known: string = iteration ? "" : this.constant(module,condition);
    const entry: SafetyState = state; let head: SafetyState = state; let exits: SafetyState = state; exits.exit = "unreachable";
    const breakStart: number = this.breaks.length; const continueStart: number = this.continues.length;
    // Monotone join over the finite slot domain; stop at the fixed point,
    // rather than assuming four traversals suffice for every dependency chain.
    while (true) {
      let body: SafetyState = head; this.expression(module,condition,body,active);
      if (known != "true") exits = this.join(exits,body);
      if (known == "false") break;
      if (iteration) { const sid: number = this.binding.files[module].declarations[bindingChild(n,"binding")]; if (sid >= 0) { body.slots[sid] = 1; this.initializePath(body,"s"+numberToString(sid)); } }
      if (n.kind == "ForOfStatement" && n.get("await") == "true") this.awaitTasks(module,id,bindingChild(n,"iterable"),body,active);
      this.walk(module,bindingChild(n,"body"),body,active);
      for (let at: number = breakStart; at < this.breaks.length; at = at + 1) exits = this.join(exits,this.breaks[at]);
      for (let at: number = continueStart; at < this.continues.length; at = at + 1) body = this.join(body,this.continues[at]);
      while (this.breaks.length > breakStart) this.breaks.pop(); while (this.continues.length > continueStart) this.continues.pop();
      if (body.exit != "") break;
      this.expression(module,bindingChild(n,"increment"),body,active);
      const next: SafetyState = this.join(entry,body); let same: boolean = true;
      for (let sid: number = 0; sid < head.slots.length; sid = sid + 1) if (head.slots[sid] != next.slots[sid]) same = false;
      if (!this.samePaths(head,next)) same = false; head = next; if (same) break;
    }
    state = exits; if (state.exit == "unreachable") state.exit = "return";
  }
  walk(module: number, id: number, out state: SafetyState, active: number[]): void {
    if (id < 0 || state.exit != "") return; const n: AstNode = this.node(module,id);
    if (this.substitutions.length > 0) {
      if ((n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") && !borrowedType(this.result.files[module].types[id])) this.transferValue(module,bindingChild(n,"initializer"));
      if (n.kind == "ReturnStatement") this.transferValue(module,bindingChild(n,"value"));
    }
    if (n.kind == "Program" || n.kind == "BlockStatement") {
      for (const edge of n.edges) if (edge.role == "statements") this.walk(module,edge.node,state,active); return;
    }
    if (n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") {
      this.expression(module,bindingChild(n,"initializer"),state,active);
      for (const edge of n.edges) if (edge.role == "arrayBindings" || edge.role == "objectBindings") {
        const fallback: number = bindingChild(this.node(module,edge.node),"defaultValue");
        if (fallback >= 0) { let choice: SafetyState = state; this.expression(module,fallback,choice,active); state = this.join(state,choice); }
        const target: number = this.binding.files[module].declarations[edge.node]; if (target >= 0) state.slots[target] = 1;
      }
      const sid: number = this.binding.files[module].declarations[id]; if (sid >= 0) state.slots[sid] = 1; return;
    }
    if (n.kind == "DeleteStatement") {
      const target: AstNode = this.node(module,bindingChild(n,"target")); const object: number = bindingChild(target,"object");
      this.expression(module,object,state,active); this.readPaths(module,object,state); this.expression(module,bindingChild(target,"index"),state,active); this.access(module,id,this.root(module,object),"write"); return;
    }
    if (n.kind == "ExpressionStatement") { this.expression(module,bindingChild(n,"expression"),state,active); return; }
    if (n.kind == "ReturnStatement") { this.expression(module,bindingChild(n,"value"),state,active); this.fieldsInitialized(module,id,state); this.returns.push(state); state.exit = "return"; return; }
    if (n.kind == "IfStatement") {
      const condition: number = bindingChild(n,"condition"); this.expression(module,condition,state,active); const known: string = this.constant(module,condition);
      let yes: SafetyState = state; let no: SafetyState = state;
      if (known != "false") this.walk(module,bindingChild(n,"thenBranch"),yes,active);
      if (known != "true") this.walk(module,bindingChild(n,"elseBranch"),no,active);
      if (known == "true") state = yes; else if (known == "false") state = no;
      else if (yes.exit != "" && no.exit != "") { state = yes; state.exit = "return"; }
      else state = this.join(yes,no); return;
    }
    if (n.kind == "SwitchStatement") {
      this.expression(module,bindingChild(n,"discriminant"),state,active);
      const entry: SafetyState = state; let falling: SafetyState = state; falling.exit = "unreachable";
      let exits: SafetyState = falling; let hasDefault: boolean = false; const breakStart: number = this.breaks.length;
      for (const edge of n.edges) if (edge.role == "clauses") {
        const clause: AstNode = this.node(module,edge.node); if (clause.kind == "DefaultClause") hasDefault = true;
        let body: SafetyState = this.join(entry,falling);
        for (const item of clause.edges) if (item.role == "body") this.walk(module,item.node,body,active);
        for (let at: number = breakStart; at < this.breaks.length; at = at + 1) exits = this.join(exits,this.breaks[at]);
        while (this.breaks.length > breakStart) this.breaks.pop();
        falling = body;
      }
      exits = this.join(exits,falling); if (!hasDefault) exits = this.join(exits,entry);
      state = exits; return;
    }
    if (["WhileStatement","ForStatement","ForOfStatement","ForInStatement"].includes(n.kind)) { this.loop(module,id,state,active); return; }
    if (n.kind == "BreakStatement" || n.kind == "ContinueStatement") {
      if (n.kind == "BreakStatement") this.breaks.push(state); else this.continues.push(state);
      state.exit = (n.kind == "BreakStatement" ? "break" : "continue"); return;
    }
    if (n.kind == "ExportDefaultDeclaration") {
      const declaration: number = bindingChild(n,"declaration");
      if (this.node(module,declaration).kind.endsWith("Expression")) this.expression(module,declaration,state,active); else this.walk(module,declaration,state,active);
    }
  }
  flow(): void {
    let globals: SafetyState = new SafetyState(this.binding.symbols.length);
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (localBinding(this.binding.symbols[sid].kind)) globals.slots[sid] = 0;
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) { if (this.trace) printError("frontend: global flow "+numberToString(m)); this.walk(m,this.graph.modules[m].cached.result.ast.root,globals,[]); }
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.result.files[m].types.length; id = id + 1) {
      if (id == 0 && this.trace) printError("frontend: definitions flow "+numberToString(m));
      const n: AstNode = this.node(m,id); if (!callableBinding(n.kind) || this.binding.files[m].nodeScopes[id] < 0) continue;
      const owner: number = this.vertex(m,id); let state: SafetyState = new SafetyState(this.binding.symbols.length);
      this.initializeFields(m,id,state);
      for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (this.owner(this.binding.symbols[sid].scope) == owner && (localBinding(this.binding.symbols[sid].kind) || this.binding.symbols[sid].kind == "Parameter")) state.slots[sid] = 0;
      for (const edge of n.edges) if (edge.role == "params") {
        this.expression(m,bindingChild(this.node(m,edge.node),"defaultValue"),state,[owner]);
        const sid: number = this.binding.files[m].declarations[edge.node]; if (sid >= 0) { state.slots[sid] = 1; if (this.parameterProperty(m,edge.node) && this.transferType(this.result.symbolTypes[sid])) state.slots[sid] = 2; }
      }
      const body: number = bindingChild(n,"body"); if (body < 0) continue;
      this.breaks = []; this.continues = []; this.returns = []; this.sites = []; this.arguments = [];
      if (this.node(m,body).kind == "BlockStatement") {
        this.walk(m,body,state,[owner]);
        if (state.exit == "") this.fieldsInitialized(m,id,state);
        if (this.node(m,body).start.kind != ";" && (functionReturn(this.result.files[m].types[id]) != "void" && !((n.get("async") == "true" || n.get("isAsync") == "true") && functionReturn(this.result.files[m].types[id]) == "Promise<void>")) && state.exit != "return") this.report(m,id,"No todas las rutas devuelven un valor");
      } else this.expression(m,body,state,[owner]);
    }
    if (this.trace) printError("frontend: flow complete, "+numberToString(this.visits)+" precise calls");
  }
  run(): CheckResult {
    if (this.trace) printError("frontend: memory and captures");
    this.memoryContracts(); this.captures(); this.result.borrows = this.leases;
    if (this.trace) printError("frontend: effects");
    this.effects = new EffectAnalyzer(this.graph,this.binding,this.result); this.effects.trace = this.trace; this.effects.analyze(); this.result.files = this.effects.checked.files; this.result.effects = this.effects.summaries;
    if (this.trace) printError("frontend: provenance and visibility");
    this.provenance(); this.visibility(); if (this.trace) printError("frontend: flow"); this.flow(); this.result.borrows = this.leases; return this.result;
  }
}
export function validateSafety(graph: ModuleGraph, binding: BindingResult, out result: CheckResult, trace: boolean = false): void {
  let analyzer: SafetyAnalyzer = new SafetyAnalyzer(graph,binding,result); analyzer.trace = trace; result = analyzer.run();
}
