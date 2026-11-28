// Tipos derivados (Partial, Required, Readonly, Pick, Omit) y resto de objeto ({ a, ...resto }).
// El parser deja una interfaz sintética sin campos con Underlying = "Tipo#X#claves";
// antes de enlazar se le copian los campos de X (local o importado). El tipo de cada
// campo es una consulta ($fieldof$campo$X) que resuelve el checker en ese módulo,
// así sirve también con imports y genéricos (Box<number>).
import { diagnosticAt } from "../diag/index";
import { AttributeKind, EdgeRole, NodeKind, AstNode, AstAttribute, AstEdge, ParserToken } from "../parser/index";
import { ModuleGraph } from "../modules/index";

export class DerivedExpander {
  graph: ModuleGraph; visited: string[]; foundModule: number; foundNode: number;
  constructor(graph: ModuleGraph) { this.graph = graph; this.visited = []; this.foundModule = -1; this.foundNode = -1; }
  report(module: number, node: number, message: string): void {
    this.graph.diagnostics.push(diagnosticAt("binder", message, this.graph.modules[module].file, this.graph.modules[module].cached.result.ast.nodes[node]));
  }
  // Declaración de nivel superior con ese nombre (en foundModule/foundNode).
  find(module: number, name: string): boolean {
    const root: number = this.graph.modules[module].cached.result.ast.root;
    for (const edge of this.graph.modules[module].cached.result.ast.nodes[root].edges) {
      const node: AstNode = this.graph.modules[module].cached.result.ast.nodes[edge.node];
      if ((node.kind == NodeKind.InterfaceDeclaration || node.kind == NodeKind.ClassDeclaration || node.kind == NodeKind.TypeAliasDeclaration) && node.get(AttributeKind.Name) == name) { this.foundModule = module; this.foundNode = edge.node; return true; }
    }
    for (const request of this.graph.modules[module].requests) {
      const node: AstNode = this.graph.modules[module].cached.result.ast.nodes[request.node]; if (node.kind != NodeKind.ImportDeclaration) continue;
      for (const edge of node.edges) if (edge.role == EdgeRole.Specifiers) {
        const specifier: AstNode = this.graph.modules[module].cached.result.ast.nodes[edge.node];
        if (specifier.get(AttributeKind.Local) != name || specifier.get(AttributeKind.Form) == "namespace") continue;
        for (let at: number = 0; at < this.graph.modules.length; at = at + 1) if (this.graph.modules[at].file == request.dependency) return this.find(at, specifier.get(AttributeKind.Imported));
      }
    }
    return false;
  }
  // La declaración con campos de un tipo, siguiendo alias (en foundModule/foundNode).
  shape(module: number, text: string): boolean {
    let name: string = text; const open: number = name.indexOf("<", 0); if (open > 0) name = name.slice(0, open);
    if (!this.find(module, name)) return false;
    const where: number = this.foundModule; const at: number = this.foundNode; const node: AstNode = this.graph.modules[where].cached.result.ast.nodes[at];
    if (node.kind == NodeKind.TypeAliasDeclaration) return this.shape(where, node.get(AttributeKind.Type));
    if (node.get(AttributeKind.Underlying) != "") this.expand(where, at);
    this.foundModule = where; this.foundNode = at; return true;
  }
  expand(module: number, id: number): void {
    const key: string = numberToString(module) + ":" + numberToString(id);
    if (this.visited.includes(key)) return; this.visited.push(key);
    for (const edge of this.graph.modules[module].cached.result.ast.nodes[id].edges) if (edge.role == EdgeRole.Fields) return;
    const parts: string[] = this.graph.modules[module].cached.result.ast.nodes[id].get(AttributeKind.Underlying).split("#");
    if (parts.length < 3) return;
    const kind: string = parts[0]; const source: string = parts[1]; let keys: string[] = []; if (parts[2] != "") keys = parts[2].split(",");
    if (kind == "Mapped") { this.mapped(module, id, source); return; }
    if (kind == "Record") {
      for (const name of keys) {
        let item: AstNode = new AstNode(NodeKind.InterfaceField, this.graph.modules[module].cached.result.ast.nodes[id].start, this.graph.modules[module].cached.result.ast.nodes[id].end);
        item.attributes.push(new AstAttribute(AttributeKind.Name, name)); item.attributes.push(new AstAttribute(AttributeKind.Type, source)); item.attributes.push(new AstAttribute(AttributeKind.Optional, "false"));
        this.graph.modules[module].cached.result.ast.nodes.push(item);
        this.graph.modules[module].cached.result.ast.nodes[id].edges.push(new AstEdge(EdgeRole.Fields, this.graph.modules[module].cached.result.ast.nodes.length - 1));
      }
      return;
    }
    if (!this.shape(module, source)) { this.report(module, id, kind + "<" + source + ">: '" + source + "' tiene que ser una interfaz, una clase o un tipo objeto con nombre"); return; }
    const where: number = this.foundModule; const at: number = this.foundNode; let names: string[] = [];
    for (const edge of this.graph.modules[where].cached.result.ast.nodes[at].edges) if (edge.role == EdgeRole.Fields) {
      const field: AstNode = this.graph.modules[where].cached.result.ast.nodes[edge.node]; if (field.get(AttributeKind.IsStatic) == "true") continue;
      const name: string = field.get(AttributeKind.Name); names.push(name);
      if (kind == "Pick" && !keys.includes(name)) continue;
      if (kind == "Omit" && keys.includes(name)) continue;
      let optional: string = field.get(AttributeKind.Optional) == "true" ? "true" : "false";
      if (kind == "Partial") optional = "true"; if (kind == "Required") optional = "false";
      let item: AstNode = new AstNode(NodeKind.InterfaceField, this.graph.modules[module].cached.result.ast.nodes[id].start, this.graph.modules[module].cached.result.ast.nodes[id].end);
      item.attributes.push(new AstAttribute(AttributeKind.Name, name));
      item.attributes.push(new AstAttribute(AttributeKind.Type, (kind == "Required" ? "$fieldreq$" : "$fieldof$") + name + "$" + source));
      item.attributes.push(new AstAttribute(AttributeKind.Optional, optional));
      if (kind == "Readonly" || field.get(AttributeKind.Readonly) == "true") item.attributes.push(new AstAttribute(AttributeKind.Readonly, "true"));
      this.graph.modules[module].cached.result.ast.nodes.push(item);
      this.graph.modules[module].cached.result.ast.nodes[id].edges.push(new AstEdge(EdgeRole.Fields, this.graph.modules[module].cached.result.ast.nodes.length - 1));
    }
    if (kind == "Pick") for (const name of keys) if (!names.includes(name)) this.report(module, id, "Pick<" + source + ">: '" + source + "' no tiene el campo '" + name + "'");
  }
  // #226: { [K in claves]: valor } con la especificación claves~modificadores~valor.
  // Con keyof X (homomórfico) cada campo hereda opcional y readonly de X salvo que
  // los modificadores digan otra cosa (dígitos: 0 igual, 1 añade, 2 quita).
  mapped(module: number, id: number, spec: string): void {
    const pieces: string[] = spec.split("~"); if (pieces.length < 3) return;
    const keysText: string = pieces[0].trim(); const mods: string = pieces[1]; let value: string = pieces[2];
    for (let at: number = 3; at < pieces.length; at = at + 1) value = value + "~" + pieces[at];
    let names: string[] = []; let optionals: boolean[] = []; let readonlys: boolean[] = [];
    if (keysText.startsWith("keyof<") && keysText.endsWith(">")) {
      const source: string = keysText.slice(6, keysText.length - 1);
      if (!this.shape(module, source)) { this.report(module, id, "keyof " + source + " en un mapped type: '" + source + "' tiene que ser una interfaz, una clase o un tipo objeto con nombre"); return; }
      const where: number = this.foundModule; const at: number = this.foundNode;
      for (const edge of this.graph.modules[where].cached.result.ast.nodes[at].edges) if (edge.role == EdgeRole.Fields) {
        const field: AstNode = this.graph.modules[where].cached.result.ast.nodes[edge.node]; if (field.get(AttributeKind.IsStatic) == "true") continue;
        names.push(field.get(AttributeKind.Name)); optionals.push(field.get(AttributeKind.Optional) == "true"); readonlys.push(field.get(AttributeKind.Readonly) == "true");
      }
    } else {
      for (const part of keysText.split("|")) {
        const key: string = part.trim();
        if (!key.startsWith("$lit:string=")) { this.report(module, id, "Las claves de un mapped type tienen que ser keyof T o literales de string (\"a\" | \"b\")"); return; }
        names.push(key.slice(12, key.length)); optionals.push(false); readonlys.push(false);
      }
    }
    for (let at: number = 0; at < names.length; at = at + 1) {
      const optional: boolean = mods.charAt(1) == "1" ? true : mods.charAt(1) == "2" ? false : optionals[at];
      const fixed: boolean = mods.charAt(0) == "1" ? true : mods.charAt(0) == "2" ? false : readonlys[at];
      let item: AstNode = new AstNode(NodeKind.InterfaceField, this.graph.modules[module].cached.result.ast.nodes[id].start, this.graph.modules[module].cached.result.ast.nodes[id].end);
      item.attributes.push(new AstAttribute(AttributeKind.Name, names[at]));
      item.attributes.push(new AstAttribute(AttributeKind.Type, mappedValue(value, names[at], mods.charAt(1) == "2")));
      item.attributes.push(new AstAttribute(AttributeKind.Optional, optional ? "true" : "false"));
      if (fixed) item.attributes.push(new AstAttribute(AttributeKind.Readonly, "true"));
      this.graph.modules[module].cached.result.ast.nodes.push(item);
      this.graph.modules[module].cached.result.ast.nodes[id].edges.push(new AstEdge(EdgeRole.Fields, this.graph.modules[module].cached.result.ast.nodes.length - 1));
    }
  }
  // #226: Alias<Args> con un alias genérico cuyo cuerpo es un mapped type
  // ($mapped<…>) se sustituye por una interfaz derivada en el módulo que lo usa.
  instantiateMapped(module: number, text: string, token: ParserToken): string {
    let result: string = text; let from: number = 0;
    while (from < result.length) {
      const open: number = result.indexOf("<", from); if (open < 0) break;
      let start: number = open; while (start > 0 && wordChar(result.charCodeAt(start - 1))) start = start - 1;
      const name: string = result.slice(start, open); let depth: number = 0; let close: number = -1;
      for (let at: number = open; at < result.length && close < 0; at = at + 1) { const code: number = result.charCodeAt(at); if (code == 60) depth = depth + 1; else if (code == 62 && result.charCodeAt(at - 1) != 61) { depth = depth - 1; if (depth == 0) close = at; } }
      if (name == "" || close < 0 || !this.find(module, name)) { from = open + 1; continue; }
      const where: number = this.foundModule; const at: number = this.foundNode; const alias: AstNode = this.graph.modules[where].cached.result.ast.nodes[at];
      const body: string = alias.get(AttributeKind.Type);
      if (alias.kind != NodeKind.TypeAliasDeclaration || !body.startsWith("$mapped<") || !body.endsWith(">")) { from = open + 1; continue; }
      let params: string[] = []; for (const edge of alias.edges) if (edge.role == EdgeRole.TypeParameters) params.push(this.graph.modules[where].cached.result.ast.nodes[edge.node].get(AttributeKind.Name));
      const args: string[] = topLevelArguments(this.instantiateMapped(module, result.slice(open + 1, close), token));
      let spec: string = body.slice(8, body.length - 1);
      for (let p: number = 0; p < params.length && p < args.length; p = p + 1) spec = replaceWord(spec, params[p], args[p]);
      const derived: string = this.mappedInterface(module, spec, token);
      result = result.slice(0, start) + derived + result.slice(close + 1, result.length); from = start + derived.length;
    }
    return result;
  }
  // La interfaz "Mapped" de esa especificación en el módulo (la misma especificación, el mismo nombre).
  mappedInterface(module: number, spec: string, token: ParserToken): string {
    const key: string = "Mapped#" + spec + "#"; let hash: number = 0;
    for (let at: number = 0; at < key.length; at = at + 1) hash = (hash * 31 + key.charCodeAt(at)) % 4294967296;
    const name: string = "__Mapped_" + numberToString(hash);
    const root: number = this.graph.modules[module].cached.result.ast.root;
    for (const edge of this.graph.modules[module].cached.result.ast.nodes[root].edges) if (this.graph.modules[module].cached.result.ast.nodes[edge.node].get(AttributeKind.Name) == name) return name;
    let declaration: AstNode = new AstNode(NodeKind.InterfaceDeclaration, token, token);
    declaration.attributes.push(new AstAttribute(AttributeKind.Name, name)); declaration.attributes.push(new AstAttribute(AttributeKind.Underlying, key));
    this.graph.modules[module].cached.result.ast.nodes.push(declaration);
    this.graph.modules[module].cached.result.ast.nodes[root].edges.push(new AstEdge(EdgeRole.Statements, this.graph.modules[module].cached.result.ast.nodes.length - 1));
    return name;
  }
  // resto = { c: fuente.c, … }: el literal marcado con la fuente toma los campos del Omit.
  rest(module: number, id: number): void {
    for (const edge of this.graph.modules[module].cached.result.ast.nodes[id].edges) if (edge.role == EdgeRole.Properties) return;
    if (!this.find(module, this.graph.modules[module].cached.result.ast.nodes[id].get(AttributeKind.DeclaredType))) return;
    const where: number = this.foundModule; const at: number = this.foundNode; this.expand(where, at);
    const source: string = this.graph.modules[module].cached.result.ast.nodes[id].get(AttributeKind.Underlying);
    let fields: string[] = []; for (const edge of this.graph.modules[where].cached.result.ast.nodes[at].edges) if (edge.role == EdgeRole.Fields) fields.push(this.graph.modules[where].cached.result.ast.nodes[edge.node].get(AttributeKind.Name));
    for (const name of fields) {
      const start: ParserToken = this.graph.modules[module].cached.result.ast.nodes[id].start; const end: ParserToken = this.graph.modules[module].cached.result.ast.nodes[id].end;
      let object: AstNode = new AstNode(NodeKind.IdentifierExpression, start, end); object.attributes.push(new AstAttribute(AttributeKind.Name, source));
      this.graph.modules[module].cached.result.ast.nodes.push(object); const objectId: number = this.graph.modules[module].cached.result.ast.nodes.length - 1;
      let member: AstNode = new AstNode(NodeKind.MemberExpression, start, end); member.attributes.push(new AstAttribute(AttributeKind.Optional, "false"));
      member.attributes.push(new AstAttribute(AttributeKind.Member, name)); member.edges.push(new AstEdge(EdgeRole.Object, objectId));
      this.graph.modules[module].cached.result.ast.nodes.push(member); const memberId: number = this.graph.modules[module].cached.result.ast.nodes.length - 1;
      let property: AstNode = new AstNode(NodeKind.ObjectProperty, start, end); property.attributes.push(new AstAttribute(AttributeKind.Key, name)); property.edges.push(new AstEdge(EdgeRole.Value, memberId));
      this.graph.modules[module].cached.result.ast.nodes.push(property);
      this.graph.modules[module].cached.result.ast.nodes[id].edges.push(new AstEdge(EdgeRole.Properties, this.graph.modules[module].cached.result.ast.nodes.length - 1));
    }
  }
  run(): void {
    // #226: primero los usos de alias con mapped types (crean interfaces "Mapped").
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) {
      if (!this.graph.modules[m].cached.result.success) continue;
      const count: number = this.graph.modules[m].cached.result.ast.nodes.length;
      for (let at: number = 0; at < count; at = at + 1) {
        const kind: NodeKind = this.graph.modules[m].cached.result.ast.nodes[at].kind;
        for (let k: number = 0; k < this.graph.modules[m].cached.result.ast.nodes[at].attributes.length; k = k + 1) {
          const name: AttributeKind = this.graph.modules[m].cached.result.ast.nodes[at].attributes[k].name;
          if (!(name == AttributeKind.DeclaredType || name == AttributeKind.Type || name == AttributeKind.ReturnType || name == AttributeKind.Constraint || name == AttributeKind.TargetType || name == AttributeKind.TypeArgument || name == AttributeKind.Payload || (name == AttributeKind.Default && kind == NodeKind.TypeParameter) || (name == AttributeKind.Underlying && kind == NodeKind.InterfaceDeclaration))) continue;
          const text: string = this.graph.modules[m].cached.result.ast.nodes[at].attributes[k].value;
          if (text.indexOf("<", 0) < 0 || kind == NodeKind.TypeAliasDeclaration && text.startsWith("$mapped<")) continue;
          const expanded: string = this.instantiateMapped(m, text, this.graph.modules[m].cached.result.ast.nodes[at].start);
          if (expanded != text) this.graph.modules[m].cached.result.ast.nodes[at].attributes[k].value = expanded;
        }
      }
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) {
      if (!this.graph.modules[m].cached.result.success) continue;
      const count: number = this.graph.modules[m].cached.result.ast.nodes.length;
      for (let at: number = 0; at < count; at = at + 1) {
        const node: AstNode = this.graph.modules[m].cached.result.ast.nodes[at];
        if (node.kind == NodeKind.InterfaceDeclaration && node.get(AttributeKind.Underlying) != "") this.expand(m, at);
        else if (node.kind == NodeKind.ObjectLiteralExpression && node.get(AttributeKind.Underlying) != "") this.rest(m, at);
      }
    }
  }
}
// Devuelve el grafo con los campos añadidos (y sus diagnósticos en graph.diagnostics).
export function expandDerivedTypes(graph: ModuleGraph): ModuleGraph {
  let expander: DerivedExpander = new DerivedExpander(graph); expander.run(); return expander.graph;
}

