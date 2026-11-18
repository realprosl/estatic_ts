// Tipos derivados (Partial, Required, Pick, Omit) y resto de objeto ({ a, ...resto }).
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
      this.graph.modules[module].cached.result.ast.nodes.push(item);
      this.graph.modules[module].cached.result.ast.nodes[id].edges.push(new AstEdge(EdgeRole.Fields, this.graph.modules[module].cached.result.ast.nodes.length - 1));
    }
    if (kind == "Pick") for (const name of keys) if (!names.includes(name)) this.report(module, id, "Pick<" + source + ">: '" + source + "' no tiene el campo '" + name + "'");
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
