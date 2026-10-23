import { EffectAnalyzer } from "./effects";
import { ModuleGraph } from "../modules/loader";
import { BindingResult, BindingSymbol, bindingChild, callableBinding } from "../binder/binder";
import { AstNode } from "../parser/parser";
import { SourceDiagnostic } from "../frontend/frontend";
import { CheckResult, NativeCapture, BorrowLease } from "./model";
import { memoryMode, memoryInner, memoryValue, ownedType, borrowedType, readonlyType, semanticElement, semanticTuple, splitTypes, functionClose, functionParams, functionReturn, fixedArraySize, fixedArrayElement, localBinding } from "./types";

export class SafetyState {
  slots: number[]; exit: string;
  constructor(count: number) { this.slots = []; this.exit = ""; for (let i: number = 0; i < count; i = i + 1) this.slots.push(1); }
}
export class SafetyEdge {
  source: number; target: number;
  constructor(source: number, target: number) { this.source = source; this.target = target; }
}
export class EscapeSite {
  module: number; node: number; vertex: number; reason: string;
  constructor(module: number, node: number, vertex: number, reason: string) { this.module = module; this.node = node; this.vertex = vertex; this.reason = reason; }
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
  offsets: number[]; nodes: number; edges: SafetyEdge[]; seeds: number[]; escapes: EscapeSite[];
  borrowSources: number[]; leases: BorrowLease[]; breaks: SafetyState[]; continues: SafetyState[]; returns: SafetyState[]; sites: SafetyCallSite[];
  constructor(graph: ModuleGraph, binding: BindingResult, result: CheckResult) {
    this.graph = graph; this.binding = binding; this.result = result; this.effects = new EffectAnalyzer(graph,binding,result); this.arguments = []; this.offsets = []; this.nodes = 0;
    this.edges = []; this.seeds = []; this.escapes = []; this.borrowSources = []; this.leases = []; this.breaks = []; this.continues = []; this.returns = []; this.sites = []; this.arguments = [];
    for (const m of graph.modules) { this.offsets.push(this.nodes); this.nodes = this.nodes + m.cached.result.ast.nodes.length; }
    for (const s of binding.symbols) this.borrowSources.push(-1);
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  report(module: number, id: number, message: string): void {
    const token = this.node(module,id).start;
    for (const d of this.result.diagnostics) if (d.file == this.graph.modules[module].file && d.token.offset == token.offset && d.message == message) return;
    this.result.diagnostics.push(new SourceDiagnostic("checker",message,this.graph.modules[module].file,token));
  }
  origin(sid: number): number { let at: number = sid; while (at >= 0 && this.binding.symbols[at].target >= 0) at = this.binding.symbols[at].target; return at; }
  reference(module: number, id: number): number {
    for (const r of this.binding.references) if (r.module == module && r.node == id && r.space == "value" && !r.deferred) return r.target;
    return -1;
  }
  helper(module: number, id: number): string {
    if (id < 0 || this.node(module,id).kind != "CallExpression") return "";
    const sid: number = this.reference(module,id);
    return sid >= 0 && (this.binding.symbols[sid].module) < 0 ? this.binding.symbols[sid].name : "";
  }
  owner(scope: number): number {
    let at: number = scope;
    while (at >= 0) {
      const s = this.binding.scopes[at];
      if (s.kind == "function" || s.kind == "arrow") return this.offsets[s.module] + s.node;
      at = s.parent;
    } return -1;
  }
  vertex(module: number, id: number): number { return this.offsets[module] + id; }
  symbolVertex(sid: number): number { return this.nodes + this.origin(sid); }
  directRoot(module: number, id: number): number {
    let at: number = id;
    while (at >= 0) {
      const n: AstNode = this.node(module,at);
      if (n.kind == "IdentifierExpression") return this.reference(module,at);
      if (n.kind == "MemberExpression" || n.kind == "IndexExpression") at = bindingChild(n,"object");
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
          if (borrowedType(this.result.symbolTypes[sid])) for (let a: number = this.arguments.length - 1; a >= 0; a = a - 1) if (this.arguments[a].parameter == sid) { source = this.arguments[a].root; break; }
          if (source < 0 || source == sid) break; sid = source; remaining = remaining - 1;
        } return sid;
      }
      if (n.kind == "MemberExpression" || n.kind == "IndexExpression") at = bindingChild(n,"object");
      else if (this.helper(module,at) == "ref" || this.helper(module,at) == "constRef" || this.helper(module,at) == "move") at = bindingChild(n,"args");
      else return -1;
    } return -1;
  }
  edge(source: number, target: number): void { if (source >= 0 && target >= 0) this.edges.push(new SafetyEdge(source,target)); }
  carrier(text: string, seen: number[]): boolean {
    if (functionClose(text) >= 0) return true;
    if (memoryMode(text) != "") return this.carrier(memoryInner(text),seen);
    const contracts: string[] = splitTypes(text,"&"); if (contracts.length > 1) { for (const part of contracts) if (this.carrier(part,seen)) return true; return false; }
    if (fixedArraySize(text) >= 0) return this.carrier(fixedArrayElement(text),seen);
    const generic: number = text.indexOf("<",0);
    if (generic > 0 && text.endsWith(">")) for (const part of splitTypes(text.slice(generic+1,text.length-1),",")) if (this.carrier(part,seen)) return true;
    if (text.endsWith("[]")) return this.carrier(semanticElement(text),seen);
    if (semanticTuple(text)) { for (const item of splitTypes(text.slice(1,text.length-1),",")) if (this.carrier(item,seen)) return true; return false; }
    const unions: string[] = splitTypes(text,"|"); if (unions.length > 1) { for (const item of unions) if (this.carrier(item,seen)) return true; return false; }
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (text == "#" + numberToString(sid) || text.startsWith("#" + numberToString(sid) + "<")) {
      if (seen.includes(sid)) return false; let next: number[] = seen; next.push(sid);
      const s: BindingSymbol = this.binding.symbols[sid];
      for (let member: number = 0; member < this.binding.symbols.length; member = member + 1) {
        const f: BindingSymbol = this.binding.symbols[member];
        if (f.module == s.module && f.scope >= 0 && this.binding.scopes[f.scope].node == s.node && (f.kind == "ClassField" || f.kind == "InterfaceField")) if (this.carrier(this.result.symbolTypes[member],next)) return true;
      }
    } return false;
  }
  memoryType(module: number, id: number, text: string, position: string): void {
    if (text == "") return;
    const mode: string = memoryMode(text);
    if (mode != "") {
      if (borrowedType(text) && position != "parameter" && position != "local") this.report(module,id,"E4203: un préstamo no puede almacenarse ni retornarse en " + position);
      if (ownedType(text) && position == "argument") this.report(module,id,"Ownership en agregados pendiente de transferencia por elemento");
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
      else if (s.kind == "ClassField" || s.kind == "InterfaceField") {
        this.memoryType(s.module,s.node,text,"campo");
        if (ownedType(text)) this.report(s.module,s.node,"Ownership en campos pendiente de copia/movimiento de agregados");
      }
      else if (callableBinding(s.kind)) this.memoryType(s.module,s.node,text,"firma");
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.result.files[m].types.length; id = id + 1) {
      const n: AstNode = this.node(m,id); const sid: number = this.binding.files[m].declarations[id];
      if (this.binding.files[m].nodeScopes[id] < 0) continue;
      if (n.kind == "ForOfStatement" || n.kind == "ForInStatement") {
        const source: number = bindingChild(n,n.kind == "ForOfStatement" ? "iterable" : "target"); const root: number = this.root(m,source);
        const binding: number = bindingChild(n,"binding"); const bindingSymbol: number = this.binding.files[m].declarations[binding];
        if (root >= 0 && bindingSymbol >= 0) {
          let lease: BorrowLease = new BorrowLease(m,bindingSymbol,root,this.owner(this.binding.files[m].nodeScopes[id]),this.node(m,bindingChild(n,"body")).start.offset,"constRef");
          lease.end = this.node(m,bindingChild(n,"body")).end.endOffset; this.leases.push(lease);
        }
      }
      if ((n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") || n.kind == "AssignmentExpression" || n.kind == "ReturnStatement") {
        const value: number = bindingChild(n,(n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") ? "initializer" : "value");
        if (value >= 0 && ownedType(this.result.files[m].types[value]) && this.node(m,value).kind != "CallExpression" && this.node(m,value).kind != "NewExpression") this.report(m,value,"E4101: transferir ownership requiere move(identifier)");
        if ((n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") && sid >= 0 && borrowedType(this.result.symbolTypes[sid])) {
          const root: number = this.root(m,value);
          if (root < 0) this.report(m,id,"E4208: no se puede demostrar el origen del préstamo local");
          else {
            this.borrowSources[sid] = root;
            let lease: BorrowLease = new BorrowLease(m,sid,root,this.owner(this.binding.symbols[sid].scope),n.end.endOffset,memoryMode(this.result.symbolTypes[sid]));
            for (const r of this.binding.references) if (r.target == sid && r.module == m && this.owner(r.scope) == lease.owner) {
              const offset: number = this.node(m,r.node).start.offset; if (offset > lease.end) lease.end = offset;
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
      if (borrowedType(text) || ownedType(text) || this.binding.symbols[capture.symbol].kind == "receiver") this.report(capture.module,capture.closure,"E4209: captura de préstamo/owner/this sin lifetime demostrado");
      const closureScope: number = this.binding.files[capture.module].nodeScopes[capture.closure];
      let mutates: boolean = false;
      for (let id: number = 0; id < this.result.files[capture.module].types.length; id = id + 1) {
        let scope: number = this.binding.files[capture.module].nodeScopes[id]; let inside: boolean = false;
        while (scope >= 0) { if (scope == closureScope) inside = true; scope = this.binding.scopes[scope].parent; }
        if (!inside) continue;
        const n: AstNode = this.node(capture.module,id); let target: number = -1;
        if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression") target = bindingChild(n,"target");
        else if (n.kind == "MemberCallExpression" && this.mutating(capture.module,id)) target = bindingChild(n,"object");
        if (target >= 0 && this.root(capture.module,target) == capture.symbol) mutates = true;
      }
      if (mutates) this.seeds.push(this.vertex(capture.module,capture.closure));
      this.edge(this.symbolVertex(capture.symbol),this.vertex(capture.module,capture.closure));
    }
    for (let c: number = 0; c < this.result.captures.length; c = c + 1) if (this.seeds.includes(this.vertex(this.result.captures[c].module,this.result.captures[c].closure))) this.result.captures[c].mode = "reference";
  }
  mutating(module: number, id: number): boolean {
    const n: AstNode = this.node(module,id); if (n.kind != "MemberCallExpression") return false;
    if (["push","pop","sort"].includes(n.get("method"))) return true;
    const target: number = this.result.files[module].selected[id]; const targetModule: number = this.result.files[module].selectedModules[id];
    if (target < 0 || targetModule < 0) return false;
    let work: number[] = [target];
    while (work.length > 0) {
      const item: AstNode = this.node(targetModule,work[work.length-1]); work.pop();
      let at: number = -1;
      if (item.kind == "AssignmentExpression" || item.kind == "CompoundAssignmentExpression") at = bindingChild(item,"target");
      else if (item.kind == "MemberCallExpression") at = bindingChild(item,"object");
      while (at >= 0) {
        const receiver: AstNode = this.node(targetModule,at);
        if (receiver.kind == "IdentifierExpression" && receiver.get("name") == "this") return true;
        if (receiver.kind != "MemberExpression" && receiver.kind != "IndexExpression") break;
        at = bindingChild(receiver,"object");
      }
      for (const edge of item.edges) work.push(edge.node);
    } return false;
  }
  provenance(): void {
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.result.files[m].types.length; id = id + 1) {
      if (this.binding.files[m].nodeScopes[id] < 0) continue;
      const n: AstNode = this.node(m,id); const vertex: number = this.vertex(m,id);
      if (n.kind == "FunctionDeclaration") {
        const sid: number = this.binding.files[m].declarations[id]; if (sid >= 0) this.edge(vertex,this.symbolVertex(sid));
      }
      if (n.kind == "ForOfStatement") {
        const sid: number = this.binding.files[m].declarations[bindingChild(n,"binding")];
        if (sid >= 0) this.edge(this.vertex(m,bindingChild(n,"iterable")),this.symbolVertex(sid));
      }
      if (n.kind == "ObjectProperty") { const value: number = bindingChild(n,"value"); if (value >= 0) this.edge(this.vertex(m,value),vertex); }
      if (n.kind == "IdentifierExpression") { const sid: number = this.reference(m,id); if (sid >= 0) this.edge(this.symbolVertex(sid),vertex); }
      if (n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") {
        const sid: number = this.binding.files[m].declarations[id]; const value: number = bindingChild(n,"initializer");
        if (sid >= 0 && value >= 0) this.edge(this.vertex(m,value),this.symbolVertex(sid));
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
          this.edge(this.vertex(m,value),this.symbolVertex(target));
          if (this.owner(this.binding.symbols[target].scope) != this.owner(this.binding.files[m].nodeScopes[id])) this.escapes.push(new EscapeSite(m,id,this.vertex(m,value),"almacenamiento fuera del ámbito de captura"));
        }
      }
      if (n.kind == "MemberCallExpression" && n.get("method") == "push") {
        const target: number = this.root(m,bindingChild(n,"object"));
        if (target >= 0) for (const edge of n.edges) if (edge.role == "args") this.edge(this.vertex(m,edge.node),this.symbolVertex(target));
      }
      if (this.carrier(this.result.files[m].types[id],[])) {
        if (n.kind != "ArrowFunctionExpression") for (const edge of n.edges) this.edge(this.vertex(m,edge.node),vertex);
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
        const knownPush: boolean = n.kind == "MemberCallExpression" && n.get("method") == "push";
        const root: number = knownPush ? this.root(m,bindingChild(n,"object")) : -1;
        const localPush: boolean = root >= 0 && this.owner(this.binding.symbols[root].scope) == this.owner(this.binding.files[m].nodeScopes[id]);
        let argumentIndex: number = 0;
        if (!knownPush || !localPush) for (const edge of n.edges) if (edge.role == "args") {
          if (this.effects.canRetain(m,id,argumentIndex)) this.escapes.push(new EscapeSite(m,edge.node,this.vertex(m,edge.node),"callback retenido o retención no demostrada"));
          argumentIndex = argumentIndex + 1;
        }
      }
    }
    let risk: number[] = []; for (let i: number = 0; i < this.nodes + this.binding.symbols.length; i = i + 1) risk.push(-1);
    let pending: number[] = []; for (const seed of this.seeds) if (risk[seed] < 0) { risk[seed] = seed; pending.push(seed); }
    for (let at: number = 0; at < pending.length; at = at + 1) for (const e of this.edges) if (e.source == pending[at] && risk[e.target] < 0) { risk[e.target] = risk[e.source]; pending.push(e.target); }
    for (const site of this.escapes) if (risk[site.vertex] >= 0) this.report(site.module,site.node,"E4210: closure con captura por referencia escapa por " + site.reason);
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
    }
  }
  publicSurface(module: number, id: number): void {
    const n: AstNode = this.node(module,id); const sid: number = this.binding.files[module].declarations[id];
    this.publicType(module,id,callableBinding(n.kind) ? this.result.files[module].types[id] : sid >= 0 ? this.result.symbolTypes[this.origin(sid)] : this.result.files[module].types[id]);
    for (const edge of n.edges) if (["params","typeParameters","fields","methods"].includes(edge.role)) {
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
  join(left: SafetyState, right: SafetyState): SafetyState {
    if (left.exit != "") return right;
    if (right.exit != "") return left;
    let result: SafetyState = left;
    for (let sid: number = 0; sid < left.slots.length; sid = sid + 1) {
      const a: number = left.slots[sid]; const b: number = right.slots[sid];
      if (a == b) result.slots[sid] = a; else if (a == 0 || b == 0) result.slots[sid] = 0; else result.slots[sid] = 3;
    } return result;
  }
  access(module: number, id: number, sid: number, mode: string): void {
    if (sid < 0) return; const handle: number = this.directRoot(module,id); if (handle >= 0 && (this.borrowSources[handle] >= 0 || borrowedType(this.result.symbolTypes[handle]))) return; const position: number = this.node(module,id).start.offset;
    const currentOwner: number = this.owner(this.binding.files[module].nodeScopes[id]);
    for (const c of this.result.captures) if (this.vertex(c.module,c.closure) == currentOwner && c.symbol == sid && c.mode == "value") return;
    for (const lease of this.leases) {
      let live: boolean = lease.module == module && lease.owner == currentOwner && (lease.begin) <= position && position <= lease.end;
      for (const site of this.sites) {
        const offset: number = this.node(site.module,site.node).start.offset;
        if (lease.module == site.module && lease.owner == this.owner(this.binding.files[site.module].nodeScopes[site.node]) && (lease.begin) <= offset && offset <= lease.end) live = true;
      }
      if (live && lease.root == sid && lease.end > lease.begin && (lease.mode == "ref" || mode != "read")) this.report(module,id,"E4207: acceso a la fuente durante un préstamo activo");
    }
  }
  read(module: number, id: number, sid: number, state: SafetyState): void {
    if (sid < 0 || (this.binding.symbols[sid].module) < 0) return;
    const s: BindingSymbol = this.binding.symbols[sid]; if (!localBinding(s.kind) && !["Parameter","receiver"].includes(s.kind)) return;
    if (state.slots[sid] == 0) this.report(module,id,"E4001: uso antes de inicializar '" + s.name + "'");
    if (state.slots[sid] == 2 || state.slots[sid] == 3) this.report(module,id,state.slots[sid] == 2 ? "E4102: uso de owner movido '" + s.name + "'" : "E4103: uso de owner posiblemente movido '" + s.name + "'");
    if (this.borrowSources[sid] < 0) this.access(module,id,sid,"read");
  }
  callBorrows(module: number, id: number): void {
    const n: AstNode = this.node(module,id); const params: string[] = functionParams(this.result.files[module].signatures[id]);
    let roots: number[] = []; let modes: string[] = []; let at: number = 0;
    for (const edge of n.edges) if (edge.role == "args") {
      const actual: string = this.result.files[module].types[edge.node]; const expected: string = at < params.length ? params[at] : actual;
      const root: number = this.root(module,edge.node); const mode: string = borrowedType(expected) ? memoryMode(expected) : this.helper(module,edge.node) == "move" ? "move" : "read";
      if (ownedType(expected) && ownedType(actual) && this.node(module,edge.node).kind != "CallExpression" && this.node(module,edge.node).kind != "NewExpression") this.report(module,edge.node,"E4101: argumento owner requiere move(identifier)");
      if (borrowedType(expected) && root < 0) this.report(module,edge.node,"E4208: un argumento prestado necesita un lvalue con origen conocido");
      if (borrowedType(expected) && root >= 0) this.access(module,edge.node,root,mode == "ref" ? "write" : "read");
      if (mode == "ref" && root >= 0) {
        const s: BindingSymbol = this.binding.symbols[root];
        if (s.module >= 0 && localBinding(s.kind)) {
          const declaration: number = s.kind == "ArrayBinding" || s.kind == "ObjectBinding" ? this.binding.files[s.module].parents[s.node] : s.node;
          if (this.node(s.module,declaration).get("mutable") != "true") this.report(module,edge.node,"E4208: préstamo mutable de una constante");
        }
        if (readonlyType(actual)) this.report(module,edge.node,"E4300: préstamo mutable de readonly");
      }
      for (let i: number = 0; i < roots.length; i = i + 1) if (root >= 0 && root == roots[i] && (mode == "ref" || modes[i] == "ref" || (mode == "move" && borrowedType(modes[i] + "<x>")) || (modes[i] == "move" && borrowedType(mode + "<x>")))) this.report(module,edge.node,"E4206: argumentos con préstamos/ownership incompatibles sobre la misma fuente");
      roots.push(root); modes.push(mode); at = at + 1;
    }
  }
  targets(module: number, id: number): number[] {
    const sid: number = this.reference(module,id);
    if (sid >= 0) for (let at: number = this.arguments.length - 1; at >= 0; at = at - 1) if (this.arguments[at].parameter == sid) {
      const actual = this.arguments[at]; return this.effects.points[this.effects.vertex(actual.module,actual.node)].targets;
    }
    return this.effects.callTargets(module,id);
  }
  observable(summaryId: number, sid: number, module: number, id: number): number {
    const summary = this.effects.summaries[summaryId];
    for (let at: number = 0; at < summary.parameters.length; at = at + 1) if (sid == summary.parameters[at]) {
      if (!borrowedType(this.result.symbolTypes[sid])) return -1;
      let position: number = 0; for (const e of this.node(module,id).edges) if (e.role == "args") { if (position == at) return this.root(module,e.node); position = position + 1; } return -1;
    }
    if (this.binding.symbols[sid].kind == "receiver") return this.root(module,bindingChild(this.node(module,id),"object"));
    if (this.owner(this.binding.symbols[sid].scope) == this.vertex(summary.module,summary.node)) return -1;
    for (const c of this.result.captures) if (c.module == summary.module && c.closure == summary.node && c.symbol == sid && c.mode == "value") return -1;
    return sid;
  }
  summary(summaryId: number, module: number, id: number, out state: SafetyState): void {
    const summary = this.effects.summaries[summaryId];
    if (summary.unknown || summary.invokes.length > 0) { this.report(module,id,"E4104: resumen recursivo con efectos opacos todavía no demostrados"); return; }
    for (const sid of summary.reads) { const root: number = this.observable(summaryId,sid,module,id); if (root >= 0) this.read(module,id,root,state); }
    for (const sid of summary.writes) { const root: number = this.observable(summaryId,sid,module,id); if (root >= 0) this.access(module,id,root,"write"); }
    for (const sid of summary.moves) {
      const root: number = this.observable(summaryId,sid,module,id);
      if (root >= 0) { this.read(module,id,root,state); this.access(module,id,root,"move"); if (state.slots[root] != 2) state.slots[root] = 3; }
    }
  }
  unknown(module: number, id: number, state: SafetyState): void {
    // A symbolic callback parameter is an obligation on callers. Definitions
    // with no concrete caller keep that obligation in their effect summary.
    let symbolic: number = this.reference(module,id); let remaining: number = this.arguments.length + 1;
    while (symbolic >= 0 && this.binding.symbols[symbolic].kind == "Parameter" && remaining > 0) {
      let found: number = -1;
      for (let at: number = this.arguments.length - 1; at >= 0; at = at - 1) if (this.arguments[at].parameter == symbolic) { found = at; break; }
      if (found < 0) return;
      const actual = this.arguments[found]; const next: number = this.directRoot(actual.module,actual.node);
      if (next == symbolic) break; symbolic = next; remaining = remaining - 1;
    }
    for (const lease of this.leases) if (lease.end > lease.begin) {
      let live: boolean = lease.module == module && lease.owner == this.owner(this.binding.files[module].nodeScopes[id]) && (lease.begin) <= this.node(module,id).start.offset && (this.node(module,id).start.offset) <= lease.end;
      for (const site of this.sites) if (lease.module == site.module && lease.owner == this.owner(this.binding.files[site.module].nodeScopes[site.node]) && (lease.begin) <= this.node(site.module,site.node).start.offset && (this.node(site.module,site.node).start.offset) <= lease.end) live = true;
      if (live) this.report(module,id,"E4104: efectos opacos durante un préstamo activo no demostrados");
    }
    for (let global: number = 0; global < this.binding.symbols.length; global = global + 1) {
      const s = this.binding.symbols[global];
      if (localBinding(s.kind) && this.owner(s.scope) < 0 && (ownedType(this.result.symbolTypes[global]) || state.slots[global] != 1)) this.report(module,id,"E4104: efectos opacos sobre globals no demostrados");
    }
  }
  invoke(module: number, id: number, out state: SafetyState, active: number[]): void {
    if (this.effects.builtin(module,id)) return;
    const targets: number[] = this.targets(module,id);
    if (targets.length == 0) { this.unknown(module,id,state); return; }
    const before: SafetyState = state; let joined: SafetyState = state; joined.exit = "unreachable";
    for (const summaryId of targets) {
      const summary = this.effects.summaries[summaryId]; let choice: SafetyState = before;
      const target: SafetyTarget = new SafetyTarget(summary.module,summary.node); const owner: number = this.vertex(target.module,target.node);
      if (bindingChild(this.node(target.module,target.node),"body") < 0) this.unknown(module,id,choice);
      else if (active.includes(owner) || active.length >= 64) this.summary(summaryId,module,id,choice);
      else this.invokeTarget(module,id,target,choice,active);
      joined = this.join(joined,choice);
    }
    state = joined;
  }
  invokeTarget(module: number, id: number, target: SafetyTarget, out state: SafetyState, active: number[]): void {
    const owner: number = this.vertex(target.module,target.node);
    const argumentStart: number = this.arguments.length; const leaseStart: number = this.leases.length;
    let saved: SafetyState = state; const returnStart: number = this.returns.length; this.sites.push(new SafetyCallSite(module,id));
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (this.owner(this.binding.symbols[sid].scope) == owner) state.slots[sid] = (this.binding.symbols[sid].kind == "receiver" ? 1 : 0);
    let next: number[] = active; next.push(owner);
    let actualCount: number = 0; for (const edge of this.node(module,id).edges) if (edge.role == "args") actualCount = actualCount + 1;
    let parameterIndex: number = 0; let actualNodes: number[] = [];
    for (const edge of this.node(module,id).edges) if (edge.role == "args") actualNodes.push(edge.node);
    for (const edge of this.node(target.module,target.node).edges) if (edge.role == "params") {
      if (parameterIndex >= actualCount) this.expression(target.module,bindingChild(this.node(target.module,edge.node),"defaultValue"),state,next);
      const parameter: number = this.binding.files[target.module].declarations[edge.node]; if (parameter >= 0) state.slots[parameter] = 1;
      const value: number = parameterIndex < actualNodes.length ? actualNodes[parameterIndex] : bindingChild(this.node(target.module,edge.node),"defaultValue");
      const valueModule: number = parameterIndex < actualNodes.length ? module : target.module;
      if (value >= 0) {
        const root: number = this.root(valueModule,value); this.arguments.push(new SafetyArgument(parameter,valueModule,value,root));
        if (root >= 0 && borrowedType(this.result.symbolTypes[parameter])) {
          const bodyNode: number = bindingChild(this.node(target.module,target.node),"body");
          let lease: BorrowLease = new BorrowLease(target.module,parameter,root,owner,this.node(target.module,bodyNode).start.offset,memoryMode(this.result.symbolTypes[parameter]));
          lease.end = this.node(target.module,bodyNode).end.offset; this.leases.push(lease);
        }
      }
      parameterIndex = parameterIndex + 1;
    }
    const body: number = bindingChild(this.node(target.module,target.node),"body");
    const breakStart: number = this.breaks.length; const continueStart: number = this.continues.length;
    if (this.node(target.module,body).kind == "BlockStatement") this.walk(target.module,body,state,next); else this.expression(target.module,body,state,next);
    for (let at: number = returnStart; at < this.returns.length; at = at + 1) state = this.join(state,this.returns[at]);
    while (this.returns.length > returnStart) this.returns.pop(); this.sites.pop();
    state.exit = "";
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (this.owner(this.binding.symbols[sid].scope) == owner) state.slots[sid] = saved.slots[sid];
    while (this.arguments.length > argumentStart) this.arguments.pop(); while (this.leases.length > leaseStart) this.leases.pop();
    while (this.breaks.length > breakStart) this.breaks.pop(); while (this.continues.length > continueStart) this.continues.pop();
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
    if (n.kind == "IdentifierExpression") { this.read(module,id,this.reference(module,id),state); return; }
    if (n.kind == "ArrowFunctionExpression") { for (const c of this.result.captures) if (c.module == module && c.closure == id) this.read(module,id,c.symbol,state); return; }
    if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression") {
      const target: number = bindingChild(n,"target"); const value: number = bindingChild(n,"value");
      this.expression(module,value,state,active);
      if (this.node(module,target).kind != "IdentifierExpression" || n.kind == "CompoundAssignmentExpression") this.expression(module,target,state,active);
      const sid: number = this.root(module,target);
      if (sid >= 0 && this.node(module,target).kind == "IdentifierExpression" && state.slots[sid] == 0) this.report(module,target,"E4001: escritura antes de inicializar");
      this.access(module,target,sid,"write");
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
      if (n.kind == "NewExpression") for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
        const s: BindingSymbol = this.binding.symbols[sid];
        if ((this.result.files[module].types[id] == "#" + numberToString(sid) || this.result.files[module].types[id].startsWith("#" + numberToString(sid) + "<")) && s.kind == "ClassDeclaration") for (const edge of this.node(s.module,s.node).edges) if (edge.role == "fields" && this.node(s.module,edge.node).get("isStatic") != "true") this.expression(s.module,bindingChild(this.node(s.module,edge.node),"defaultValue"),state,active);
      }
      for (const edge of n.edges) if (edge.role == "args") this.expression(module,edge.node,state,active);
      if (this.helper(module,id) == "move") {
        const arg: number = bindingChild(n,"args"); const sid: number = this.root(module,arg); this.access(module,id,sid,"move"); if (sid >= 0) state.slots[sid] = 2;
      } else if (this.helper(module,id) != "ref" && this.helper(module,id) != "constRef") {
        this.callBorrows(module,id);
        if (this.mutating(module,id) && object >= 0) this.access(module,object,this.root(module,object),"write");
        if (this.helper(module,id) == "") this.invoke(module,id,state,active);
      } return;
    }
    for (const edge of n.edges) this.expression(module,edge.node,state,active);
  }
  loop(module: number, id: number, out state: SafetyState, active: number[]): void {
    const n: AstNode = this.node(module,id); const init: number = bindingChild(n,"initializer"); if (init >= 0) this.walk(module,init,state,active);
    const iteration: boolean = n.kind == "ForOfStatement" || n.kind == "ForInStatement";
    if (iteration) this.expression(module,bindingChild(n,n.kind == "ForOfStatement" ? "iterable" : "target"),state,active);
    const condition: number = bindingChild(n,"condition"); const known: string = this.constant(module,condition);
    const entry: SafetyState = state; let head: SafetyState = state; let exits: SafetyState = state; exits.exit = "unreachable";
    const breakStart: number = this.breaks.length; const continueStart: number = this.continues.length;
    // Monotone join over the finite slot domain; stop at the fixed point,
    // rather than assuming four traversals suffice for every dependency chain.
    while (true) {
      let body: SafetyState = head; this.expression(module,condition,body,active);
      if (known != "true") exits = this.join(exits,body);
      if (known == "false") break;
      if (iteration) { const sid: number = this.binding.files[module].declarations[bindingChild(n,"binding")]; if (sid >= 0) body.slots[sid] = 1; }
      this.walk(module,bindingChild(n,"body"),body,active);
      for (let at: number = breakStart; at < this.breaks.length; at = at + 1) exits = this.join(exits,this.breaks[at]);
      for (let at: number = continueStart; at < this.continues.length; at = at + 1) body = this.join(body,this.continues[at]);
      while (this.breaks.length > breakStart) this.breaks.pop(); while (this.continues.length > continueStart) this.continues.pop();
      if (body.exit != "") break;
      this.expression(module,bindingChild(n,"increment"),body,active);
      const next: SafetyState = this.join(entry,body); let same: boolean = true;
      for (let sid: number = 0; sid < head.slots.length; sid = sid + 1) if (head.slots[sid] != next.slots[sid]) same = false;
      head = next; if (same) break;
    }
    state = exits; if (state.exit == "unreachable") state.exit = "return";
  }
  walk(module: number, id: number, out state: SafetyState, active: number[]): void {
    if (id < 0 || state.exit != "") return; const n: AstNode = this.node(module,id);
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
    if (n.kind == "ExpressionStatement") { this.expression(module,bindingChild(n,"expression"),state,active); return; }
    if (n.kind == "ReturnStatement") { this.expression(module,bindingChild(n,"value"),state,active); this.returns.push(state); state.exit = "return"; return; }
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
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) this.walk(m,this.graph.modules[m].cached.result.ast.root,globals,[]);
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.result.files[m].types.length; id = id + 1) {
      const n: AstNode = this.node(m,id); if (!callableBinding(n.kind) || this.binding.files[m].nodeScopes[id] < 0) continue;
      const owner: number = this.vertex(m,id); let state: SafetyState = new SafetyState(this.binding.symbols.length);
      for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (this.owner(this.binding.symbols[sid].scope) == owner && (localBinding(this.binding.symbols[sid].kind) || this.binding.symbols[sid].kind == "Parameter")) state.slots[sid] = 0;
      for (const edge of n.edges) if (edge.role == "params") {
        this.expression(m,bindingChild(this.node(m,edge.node),"defaultValue"),state,[owner]);
        const sid: number = this.binding.files[m].declarations[edge.node]; if (sid >= 0) state.slots[sid] = 1;
      }
      const body: number = bindingChild(n,"body"); if (body < 0) continue;
      this.breaks = []; this.continues = []; this.returns = []; this.sites = []; this.arguments = [];
      if (this.node(m,body).kind == "BlockStatement") {
        this.walk(m,body,state,[owner]);
        if (this.node(m,body).start.kind != ";" && functionReturn(this.result.files[m].types[id]) != "void" && state.exit != "return") this.report(m,id,"No todas las rutas devuelven un valor");
      } else this.expression(m,body,state,[owner]);
    }
  }
  run(): CheckResult {
    this.memoryContracts(); this.captures(); this.result.borrows = this.leases;
    this.effects = new EffectAnalyzer(this.graph,this.binding,this.result); this.effects.analyze(); this.result.effects = this.effects.summaries;
    this.provenance(); this.visibility(); this.flow(); this.result.borrows = this.leases; return this.result;
  }
}
export function validateSafety(graph: ModuleGraph, binding: BindingResult, out result: CheckResult): void {
  let analyzer: SafetyAnalyzer = new SafetyAnalyzer(graph,binding,result); result = analyzer.run();
}