function wordChar(code: number): boolean { return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code == 95 || code == 36; }
// `word` como identificador completo → `replacement`.
function replaceWord(text: string, word: string, replacement: string): string {
  let result: string = ""; let at: number = 0;
  while (at < text.length) {
    if (text.startsWith(word, at) && (at == 0 || !wordChar(text.charCodeAt(at - 1))) && (at + word.length >= text.length || !wordChar(text.charCodeAt(at + word.length)))) { result = result + replacement; at = at + word.length; continue; }
    result = result + text.charAt(at); at = at + 1;
  }
  return result;
}
// Argumentos de tipo separados por comas de primer nivel.
function topLevelArguments(text: string): string[] {
  let result: string[] = []; let depth: number = 0; let start: number = 0;
  for (let at: number = 0; at < text.length; at = at + 1) {
    const code: number = text.charCodeAt(at);
    if (code == 60 || code == 40 || code == 91) depth = depth + 1; else if ((code == 62 && (at == 0 || text.charCodeAt(at - 1) != 61)) || code == 41 || code == 93) depth = depth - 1;
    else if (code == 44 && depth == 0) { result.push(text.slice(start, at).trim()); start = at + 1; }
  }
  result.push(text.slice(start, text.length).trim()); return result;
}
// El tipo del campo `name`: X[$key$] → el tipo de ese campo en X ($fieldof$/$fieldreq$),
// y la clave suelta ($key$) → el literal de string con el nombre.
function mappedValue(value: string, name: string, required: boolean): string {
  let result: string = value;
  while (true) {
    const at: number = result.indexOf("[$key$]", 0); if (at < 0) break;
    let start: number = at;
    if (start > 0 && result.charCodeAt(start - 1) == 62) {
      let depth: number = 0; start = start - 1;
      while (start >= 0) { const code: number = result.charCodeAt(start); if (code == 62) depth = depth + 1; else if (code == 60) { depth = depth - 1; if (depth == 0) break; } start = start - 1; }
    }
    while (start > 0 && (wordChar(result.charCodeAt(start - 1)) || result.charCodeAt(start - 1) == 46)) start = start - 1;
    result = result.slice(0, start) + (required ? "$fieldreq$" : "$fieldof$") + name + "$" + result.slice(start, at) + result.slice(at + 7, result.length);
  }
  return replaceWord(result, "$key$", "$lit:string=" + name);
}
