// #200: operadores definidos en clases ("+"(o: T): T). El checker convierte el
// nodo del operador en la llamada object."op"(args) y la tipa como tal; así los
// efectos, los préstamos y el IR ven una llamada a método normal. El checker
// trabaja sobre su copia del grafo: el IR repite la conversión en el suyo a partir
// de lo que resolvió el checker (members[id]).
import { AttributeKind, EdgeRole, NodeKind, AstAttribute, AstEdge } from "../parser/index";
import { ModuleGraph } from "../modules/index";

// El nodo `id` pasa a ser la llamada object."op"(args).
export function rewriteOperatorCall(graph: ref<ModuleGraph>, module: number, id: number, op: string, object: number, args: number[]): void {
  let edges: AstEdge[] = [new AstEdge(EdgeRole.Object, object)]; for (const arg of args) edges.push(new AstEdge(EdgeRole.Args, arg));
  graph.modules[module].cached.result.ast.nodes[id].kind = NodeKind.MemberCallExpression;
  graph.modules[module].cached.result.ast.nodes[id].attributes = [new AstAttribute(AttributeKind.Method, op), new AstAttribute(AttributeKind.Optional, "false")];
  graph.modules[module].cached.result.ast.nodes[id].edges = edges;
}
