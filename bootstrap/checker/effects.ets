import { ModuleGraph } from "../modules/loader";
import { BindingResult, bindingChild, callableBinding } from "../binder/binder";
import { AstNode } from "../parser/parser";
import { CheckResult, EffectSummary, EffectPoint, EffectBorrow } from "./model";
import { borrowedType, memoryValue } from "./types";

export class EffectEdge {
  source: number; target: number; callable: boolean;
  constructor(source: number, target: number, callable: boolean) { this.source = source; this.target = target; this.callable = callable; }
}
export class EffectCall {
  module: number; node: number; owner: number;
  constructor(module: number, node: number, owner: number) { this.module = module; this.node = node; this.owner = owner; }
}
// Finite, monotone value-flow and effect summaries. IDs belong to this binding.
// No AST annotation and no recursion-depth cutoff in summary construction.
export class EffectAnalyzer {
  graph: ModuleGraph; binding: BindingResult; checked: CheckResult;
  offsets: number[]; nodes: number; points: EffectPoint[]; summaries: EffectSummary[];
  edges: EffectEdge[]; calls: EffectCall[]; changed: boolean;
  constructor(graph: ModuleGraph, binding: BindingResult, checked: CheckResult) {
    this.graph = graph; this.binding = binding; this.checked = checked; this.offsets = []; this.nodes = 0;
    this.points = []; this.summaries = []; this.edges = []; this.calls = []; this.changed = false;
    for (const m of graph.modules) { this.offsets.push(this.nodes); this.nodes = this.nodes + m.cached.result.ast.nodes.length; }
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  vertex(module: number, id: number): number { return this.offsets[module] + id; }
  origin(sid: number): number { let at: number = sid; while (at >= 0 && this.binding.symbols[at].target >= 0) at = this.binding.symbols[at].target; return at; }
  symbol(sid: number): number { return this.nodes + this.origin(sid); }
  reference(module: number, id: number): number {
    for (const r of this.binding.references) if (r.module == module && r.node == id && !r.deferred && r.space == "value") return r.target;
    return -1;
  }
  helper(module: number, id: number): string {
    const sid: number = this.reference(module,id);
    return this.node(module,id).kind == "CallExpression" && sid >= 0 && (this.binding.symbols[sid].module) < 0 ? this.binding.symbols[sid].name : "";
  }
  owner(scope: number): number {
    let at: number = scope;
    while (at >= 0) {
      const s = this.binding.scopes[at];
      if (s.kind == "function" || s.kind == "arrow") return this.functionIndex(s.module,s.node);
      at = s.parent;
    } return -1;
  }
  functionIndex(module: number, node: number): number {
    for (let i: number = 0; i < this.summaries.length; i = i + 1) if (this.summaries[i].module == module && this.summaries[i].node == node) return i;
    return -1;
  }
  root(module: number, id: number): number {
    let at: number = id;
    while (at >= 0) {
      const n: AstNode = this.node(module,at);
      if (n.kind == "IdentifierExpression") {
        let sid: number = this.reference(module,at); let remaining: number = this.binding.symbols.length;
        while (sid >= 0 && remaining > 0) { let next: number = -1; for (const b of this.checked.borrows) if (b.symbol == sid) next = b.root; if (next < 0 || next == sid) break; sid = next; remaining = remaining - 1; } return sid;
      }
      if (n.kind == "MemberExpression" || n.kind == "IndexExpression") at = bindingChild(n,"object");
      else if (["ref","constRef","move"].includes(this.helper(module,at))) at = bindingChild(n,"args"); else return -1;
    } return -1;
  }
  addEdge(source: number, target: number, callable: boolean): void {
    if (source < 0 || target < 0) return;
    for (const e of this.edges) if (e.source == source && e.target == target && e.callable == callable) return;
    this.edges.push(new EffectEdge(source,target,callable)); this.changed = true;
  }
  addTarget(vertex: number, target: number): void {
    if (vertex >= 0 && target >= 0 && !this.points[vertex].targets.includes(target)) { this.points[vertex].targets.push(target); this.changed = true; }
  }
  addOrigin(vertex: number, symbol: number): void {
    if (vertex >= 0 && symbol >= 0 && !this.points[vertex].origins.includes(symbol)) { this.points[vertex].origins.push(symbol); this.changed = true; }
  }
  returnVertex(summaryId: number): number { return this.nodes + this.binding.symbols.length + summaryId; }
  member(module: number, id: number): number {
    const direct: number = this.reference(module,id); if (direct >= 0) return direct;
    return this.checked.files[module].members[id];
  }
  builtin(module: number, id: number): boolean {
    const n: AstNode = this.node(module,id);
    if (this.helper(module,id) != "") return true;
    if (n.kind == "NewExpression" && this.checked.files[module].selected[id] < 0) return true;
    if (n.kind == "MemberCallExpression") {
      const object: number = bindingChild(n,"object"); const receiver: string = memoryValue(this.checked.files[module].types[object]);
      return receiver == "string" || receiver.endsWith("[]");
    } return false;
  }
  callTargets(module: number, id: number): number[] {
    let result: number[] = []; const n: AstNode = this.node(module,id);
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
    const sid: number = this.node(module,id).kind == "MemberCallExpression" ? this.member(module,id) : this.reference(module,id);
    if (sid >= 0) return this.points[this.symbol(sid)].origins;
    let empty: number[] = []; return empty;
  }
  fieldOf(module: number, object: number, name: string): number {
    const text: string = memoryValue(this.checked.files[module].types[object]);
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (text == "#" + numberToString(sid)) {
      const owner = this.binding.symbols[sid];
      for (let member: number = 0; member < this.binding.symbols.length; member = member + 1) {
        const s = this.binding.symbols[member];
        if (s.module == owner.module && s.name == name && s.scope >= 0 && this.binding.scopes[s.scope].node == owner.node) return member;
      }
    } return -1;
  }
  build(): void {
    // Discover all functions before resolving owners or allocating return vertices.
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id + 1) {
      if (this.binding.files[m].nodeScopes[id] >= 0 && callableBinding(this.node(m,id).kind)) {
        let summary: EffectSummary = new EffectSummary(m,id); summary.unknown = bindingChild(this.node(m,id),"body") < 0;
        for (const e of this.node(m,id).edges) if (e.role == "params") summary.parameters.push(this.binding.files[m].declarations[e.node]);
        this.summaries.push(summary);
      }
    }
    for (let i: number = 0; i < this.nodes + this.binding.symbols.length + this.summaries.length; i = i + 1) this.points.push(new EffectPoint());
    for (let summaryId: number = 0; summaryId < this.summaries.length; summaryId = summaryId + 1) {
      const s = this.summaries[summaryId]; if (!s.unknown) this.addTarget(this.vertex(s.module,s.node),summaryId);
      const sid: number = this.binding.files[s.module].declarations[s.node]; if (sid >= 0 && !s.unknown) this.addTarget(this.symbol(sid),summaryId);
      for (const parameter of s.parameters) {
        this.addOrigin(this.symbol(parameter),parameter);
        const p = this.binding.symbols[parameter]; const value: number = bindingChild(this.node(p.module,p.node),"defaultValue");
        if (value >= 0) this.addEdge(this.vertex(p.module,value),this.symbol(parameter),true);
      }
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id + 1) {
      const scope: number = this.binding.files[m].nodeScopes[id]; if (scope < 0) continue;
      const n: AstNode = this.node(m,id); const vertex: number = this.vertex(m,id); const owner: number = this.owner(scope);
      if (n.kind == "IdentifierExpression" || n.kind == "MemberExpression") {
        const sid: number = this.member(m,id); if (sid >= 0) this.addEdge(this.symbol(sid),vertex,true);
      }
      if (n.kind == "VariableDeclaration") {
        const sid: number = this.binding.files[m].declarations[id]; const init: number = bindingChild(n,"initializer");
        if (sid >= 0 && init >= 0) this.addEdge(this.vertex(m,init),this.symbol(sid),true);
      }
      if (n.kind == "AssignmentExpression") {
        const target: number = bindingChild(n,"target"); const value: number = this.vertex(m,bindingChild(n,"value"));
        const root: number = this.root(m,target); if (root >= 0) this.addEdge(value,this.symbol(root),true);
        const member: number = this.checked.files[m].members[target]; if (member >= 0) this.addEdge(value,this.symbol(member),true);
      }
      if (n.kind == "ObjectLiteralExpression") for (const e of n.edges) if (e.role == "properties") {
        const property: AstNode = this.node(m,e.node); const value: number = this.vertex(m,bindingChild(property,"value"));
        this.addEdge(value,vertex,true); const member: number = this.fieldOf(m,id,property.get("key")); if (member >= 0) this.addEdge(value,this.symbol(member),true);
      }
      if (["ArrayLiteralExpression","IndexExpression","TernaryExpression","AsExpression","SatisfiesExpression"].includes(n.kind)) for (const e of n.edges) if (e.role != "condition" && e.role != "index") this.addEdge(this.vertex(m,e.node),vertex,true);
      if (n.kind == "ClassField") { const value: number = bindingChild(n,"defaultValue"); const sid: number = this.binding.files[m].declarations[id]; if (value >= 0 && sid >= 0) this.addEdge(this.vertex(m,value),this.symbol(sid),true); }
      if (n.kind == "ReturnStatement" && owner >= 0) { const value: number = bindingChild(n,"value"); if (value >= 0) this.addEdge(this.vertex(m,value),this.returnVertex(owner),true); }
      if (n.kind == "ArrowFunctionExpression") { const body: number = bindingChild(n,"body"); if (this.node(m,body).kind != "BlockStatement") this.addEdge(this.vertex(m,body),this.returnVertex(this.functionIndex(m,id)),true); }
      if (n.kind == "CallExpression" || n.kind == "MemberCallExpression" || n.kind == "NewExpression") this.calls.push(new EffectCall(m,id,owner));
      if (n.kind == "MemberCallExpression" && n.get("method") == "push") {
        const root: number = this.root(m,bindingChild(n,"object")); if (root >= 0) for (const e of n.edges) if (e.role == "args") this.addEdge(this.vertex(m,e.node),this.symbol(root),true);
      }
    }
    for (const c of this.checked.captures) this.addEdge(this.symbol(c.symbol),this.vertex(c.module,c.closure),false);
    // New call edges and target sets may expose one another. Both are finite.
    this.changed = true;
    while (this.changed) {
      this.changed = false;
      for (const call of this.calls) for (const target of this.callTargets(call.module,call.node)) {
        const summary = this.summaries[target];
        let at: number = 0;
        for (const e of this.node(call.module,call.node).edges) if (e.role == "args") {
          if (at < summary.parameters.length) this.addEdge(this.vertex(call.module,e.node),this.symbol(summary.parameters[at]),true); at = at + 1;
        }
        this.addEdge(this.returnVertex(target),this.vertex(call.module,call.node),true);
      }
      for (const e of this.edges) {
        if (e.callable) for (const target of this.points[e.source].targets) this.addTarget(e.target,target);
        for (const origin of this.points[e.source].origins) this.addOrigin(e.target,origin);
      }
    }
  }
  addEffect(summaryId: number, sid: number, mode: string): void {
    if (summaryId < 0 || sid < 0 || (this.binding.symbols[sid].module) < 0) return;
    if (!["VariableDeclaration","Parameter","receiver"].includes(this.binding.symbols[sid].kind)) return;
    let s = this.summaries[summaryId]; let values: number[] = mode == "read" ? s.reads : mode == "write" ? s.writes : s.moves;
    if (!values.includes(sid)) { values.push(sid); if (mode == "read") s.reads = values; else if (mode == "write") s.writes = values; else s.moves = values; this.summaries[summaryId] = s; this.changed = true; }
  }
  mapRoot(call: EffectCall, target: number, sid: number): number {
    const callee = this.summaries[target];
    for (let at: number = 0; at < callee.parameters.length; at = at + 1) if (callee.parameters[at] == sid) {
      if (!borrowedType(this.checked.symbolTypes[sid])) return -1;
      let position: number = 0; for (const e of this.node(call.module,call.node).edges) if (e.role == "args") { if (position == at) return this.root(call.module,e.node); position = position + 1; } return -1;
    }
    if (this.binding.symbols[sid].kind == "receiver") return this.root(call.module,bindingChild(this.node(call.module,call.node),"object"));
    if (this.owner(this.binding.symbols[sid].scope) == target) return -1;
    for (const c of this.checked.captures) if (c.module == callee.module && c.closure == callee.node && c.symbol == sid && c.mode == "value") return -1;
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
    if (this.builtin(module,id)) return false;
    const targets: number[] = this.callTargets(module,id); if (targets.length == 0) return true;
    for (const target of targets) {
      const s = this.summaries[target];
      if ((s.unknown && bindingChild(this.node(s.module,s.node),"body") < 0) || (position < s.parameters.length && s.retains.includes(s.parameters[position]))) return true;
    } return false;
  }
  analyze(): void {
    this.build();
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id + 1) {
      const scope: number = this.binding.files[m].nodeScopes[id]; if (scope < 0) continue; const owner: number = this.owner(scope); if (owner < 0) continue;
      const n: AstNode = this.node(m,id);
      if (n.kind == "NewExpression") for (const symbol of this.binding.symbols) if (symbol.kind == "ClassDeclaration" && this.checked.files[m].types[id] == "#" + numberToString(this.binding.files[symbol.module].declarations[symbol.node])) for (const e of this.node(symbol.module,symbol.node).edges) if (e.role == "fields") {
        const value: number = bindingChild(this.node(symbol.module,e.node),"defaultValue"); if (value >= 0 && this.node(symbol.module,value).kind != "LiteralExpression") this.summaries[owner].unknown = true;
      }
      if (n.kind == "IdentifierExpression" || n.kind == "CallExpression") {
        const parent: number = this.binding.files[m].parents[id]; let writeOnly: boolean = false;
        if (parent >= 0) { const p: AstNode = this.node(m,parent); writeOnly = p.kind == "AssignmentExpression" && bindingChild(p,"target") == id; }
        if (!writeOnly) this.addEffect(owner,this.reference(m,id),"read");
      }
      if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression") this.addEffect(owner,this.root(m,bindingChild(n,"target")),"write");
      if (this.helper(m,id) == "move") this.addEffect(owner,this.root(m,bindingChild(n,"args")),"move");
      if (n.kind == "MemberCallExpression" && ["push","pop","sort"].includes(n.get("method"))) this.addEffect(owner,this.root(m,bindingChild(n,"object")),"write");
      if (n.kind == "ReturnStatement") { const value: number = bindingChild(n,"value"); if (value >= 0) for (const origin of this.points[this.vertex(m,value)].origins) if (!this.summaries[owner].returned.includes(origin)) this.summaries[owner].returned.push(origin); }
      if (n.kind == "VariableDeclaration") {
        const sid: number = this.binding.files[m].declarations[id]; const init: number = bindingChild(n,"initializer");
        if (sid >= 0 && this.owner(this.binding.symbols[sid].scope) != owner && init >= 0) this.retain(owner,this.vertex(m,init));
      }
      if (n.kind == "AssignmentExpression" || (n.kind == "MemberCallExpression" && n.get("method") == "push")) {
        const root: number = this.root(m,bindingChild(n,n.kind == "AssignmentExpression" ? "target" : "object"));
        if (root >= 0 && (this.owner(this.binding.symbols[root].scope) != owner || borrowedType(this.checked.symbolTypes[root]))) for (const e of n.edges) if (e.role == "value" || e.role == "args") this.retain(owner,this.vertex(m,e.node));
      }
    }
    for (const call of this.calls) if (call.owner >= 0 && !this.builtin(call.module,call.node)) {
      for (const origin of this.callOrigins(call.module,call.node)) if (this.summaries[call.owner].parameters.includes(origin) && !this.summaries[call.owner].invokes.includes(origin)) this.summaries[call.owner].invokes.push(origin);
      for (const callback of this.callOrigins(call.module,call.node)) if (this.summaries[call.owner].parameters.includes(callback)) for (const parameter of this.summaries[call.owner].parameters) if (borrowedType(this.checked.symbolTypes[parameter])) this.obligation(call.owner,call.node,callback,parameter,memoryMode(this.checked.symbolTypes[parameter]));
      const targets: number[] = this.callTargets(call.module,call.node);
      if (targets.length == 0 && this.callOrigins(call.module,call.node).length == 0) this.summaries[call.owner].unknown = true;
      for (const lease of this.checked.borrows) if (lease.end > lease.begin && lease.module == call.module && lease.owner == this.vertex(this.summaries[call.owner].module,this.summaries[call.owner].node) && (lease.begin) <= this.node(call.module,call.node).start.offset && (this.node(call.module,call.node).start.offset) <= lease.end) {
        for (const parameter of this.callOrigins(call.module,call.node)) if (this.summaries[call.owner].parameters.includes(parameter)) this.obligation(call.owner,call.node,parameter,lease.root,lease.mode);
      }
    }
    for (let summaryId: number = 0; summaryId < this.summaries.length; summaryId = summaryId + 1) this.summaries[summaryId].returned = this.points[this.returnVertex(summaryId)].origins;
    this.changed = true;
    while (this.changed) {
      this.changed = false;
      for (const call of this.calls) if (call.owner >= 0) {
        for (const target of this.callTargets(call.module,call.node)) {
          const callee = this.summaries[target];
          for (const b of callee.borrows) {
            let callbackOrigins: number[] = []; let position: number = 0;
            for (const parameter of callee.parameters) {
              if (parameter == b.callback) { let actual: number = 0; for (const e of this.node(call.module,call.node).edges) if (e.role == "args") { if (actual == position) callbackOrigins = this.points[this.vertex(call.module,e.node)].origins; actual = actual + 1; } }
              position = position + 1;
            }
            if (!callee.parameters.includes(b.callback)) callbackOrigins.push(b.callback);
            for (const callback of callbackOrigins) if (this.summaries[call.owner].parameters.includes(callback)) this.obligation(call.owner,call.node,callback,this.mapRoot(call,target,b.root),b.mode);
          }
          for (const invoked of callee.invokes) {
            let origins: number[] = []; let argumentPosition: number = 0;
            for (const parameter of callee.parameters) {
              if (parameter == invoked) { let actualPosition: number = 0; for (const e of this.node(call.module,call.node).edges) if (e.role == "args") { if (actualPosition == argumentPosition) origins = this.points[this.vertex(call.module,e.node)].origins; actualPosition = actualPosition + 1; } }
              argumentPosition = argumentPosition + 1;
            }
            if (!callee.parameters.includes(invoked)) origins.push(invoked);
            for (const origin of origins) if (this.summaries[call.owner].parameters.includes(origin)) for (const lease of this.checked.borrows) if (lease.module == call.module && lease.owner == this.vertex(this.summaries[call.owner].module,this.summaries[call.owner].node) && (lease.begin) <= this.node(call.module,call.node).start.offset && (this.node(call.module,call.node).start.offset) <= lease.end && lease.end > lease.begin) this.obligation(call.owner,call.node,origin,lease.root,lease.mode);
            for (const origin of origins) if (this.summaries[call.owner].parameters.includes(origin) && !this.summaries[call.owner].invokes.includes(origin)) { this.summaries[call.owner].invokes.push(origin); this.changed = true; }
          }
          for (const retained of callee.retains) if (!callee.parameters.includes(retained) && !this.summaries[call.owner].retains.includes(retained)) { this.summaries[call.owner].retains.push(retained); this.changed = true; }
          if (!this.summaries[call.owner].callees.includes(target)) { this.summaries[call.owner].callees.push(target); this.changed = true; }
          for (const sid of callee.reads) this.addEffect(call.owner,this.mapRoot(call,target,sid),"read");
          for (const sid of callee.writes) this.addEffect(call.owner,this.mapRoot(call,target,sid),"write");
          for (const sid of callee.moves) this.addEffect(call.owner,this.mapRoot(call,target,sid),"move");
          if (callee.unknown && !this.summaries[call.owner].unknown) { this.summaries[call.owner].unknown = true; this.changed = true; }
        }
        let opaque: boolean = this.callTargets(call.module,call.node).length == 0; for (const target of this.callTargets(call.module,call.node)) if (this.summaries[target].unknown) opaque = true;
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
