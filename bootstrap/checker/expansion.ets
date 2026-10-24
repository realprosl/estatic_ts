import { AttributeKind, EdgeRole, NodeKind } from "../parser/ast-schema";
import { ModuleGraph, LoadedFile, GeneratedSource } from "../modules/loader";
import { CachedSource, FileRecord } from "../modules/syntax-cache";
import { AstNode, AstEdge, AstAttribute } from "../parser/parser";
import { diagnosticAt, parseSource, SourceDiagnostic } from "../frontend/frontend";
import { bindProject, BindingResult, bindingChild } from "../binder/binder";
import { NativeChecker, checkProject } from "./checker";
import { CheckResult, TypedFile } from "./model";
import { NativeComptime } from "./comptime";
import { contentHash } from "../modules/platform";

export class FrontendProject {
  graph: ModuleGraph; binding: BindingResult; checked: CheckResult;
  constructor(graph: ModuleGraph, binding: BindingResult, checked: CheckResult) { this.graph = graph; this.binding = binding; this.checked = checked; }
}
// Expansion owns a value copy of the graph. Cached source arenas are immutable.
export class NativeExpansion {
  graph: ModuleGraph; binding: BindingResult; count: number;
  constructor(graph: ModuleGraph) { this.graph = graph; this.binding = new BindingResult(); this.count = 0; }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  decorated(module: number, id: number, name: string): boolean {
    for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Decorators && this.node(module,edge.node).get(AttributeKind.Name) == name) return true;
    return false;
  }
  report(module: number, id: number, code: string, message: string): void {
    this.graph.diagnostics.push(diagnosticAt("checker",code+": "+message,this.graph.modules[module].file,this.node(module,id))); this.graph.success = false;
  }
  origin(sid: number): number { while (sid >= 0 && this.binding.symbols[sid].target >= 0) sid = this.binding.symbols[sid].target; return sid; }
  target(module: number, id: number): number {
    return id < 0 ? -1 : this.origin(this.binding.files[module].valueTargets[id]);
  }
  lookup(scope: number, name: string): number {
    while (scope >= 0) {
      for (const sid of this.binding.scopes[scope].symbols) if (this.binding.symbols[sid].name == name && this.binding.symbols[sid].values) return sid;
      scope = this.binding.scopes[scope].parent;
    } return -1;
  }
  generator(sid: number): boolean {
    if (sid < 0) return false; const s = this.binding.symbols[sid];
    if ((s.module) < 0 || s.kind != "FunctionDeclaration") return false;
    for (const declaration of s.declarations) if (this.decorated(s.module,declaration,"etsgen")) return true;
    return false;
  }
  set(out n: AstNode, key: AttributeKind, value: string): void {
    for (let a: number = 0; a < n.attributes.length; a = a+1) if (n.attributes[a].name == key) { n.attributes[a].value = value; return; }
    n.attr(key,value);
  }
  markers(out parsed: ModuleGraph, module: number, call: number, generatorModule: number): boolean {
    for (let id: number = 0; id < parsed.modules[0].cached.result.ast.nodes.length; id = id+1) {
      let n = parsed.modules[0].cached.result.ast.nodes[id]; if (n.kind != NodeKind.CallExpression || !["etsCapture","etsDefinition"].includes(n.get(AttributeKind.Callee))) continue;
      let args: number[] = []; for (const edge of n.edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
      if (args.length == 0 || (n.get(AttributeKind.Callee) == "etsCapture" && args.length != 1)) { this.report(module,call,"ETSGEN_GENERATED_HYGIENE","Aridad incorrecta del marcador de captura"); return false; }
      const nameNode = parsed.modules[0].cached.result.ast.nodes[args[0]]; const name: string = nameNode.get(AttributeKind.Value);
      if (nameNode.kind != NodeKind.LiteralExpression || nameNode.get(AttributeKind.LiteralType) != "string") { this.report(module,call,"ETSGEN_GENERATED_HYGIENE","La captura requiere un identificador literal"); return false; }
      const definition: boolean = n.get(AttributeKind.Callee) == "etsDefinition";
      const scope: number = definition ? this.binding.files[generatorModule].scope : this.binding.files[module].nodeScopes[call];
      const sid: number = this.lookup(scope,name);
      if (sid < 0) { this.report(module,call,"ETSGEN_GENERATED_HYGIENE","Captura no declarada: "+name); return false; }
      const s = this.binding.symbols[this.origin(sid)]; const invoke: boolean = definition && args.length > 1;
      let replacement = new AstNode(invoke ? NodeKind.CallExpression : NodeKind.IdentifierExpression,n.start,n.end);
      replacement.attr(invoke ? AttributeKind.Callee : AttributeKind.Name,name); replacement.attr(AttributeKind.GeneratedExternal,"true");
      if (definition) replacement.attr(AttributeKind.GeneratedDefinition,this.graph.modules[generatorModule].file);
      for (let a: number = 1; a < args.length; a = a+1) replacement.edge(EdgeRole.Args,args[a]);
      parsed.modules[0].cached.result.ast.nodes[id] = replacement;
    } return true;
  }
  rename(text: string, names: string[], replacements: string[]): string {
    let output: string = ""; let at: number = 0;
    while (at < text.length) {
      const code: number = text.charCodeAt(at);
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code == 95 || code == 36) {
        const begin: number = at; at = at+1;
        while (at < text.length) { const c: number = text.charCodeAt(at); if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 95 || c == 36)) break; at = at+1; }
        const word: string = text.slice(begin,at); let emitted: string = word;
        for (let p: number = 0; p < names.length; p = p+1) if (word == names[p]) emitted = replacements[p]; output = output+emitted;
      } else { output = output+text.charAt(at); at = at+1; }
    } return output;
  }
  hygiene(out fragment: ModuleGraph, module: number, call: number, generatorModule: number, sourceId: string): boolean {
    const root: number = fragment.modules[0].cached.result.ast.root; let published: number[] = [];
    for (let id: number = 0; id < fragment.modules[0].cached.result.ast.nodes.length; id = id+1) {
      let n = fragment.modules[0].cached.result.ast.nodes[id]; let edges: AstEdge[] = [];
      if ([NodeKind.ImportDeclaration,NodeKind.ExportNamedDeclaration,NodeKind.ExportAllDeclaration,NodeKind.ExportDefaultDeclaration,NodeKind.ModuleHeaderDeclaration,NodeKind.RawCppExpression].includes(n.kind) || n.get(AttributeKind.Exported) == "true") { this.report(module,call,"ETSGEN_GENERATED_HYGIENE","El fragmento no admite imports, exports, cabeceras ni C++ opaco"); return false; }
      for (const edge of n.edges) {
        const decorator = fragment.modules[0].cached.result.ast.nodes[edge.node];
        if (edge.role == EdgeRole.Decorators && decorator.get(AttributeKind.Name) == "etsPublish") {
          let direct: boolean = false; for (const item of fragment.modules[0].cached.result.ast.nodes[root].edges) if (item.node == id) direct = true;
          if (!direct || ![NodeKind.VariableDeclaration,NodeKind.FunctionDeclaration,NodeKind.ClassDeclaration,NodeKind.InterfaceDeclaration].includes(n.kind) || n.get(AttributeKind.Pattern) != "" || decorator.edges.length != 0) { this.report(module,call,"ETSGEN_GENERATED_HYGIENE","@etsPublish requiere una declaración directa simple y no recibe argumentos"); return false; }
          published.push(id);
        } else edges.push(edge);
      }
      n.edges = edges; fragment.modules[0].cached.result.ast.nodes[id] = n;
    }
    const local: BindingResult = bindProject(fragment);
    for (const diagnostic of local.diagnostics) if (diagnostic.message.includes("duplicad",0)) { this.report(module,call,"ETSGEN_GENERATED_HYGIENE",diagnostic.message); return false; }
    let emitted: string[] = [];
    for (let sid: number = 0; sid < local.symbols.length; sid = sid+1) {
      const s = local.symbols[sid]; let name: string = s.name;
      if (s.kind == "FunctionDeclaration") for (const declaration of s.declarations) if (published.includes(declaration) != published.includes(s.node)) { this.report(module,call,"ETSGEN_GENERATED_HYGIENE","Las sobrecargas deben compartir la publicación @etsPublish"); return false; }
      if (s.module >= 0 && ["VariableDeclaration","UsingDeclaration","ArrayBinding","ObjectBinding","FunctionDeclaration","ClassDeclaration","InterfaceDeclaration","TypeAliasDeclaration","EnumDeclaration","UnionDeclaration"].includes(s.kind) && !published.includes(s.node)) name = "__etsgen_"+sourceId+"_"+numberToString(sid);
      emitted.push(name);
    }
    for (let id: number = 0; id < fragment.modules[0].cached.result.ast.nodes.length; id = id+1) {
      let n = fragment.modules[0].cached.result.ast.nodes[id]; let names: string[] = []; let replacements: string[] = [];
      const declaration: number = local.files[0].declarations[id];
      if (declaration >= 0 && emitted[declaration] != local.symbols[declaration].name) { this.set(n,AttributeKind.Name,emitted[declaration]); n.attr(AttributeKind.GeneratedOriginalName,local.symbols[declaration].name); }
      if (n.get(AttributeKind.GeneratedExternal) != "true") for (const ref of local.references) if (ref.module == 0 && ref.node == id && ref.target >= 0) {
        names.push(ref.name); replacements.push(emitted[ref.target]);
        if (ref.space == "value" && n.kind == NodeKind.CallExpression) this.set(n,AttributeKind.Callee,emitted[ref.target]);
        if (ref.space == "value" && [NodeKind.IdentifierExpression,NodeKind.GenericIdentifierExpression].includes(n.kind)) this.set(n,AttributeKind.Name,emitted[ref.target]);
      }
      for (let a: number = 0; a < n.attributes.length; a = a+1) if ([AttributeKind.Type,AttributeKind.DeclaredType,AttributeKind.ReturnType,AttributeKind.Constraint,AttributeKind.TargetType,AttributeKind.TypeArgument,AttributeKind.Payload,AttributeKind.ClassName].includes(n.attributes[a].name) || (n.kind == NodeKind.TypeParameter && n.attributes[a].name == AttributeKind.Default)) n.attributes[a].value = this.rename(n.attributes[a].value,names,replacements);
      fragment.modules[0].cached.result.ast.nodes[id] = n;
    }
    return this.markers(fragment,module,call,generatorModule);
  }
  rootSource(id: string): string {
    let root: string = id;
    while (true) { let parent: string = ""; for (const source of this.graph.generatedSources) if (source.id == root) parent = source.parentId; if (parent == "") return root; root = parent; }
  }
  expand(module: number, call: number, sid: number): boolean {
    const symbol = this.binding.symbols[sid]; let checker = new NativeChecker(this.graph,this.binding);
    for (const s of this.binding.symbols) { checker.result.symbolTypes.push(""); checker.symbolStates.push(0); }
    for (const m of this.graph.modules) checker.result.files.push(new TypedFile(m.cached.result.ast.nodes.length));
    for (const declaration of symbol.declarations) checker.statement(symbol.module,declaration,"",0);
    checker.expression(module,call,"");
    for (let m: number = 0; m < checker.result.files.length; m = m+1) for (let id: number = 0; id < checker.result.files[m].types.length; id = id+1) if (checker.result.files[m].types[id] != "" && this.node(m,id).kind == NodeKind.ArrowFunctionExpression) checker.statement(m,id,"",0);
    if (checker.result.diagnostics.length > 0) { for (const d of checker.result.diagnostics) this.graph.diagnostics.push(d); this.graph.success = false; return false; }
    const selected: number = checker.result.files[module].selected[call];
    if (selected < 0 || !this.decorated(symbol.module,selected,"etsgen")) { this.report(module,call,"ETSGEN_INVALID_GENERATOR","La sobrecarga elegida no declara @etsgen"); return false; }
    let evaluator = new NativeComptime(this.graph,this.binding,checker.result); evaluator.evaluate(module,call,true);
    if (evaluator.failure != "") { this.report(module,call,evaluator.failureCode,evaluator.failure); return false; }
    const value = evaluator.values[evaluator.lastValue];
    if (value.kind != "string") { this.report(module,call,"ETSGEN_INVALID_GENERATOR","El generador debe devolver string"); return false; }
    const parent: string = this.node(module,call).get(AttributeKind.GeneratedSource); let depth: number = 0; let bytes: number = value.text.length; let ancestor: string = parent;
    while (ancestor != "") { let next: string = ""; for (const source of this.graph.generatedSources) if (source.id == ancestor) { next = source.parentId; bytes = bytes+source.source.length; } ancestor = next; depth = depth+1; }
    let expansions: number = 0; bytes = value.text.length;
    if (parent != "") { const root: string = this.rootSource(parent); for (const source of this.graph.generatedSources) if (this.rootSource(source.id) == root) { expansions = expansions+1; bytes = bytes+source.source.length; } }
    if (depth >= 64 || expansions >= 1000 || bytes > 1048576) { this.report(module,call,depth >= 64 ? "ETSGEN_RECURSION_LIMIT" : bytes > 1048576 ? "ETSGEN_GENERATED_LIMIT" : "ETSGEN_EXPANSION_LIMIT","Límite de expansión excedido"); return false; }
    const sourceId: string = contentHash(this.graph.modules[module].file+":"+numberToString(call)+":"+parent);
    const parsed = parseSource(value.text,"etsgen:"+sourceId); let fragment = new ModuleGraph(parsed.file);
    fragment.modules.push(new LoadedFile(parsed.file,new CachedSource(parsed,new FileRecord(parsed.file,contentHash(value.text),"",""),false)));
    const site = this.node(module,call);
    this.graph.generatedSources.push(new GeneratedSource(sourceId,module,call,symbol.module,selected,parent,value.text,site.start,site.end));
    if (!parsed.success) {
      for (const d of parsed.diagnostics) { let diagnostic = new SourceDiagnostic("checker","ETSGEN_GENERATED_PARSE: "+d.message,this.graph.modules[module].file,site.start); diagnostic.generatedId = sourceId; diagnostic.endToken = site.end; diagnostic.generatedToken = d.token; diagnostic.generatedEndToken = d.endToken; this.graph.diagnostics.push(diagnostic); }
      this.graph.success = false; return false;
    }
    if (!this.hygiene(fragment,module,call,symbol.module,sourceId)) return false;
    const statement: number = this.binding.files[module].parents[call]; const container: number = this.binding.files[module].parents[statement];
    const offset: number = this.graph.modules[module].cached.result.ast.nodes.length;
    for (const original of fragment.modules[0].cached.result.ast.nodes) {
      let n = original; n.generatedId = sourceId; n.generatedStart = original.start; n.generatedEnd = original.end; n.attr(AttributeKind.GeneratedSource,sourceId); n.attr(AttributeKind.GeneratedOffset,numberToString(original.start.offset)); n.attr(AttributeKind.GeneratedEndOffset,numberToString(original.end.endOffset)); n.attr(AttributeKind.GeneratedLine,numberToString(original.start.line)); n.attr(AttributeKind.GeneratedColumn,numberToString(original.start.column));
      n.start = site.start; n.end = site.end;
      for (let e: number = 0; e < n.edges.length; e = e+1) n.edges[e].node = n.edges[e].node+offset;
      this.graph.modules[module].cached.result.ast.nodes.push(n);
    }
    let node = this.node(module,container); let edges: AstEdge[] = [];
    for (const edge of node.edges) {
      if (edge.node != statement) edges.push(edge);
      else for (const generated of fragment.modules[0].cached.result.ast.nodes[parsed.ast.root].edges) edges.push(new AstEdge(edge.role,generated.node+offset));
    }
    node.edges = edges; this.graph.modules[module].cached.result.ast.nodes[container] = node;
    this.count = this.count+1; return true;
  }
  order(module: number, id: number, cursor: number, depth: number): number {
    if (depth > 256) { this.report(module,id,"ETSGEN_GENERATED_LIMIT","Profundidad del AST expandido excedida"); return cursor; }
    this.graph.modules[module].cached.result.ast.nodes[id].analysisStart = cursor; cursor = cursor+1;
    for (const edge of this.node(module,id).edges) cursor = this.order(module,edge.node,cursor,depth+1);
    this.graph.modules[module].cached.result.ast.nodes[id].analysisEnd = cursor; return cursor+1;
  }
  run(): ModuleGraph {
    while (this.graph.success) {
      this.binding = bindProject(this.graph); let foundModule: number = -1; let foundCall: number = -1; let foundSymbol: number = -1;
      for (let m: number = 0; m < this.graph.modules.length && foundCall < 0; m = m+1) for (let id: number = 0; id < this.graph.modules[m].cached.result.ast.nodes.length && foundCall < 0; id = id+1) {
        if (this.binding.files[m].nodeScopes[id] < 0 || ![NodeKind.CallExpression,NodeKind.MemberCallExpression].includes(this.node(m,id).kind)) continue;
        let parent: number = this.binding.files[m].parents[id]; let inGenerator: boolean = false;
        while (parent >= 0) { if (this.decorated(m,parent,"etsgen")) inGenerator = true; parent = this.binding.files[m].parents[parent]; }
        const sid: number = this.target(m,id); if (inGenerator || !this.generator(sid)) continue;
        const statement: number = this.binding.files[m].parents[id]; const container: number = statement >= 0 ? this.binding.files[m].parents[statement] : -1;
        if (statement < 0 || this.node(m,statement).kind != NodeKind.ExpressionStatement || container < 0 || ![NodeKind.Program,NodeKind.BlockStatement,NodeKind.CaseClause,NodeKind.DefaultClause].includes(this.node(m,container).kind)) { this.report(m,id,"ETSGEN_INVALID_CONTEXT","La expansión requiere una sentencia en una lista de statements"); return this.graph; }
        foundModule = m; foundCall = id; foundSymbol = sid;
      }
      if (foundCall < 0) break;
      if (!this.expand(foundModule,foundCall,foundSymbol)) break;
    }
    if (this.graph.generatedSources.length > 0) for (let m: number = 0; m < this.graph.modules.length; m = m+1) this.order(m,this.graph.modules[m].cached.result.ast.root,0,0);
    return this.graph;
  }
}
export function analyzeProject(graph: ModuleGraph, trace: boolean = false): FrontendProject {
  if (trace) printError("frontend: expansion and binding");
  let expansion = new NativeExpansion(graph); const expanded: ModuleGraph = expansion.run(); const binding: BindingResult = bindProject(expanded);
  return new FrontendProject(expanded,binding,checkProject(expanded,binding,trace));
}
