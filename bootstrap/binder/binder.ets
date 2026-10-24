import { nativeBuiltinNames, nativeBuiltinTypes } from "../frontend/builtins";
import { ModuleGraph } from "../modules/loader";
import { AstNode, ParserToken } from "../parser/parser";
import { diagnosticAt, SourceDiagnostic, quoteSource } from "../frontend/frontend";

export class BindingScope {
  parent: number; module: number; node: number; kind: string; symbols: number[];
  constructor(parent: number, module: number, node: number, kind: string) {
    this.parent = parent; this.module = module; this.node = node; this.kind = kind; this.symbols = [];
  }
}
export class BindingSymbol {
  name: string; kind: string; scope: number; module: number; node: number; declarations: number[];
  values: boolean; types: boolean; target: number; namespaceModule: number; typeOnly: boolean; invalid: boolean;
  constructor(name: string, kind: string, scope: number, module: number, node: number, values: boolean, types: boolean) {
    this.name = name; this.kind = kind; this.scope = scope; this.module = module; this.node = node;
    this.declarations = [node]; this.values = values; this.types = types; this.target = -1;
    this.namespaceModule = -1; this.typeOnly = false; this.invalid = false;
  }
}
export class BoundReference {
  module: number; node: number; scope: number; name: string; space: string; symbol: number; target: number; deferred: boolean;
  constructor(module: number, node: number, scope: number, name: string, space: string, symbol: number, target: number, deferred: boolean) {
    this.module = module; this.node = node; this.scope = scope; this.name = name; this.space = space;
    this.symbol = symbol; this.target = target; this.deferred = deferred;
  }
}
export class BoundExport {
  module: number; name: string; symbol: number; typeOnly: boolean; isExplicit: boolean;
  constructor(module: number, name: string, symbol: number, typeOnly: boolean, isExplicit: boolean) {
    this.module = module; this.name = name; this.symbol = symbol; this.typeOnly = typeOnly; this.isExplicit = isExplicit;
  }
}
export class BoundFile {
  scope: number; nodeScopes: number[]; declarations: number[]; parents: number[]; valueTargets: number[];
  constructor(scope: number, count: number) {
    this.scope = scope; this.nodeScopes = []; this.declarations = []; this.parents = []; this.valueTargets = [];
    for (let i: number = 0; i < count; i = i + 1) { this.nodeScopes.push(-1); this.declarations.push(-1); this.parents.push(-1); this.valueTargets.push(-1); }
  }
}
export class BindingResult {
  scopes: BindingScope[]; symbols: BindingSymbol[]; references: BoundReference[]; exports: BoundExport[];
  files: BoundFile[]; diagnostics: SourceDiagnostic[]; success: boolean;
  constructor() { this.scopes = []; this.symbols = []; this.references = []; this.exports = []; this.files = []; this.diagnostics = []; this.success = false; }
}
export function bindingChild(node: AstNode, role: string): number {
  for (const edge of node.edges) { if (edge.role == role) return edge.node; } return -1;
}
export function isBindingMember(kind: string): boolean {
  return kind == "ClassField" || kind == "ClassMethod" || kind == "InterfaceField" || kind == "InterfaceMethod" || kind == "EnumMember" || kind == "UnionVariantBinding";
}
export function callableBinding(kind: string): boolean {
  return kind == "FunctionDeclaration" || kind == "ArrowFunctionExpression" || kind == "ClassMethod" || kind == "InterfaceMethod";
}
export class ScopeWork {
  node: number; scope: number; reuse: boolean;
  constructor(node: number, scope: number, reuse: boolean) { this.node = node; this.scope = scope; this.reuse = reuse; }
}
export class Binder {
  graph: ModuleGraph; result: BindingResult;
  constructor(graph: ModuleGraph) { this.graph = graph; this.result = new BindingResult(); }
  report(module: number, node: number, message: string): void {
    const token: ParserToken = this.graph.modules[module].cached.result.ast.nodes[node].start;
    this.result.diagnostics.push(diagnosticAt("binder", message, this.graph.modules[module].file,this.graph.modules[module].cached.result.ast.nodes[node]));
  }
  scope(parent: number, module: number, node: number, kind: string): number {
    this.result.scopes.push(new BindingScope(parent, module, node, kind)); return this.result.scopes.length - 1;
  }
  declare(name: string, kind: string, scope: number, module: number, node: number, values: boolean, types: boolean): number {
    if (name == "") return -1;
    if ((kind == "FunctionDeclaration" || kind == "ClassMethod" || kind == "InterfaceMethod") && scope >= 0) {
      for (const entry of this.result.scopes[scope].symbols) {
        if (this.result.symbols[entry].name == name && this.result.symbols[entry].kind == kind) {
          this.result.symbols[entry].declarations.push(node); this.result.files[module].declarations[node] = entry; return entry;
        }
      }
    }
    const symbol: number = this.result.symbols.length;
    this.result.symbols.push(new BindingSymbol(name, kind, scope, module, node, values, types));
    if (scope >= 0) this.result.scopes[scope].symbols.push(symbol);
    if (module >= 0 && node >= 0) this.result.files[module].declarations[node] = symbol;
    return symbol;
  }
  local(scope: number, name: string, space: string): number {
    for (const symbol of this.result.scopes[scope].symbols) {
      const item: BindingSymbol = this.result.symbols[symbol];
      if (item.name == name && (space == "any" || (space == "value" && item.values) || (space == "type" && item.types) || (space == "query" && (item.values || item.namespaceModule >= 0 || (item.kind == "import" && this.result.symbols[this.origin(symbol)].values))))) return symbol;
    }
    return -1;
  }
  lookup(scope: number, name: string, space: string): number {
    let current: number = scope;
    while (current >= 0) {
      const found: number = this.local(current, name, space);
      if (found >= 0 && !isBindingMember(this.result.symbols[found].kind)) return found;
      if (name == "this" && this.result.scopes[current].kind == "function") return -1;
      current = this.result.scopes[current].parent;
    }
    return -1;
  }
  origin(symbol: number): number {
    let current: number = symbol;
    for (let i: number = 0; i < this.result.symbols.length && current >= 0; i = i + 1) {
      const next: number = this.result.symbols[current].target; if (next < 0) return current; current = next;
    }
    return -1;
  }
  collect(module: number): void {
    const arena: AstNode[] = this.graph.modules[module].cached.result.ast.nodes;
    const root: number = this.graph.modules[module].cached.result.ast.root;
    const moduleScope: number = this.result.files[module].scope;
    let stack: ScopeWork[] = [new ScopeWork(root, moduleScope, true)];
    while (stack.length > 0) {
      const work: ScopeWork = stack[stack.length - 1]; stack.pop();
      const node: AstNode = arena[work.node]; let scope: number = work.scope;
      let symbol: number = -1; const kind: string = node.kind; const name: string = node.get("name");
      if (kind == "VariableDeclaration" || kind == "UsingDeclaration" || kind == "FunctionDeclaration") symbol = this.declare(name, kind, scope, module, work.node, true, false);
      else if (kind == "ClassDeclaration" || kind == "EnumDeclaration" || kind == "UnionDeclaration") symbol = this.declare(name, kind, scope, module, work.node, true, true);
      else if (kind == "InterfaceDeclaration" || kind == "TypeAliasDeclaration" || kind == "TypeParameter") symbol = this.declare(name, kind, scope, module, work.node, false, true);
      else if (kind == "Parameter" || kind == "ArrayBinding" || kind == "ObjectBinding") symbol = this.declare(name, kind, scope, module, work.node, true, false);
      else if (isBindingMember(kind)) symbol = this.declare(name, kind, scope, module, work.node, true, false);
      else if (kind == "Binding" && this.result.scopes[scope].kind == "UnionVariant") symbol = this.declare(name,"UnionVariantBinding",scope,module,work.node,true,false);
      else if (kind == "UnionVariant") {
        const outer: number = this.result.scopes[scope].parent;
        symbol = this.declare(name, kind, outer, module, work.node, true, false);
      } else if (kind == "ImportSpecifier") {
        const typeOnly: boolean = node.get("typeOnly") == "true";
        symbol = this.declare(node.get("local"), "import", scope, module, work.node, !typeOnly, true);
        if (symbol >= 0) this.result.symbols[symbol].typeOnly = typeOnly;
      }
      if (kind == "Parameter" && node.get("parameterProperty") == "true") {
        const parent: number = this.result.scopes[scope].parent;
        if (parent >= 0) {
          this.declare(name, "ClassField", parent, module, work.node, true, false);
          this.result.files[module].declarations[work.node] = symbol;
        }
      }
      if (callableBinding(kind)) {
        scope = this.scope(scope, module, work.node, kind == "ArrowFunctionExpression" ? "arrow" : "function");
        if (kind == "ClassMethod" || kind == "InterfaceMethod") this.declare("this", "receiver", scope, module, -1, true, false);
      } else if (kind == "ClassDeclaration" || kind == "InterfaceDeclaration" || kind == "EnumDeclaration" || kind == "UnionDeclaration" || kind == "TypeAliasDeclaration") {
        scope = this.scope(scope, module, work.node, kind);
        if (kind == "ClassDeclaration") this.declare("this", "receiver", scope, module, -1, true, false);
      } else if (kind == "UnionVariant" || (kind == "BlockStatement" && !work.reuse) || kind == "ForStatement" || kind == "ForOfStatement" || kind == "ForInStatement" || kind == "SwitchStatement") scope = this.scope(scope, module, work.node, kind);
      this.result.files[module].nodeScopes[work.node] = scope;
      // Push in reverse to preserve source/edge order without recursive calls.
      for (let i: number = node.edges.length - 1; i >= 0; i = i - 1) {
        const child: number = node.edges[i].node;
        this.result.files[module].parents[child] = work.node;
        stack.push(new ScopeWork(child, scope, callableBinding(kind) && node.edges[i].role == "body"));
      }
    }
  }
  dependency(module: number, node: number): number {
    for (const request of this.graph.modules[module].requests) {
      if (request.node == node) for (let i: number = 0; i < this.graph.modules.length; i = i + 1) {
        if (this.graph.modules[i].file == request.dependency) return i;
      }
    }
    return -1;
  }
  exported(module: number, name: string): number {
    for (let i: number = 0; i < this.result.exports.length; i = i + 1) {
      if (this.result.exports[i].module == module && this.result.exports[i].name == name) return i;
    }
    return -1;
  }
  target(module: number, dependency: number, node: number, name: string): number {
    const entry: number = this.exported(dependency, name);
    if (entry >= 0) return entry;
    const local: number = this.local(this.result.files[dependency].scope, name, "any");
    this.report(module, node, local >= 0 ? "El símbolo '" + name + "' es privado" : "El módulo no exporta '" + name + "'"); return -1;
  }
  sameBinding(left: number, right: number): boolean {
    const a: number = this.origin(left); const b: number = this.origin(right);
    if (a == b) return true;
    return a >= 0 && b >= 0 && this.result.symbols[a].namespaceModule >= 0 && this.result.symbols[a].namespaceModule == this.result.symbols[b].namespaceModule;
  }
  publish(module: number, name: string, symbol: number, typeOnly: boolean, isExplicit: boolean, node: number): void {
    const old: number = this.exported(module, name);
    if (old < 0) { this.result.exports.push(new BoundExport(module, name, symbol, typeOnly, isExplicit)); return; }
    if (!isExplicit && this.result.exports[old].isExplicit) return;
    if (isExplicit || !this.sameBinding(this.result.exports[old].symbol, symbol) || this.result.exports[old].typeOnly != typeOnly)
      this.report(module, node, isExplicit ? "Export duplicado '" + name + "'" : "Reexport ambiguo '" + name + "'");
  }
  imports(module: number): void {
    const arena: AstNode[] = this.graph.modules[module].cached.result.ast.nodes;
    for (const request of this.graph.modules[module].requests) {
      const node: AstNode = arena[request.node]; if (node.kind != "ImportDeclaration") continue;
      const dependency: number = this.dependency(module, request.node); if (dependency < 0) continue;
      for (const edge of node.edges) {
        if (edge.role != "specifiers") continue;
        const specifier: AstNode = arena[edge.node]; const sid: number = this.result.files[module].declarations[edge.node];
        if (sid < 0) continue;
        if (specifier.get("form") == "namespace") { this.result.symbols[sid].namespaceModule = dependency; continue; }
        const entry: number = this.target(module, dependency, edge.node, specifier.get("imported"));
        if (entry < 0) { this.result.symbols[sid].invalid = true; continue; }
        const exported: BoundExport = this.result.exports[entry]; const origin: number = this.origin(exported.symbol);
        this.result.symbols[sid].target = exported.symbol;
        this.result.symbols[sid].typeOnly = this.result.symbols[sid].typeOnly || exported.typeOnly;
        this.result.symbols[sid].values = !this.result.symbols[sid].typeOnly && this.result.symbols[origin].values;
        this.result.symbols[sid].types = this.result.symbols[origin].types;
      }
    }
  }
  moduleExports(module: number): void {
    const arena: AstNode[] = this.graph.modules[module].cached.result.ast.nodes;
    const root: number = this.graph.modules[module].cached.result.ast.root;
    for (const edge of arena[root].edges) {
      const node: AstNode = arena[edge.node]; const sid: number = this.result.files[module].declarations[edge.node];
      if (node.kind == "ExportDefaultDeclaration") {
        const declaration: number = bindingChild(node, "declaration"); let target: number = this.result.files[module].declarations[declaration];
        if (target < 0) {
          const kind: string = arena[declaration].kind;
          target = this.declare("default", kind, -1, module, declaration, true, kind == "ClassDeclaration");
        }
        this.publish(module, "default", target, false, true, edge.node);
      } else if (node.get("exported") == "true" && sid >= 0) {
        const old: number = this.exported(module, node.get("name"));
        if (old < 0 || node.kind != "FunctionDeclaration" || this.result.exports[old].symbol != sid) this.publish(module, node.get("name"), sid, false, true, edge.node);
      }
      else if (node.get("exported") == "true" && node.get("pattern") != "") {
        for (const item of node.edges) {
          if (item.role == "arrayBindings" || item.role == "objectBindings") {
            const target: number = this.result.files[module].declarations[item.node];
            if (target >= 0) this.publish(module, arena[item.node].get("name"), target, false, true, item.node);
          }
        }
      }
      if (node.kind == "ExportNamedDeclaration") {
        const dependency: number = this.dependency(module, edge.node);
        for (const item of node.edges) {
          if (item.role != "specifiers") continue;
          const specifier: AstNode = arena[item.node]; const name: string = specifier.get("name"); let symbol: number = -1;
          let typeOnly: boolean = node.get("typeOnly") == "true" || specifier.get("typeOnly") == "true";
          if (dependency >= 0) {
            const entry: number = this.target(module, dependency, item.node, name);
            if (entry >= 0) { symbol = this.result.exports[entry].symbol; typeOnly = typeOnly || this.result.exports[entry].typeOnly; }
          } else {
            symbol = this.local(this.result.files[module].scope, name, "any");
            if (symbol < 0) this.report(module, item.node, "No existe el nombre exportado '" + name + "'");
            else typeOnly = typeOnly || this.result.symbols[symbol].typeOnly;
          }
          if (symbol >= 0) this.publish(module, specifier.get("alias") == "" ? name : specifier.get("alias"), symbol, typeOnly, true, item.node);
        }
      } else if (node.kind == "ExportAllDeclaration" && node.get("namespace") != "") {
        const dependency: number = this.dependency(module, edge.node); if (dependency < 0) continue;
        const symbol: number = this.declare(node.get("namespace"), "namespace", -1, module, edge.node, true, true);
        this.result.symbols[symbol].namespaceModule = dependency;
        this.publish(module, node.get("namespace"), symbol, node.get("typeOnly") == "true", true, edge.node);
      }
    }
    for (const request of this.graph.modules[module].requests) {
      const node: AstNode = arena[request.node]; if (node.kind != "ExportAllDeclaration" || node.get("namespace") != "") continue;
      const dependency: number = this.dependency(module, request.node); if (dependency < 0) continue;
      const count: number = this.result.exports.length;
      for (let i: number = 0; i < count; i = i + 1) {
        const entry: BoundExport = this.result.exports[i];
        if (entry.module == dependency && entry.name != "default") this.publish(module, entry.name, entry.symbol, entry.typeOnly || node.get("typeOnly") == "true", false, request.node);
      }
    }
  }
  duplicates(): void {
    for (const scope of this.result.scopes) {
      for (let i: number = 0; i < scope.symbols.length; i = i + 1) {
        const current: BindingSymbol = this.result.symbols[scope.symbols[i]]; if ((current.module) < 0) continue;
        for (let j: number = 0; j < i; j = j + 1) {
          const old: BindingSymbol = this.result.symbols[scope.symbols[j]];
          if (old.name == current.name && ((old.values && current.values) || (old.types && current.types))) { this.report(current.module, current.node, "Declaración duplicada '" + current.name + "'"); break; }
        }
        if (current.kind == "FunctionDeclaration" && current.declarations.length > 1) {
          let visibility: string = ""; let first: boolean = true;
          for (const declaration of current.declarations) {
            const node: AstNode = this.graph.modules[current.module].cached.result.ast.nodes[declaration];
            const parent: number = this.result.files[current.module].parents[declaration];
            let exported: string = node.get("exported");
            if (parent >= 0 && this.graph.modules[current.module].cached.result.ast.nodes[parent].kind == "ExportDefaultDeclaration") exported = "true";
            if (!first && visibility != exported) this.report(current.module, declaration, "Las sobrecargas requieren la misma visibilidad");
            first = false; visibility = exported;
          }
        }
      }
    }
  }
  reference(module: number, node: number, name: string, space: string): number {
    let scope: number = this.result.files[module].nodeScopes[node];
    const definition: string = this.graph.modules[module].cached.result.ast.nodes[node].get("generatedDefinition");
    if (definition != "") for (let m: number = 0; m < this.graph.modules.length; m = m+1) if (this.graph.modules[m].file == definition) scope = this.result.files[m].scope;
    const sid: number = this.lookup(scope, name, space);
    if (sid < 0) {
      const other: number = this.lookup(scope, name, "any");
      this.report(module, node, other >= 0 ? "El nombre '" + name + "' no está disponible como " + space : "Nombre no declarado '" + name + "'");
    }
    const target: number = this.origin(sid);
    this.result.references.push(new BoundReference(module, node, scope, name, space, sid, target, false)); return sid;
  }
  namespaceMember(module: number, node: number, receiver: number, member: string, space: string): number {
    const origin: number = this.origin(receiver); if (origin < 0) return -1;
    const dependency: number = this.result.symbols[origin].namespaceModule;
    if (dependency < 0) return -1;
    const entry: number = this.target(module, dependency, node, member); let symbol: number = -1;
    if (entry >= 0) {
      symbol = this.result.exports[entry].symbol; const target: number = this.origin(symbol);
      if ((space == "value" && (this.result.exports[entry].typeOnly || !this.result.symbols[target].values)) || (space == "type" && !this.result.symbols[target].types)) this.report(module, node, "El miembro '" + member + "' no está disponible como " + space);
    }
    this.result.references.push(new BoundReference(module, node, this.result.files[module].nodeScopes[node], member, space, symbol, this.origin(symbol), false)); return symbol;
  }
  typeReferences(module: number, node: number, text: string, firstValue: boolean): void {
    let at: number = 0; let previous: string = ""; let first: boolean = true;
    while (at < text.length) {
      const c: string = text.charAt(at); const code: number = text.charCodeAt(at);
      if (c == "\"" || c == "'") {
        const quote: string = c; at = at + 1;
        while (at < text.length && text.charAt(at) != quote) { if (text.charAt(at) == "\\") at = at + 1; at = at + 1; }
        at = at + 1; continue;
      }
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c == "_" || c == "$") {
        const start: number = at; at = at + 1;
        while (at < text.length) {
          const b: number = text.charCodeAt(at); const character: string = text.charAt(at);
          if (!((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || character == "_" || character == "$")) break;
          at = at + 1;
        }
        const firstName: boolean = first;
        let name: string = text.slice(start, at); let space: string = firstValue && first ? "value" : "type"; first = false;
        if (name.startsWith("$typeof$")) { name = name.slice(8, name.length); space = "query"; }
        if (previous == "[" && start >= 2) {
          const before: string = text.charAt(start - 2);
          if (before != "" && before != "(" && before != "," && before != "[" && before != " ") space = "value";
        }
        if (name == "readonly") { previous = ""; continue; }
        let receiver: number = this.reference(module, node, name, space);
        while (text.charAt(at) == ".") {
          at = at + 1; const begin: number = at;
          while (at < text.length) {
            const b: number = text.charCodeAt(at);
            if (!((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || text.charAt(at) == "_" || text.charAt(at) == "$")) break;
            at = at + 1;
          }
          const member: string = text.slice(begin, at); const origin: number = this.origin(receiver);
          if (origin >= 0 && this.result.symbols[origin].namespaceModule >= 0) receiver = this.namespaceMember(module, node, receiver, member, space);
          else { this.result.references.push(new BoundReference(module, node, this.result.files[module].nodeScopes[node], member, space, -1, -1, true)); receiver = -1; }
        }
        if (firstValue && firstName) this.namespaceValue(module, node, receiver);
        previous = "";
      } else { if (c != " ") previous = c; at = at + 1; }
    }
  }
  namespaceValue(module: number, node: number, receiver: number): void {
    const origin: number = this.origin(receiver);
    if (origin < 0 || (this.result.symbols[origin].namespaceModule) < 0) return;
    const parent: number = this.result.files[module].parents[node];
    if (parent >= 0) {
      const owner: AstNode = this.graph.modules[module].cached.result.ast.nodes[parent];
      if ((owner.kind == "MemberExpression" || owner.kind == "MemberCallExpression") && bindingChild(owner, "object") == node) return;
    }
    this.report(module, node, "Un namespace requiere un miembro estático; no es un valor runtime");
  }
  uses(module: number): void {
    const arena: AstNode[] = this.graph.modules[module].cached.result.ast.nodes;
    // Arena allocation order is not evaluation order. Child references are
    // resolved through their node IDs; only reachable nodes receive scopes.
    for (let id: number = 0; id < arena.length; id = id + 1) {
      const scope: number = this.result.files[module].nodeScopes[id]; if (scope < 0) continue;
      const node: AstNode = arena[id];
      if (node.kind == "IdentifierExpression" || node.kind == "GenericIdentifierExpression") {
        const parent: number = this.result.files[module].parents[id]; let typeOperand: boolean = false;
        if (parent >= 0) { const expression: AstNode = arena[parent]; typeOperand = expression.kind == "BinaryExpression" && expression.get("operator") == "instanceof" && bindingChild(expression,"right") == id; }
        if (typeOperand) this.typeReferences(module,id,node.get("name"),false);
        else { const symbol: number = this.reference(module, id, node.get("name"), "value"); this.namespaceValue(module, id, symbol); }
      } else if (node.kind == "CallExpression") {
        const symbol: number = this.reference(module, id, node.get("callee"), "value"); this.namespaceValue(module, id, symbol);
      }
      else if (node.kind == "NewExpression") this.typeReferences(module, id, node.get("className"), true);
      for (const attribute of node.attributes) {
        if (attribute.name == "declaredType" || attribute.name == "type" || attribute.name == "returnType" || attribute.name == "constraint" || attribute.name == "targetType" || attribute.name == "typeArgument" || attribute.name == "payload" || (node.kind == "TypeParameter" && attribute.name == "default")) this.typeReferences(module, id, attribute.value, false);
      }
    }
    // Resolve static namespace chains after lexical names, in dependency order
    // of expression nodes (parser allocates member parents after their object).
    for (let id: number = 0; id < arena.length; id = id + 1) {
      const node: AstNode = arena[id]; const scope: number = this.result.files[module].nodeScopes[id];
      if (scope < 0 || (node.kind != "MemberExpression" && node.kind != "MemberCallExpression")) continue;
      const object: number = bindingChild(node, "object"); let receiver: number = -1;
      for (const reference of this.result.references) { if (reference.module == module && reference.node == object && reference.space == "value" && !reference.deferred) receiver = reference.symbol; }
      const origin: number = this.origin(receiver);
      const member: string = node.kind == "MemberExpression" ? node.get("member") : node.get("method");
      if (origin >= 0 && this.result.symbols[origin].namespaceModule >= 0) {
        if (node.get("optional") == "true") this.report(module, id, "Un namespace no admite acceso opcional");
        const symbol: number = this.namespaceMember(module, id, receiver, member, "value"); this.namespaceValue(module, id, symbol);
      }
      else this.result.references.push(new BoundReference(module, id, scope, member, "member", -1, -1, true));
    }
  }
  bind(): BindingResult {
    this.result = new BindingResult();
    for (const diagnostic of this.graph.diagnostics) this.result.diagnostics.push(diagnostic);
    if (!this.graph.success) return this.result;
    this.scope(-1, -1, -1, "builtins");
    for (const name of bindingBuiltinValues()) this.declare(name, "builtin", 0, -1, -1, true, false);
    for (const name of bindingBuiltinTypes()) this.declare(name, "builtin-type", 0, -1, -1, false, true);
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) {
      const scope: number = this.scope(0, m, this.graph.modules[m].cached.result.ast.root, "module");
      this.result.files.push(new BoundFile(scope, this.graph.modules[m].cached.result.ast.nodes.length));
      this.collect(m);
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) { this.imports(m); this.moduleExports(m); }
    this.duplicates();
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) this.uses(m);
    for (const ref of this.result.references) if (ref.space == "value" && !ref.deferred && this.result.files[ref.module].valueTargets[ref.node] < 0) this.result.files[ref.module].valueTargets[ref.node] = ref.target;
    this.result.success = this.result.diagnostics.length == 0; return this.result;
  }
}
export function bindProject(graph: ModuleGraph): BindingResult {
  let binder: Binder = new Binder(graph); return binder.bind();
}

