import { nativeBuiltinSignatures } from "../frontend/builtins";
import { ModuleGraph } from "../modules/loader";
import { BindingResult, bindingChild, callableBinding } from "../binder/binder";
import { AstNode, nodeBegin } from "../parser/parser";
import { CheckResult, EffectSummary, EffectPoint, EffectBorrow, argumentParameter } from "./model";
import { functionParams, borrowedType, memoryMode, memoryValue, genericBase, genericArguments, splitTypes, canonicalSymbol } from "./types";

export class EffectEdge {
  source: number; target: number; callable: boolean; origins: number; targets: number; tasks: number;
  constructor(source: number, target: number, callable: boolean) { this.source = source; this.target = target; this.callable = callable; this.origins = 0; this.targets = 0; this.tasks = 0; }
}
export class EffectCall {
  module: number; node: number; owner: number; linked: Map<number,boolean>;
  constructor(module: number, node: number, owner: number) { this.module = module; this.node = node; this.owner = owner; this.linked = new Map<number,boolean>(); }
}
// Finite, monotone value-flow and effect summaries. IDs belong to this binding.
// No AST annotation and no recursion-depth cutoff in summary construction.
export class EffectAnalyzer {
  graph: ModuleGraph; binding: BindingResult; checked: CheckResult;
  offsets: number[]; nodes: number; points: EffectPoint[]; summaries: EffectSummary[]; functionIndices: number[][];
  edges: EffectEdge[]; calls: EffectCall[]; changed: boolean; owners: number[]; edgeKeys: Map<string,boolean>; trace: boolean;
  constructor(graph: ModuleGraph, binding: BindingResult, checked: CheckResult) {
    this.graph = graph; this.binding = binding; this.checked = checked; this.offsets = []; this.nodes = 0;
    this.points = []; this.summaries = []; this.edges = []; this.calls = []; this.changed = false; this.owners = []; this.edgeKeys = new Map<string,boolean>(); this.trace = false; this.functionIndices = [];
    for (const scope of binding.scopes) this.owners.push(-2);
    for (const m of graph.modules) { this.offsets.push(this.nodes); this.nodes = this.nodes + m.cached.result.ast.nodes.length; let indices: number[] = []; for (let node: number = 0; node < m.cached.result.ast.nodes.length; node = node+1) indices.push(-1); this.functionIndices.push(indices); }
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  vertex(module: number, id: number): number { return this.offsets[module] + id; }
  origin(sid: number): number { let at: number = sid; while (at >= 0 && this.binding.symbols[at].target >= 0) at = this.binding.symbols[at].target; return at; }
  symbol(sid: number): number { return this.nodes + this.origin(sid); }
  reference(module: number, id: number): number {
    return id < 0 ? -1 : this.binding.files[module].valueTargets[id];
  }
  helper(module: number, id: number): string {
    const sid: number = this.reference(module,id);
    return this.node(module,id).kind == "CallExpression" && sid >= 0 && (this.binding.symbols[sid].module) < 0 ? this.binding.symbols[sid].name : "";
  }
  owner(scope: number): number {
    if (scope >= 0 && this.owners[scope] != -2) return this.owners[scope];
    let at: number = scope;
    while (at >= 0) {
      const s = this.binding.scopes[at];
      if (s.kind == "function" || s.kind == "arrow") { const result: number = this.functionIndex(s.module,s.node); this.owners[scope] = result; return result; }
      at = s.parent;
    } if (scope >= 0) this.owners[scope] = -1; return -1;
  }
  functionIndex(module: number, node: number): number {
    if (module < 0 || module >= this.functionIndices.length || node < 0 || node >= this.functionIndices[module].length) return -1;
    return this.functionIndices[module][node];
  }
  opaque(module: number, id: number): boolean {
    for (const edge of this.node(module,id).edges) if (edge.role == "decorators" && this.node(module,edge.node).get("name") == "cppgen") return true;
    return false;
  }
  implemented(module: number, id: number): boolean { if (this.opaque(module,id)) return false; const body: number = bindingChild(this.node(module,id),"body"); return body >= 0 && this.node(module,body).start.kind != ";"; }
  asynchronous(target: number): boolean {
    const n: AstNode = this.node(this.summaries[target].module,this.summaries[target].node);
    return n.get("async") == "true" || n.get("isAsync") == "true";
  }
  executionOwner(module: number, id: number): number {
    const body: number = this.owner(this.binding.files[module].nodeScopes[id]);
    let at: number = id;
    while (at >= 0) {
      const n: AstNode = this.node(module,at);
      if (callableBinding(n.kind)) break;
      if (n.kind == "Parameter" && body >= 0 && this.asynchronous(body)) return this.summaries[body].creation;
      at = this.binding.files[module].parents[at];
    } return body;
  }
  taskSources(module: number, id: number): number[] { return this.points[this.vertex(module,id)].tasks; }
  sourceModule(vertex: number): number {
    let m: number = 0; for (let at: number = 0; at < this.offsets.length; at = at+1) if (this.offsets[at] <= vertex) m = at; return m;
  }
  taskCollection(module: number, id: number): boolean { return ["all","race","promiseAll","promiseRace"].includes(this.helper(module,id)); }
  suspensionNode(module: number, id: number): boolean { const n: AstNode = this.node(module,id); return n.kind == "AwaitExpression" || (n.kind == "ForOfStatement" && n.get("await") == "true") || this.taskCollection(module,id); }
  taskOperand(module: number, id: number): number { return bindingChild(this.node(module,id),this.taskCollection(module,id) ? "args" : this.node(module,id).kind == "ForOfStatement" ? "iterable" : "operand"); }
  executionTargets(module: number, id: number): number[] {
    let targets: number[] = []; const n: AstNode = this.node(module,id);
    for (const target of this.callTargets(module,id)) {
      const creation: number = this.summaries[target].creation;
      targets.push(creation >= 0 && !this.suspensionNode(module,id) ? creation : target);
    } return targets;
  }
  addTask(vertex: number, source: number): void {
    if (!this.points[vertex].taskSet.has(source)) { this.points[vertex].taskSet.set(source,true); this.points[vertex].tasks.push(source); this.changed = true; }
  }
  root(module: number, id: number): number {
    let at: number = id;
    while (at >= 0) {
      const n: AstNode = this.node(module,at);
      if (n.kind == "IdentifierExpression") {
        let sid: number = this.reference(module,at); let remaining: number = this.binding.symbols.length;
        while (sid >= 0 && remaining > 0) { let next: number = -1; for (const b of this.checked.borrows) if (b.symbol == sid && borrowedType(this.checked.symbolTypes[sid])) next = b.root; if (next < 0 || next == sid) break; sid = next; remaining = remaining - 1; } return sid;
      }
      if (n.kind == "NamedArgumentExpression") at = bindingChild(n,"value");
      else if (n.kind == "SpreadElement") at = bindingChild(n,"expression");
      else if (n.kind == "MemberExpression" || n.kind == "IndexExpression") at = bindingChild(n,"object");
      else if (["ref","constRef","move"].includes(this.helper(module,at))) at = bindingChild(n,"args"); else return -1;
    } return -1;
  }
  addEdge(source: number, target: number, callable: boolean): void {
    if (source < 0 || target < 0) return;
    const key: string = numberToString(source)+":"+numberToString(target)+":"+(callable ? "1" : "0");
    if (this.edgeKeys.has(key)) return; this.edgeKeys.set(key,true);
    this.edges.push(new EffectEdge(source,target,callable)); this.changed = true;
  }
  addTarget(vertex: number, target: number): void {
    if (vertex >= 0 && target >= 0 && !this.points[vertex].targetSet.has(target)) { this.points[vertex].targetSet.set(target,true); this.points[vertex].targets.push(target); this.changed = true; }
  }
  addOrigin(vertex: number, symbol: number): void {
    if (vertex >= 0 && symbol >= 0 && !this.points[vertex].originSet.has(symbol)) { this.points[vertex].originSet.set(symbol,true); this.points[vertex].origins.push(symbol); this.changed = true; }
  }
  returnVertex(summaryId: number): number { return this.nodes + this.binding.symbols.length + summaryId; }
  member(module: number, id: number): number {
    const direct: number = this.reference(module,id); if (direct >= 0) return direct;
    return this.checked.files[module].members[id];
  }
  arrayCallback(module: number, id: number): number {
    const n: AstNode = this.node(module,id);
    if (["optionalMap","optionalAndThen"].includes(this.helper(module,id))) { let at: number = 0; for (const edge of n.edges) if (edge.role == "args") { if (at == 1) return edge.node; at = at+1; } return -1; }
    if (n.kind != "MemberCallExpression") return -1;
    const receiver: string = memoryValue(this.receiver(module,id));
    const collection: boolean = ["Map","Set"].includes(genericBase(receiver)) && n.get("method") == "forEach";
    const optional: boolean = genericBase(receiver) == "Optional" && ["map","andThen"].includes(n.get("method"));
    if (!optional && !collection && (!receiver.endsWith("[]") || !["map","filter","reduce","forEach","find","some","every","flatMap","sort"].includes(n.get("method")))) return -1;
    let at: number = 0;
    for (const edge of n.edges) if (edge.role == "args") { if (at == (n.get("method") == "reduce" ? 1 : 0)) return edge.node; at = at + 1; }
    return -1;
  }
  matchCallbacks(module: number, id: number): number[] {
    let callbacks: number[] = []; if (this.helper(module,id) != "match") return callbacks;
    let list: number = -1; for (const edge of this.node(module,id).edges) if (edge.role == "args") list = edge.node;
    if (list >= 0) for (const edge of this.node(module,list).edges) if (edge.role == "elements") {
      let callback: number = -1; for (const value of this.node(module,edge.node).edges) if (value.role == "args") callback = value.node;
      if (callback >= 0) callbacks.push(callback);
    }
    return callbacks;
  }
  synchronousCallbacks(module: number, id: number): number[] {
    const array: number = this.arrayCallback(module,id); if (array >= 0) return [array]; return this.matchCallbacks(module,id);
  }
  callbackInputs(module: number, id: number): number[] {
    const n: AstNode = this.node(module,id); let inputs: number[] = [];
    if (this.helper(module,id) == "match") return [bindingChild(n,"args")];
    if (["optionalMap","optionalAndThen"].includes(this.helper(module,id))) return [bindingChild(n,"args")];
    if (n.get("method") == "reduce") inputs.push(bindingChild(n,"args"));
    inputs.push(bindingChild(n,"object"));
    if (n.get("method") == "sort" || genericBase(memoryValue(this.receiver(module,id))) == "Map") inputs.push(bindingChild(n,"object"));
    return inputs;
  }
  borrowedSymbol(sid: number): boolean {
    if (sid < 0) return false;
    const s = this.binding.symbols[sid];
    return borrowedType(this.checked.symbolTypes[sid]) || (s.kind == "Parameter" && s.module >= 0 && this.node(s.module,s.node).get("out") == "true");
  }
  borrowMode(sid: number): string {
    const s = this.binding.symbols[sid];
    return s.kind == "Parameter" && s.module >= 0 && this.node(s.module,s.node).get("out") == "true" ? "ref" : memoryMode(this.checked.symbolTypes[sid]);
  }
  receiver(module: number, id: number): string {
    // TypedFile owns every semantic table for the module. Read the required
    // entries directly rather than copying all tables on each graph query.
    const receiver: string = this.checked.files[module].receivers[id];
    return receiver != "" ? receiver : this.checked.files[module].types[bindingChild(this.node(module,id),"object")];
  }
  builtin(module: number, id: number): boolean {
    if (this.suspensionNode(module,id)) {
      const sources: number[] = this.taskSources(module,this.taskOperand(module,id)); if (sources.length == 0) return this.taskCollection(module,id) || this.node(module,id).kind == "ForOfStatement";
      for (const source of sources) { if (source < 0) return false; const m: number = this.sourceModule(source); const helper: string = this.helper(m,source-this.offsets[m]); if (helper != "sleep" && nativeBuiltinSignatures(helper).length == 0) return false; } return true;
    }
    if (this.synchronousCallbacks(module,id).length > 0) return false;
    const n: AstNode = this.node(module,id);
    const member: number = this.member(module,id); if (member >= 0 && this.binding.symbols[member].kind == "UnionVariant") return true;
    if (this.helper(module,id) != "") return true;
    if (n.kind == "NewExpression" && this.checked.files[module].selected[id] < 0) return true;
    if (n.kind == "MemberCallExpression") {
      const object: number = bindingChild(n,"object"); const receiver: string = memoryValue(this.receiver(module,id));
      if (nativeBuiltinSignatures(receiver+"."+n.get("method")).length > 0) return true;
      return ["string","!Math","!JSON","!Date","Console"].includes(receiver) || receiver.endsWith("[]") || ["Optional","Result","Map","Set"].includes(genericBase(receiver));
    } return false;
  }
  unionReceiver(module: number, id: number): number {
    const n: AstNode = this.node(module,id);
    if (n.kind != "MemberExpression" && n.kind != "MemberCallExpression") return -1;
    const object: number = bindingChild(n,"object");
    for (const part of splitTypes(memoryValue(this.receiver(module,id)),"|")) {
      const base: string = genericBase(part) == "variant" ? genericArguments(part)[0] : part;
      const sid: number = canonicalSymbol(base); if (sid >= 0 && sid < this.binding.symbols.length && this.binding.symbols[sid].kind == "UnionDeclaration") return object;
    }
    return -1;
  }
  callTargets(module: number, id: number): number[] {
    let result: number[] = []; const n: AstNode = this.node(module,id);
    if (this.suspensionNode(module,id)) {
      for (const source of this.taskSources(module,this.taskOperand(module,id))) {
        if (source < 0) continue; const m: number = this.sourceModule(source);
        for (const target of this.callTargets(m,source-this.offsets[m])) if (this.asynchronous(target) && !result.includes(target)) result.push(target);
      } return result;
    }
    const callbacks: number[] = this.synchronousCallbacks(module,id);
    if (callbacks.length > 0) { for (const callback of callbacks) for (const target of this.points[this.vertex(module,callback)].targets) if (!result.includes(target)) result.push(target); return result; }
    const payload: number = this.unionReceiver(module,id);
    if (payload >= 0) return this.points[this.vertex(module,payload)].targets;
    const selected: number = this.checked.files[module].selected[id]; const selectedModule: number = this.checked.files[module].selectedModules[id];
    if (selected >= 0 && bindingChild(this.node(selectedModule,selected),"body") >= 0) {
      const summaryId: number = this.functionIndex(selectedModule,selected); if (summaryId >= 0) result.push(summaryId); return result;
    }
    const sid: number = n.kind == "MemberCallExpression" ? this.member(module,id) : this.reference(module,id);
    if (sid >= 0) for (const target of this.points[this.symbol(sid)].targets) if (!result.includes(target)) result.push(target);
    if (result.length == 0 && selected >= 0) { const summaryId: number = this.functionIndex(selectedModule,selected); if (summaryId >= 0) result.push(summaryId); }
    return result;
  }
  callOrigins(module: number, id: number): number[] {
    const callbacks: number[] = this.synchronousCallbacks(module,id);
    if (callbacks.length > 0) { let origins: number[] = []; for (const callback of callbacks) for (const origin of this.points[this.vertex(module,callback)].origins) if (!origins.includes(origin)) origins.push(origin); return origins; }
    const payload: number = this.unionReceiver(module,id);
    if (payload >= 0) return this.points[this.vertex(module,payload)].origins;
    const sid: number = this.node(module,id).kind == "MemberCallExpression" ? this.member(module,id) : this.reference(module,id);
    if (sid >= 0) return this.points[this.symbol(sid)].origins;
    let empty: number[] = []; return empty;
  }
  fieldOf(module: number, object: number, name: string): number {
    const text: string = memoryValue(this.checked.files[module].types[object]);
    const sid: number = canonicalSymbol(text);
    if (sid >= 0 && sid < this.binding.symbols.length) {
      const owner = this.binding.symbols[sid];
      for (let member: number = 0; member < this.binding.symbols.length; member = member + 1) {
        const s = this.binding.symbols[member];
        if (s.module == owner.module && s.name == name && s.scope >= 0 && this.binding.scopes[s.scope].node == owner.node) return member;
      }
    } return -1;
  }
  build(): void {
    if (this.trace) printError("frontend: effect functions");
    // Discover all functions before resolving owners or allocating return vertices.
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id + 1) {
      if (this.binding.files[m].nodeScopes[id] >= 0 && callableBinding(this.node(m,id).kind)) {
        let summary: EffectSummary = new EffectSummary(m,id); summary.unknown = !this.implemented(m,id); summary.external = this.opaque(m,id) || !this.implemented(m,id);
        for (const e of this.node(m,id).edges) if (e.role == "params") summary.parameters.push(this.binding.files[m].declarations[e.node]);
        this.functionIndices[m][id] = this.summaries.length; this.summaries.push(summary);
      }
    }
    const bodyCount: number = this.summaries.length;
    for (let target: number = 0; target < bodyCount; target = target+1) if (this.asynchronous(target)) {
      const body = this.summaries[target]; let creation: EffectSummary = new EffectSummary(body.module,body.node);
      creation.phase = "creation"; creation.parameters = body.parameters; creation.unknown = body.unknown; this.summaries[target].creation = this.summaries.length; this.summaries.push(creation);
    }
    if (this.trace) printError("frontend: effect points "+numberToString(this.nodes+this.binding.symbols.length+this.summaries.length));
    for (let i: number = 0; i < this.nodes + this.binding.symbols.length + this.summaries.length; i = i + 1) this.points.push(new EffectPoint());
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) if (this.binding.symbols[sid].kind == "Parameter" && this.checked.symbolTypes[sid].indexOf("Promise<",0) >= 0 && this.checked.symbolTypes[sid].indexOf("=>",0) < 0) this.addTask(this.symbol(sid),-sid-1);
    for (let summaryId: number = 0; summaryId < this.summaries.length; summaryId = summaryId + 1) {
      const s = this.summaries[summaryId]; if (s.phase == "creation") continue; if (!s.unknown) this.addTarget(this.vertex(s.module,s.node),summaryId);
      const sid: number = this.binding.files[s.module].declarations[s.node]; if (sid >= 0 && !s.unknown) this.addTarget(this.symbol(sid),summaryId);
      for (const parameter of s.parameters) {
        this.addOrigin(this.symbol(parameter),parameter);
        const p = this.binding.symbols[parameter]; const value: number = bindingChild(this.node(p.module,p.node),"defaultValue");
        if (value >= 0) this.addEdge(this.vertex(p.module,value),this.symbol(parameter),true);
      }
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id + 1) {
      if (id == 0 && this.trace) printError("frontend: effect module "+numberToString(m));
      const scope: number = this.binding.files[m].nodeScopes[id]; if (scope < 0) continue;
      const n: AstNode = this.node(m,id); const vertex: number = this.vertex(m,id); const owner: number = this.executionOwner(m,id);
      if (n.kind == "ForOfStatement" && n.get("await") != "true") {
        const sid: number = this.binding.files[m].declarations[bindingChild(n,"binding")];
        if (sid >= 0) this.addEdge(this.vertex(m,bindingChild(n,"iterable")),this.symbol(sid),true);
      }
      if (n.kind == "IdentifierExpression" || n.kind == "MemberExpression") {
        const selected: number = this.checked.files[m].selected[id];
        if (selected >= 0) this.addTarget(vertex,this.functionIndex(this.checked.files[m].selectedModules[id],selected));
        else { const sid: number = this.member(m,id); if (sid >= 0) this.addEdge(this.symbol(sid),vertex,true); }
      }
      const payload: number = this.unionReceiver(m,id);
      if (payload >= 0 && n.kind == "MemberExpression") this.addEdge(this.vertex(m,payload),vertex,true);
      if (n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") {
        const sid: number = this.binding.files[m].declarations[id]; const init: number = bindingChild(n,"initializer");
        if (sid >= 0 && init >= 0) this.addEdge(this.vertex(m,init),this.symbol(sid),true);
        for (const edge of n.edges) if (edge.role == "arrayBindings" || edge.role == "objectBindings") {
          const target: number = this.binding.files[m].declarations[edge.node]; const fallback: number = bindingChild(this.node(m,edge.node),"defaultValue");
          if (target >= 0) { if (init >= 0) this.addEdge(this.vertex(m,init),this.symbol(target),true); if (fallback >= 0) this.addEdge(this.vertex(m,fallback),this.symbol(target),true); }
        }
      }
      if (n.kind == "AssignmentExpression") {
        const target: number = bindingChild(n,"target"); const value: number = this.vertex(m,bindingChild(n,"value"));
        const root: number = this.root(m,target); if (root >= 0) this.addEdge(value,this.symbol(root),true);
        const member: number = this.checked.files[m].members[target]; if (member >= 0) this.addEdge(value,this.symbol(member),true);
      }
      if (n.kind == "NewExpression" && this.checked.files[m].constructionFields[id].length > 0 && functionParams(this.checked.files[m].signatures[id]).length > 0) {
        let at: number = 0; for (const edge of n.edges) if (edge.role == "args") {
          const position: number = this.checked.files[m].argumentParameters[edge.node];
          if (position >= 0 && position < this.checked.files[m].constructionFields[id].length) {
            this.addEdge(this.vertex(m,edge.node),vertex,true); this.addEdge(this.vertex(m,edge.node),this.symbol(this.checked.files[m].constructionFields[id][position]),true);
          }
          at = at+1;
        }
      }
      if (n.kind == "ObjectLiteralExpression") for (const e of n.edges) if (e.role == "properties") {
        const property: AstNode = this.node(m,e.node); const value: number = this.vertex(m,bindingChild(property,"value"));
        this.addEdge(value,vertex,true); const member: number = this.fieldOf(m,id,property.get("key")); if (member >= 0) this.addEdge(value,this.symbol(member),true);
      }
      if (["ArrayLiteralExpression","IndexExpression","TernaryExpression","AsExpression","SatisfiesExpression","NamedArgumentExpression","SpreadElement"].includes(n.kind)) for (const e of n.edges) if (e.role != "condition" && e.role != "index") this.addEdge(this.vertex(m,e.node),vertex,true);
      if (n.kind == "ClassField") { const value: number = bindingChild(n,"defaultValue"); const sid: number = this.binding.files[m].declarations[id]; if (value >= 0 && sid >= 0) this.addEdge(this.vertex(m,value),this.symbol(sid),true); }
      if (["move","optionalSome","optionalValueOr","optionalOrElse","resultOk","resultErr","resultValueOr","ok","err"].includes(this.helper(m,id))) for (const edge of n.edges) if (edge.role == "args") this.addEdge(this.vertex(m,edge.node),vertex,true);
      if ((n.kind == "CallExpression" || n.kind == "MemberCallExpression") && this.member(m,id) >= 0 && this.binding.symbols[this.member(m,id)].kind == "UnionVariant") for (const edge of n.edges) if (edge.role == "args") this.addEdge(this.vertex(m,edge.node),vertex,true);
      if (n.kind == "MemberCallExpression" && ["Optional","Result"].includes(genericBase(memoryValue(this.receiver(m,id))))) {
        if (["value","valueOr","error","orElse"].includes(n.get("method"))) { this.addEdge(this.vertex(m,bindingChild(n,"object")),vertex,true); for (const edge of n.edges) if (edge.role == "args") this.addEdge(this.vertex(m,edge.node),vertex,true); }
      }
      if (n.kind == "MemberCallExpression" && n.get("method") == "get" && genericBase(memoryValue(this.receiver(m,id))) == "Map") this.addEdge(this.vertex(m,bindingChild(n,"object")),vertex,true);
      if (n.kind == "MemberCallExpression" && memoryValue(this.receiver(m,id)).endsWith("[]") && ["filter","find","sort","slice","concat"].includes(n.get("method"))) {
        this.addEdge(this.vertex(m,bindingChild(n,"object")),vertex,true);
        if (n.get("method") == "concat") for (const edge of n.edges) if (edge.role == "args") this.addEdge(this.vertex(m,edge.node),vertex,true);
      }
      if (n.kind == "BinaryExpression" && n.get("operator") == "??") for (const edge of n.edges) this.addEdge(this.vertex(m,edge.node),vertex,true);
      if (n.kind == "ReturnStatement" && owner >= 0) { const value: number = bindingChild(n,"value"); if (value >= 0) this.addEdge(this.vertex(m,value),this.returnVertex(owner),true); }
      if (n.kind == "ArrowFunctionExpression") { const body: number = bindingChild(n,"body"); if (this.node(m,body).kind != "BlockStatement") this.addEdge(this.vertex(m,body),this.returnVertex(this.functionIndex(m,id)),true); }
      if (n.kind == "CallExpression" || n.kind == "MemberCallExpression" || n.kind == "NewExpression" || n.kind == "AwaitExpression" || (n.kind == "ForOfStatement" && n.get("await") == "true")) this.calls.push(new EffectCall(m,id,owner));
      if (n.kind == "MemberCallExpression" && ["push","set","add"].includes(n.get("method"))) {
        const root: number = this.root(m,bindingChild(n,"object")); if (root >= 0) for (const e of n.edges) if (e.role == "args") this.addEdge(this.vertex(m,e.node),this.symbol(root),true);
      }
    }
    for (const c of this.checked.captures) this.addEdge(this.symbol(c.symbol),this.vertex(c.module,c.closure),false);
    // New call edges and target sets may expose one another. Both are finite.
    this.changed = true; let graphPass: number = 0;
    while (this.changed) {
      graphPass = graphPass+1; if (this.trace) printError("frontend: effect graph pass "+numberToString(graphPass)+", "+numberToString(this.edges.length)+" edges");
      this.changed = false;
      for (let callIndex: number = 0; callIndex < this.calls.length; callIndex = callIndex+1) {
      const call = this.calls[callIndex];
      for (const target of this.callTargets(call.module,call.node)) {
        if (this.calls[callIndex].linked.has(target)) continue; this.calls[callIndex].linked.set(target,true);
        const summary = this.summaries[target];
        let at: number = 0;
        if (this.synchronousCallbacks(call.module,call.node).length > 0) {
          for (const input of this.callbackInputs(call.module,call.node)) {
            if (at < summary.parameters.length) this.addEdge(this.vertex(call.module,input),this.symbol(summary.parameters[at]),true); at = at + 1;
          }
          if (this.node(call.module,call.node).get("method") == "reduce" && summary.parameters.length > 0) this.addEdge(this.returnVertex(target),this.symbol(summary.parameters[0]),true);
        } else if (!this.suspensionNode(call.module,call.node)) for (const e of this.node(call.module,call.node).edges) if (e.role == "args") {
          const position: number = argumentParameter(this.checked.files[call.module],e.node,at);
          if (position < summary.parameters.length) this.addEdge(this.vertex(call.module,e.node),this.symbol(summary.parameters[position]),true); at = at + 1;
        }
        const suspended: boolean = this.suspensionNode(call.module,call.node);
        if (this.asynchronous(target) && !suspended) {
          this.addTask(this.vertex(call.module,call.node),this.vertex(call.module,call.node));
          // A Task carries its frame origins, not the callable targets/results
          // returned by the suspended body.
          for (const edge of this.node(call.module,call.node).edges) if (edge.role == "args" || edge.role == "object") this.addEdge(this.vertex(call.module,edge.node),this.vertex(call.module,call.node),false);
          const callee: number = this.reference(call.module,call.node); if (callee >= 0) this.addEdge(this.symbol(callee),this.vertex(call.module,call.node),false);
          for (const parameter of summary.parameters) { const symbol = this.binding.symbols[parameter]; const fallback: number = bindingChild(this.node(symbol.module,symbol.node),"defaultValue"); if (fallback >= 0) this.addEdge(this.vertex(symbol.module,fallback),this.vertex(call.module,call.node),false); }
        }
        else this.addEdge(this.returnVertex(target),this.vertex(call.module,call.node),true);
        if (suspended && this.node(call.module,call.node).kind == "ForOfStatement") {
          const sid: number = this.binding.files[call.module].declarations[bindingChild(this.node(call.module,call.node),"binding")];
          if (sid >= 0) this.addEdge(this.returnVertex(target),this.symbol(sid),true);
        }
      }
      }
      for (const call of this.calls) {
        if (this.helper(call.module,call.node) == "sleep") this.addTask(this.vertex(call.module,call.node),this.vertex(call.module,call.node));
        else if (["CallExpression","MemberCallExpression"].includes(this.node(call.module,call.node).kind) && genericBase(this.checked.files[call.module].types[call.node]) == "Promise") {
          const targets: number[] = this.callTargets(call.module,call.node); let unknown: boolean = targets.length == 0 && !this.builtin(call.module,call.node);
          for (const target of targets) if (this.summaries[target].unknown) unknown = true;
          if (unknown) this.addTask(this.vertex(call.module,call.node),-this.binding.symbols.length-this.vertex(call.module,call.node)-1);
          else if (targets.length == 0) this.addTask(this.vertex(call.module,call.node),this.vertex(call.module,call.node));
        }
      }
      // Point sets only grow. Each edge forwards each source entry once;
      // newly discovered call edges start at zero and receive the full set.
      for (let at: number = 0; at < this.edges.length; at = at+1) {
        let e = this.edges[at];
        if (e.callable) {
          while ((e.tasks) < this.points[e.source].tasks.length) { this.addTask(e.target,this.points[e.source].tasks[e.tasks]); e.tasks = e.tasks+1; }
          while ((e.targets) < this.points[e.source].targets.length) { this.addTarget(e.target,this.points[e.source].targets[e.targets]); e.targets = e.targets+1; }
        }
        while ((e.origins) < this.points[e.source].origins.length) { this.addOrigin(e.target,this.points[e.source].origins[e.origins]); e.origins = e.origins+1; }
        this.edges[at] = e;
      }
    }
  }
  addEffect(summaryId: number, sid: number, mode: string): void {
    if (summaryId < 0 || sid < 0 || (this.binding.symbols[sid].module) < 0) return;
    if (!["VariableDeclaration","Parameter","receiver"].includes(this.binding.symbols[sid].kind)) return;
    // Update the selected set in place. Copying every summary (including its
    // other effect vectors) for each propagated symbol made closure quadratic
    // in the size of the already accumulated summaries.
    if (mode == "read") { if (!this.summaries[summaryId].reads.includes(sid)) { this.summaries[summaryId].reads.push(sid); this.changed = true; } }
    else if (mode == "write") { if (!this.summaries[summaryId].writes.includes(sid)) { this.summaries[summaryId].writes.push(sid); this.changed = true; } }
    else if (!this.summaries[summaryId].moves.includes(sid)) { this.summaries[summaryId].moves.push(sid); this.changed = true; }
  }
  actualInput(module: number, id: number, parameter: number): number {
    if (this.synchronousCallbacks(module,id).length > 0) { const inputs: number[] = this.callbackInputs(module,id); return parameter < inputs.length ? inputs[parameter] : -1; }
    let position: number = 0;
    for (const edge of this.node(module,id).edges) if (edge.role == "args") { if (argumentParameter(this.checked.files[module],edge.node,position) == parameter) return edge.node; position = position + 1; }
    return -1;
  }
  mapRoot(call: EffectCall, target: number, sid: number): number {
    const parameters: number[] = this.summaries[target].parameters;
    for (let at: number = 0; at < parameters.length; at = at + 1) if (parameters[at] == sid) {
      const signature: string[] = functionParams(this.checked.files[call.module].signatures[call.node]);
      if (!this.borrowedSymbol(sid) && !(at < signature.length && borrowedType(signature[at]))) return -1;
      return this.root(call.module,this.actualInput(call.module,call.node,at));
    }
    if (this.binding.symbols[sid].kind == "receiver") return this.root(call.module,bindingChild(this.node(call.module,call.node),"object"));
    if (this.owner(this.binding.symbols[sid].scope) == target) return -1;
    for (const c of this.checked.captures) if (c.module == this.summaries[target].module && c.closure == this.summaries[target].node && c.symbol == sid && c.mode == "value") return -1;
    return sid;
  }
  retain(summaryId: number, vertex: number): void {
    if (summaryId < 0 || vertex < 0) return;
    for (const origin of this.points[vertex].origins) if (!this.summaries[summaryId].retains.includes(origin)) { this.summaries[summaryId].retains.push(origin); this.changed = true; }
  }
  obligation(summaryId: number, call: number, callback: number, root: number, mode: string): void {
    if (callback < 0 || root < 0) return;
    for (const b of this.summaries[summaryId].borrows) if (b.call == call && b.callback == callback && b.root == root && b.mode == mode) return;
    this.summaries[summaryId].borrows.push(new EffectBorrow(call,callback,root,mode)); this.changed = true;
  }
  canRetain(module: number, id: number, position: number): boolean {
    if (this.synchronousCallbacks(module,id).length > 0) return false;
    const helper: string = this.helper(module,id);
    if ((["setTimeout","setInterval"].includes(helper) && position == 0) || (helper == "watchFs" && position == 1)) return true;
    if (this.node(module,id).kind == "MemberCallExpression" && this.receiver(module,id) == "Server" && ["get","post","put","patch","delete"].includes(this.node(module,id).get("method")) && position == 1) return true;
    if (this.helper(module,id) == "spawn") return true;
    if (this.builtin(module,id)) return false;
    let sourcePosition: number = 0;
    for (const e of this.node(module,id).edges) if (e.role == "args") { if (sourcePosition == position) { position = argumentParameter(this.checked.files[module],e.node,position); break; } sourcePosition = sourcePosition + 1; }
    const targets: number[] = this.callTargets(module,id); if (targets.length == 0) return true;
    for (const target of targets) {
      if (this.asynchronous(target) && !this.summaries[target].unknown) continue;
      if ((this.summaries[target].unknown && !this.implemented(this.summaries[target].module,this.summaries[target].node)) || (position < this.summaries[target].parameters.length && this.summaries[target].retains.includes(this.summaries[target].parameters[position]))) return true;
    } return false;
  }
  analyze(): void {
    if (this.trace) printError("frontend: effects graph");
    this.build();
    if (this.trace) printError("frontend: effects summaries");
    for (let m: number = 0; m < this.checked.files.length; m = m+1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id+1) this.checked.files[m].taskSources[id] = this.taskSources(m,id);
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id + 1) {
      const scope: number = this.binding.files[m].nodeScopes[id]; if (scope < 0) continue; const owner: number = this.executionOwner(m,id); if (owner < 0) continue;
      const n: AstNode = this.node(m,id);
      const helper: string = this.helper(m,id);
      if (nativeBuiltinSignatures(helper).length > 0 && !["numberToString","charAt","substring","indexOf","startsWith","trim","lineCount","lineAt","length","jsonEscape","jsonIsString","jsonIsNumber","jsonIsBool","jsonIsArray","jsonIsObject","jsonIsNull","jsonAsString","jsonAsNumber","jsonAsBool","jsonArrayLength","jsonArrayGet","jsonObjectGet"].includes(helper)) this.summaries[owner].external = true;
      if (["print","printError","write","writeError","argument","argumentCount","exitProcess","readFile","writeFile","appendFile","copyFile","moveFile","removeFile","fileExists","spawn"].includes(helper)) this.summaries[owner].external = true;
      if (n.kind == "MemberCallExpression") {
        const receiver: string = this.receiver(m,id);
        if (["!fs","!http","!process","Server","Response","Request","FileReader","Timer","FsWatcher","FsEvent","HttpClientResponse"].includes(receiver)) this.summaries[owner].external = true;
        if (receiver == "Console" || receiver == "!Date" || (receiver == "!Math" && n.get("method") == "random")) this.summaries[owner].external = true;
      }
      if (n.kind == "NewExpression") for (const symbol of this.binding.symbols) if (symbol.kind == "ClassDeclaration" && (this.checked.files[m].types[id] == "#" + numberToString(this.binding.files[symbol.module].declarations[symbol.node]) || this.checked.files[m].types[id].startsWith("#" + numberToString(this.binding.files[symbol.module].declarations[symbol.node]) + "<"))) for (const e of this.node(symbol.module,symbol.node).edges) if (e.role == "fields") {
        const value: number = bindingChild(this.node(symbol.module,e.node),"defaultValue"); if (value >= 0 && this.node(symbol.module,value).kind != "LiteralExpression") this.summaries[owner].unknown = true;
      }
      if (n.kind == "IdentifierExpression" || n.kind == "CallExpression") {
        const parent: number = this.binding.files[m].parents[id]; let writeOnly: boolean = false;
        if (parent >= 0) { const p: AstNode = this.node(m,parent); writeOnly = p.kind == "AssignmentExpression" && bindingChild(p,"target") == id; }
        if (!writeOnly) this.addEffect(owner,this.reference(m,id),"read");
      }
      if (["CallExpression","MemberCallExpression"].includes(n.kind)) {
        const params: string[] = functionParams(this.checked.files[m].signatures[id]); let at: number = 0;
        for (const edge of n.edges) if (edge.role == "args") { const p: number = argumentParameter(this.checked.files[m],edge.node,at); if (p < params.length && memoryMode(params[p]) == "ref") this.addEffect(owner,this.root(m,edge.node),"write"); at = at+1; }
      }
      if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression" || n.kind == "DeleteStatement") this.addEffect(owner,this.root(m,bindingChild(n,"target")),"write");
      if (this.suspensionNode(m,id)) {
        this.addEffect(owner,this.root(m,this.taskOperand(m,id)),"move");
        for (const source of this.taskSources(m,this.taskOperand(m,id))) if (source >= 0) { const sourceModule: number = this.sourceModule(source); if (this.helper(sourceModule,source-this.offsets[sourceModule]) == "sleep") this.summaries[owner].external = true; }
      }
      if (this.helper(m,id) == "move") this.addEffect(owner,this.root(m,bindingChild(n,"args")),"move");
      if (n.kind == "MemberCallExpression" && ["push","pop","sort","set","add","delete","clear"].includes(n.get("method"))) this.addEffect(owner,this.root(m,bindingChild(n,"object")),"write");
      if (n.kind == "ReturnStatement") { const value: number = bindingChild(n,"value"); if (value >= 0) for (const origin of this.points[this.vertex(m,value)].origins) if (!this.summaries[owner].returned.includes(origin)) this.summaries[owner].returned.push(origin); }
      if (n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") {
        const sid: number = this.binding.files[m].declarations[id]; const init: number = bindingChild(n,"initializer");
        if (sid >= 0 && this.owner(this.binding.symbols[sid].scope) != owner && init >= 0) this.retain(owner,this.vertex(m,init));
      }
      if (n.kind == "AssignmentExpression" || (n.kind == "MemberCallExpression" && ["push","set","add"].includes(n.get("method")))) {
        const root: number = this.root(m,bindingChild(n,n.kind == "AssignmentExpression" ? "target" : "object"));
        if (root >= 0 && (this.owner(this.binding.symbols[root].scope) != owner || borrowedType(this.checked.symbolTypes[root]))) for (const e of n.edges) if (e.role == "value" || e.role == "args") this.retain(owner,this.vertex(m,e.node));
      }
    }
    for (const call of this.calls) if (call.owner >= 0 && !this.builtin(call.module,call.node)) {
      for (const origin of this.callOrigins(call.module,call.node)) if (this.summaries[call.owner].parameters.includes(origin) && !this.summaries[call.owner].invokes.includes(origin)) this.summaries[call.owner].invokes.push(origin);
      for (const callback of this.callOrigins(call.module,call.node)) if (this.summaries[call.owner].parameters.includes(callback)) for (const parameter of this.summaries[call.owner].parameters) if (borrowedType(this.checked.symbolTypes[parameter])) this.obligation(call.owner,call.node,callback,parameter,memoryMode(this.checked.symbolTypes[parameter]));
      if (this.arrayCallback(call.module,call.node) >= 0) for (const callback of this.callOrigins(call.module,call.node)) if (this.summaries[call.owner].parameters.includes(callback)) this.obligation(call.owner,call.node,callback,this.root(call.module,bindingChild(this.node(call.module,call.node),"object")),"constRef");
      const targets: number[] = this.executionTargets(call.module,call.node);
      if (targets.length == 0 && this.callOrigins(call.module,call.node).length == 0) this.summaries[call.owner].unknown = true;
      for (const lease of this.checked.borrows) if (lease.end > lease.begin && lease.module == call.module && lease.owner == this.vertex(this.summaries[call.owner].module,this.summaries[call.owner].node) && (lease.begin) <= nodeBegin(this.node(call.module,call.node)) && (nodeBegin(this.node(call.module,call.node))) <= lease.end) {
        for (const parameter of this.callOrigins(call.module,call.node)) if (this.summaries[call.owner].parameters.includes(parameter)) this.obligation(call.owner,call.node,parameter,lease.root,lease.mode);
      }
    }
    for (let summaryId: number = 0; summaryId < this.summaries.length; summaryId = summaryId + 1) this.summaries[summaryId].returned = this.points[this.returnVertex(summaryId)].origins;
    this.changed = true;
    while (this.changed) {
      this.changed = false;
      for (const call of this.calls) if (call.owner >= 0) {
        for (const target of this.executionTargets(call.module,call.node)) {
          const callee = this.summaries[target];
          for (const b of callee.borrows) {
            let callbackOrigins: number[] = []; let position: number = 0;
            for (const parameter of callee.parameters) {
              if (parameter == b.callback) { const input: number = this.actualInput(call.module,call.node,position); if (input >= 0) callbackOrigins = this.points[this.vertex(call.module,input)].origins; }
              position = position + 1;
            }
            if (!callee.parameters.includes(b.callback)) callbackOrigins.push(b.callback);
            for (const callback of callbackOrigins) if (this.summaries[call.owner].parameters.includes(callback)) this.obligation(call.owner,call.node,callback,this.mapRoot(call,target,b.root),b.mode);
          }
          for (const invoked of callee.invokes) {
            let origins: number[] = []; let argumentPosition: number = 0;
            for (const parameter of callee.parameters) {
              if (parameter == invoked) { const input: number = this.actualInput(call.module,call.node,argumentPosition); if (input >= 0) origins = this.points[this.vertex(call.module,input)].origins; }
              argumentPosition = argumentPosition + 1;
            }
            if (!callee.parameters.includes(invoked)) origins.push(invoked);
            for (const origin of origins) if (this.summaries[call.owner].parameters.includes(origin)) for (const lease of this.checked.borrows) if (lease.module == call.module && lease.owner == this.vertex(this.summaries[call.owner].module,this.summaries[call.owner].node) && (lease.begin) <= nodeBegin(this.node(call.module,call.node)) && (nodeBegin(this.node(call.module,call.node))) <= lease.end && lease.end > lease.begin) this.obligation(call.owner,call.node,origin,lease.root,lease.mode);
            for (const origin of origins) if (this.summaries[call.owner].parameters.includes(origin) && !this.summaries[call.owner].invokes.includes(origin)) { this.summaries[call.owner].invokes.push(origin); this.changed = true; }
          }
          if (this.synchronousCallbacks(call.module,call.node).length > 0) for (let p: number = 0; p < callee.parameters.length; p = p + 1) if (callee.retains.includes(callee.parameters[p])) {
            const input: number = this.actualInput(call.module,call.node,p); if (input >= 0) this.retain(call.owner,this.vertex(call.module,input));
          }
          for (const retained of callee.retains) if (!callee.parameters.includes(retained) && !this.summaries[call.owner].retains.includes(retained)) { this.summaries[call.owner].retains.push(retained); this.changed = true; }
          if (!this.summaries[call.owner].callees.includes(target)) { this.summaries[call.owner].callees.push(target); this.changed = true; }
          for (const sid of callee.reads) this.addEffect(call.owner,this.mapRoot(call,target,sid),"read");
          for (const sid of callee.writes) this.addEffect(call.owner,this.mapRoot(call,target,sid),"write");
          for (const sid of callee.moves) this.addEffect(call.owner,this.mapRoot(call,target,sid),"move");
          if (callee.unknown && !this.summaries[call.owner].unknown) { this.summaries[call.owner].unknown = true; this.changed = true; }
          if (callee.external && !this.summaries[call.owner].external) { this.summaries[call.owner].external = true; this.changed = true; }
        }
        let opaque: boolean = this.executionTargets(call.module,call.node).length == 0; for (const target of this.executionTargets(call.module,call.node)) if (this.summaries[target].unknown) opaque = true;
        if (opaque && !this.builtin(call.module,call.node)) {
          const receiver: number = bindingChild(this.node(call.module,call.node),"object"); if (receiver >= 0) this.retain(call.owner,this.vertex(call.module,receiver));
        }
        let at: number = 0;
        for (const e of this.node(call.module,call.node).edges) if (e.role == "args") { if (this.canRetain(call.module,call.node,at)) this.retain(call.owner,this.vertex(call.module,e.node)); at = at + 1; }
      }
    }
    for (let start: number = 0; start < this.summaries.length; start = start + 1) {
      let pending: number[] = this.summaries[start].callees; let seen: number[] = [];
      for (let at: number = 0; at < pending.length; at = at + 1) { const target: number = pending[at]; if (target == start) this.summaries[start].recursive = true; if (!seen.includes(target)) { seen.push(target); for (const next of this.summaries[target].callees) pending.push(next); } }

    }
  }
}