export function bindingBuiltinValues(): string[] { let names: string[] = ["i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64", "f32", "f64", "optionalIsPresent", "optionalValueOr", "optionalOrElse", "resultOk", "resultErr", "resultIsOk", "resultValueOr", "Date", "FileReader", "JSON", "Map", "Math", "Optional", "Promise", "Result", "Server", "Set", "__noExtend", "__noThrow", "acceptTcp", "acceptTcpUntil", "acceptTls", "all", "appendFile", "appendFileAsync", "appendFileUntil", "argument", "argumentCount", "asyncIoUringRead", "asyncIoUringWrite", "cancel", "cancelTimer", "cancellationToken", "charAt", "clearError", "closeTcp", "closeTls", "compileCpp", "compilerRoot", "comptime", "console", "constRef", "copyFile", "copyFileAsync", "copyFileUntil", "createCancellation", "createTlsServer", "ensureParentDirectory", "err", "estaticAstRecords", "estaticTypedAstJson", "estaticTypedAstRecords", "exitProcess", "fail", "fileAppend", "fileCopy", "fileExists", "fileExistsAsync", "fileMove", "fileRead", "fileRemove", "fileWrite", "fs", "hasError", "http", "indexOf", "ioUringAvailable", "ioUringRead", "ioUringWrite", "isCancelled", "jsonArrayGet", "jsonArrayLength", "jsonAsBool", "jsonAsNumber", "jsonAsString", "jsonEscape", "jsonIsArray", "jsonIsBool", "jsonIsNull", "jsonIsNumber", "jsonIsObject", "jsonIsString", "jsonObjectGet", "length", "lineAt", "lineCount", "listenTcp", "match", "move", "moveFile", "moveFileAsync", "moveFileUntil", "normalizePath", "numberToString", "ok", "openFileReader", "optionalNone", "optionalSome", "otherwise", "path", "pathDirectory", "print", "printError", "process", "promiseAll", "promiseRace", "race", "readFile", "readFileAsync", "readFileUntil", "readTcp", "readTcpUntil", "readTls", "ref", "removeFile", "removeFileAsync", "removeFileUntil", "resolveDns", "resolveImportPath", "resolveProjectPath", "retry", "setInterval", "setTimeout", "sleep", "spawn", "startsWith", "stopLoop", "substring", "syntaxTreeJson", "syntaxTreeRecords", "tcpAccept", "tcpClose", "tcpConnect", "tcpListen", "tcpRead", "tcpWrite", "timeout", "trim", "unwatchFs", "validateSyntax", "watchFs", "when", "whenType", "write", "writeError", "writeFile", "writeFileAsync", "writeFileUntil", "writeTcp", "writeTcpUntil", "writeTls"]; for (const name of nativeBuiltinNames()) if (!names.includes(name)) names.push(name); return names; }

export function bindingBuiltinTypes(): string[] { let names: string[] = ["Array", "ArrayLike", "CancellationSource", "CancellationToken", "Console", "Error", "FileReader", "FsEvent", "FsWatcher", "HttpClientResponse", "JsonValue", "Map", "MatchCase", "MatchCaseResult", "MatchDefaultCase", "MatchResult", "MatchTypeCase", "MatchValueCase", "NonThrowable", "Optional", "Phantom", "Promise", "Request", "Response", "Result", "Sealed", "Server", "Set", "StringInstance", "TcpConnection", "TcpListener", "Timer", "TlsConnection", "TlsContext", "boolean", "constPtr", "constRef", "f32", "f64", "i16", "i32", "i64", "i8", "number", "ptr", "readonly", "ref", "string", "u16", "u32", "u64", "u8", "void"]; for (const name of nativeBuiltinTypes()) if (!names.includes(name)) names.push(name); return names; }
