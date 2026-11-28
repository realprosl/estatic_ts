import { AttributeKind, EdgeRole, NodeKind, attributeKindName, edgeRoleName, nodeKindName, operatorMethodNames } from "./ast-schema";
// Bootstrap parser. Tokens are supplied by the caller; no lexer/checker imports.
// An arena owns all nodes. Edges are indices, so recursive ASTs need no cycles.

// Escapa el valor de un literal de tipo. El parser no importa del checker, asi
// que esta copia local mantiene la misma forma canonica que `checker/types`.
export function escapeLiteralValue(value: string): string {
  let result: string = "";
  for (let at: number = 0; at < value.length; at = at + 1) {
    const c: string = value.charAt(at);
    if (c == "\\") result = result + "\\\\";
    else if (c == "|") result = result + "\\|";
    else if (c == "=") result = result + "\\=";
    else result = result + c;
  }
  return result;
}

export class ParserToken {
  kind: string; lexeme: string;
  offset: number; line: number; column: number;
  endOffset: number; endLine: number; endColumn: number;
  constructor(kind: string, lexeme: string, offset: number, line: number, column: number,
              endOffset: number, endLine: number, endColumn: number) {
    this.kind = kind; this.lexeme = lexeme; this.offset = offset; this.line = line; this.column = column;
    this.endOffset = endOffset; this.endLine = endLine; this.endColumn = endColumn;
  }
}
export class AstAttribute {
  name: AttributeKind; value: string;
  constructor(name: AttributeKind, value: string) { this.name = name; this.value = value; }
}
export class AstEdge {
  role: EdgeRole; node: number;
  constructor(role: EdgeRole, node: number) { this.role = role; this.node = node; }
}
export class AstNode {
  kind: NodeKind; start: ParserToken; end: ParserToken; analysisStart: number; analysisEnd: number; generatedId: string; generatedStart: ParserToken; generatedEnd: ParserToken;
  attributes: AstAttribute[]; edges: AstEdge[];
  constructor(kind: NodeKind, start: ParserToken, end: ParserToken) {
    this.kind = kind; this.start = start; this.end = end; this.attributes = []; this.edges = []; this.analysisStart = -1; this.analysisEnd = -1; this.generatedId = ""; this.generatedStart = start; this.generatedEnd = end;
  }
  attr(name: AttributeKind, value: string): void { this.attributes.push(new AstAttribute(name, value)); }
  edge(role: EdgeRole, node: number): void { this.edges.push(new AstEdge(role, node)); }
  get(name: AttributeKind): string {
    for (const field of this.attributes) { if (field.name == name) return field.value; }
    return "";
  }
}
export function nodeBegin(node: AstNode): number { return node.analysisStart >= 0 ? node.analysisStart : node.start.offset; }
export function nodeEnd(node: AstNode): number { return node.analysisEnd >= 0 ? node.analysisEnd : node.end.endOffset; }
// Datos para el catálogo de mensajes (messages/<idioma>.json): líneas
// "\t nombre=valor" al final del mensaje. Copia local del formato de
// frontend/catalog.ets para que el parser no dependa de nada más.
function catalogArg(name: string, value: string): string { return "\n\t" + name + "=" + value; }
function catalogVariant(variant: string): string { return catalogArg("_variante", variant); }
function tokenArg(name: string, kind: string, lexeme: string): string { return catalogArg(name, "tok:" + kind + ":" + lexeme); }

export class ParserDiagnostic {
  message: string; token: ParserToken;
  constructor(message: string, token: ParserToken) { this.message = message; this.token = token; }
}
export class ParseResult {
  root: number; nodes: AstNode[]; diagnostics: ParserDiagnostic[];
  constructor(root: number, nodes: AstNode[], diagnostics: ParserDiagnostic[]) {
    this.root = root; this.nodes = nodes; this.diagnostics = diagnostics;
  }
}

function jsonSpace(code: number): boolean { return code == 32 || code == 9 || code == 10 || code == 13; }
function bindingChildOf(node: AstNode, role: EdgeRole): number { for (const edge of node.edges) if (edge.role == role) return edge.node; return -1; }
// Orden de dos textos por código de carácter (para las formas de los tipos objeto).
function compareText(a: string, b: string): number {
  const size: number = a.length < b.length ? a.length : b.length;
  for (let at: number = 0; at < size; at = at + 1) { const difference: number = a.charCodeAt(at) - b.charCodeAt(at); if (difference != 0) return difference; }
  return a.length - b.length;
}
export class Parser {
  tokens: ParserToken[]; current: number; nodes: AstNode[]; diagnostics: ParserDiagnostic[];
  nesting: number; exhausted: boolean;
  // `const T&` / `const T*`: el `const` inicial espera al primer `&` o `*`
  // del mismo tipo (ver typeSuffix). typeName lo aisla de los tipos anidados.
  constMemory: boolean;
  // #223: tipos objeto { a: T; b?: U } convertidos en interfaces sintéticas, una
  // por forma (se añaden al final del programa).
  objectTypes: number[]; objectTypeNames: string[];
  // #223: parámetros desestructurados ({ a, b = 1 }: T): la declaración del
  // patrón se añade al principio del cuerpo de su función.
  patternOwners: number[]; patternDeclarations: number[];
  // #223: declaraciones extra de un patrón (anidados y resto), antes o después
  // de la sentencia que lo contiene.
  extraOwners: number[]; extraNodes: number[]; extraBefore: boolean[];
  // Resto de array pendiente de la fuente: patrón, nombre del resto y posición.
  restOwners: number[]; restNames: ParserToken[]; restIndexes: number[];
  // Variables visibles con su tipo anotado ("" si no lo tiene), para el resto de
  // objeto sin anotar (const { a, ...resto } = p con p: P). pendingNames/Types son
  // los parámetros que entran en el próximo bloque (el cuerpo de la función).
  scopeNames: string[]; scopeTypes: string[]; pendingNames: string[]; pendingTypes: string[];
  // keyof T: el operando no se lleva el `| U` de detrás (keyof A | B es (keyof A) | B).
  typeOperand: boolean;
  // #227/#228: parámetros del alias que se está leyendo (un `T extends …` sobre uno
  // de ellos se distribuye sobre uniones) y nombres de `infer` visibles.
  aliasParams: string[]; inferCollecting: boolean; inferNames: string[]; inferVisible: string[];
  // #226: la variable de clave de un mapped type ({ [K in …]: … }) se escribe $key$.
  mappedKey: string;
  jsonAt: number;
  // Nombres locales importados de "estatic:json": la clase (JSON) y parse.
  jsonClasses: string[]; jsonParsers: string[];
  constructor(tokens: ParserToken[]) {
    this.tokens = tokens; this.current = 0; this.nodes = []; this.diagnostics = [];
    this.nesting = 0; this.exhausted = false; this.constMemory = false; this.objectTypes = []; this.objectTypeNames = []; this.patternOwners = []; this.patternDeclarations = []; this.extraOwners = []; this.extraNodes = []; this.extraBefore = []; this.restOwners = []; this.restNames = []; this.restIndexes = []; this.typeOperand = false; this.aliasParams = []; this.inferCollecting = false; this.inferNames = []; this.inferVisible = []; this.mappedKey = ""; this.scopeNames = []; this.scopeTypes = []; this.pendingNames = []; this.pendingTypes = []; this.jsonAt = 0; this.jsonClasses = []; this.jsonParsers = [];
    if (tokens.length == 0) {
      this.tokens.push(new ParserToken("eof", "", 0, 1, 1, 0, 1, 1));
      this.report("La entrada de tokens necesita un eof final");
    } else if (tokens[tokens.length - 1].kind != "eof") {
      const last: ParserToken = tokens[tokens.length - 1];
      this.tokens.push(new ParserToken("eof", "", last.endOffset, last.endLine, last.endColumn,
                                      last.endOffset, last.endLine, last.endColumn));
      this.report("La entrada de tokens necesita un eof final");
    }
    for (let i: number = 0; i + 1 < this.tokens.length; i = i + 1) {
      if (this.tokens[i].kind == "eof") {
        this.current = i; this.report("eof solo puede aparecer al final de los tokens"); this.current = 0; break;
      }
    }
    for (let i: number = 0; i < this.tokens.length; i = i + 1) {
      const token: ParserToken = this.tokens[i];
      if (!this.coordinate(token.offset, 0) || !this.coordinate(token.endOffset, 0)
          || !this.coordinate(token.line, 1) || !this.coordinate(token.endLine, 1)
          || !this.coordinate(token.column, 1) || !this.coordinate(token.endColumn, 1)) {
        this.reportAt(token, "Las coordenadas de tokens deben ser enteros válidos de 32 bits");
      } else if (!this.ordered(token.offset, token.line, token.column, token.endOffset, token.endLine, token.endColumn)) {
        this.reportAt(token, "El span del token tiene posiciones inconsistentes");
      }
      if (token.kind == "eof" && (token.offset != token.endOffset || token.line != token.endLine || token.column != token.endColumn))
        this.reportAt(token, "El token eof debe tener un span vacío");
      if (i > 0) {
        const previous: ParserToken = this.tokens[i - 1];
        if (!this.ordered(previous.endOffset, previous.endLine, previous.endColumn, token.offset, token.line, token.column))
          this.reportAt(token, "Los tokens deben estar ordenados y no solaparse");
      }
    }
  }
  coordinate(value: number, minimum: number): boolean {
    return value >= minimum && value <= 2147483647 && value % 1 == 0;
  }
  ordered(offset: number, line: number, column: number, endOffset: number, endLine: number, endColumn: number): boolean {
    if (endOffset < offset || endLine < line) return false;
    if (endOffset == offset) return line == endLine && column == endColumn;
    if (endLine == line) return endColumn - column == endOffset - offset;
    return endOffset - offset >= endLine - line;
  }
  peek(ahead: number): ParserToken { return this.tokens[Math.min(this.current + ahead, this.tokens.length - 1)]; }
  previous(): ParserToken { return this.tokens[Math.max(0, this.current - 1)]; }
  check(kind: string): boolean { return this.peek(0).kind == kind; }
  take(): ParserToken {
    const token: ParserToken = this.peek(0);
    if (!this.check("eof")) this.current = this.current + 1;
    return token;
  }
  accept(kind: string): boolean { if (!this.check(kind)) return false; this.take(); return true; }
  report(message: string): void {
    this.reportAt(this.peek(0), message);
  }
  reportAt(token: ParserToken, message: string): void {
    if (100 > this.diagnostics.length) this.diagnostics.push(new ParserDiagnostic(message, token));
  }
  // `: Tipo` de retorno obligatorio. Sin él se da un solo error que dice qué
  // falta, en vez de "Se esperaba ':'" seguido de "Se esperaba un tipo".
  returnType(subject: string): string {
    if (this.accept(":")) return this.typeName();
    this.report(this.missingReturnType(subject)); return "<error>";
  }
  missingReturnType(subject: string): string {
    // subject: "La función 'f'", "La función" o "El método 'm'".
    const quote: number = subject.indexOf("'",0); const name: string = quote < 0 ? "" : subject.slice(quote+1,subject.length-1);
    const variant: string = subject.startsWith("El método") ? catalogVariant("metodo") : (quote < 0 ? catalogVariant("anonima") : "");
    return "E1002: " + subject + " necesita un tipo de retorno: añade ': Tipo' después de los parámetros (por ejemplo ': void' o ': number')" + catalogArg("nombre", name) + variant;
  }
  // Cierre de argumentos de tipo (#194): `Map<string,number>=x` llega como
  // `>=` y `Array<Array<T>>=x` como `>` `>=`; se parte el token y se deja el
  // resto (`=`, `>=`) como siguiente.
  closeAngle(): ParserToken {
    const token: ParserToken = this.peek(0);
    if ((token.kind == ">=" || token.kind == ">>=") && token.endOffset > token.offset) {
      const rest: string = token.kind.slice(1, token.kind.length);
      const close: ParserToken = new ParserToken(">", ">", token.offset, token.line, token.column, token.offset + 1, token.line, token.column + 1);
      this.tokens[this.current] = new ParserToken(rest, rest, token.offset + 1, token.line, token.column + 1, token.endOffset, token.endLine, token.endColumn);
      // #369: `Promise<void>=>` llega como `>=` `>`: el `=` que queda y el `>`
      // contiguo forman la flecha `=>`.
      const next: ParserToken = this.peek(1);
      if (rest == "=" && next.kind == ">" && next.offset == token.endOffset) {
        this.tokens[this.current] = new ParserToken("=>", "=>", token.offset + 1, token.line, token.column + 1, next.endOffset, next.endLine, next.endColumn);
        for (let at: number = this.current + 1; at + 1 < this.tokens.length; at = at + 1) this.tokens[at] = this.tokens[at + 1];
        this.tokens.pop();
      }
      return close;
    }
    return this.expect(">");
  }
  expect(kind: string): ParserToken {
    if (this.check(kind)) return this.take();
    this.report("E1001: Se esperaba " + this.describeKind(kind) + " y se encontró " + this.found() + this.expectedArg(kind) + this.foundArg());
    return this.peek(0);
  }
  // Descripción legible del token actual: "'{'", "el final del fichero", ...
  found(): string {
    const token: ParserToken = this.peek(0);
    if (token.kind == "eof") return "el final del fichero";
    if (token.kind == "newline") return "un salto de línea";
    if (token.kind == "identifier") return "el identificador '" + token.lexeme + "'";
    if (token.kind == "string") return "un texto";
    if (token.kind == "number") return "el número " + token.lexeme;
    return "'" + token.lexeme + "'";
  }
  // Datos del token para el catálogo de mensajes (driver/diagnostics.ts).
  foundArg(): string { const token: ParserToken = this.peek(0); return tokenArg("encontrado", token.kind, token.lexeme); }
  expectedArg(kind: string): string { return tokenArg("esperado", ["identifier","string","number"].includes(kind) ? kind + "?" : "lexeme", kind); }
  describeKind(kind: string): string {
    if (kind == "identifier") return "un nombre";
    if (kind == "string") return "un texto entre comillas";
    if (kind == "number") return "un número";
    return "'" + kind + "'";
  }
  enter(): boolean {
    if (this.nesting >= 128) {
      this.report("Límite de anidamiento del parser (128)"); this.exhausted = true;
      this.current = this.tokens.length - 1; return false;
    }
    this.nesting = this.nesting + 1; return true;
  }
  leave(): void { this.nesting = this.nesting - 1; }
  add(kind: NodeKind, start: ParserToken, end: ParserToken): number {
    this.nodes.push(new AstNode(kind, start, end)); return this.nodes.length - 1;
  }
  node(cursor: number): AstNode { return this.nodes[cursor]; }
  attr(cursor: number, name: AttributeKind, value: string): void { this.nodes[cursor].attributes.push(new AstAttribute(name, value)); }
  edge(cursor: number, role: EdgeRole, child: number): void { this.nodes[cursor].edges.push(new AstEdge(role, child)); }
  get(cursor: number, name: AttributeKind): string { return this.nodes[cursor].get(name); }
  setEnd(cursor: number, end: ParserToken): void { this.nodes[cursor].end = end; }
  setKind(cursor: number, kind: NodeKind): void { this.nodes[cursor].kind = kind; }
  skipNewlines(): void { while (this.accept("newline")) {} }
  terminator(): ParserToken {
    if (this.check(";") || this.check("newline")) return this.take();
    // ASI: preserve a physical line break when the token stream omits newlines.
    const previousLine: number = this.previous().endLine;
    const nextLine: number = this.peek(0).line;
    if (previousLine < nextLine) return this.previous();
    if (!this.check("}") && !this.check("eof") && !this.check(",")) this.report("E1003: Falta ';' o un salto de línea al final de la sentencia: se encontró " + this.found() + this.foundArg());
    return this.peek(0);
  }
  parseProgram(): ParseResult {
    const start: ParserToken = this.peek(0);
    const program: number = this.add(NodeKind.Program, start, start);
    this.skipNewlines();
    if (this.headerAhead()) {
      const header: number = this.add(NodeKind.ModuleHeaderDeclaration, this.peek(0), this.peek(0));
      while (this.headerAhead()) {
        const decorator: number = this.singleDecorator();
        this.edge(header, EdgeRole.Decorators, decorator); this.setEnd(header, this.node(decorator).end);
        this.skipNewlines();
      }
      this.edge(program, EdgeRole.Statements, header);
    }
    while (!this.check("eof")) {
      this.skipNewlines();
      if (this.check("eof")) break;
      if (!this.accept(";")) {
        const before: number = this.current;
        const child: number = this.statement(true);
        this.pushStatement(program, EdgeRole.Statements, child);
        if (this.current == before && !this.check("eof")) { this.report("E1006: No se esperaba " + this.found() + " aquí" + this.foundArg()); this.take(); }
      }
    }
    for (const objectType of this.objectTypes) this.edge(program, EdgeRole.Statements, objectType);
    this.setEnd(program, this.peek(0));
    return new ParseResult(program, this.nodes, this.diagnostics);
  }
  headerAhead(): boolean {
    return this.check("@") && this.peek(1).kind == "identifier" && (this.peek(1).lexeme == "include" || this.peek(1).lexeme == "link");
  }
  singleDecorator(): number {
    const at: ParserToken = this.expect("@");
    const name: ParserToken = this.expect("identifier");
    const result: number = this.add(NodeKind.Decorator, at, name); this.attr(result, AttributeKind.Name, name.lexeme);
    if (this.accept("(")) { this.argumentsInto(result, EdgeRole.Args, ")"); this.setEnd(result, this.previous()); }
    return result;
  }
  decorators(): number[] {
    let result: number[] = [];
    while (this.check("@")) { result.push(this.singleDecorator()); this.skipNewlines(); }
    return result;
  }
  prependDecorators(owner: number, decorators: number[]): void {
    if (decorators.length == 0) return;
    let edges: AstEdge[] = [];
    for (const decorator of decorators) edges.push(new AstEdge(EdgeRole.Decorators, decorator));
    for (const edge of this.nodes[owner].edges) edges.push(edge);
    this.nodes[owner].edges = edges;
  }
  statement(topLevel: boolean): number {
    const start: ParserToken = this.peek(0);
    if (!this.enter()) return this.add(NodeKind.ErrorNode, start, start);
    const result: number = this.statementInner(topLevel);
    this.leave(); return result;
  }
  statementInner(topLevel: boolean): number {
    this.skipNewlines();
    const start: ParserToken = this.peek(0);
    let decorators: number[] = this.decorators();
    const exported: boolean = this.accept("export");
    if (exported) { this.skipNewlines(); for (const decorator of this.decorators()) decorators.push(decorator); }
    if (exported && !topLevel) this.report("'export' solo es válido en el nivel superior");
    let result: number = -1;
    if (this.check("let") || this.check("const") || this.check("using")) result = this.variable(true);
    else if (this.check("function") || this.check("async")) result = this.functionDeclaration(false);
    else if (this.accept("class")) result = this.classDeclaration(this.previous(), false);
    else if (this.accept("interface")) result = this.interfaceDeclaration(this.previous());
    else if (this.accept("enum")) result = this.enumDeclaration(this.previous());
    else if (this.accept("union")) result = this.unionDeclaration(this.previous());
    else if (this.accept("switch")) result = this.switchStatement(this.previous());
    else if (this.accept("import")) {
      const keyword: ParserToken = this.previous();
      if (!topLevel) this.reportAt(keyword, "import solo es válido en el nivel superior");
      if (exported) this.reportAt(keyword, "export no puede preceder a import");
      result = this.importDeclaration(keyword);
    } else if (exported && this.accept("default")) result = this.exportDefault(start);
    else if (exported && (this.check("{") || this.check("*") || (this.word("type") && (this.moduleNextKind() == "{" || this.moduleNextKind() == "*")))) {
      const typeOnly: boolean = this.acceptWord("type");
      this.skipNewlines();
      result = this.exportList(start, typeOnly);
    }
    else if (this.check("type") && this.peek(0).lexeme == "type") {
      const keyword: ParserToken = this.take();
      const name: ParserToken = this.expect("identifier");
      result = this.add(NodeKind.TypeAliasDeclaration, keyword, name); this.attr(result, AttributeKind.Name, name.lexeme);
      this.typeParameters(result, false); this.expect("=");
      let params: string[] = []; for (const edge of this.node(result).edges) if (edge.role == EdgeRole.TypeParameters) params.push(this.get(edge.node, AttributeKind.Name));
      const outerParams: string[] = this.aliasParams; this.aliasParams = params;
      this.attr(result, AttributeKind.Type, this.typeName()); this.aliasParams = outerParams; this.setEnd(result, this.terminator());
    } else if (this.accept("if")) {
      const keyword: ParserToken = this.previous();
      this.expect("("); const condition: number = this.expression(); this.expect(")");
      const thenBranch: number = this.statement(false); this.skipNewlines();
      result = this.add(NodeKind.IfStatement, keyword, this.node(thenBranch).end);
      this.edge(result, EdgeRole.Condition, condition); this.edge(result, EdgeRole.ThenBranch, thenBranch);
      if (this.accept("else")) { const branch: number = this.statement(false); this.edge(result, EdgeRole.ElseBranch, branch); this.setEnd(result, this.node(branch).end); }
    } else if (this.accept("while")) {
      const keyword: ParserToken = this.previous(); this.expect("("); const condition: number = this.expression(); this.expect(")");
      const body: number = this.statement(false); result = this.add(NodeKind.WhileStatement, keyword, this.node(body).end);
      this.edge(result, EdgeRole.Condition, condition); this.edge(result, EdgeRole.Body, body);
    } else if (this.accept("for")) result = this.forStatement(this.previous());
    else if (this.accept("{")) result = this.block(this.previous());
    else if (this.check("return") || this.check("break") || this.check("continue") || this.check("delete")) {
      const keyword: ParserToken = this.take();
      let kind: NodeKind = NodeKind.ReturnStatement;
      if (keyword.kind == "break") kind = NodeKind.BreakStatement;
      else if (keyword.kind == "continue") kind = NodeKind.ContinueStatement;
      else if (keyword.kind == "delete") kind = NodeKind.DeleteStatement;
      result = this.add(kind, keyword, keyword);
      if (keyword.kind == "delete") {
        const target: number = this.expression(); this.edge(result, EdgeRole.Target, target);
        if (this.node(target).kind != NodeKind.IndexExpression) this.report("delete requiere un acceso por índice");
      } else if (keyword.kind == "return" && !this.check(";") && !this.check("newline") && !this.check("}") && !this.check("eof")) {
        this.edge(result, EdgeRole.Value, this.expression());
      }
      this.setEnd(result, this.terminator());
    } else if (this.check("case") || this.check("default")) {
      this.report("case/default requiere un switch"); result = this.add(NodeKind.ErrorNode, start, this.take());
    } else {
      const value: number = this.expression();
      result = this.add(NodeKind.ExpressionStatement, this.node(value).start, this.terminator()); this.edge(result, EdgeRole.Expression, value);
      if (exported || decorators.length > 0) this.report("El modificador necesita una declaración compatible");
    }
    const declarationKind: NodeKind = this.node(result).kind;
    const moduleExport: boolean = declarationKind == NodeKind.ExportDefaultDeclaration || declarationKind == NodeKind.ExportNamedDeclaration || declarationKind == NodeKind.ExportAllDeclaration;
    if (exported && !moduleExport) {
      if (declarationKind != NodeKind.VariableDeclaration && declarationKind != NodeKind.UsingDeclaration && declarationKind != NodeKind.FunctionDeclaration
          && declarationKind != NodeKind.ClassDeclaration && declarationKind != NodeKind.InterfaceDeclaration && declarationKind != NodeKind.TypeAliasDeclaration
          && declarationKind != NodeKind.EnumDeclaration && declarationKind != NodeKind.UnionDeclaration
          && declarationKind != NodeKind.ErrorNode) this.report("export necesita una declaración compatible");
      this.attr(result, AttributeKind.Exported, "true");
    }
    let decorated: number = result;
    if (declarationKind == NodeKind.ExportDefaultDeclaration) decorated = this.nodes[result].edges[0].node;
    const decoratedKind: NodeKind = this.node(decorated).kind;
    if (decorators.length > 0 && decoratedKind != NodeKind.VariableDeclaration && decoratedKind != NodeKind.FunctionDeclaration && decoratedKind != NodeKind.ClassDeclaration && decoratedKind != NodeKind.InterfaceDeclaration) {
      this.reportAt(start, "Los decoradores requieren una declaración compatible");
    } else this.prependDecorators(decorated, decorators);
    return result;
  }
  word(value: string): boolean {
    const token: ParserToken = this.peek(0);
    return token.lexeme == value && (token.kind == "identifier" || token.kind == "type" || token.kind == value);
  }
  acceptWord(value: string): boolean { if (!this.word(value)) return false; this.take(); return true; }
  moduleNextKind(): string {
    let cursor: number = 1; while (this.peek(cursor).kind == "newline") cursor = cursor + 1;
    return this.peek(cursor).kind;
  }
  moduleName(): ParserToken {
    if (this.check("identifier") || this.check("default") || this.word("type")) return this.take();
    this.report("Se esperaba un nombre de import/export"); return this.peek(0);
  }
  moduleEnd(): ParserToken {
    const end: ParserToken = this.previous();
    if (this.accept(";")) return this.previous();
    if (this.accept("newline")) return end;
    if (!this.check("eof") && !this.check("}")) this.report("Se esperaba un terminador después de import/export");
    return end;
  }
  moduleSource(owner: number): void {
    this.skipNewlines();
    if (!this.acceptWord("from")) this.report("Se esperaba 'from' en import/export");
    this.skipNewlines();
    if (this.check("string")) this.attr(owner, AttributeKind.Source, this.take().lexeme);
    else this.report("Se esperaba un literal de módulo después de 'from'");
  }
  fromAfterNewlines(): boolean {
    let cursor: number = 0; while (this.peek(cursor).kind == "newline") cursor = cursor + 1;
    const token: ParserToken = this.peek(cursor);
    return token.kind == "identifier" && token.lexeme == "from";
  }
  moduleSpecifiers(owner: number, importing: boolean, typeOnly: boolean): void {
    this.expect("{"); this.skipNewlines();
    while (!this.check("}") && !this.check("eof")) {
      const before: number = this.current; const start: ParserToken = this.peek(0);
      let itemTypeOnly: boolean = typeOnly;
      if (this.word("type") && (this.moduleNextKind() == "identifier" || this.moduleNextKind() == "default")) {
        this.take(); itemTypeOnly = true; this.skipNewlines();
      }
      const name: ParserToken = this.moduleName(); let alias: ParserToken = name; let renamed: boolean = false;
      this.skipNewlines();
      if (this.acceptWord("as")) {
        renamed = true; this.skipNewlines(); alias = (importing ? this.expect("identifier") : this.moduleName());
      }
      const specifier: number = this.add(importing ? NodeKind.ImportSpecifier : NodeKind.ExportSpecifier, start, alias);
      if (importing) {
        this.attr(specifier, AttributeKind.Imported, name.lexeme); this.attr(specifier, AttributeKind.Local, alias.lexeme); this.attr(specifier, AttributeKind.Form, "named");
        if (alias.kind != "identifier") this.reportAt(alias, "El nombre local del import necesita un identificador; usa 'as nombre'");
      } else { this.attr(specifier, AttributeKind.Name, name.lexeme); if (renamed) this.attr(specifier, AttributeKind.Alias, alias.lexeme); }
      if (itemTypeOnly) this.attr(specifier, AttributeKind.TypeOnly, "true");
      this.edge(owner, EdgeRole.Specifiers, specifier); this.skipNewlines();
      if (this.current == before) break;
      if (this.check("}")) break;
      if (!this.accept(",")) {
        this.report("Se esperaba ',' o '}' entre nombres de import/export");
        if (this.word("from") || (!this.check("identifier") && !this.check("default") && !this.word("type"))) break;
      }
      this.skipNewlines();
    }
    this.expect("}");
  }
  checkModuleNames(owner: number, importing: boolean): void {
    let names: string[] = [];
    for (const edge of this.nodes[owner].edges) {
      if (edge.role == EdgeRole.Specifiers) {
        const name: string = importing ? this.get(edge.node, AttributeKind.Local) : this.get(edge.node, AttributeKind.Alias);
        const effective: string = name == "" ? this.get(edge.node, AttributeKind.Name) : name;
        if (names.includes(effective)) this.reportAt(this.node(edge.node).start, "Nombre duplicado en la lista de import/export");
        names.push(effective);
      }
    }
  }
  importDeclaration(keyword: ParserToken): number {
    const result: number = this.add(NodeKind.ImportDeclaration, keyword, keyword); this.skipNewlines();
    if (this.check("string")) {
      this.attr(result, AttributeKind.Source, this.take().lexeme); this.attr(result, AttributeKind.SideEffect, "true");
      this.setEnd(result, this.moduleEnd()); return result;
    }
    if (this.check("(")) {
      this.report("import dinámico no está soportado por este parser"); this.synchronize(); this.setEnd(result, this.previous()); return result;
    }
    const typeOnly: boolean = this.acceptWord("type"); if (typeOnly) this.attr(result, AttributeKind.TypeOnly, "true");
    this.skipNewlines(); let hasDefault: boolean = false; let more: boolean = true;
    if (this.check("identifier")) {
      const local: ParserToken = this.take(); const item: number = this.add(NodeKind.ImportSpecifier, local, local);
      this.attr(item, AttributeKind.Imported, "default"); this.attr(item, AttributeKind.Local, local.lexeme); this.attr(item, AttributeKind.Form, "default");
      if (typeOnly) this.attr(item, AttributeKind.TypeOnly, "true"); this.edge(result, EdgeRole.Specifiers, item);
      hasDefault = true; this.skipNewlines(); more = this.accept(","); if (more) this.skipNewlines();
    }
    if (more) {
      if (this.accept("*")) {
        const star: ParserToken = this.previous(); this.skipNewlines();
        if (!this.acceptWord("as")) this.report("Un import '*' requiere 'as nombre'");
        this.skipNewlines(); const local: ParserToken = this.expect("identifier");
        const item: number = this.add(NodeKind.ImportSpecifier, star, local);
        this.attr(item, AttributeKind.Imported, "*"); this.attr(item, AttributeKind.Local, local.lexeme); this.attr(item, AttributeKind.Form, "namespace");
        if (typeOnly) this.attr(item, AttributeKind.TypeOnly, "true"); this.edge(result, EdgeRole.Specifiers, item);
      } else if (this.check("{")) this.moduleSpecifiers(result, true, typeOnly);
      else this.report("Se esperaba un binding, namespace o lista de nombres en import");
    } else if (!hasDefault) this.report("Se esperaba un nombre local en import");
    this.moduleSource(result); this.checkModuleNames(result, true);
    if (this.get(result, AttributeKind.Source) == "estatic:json") for (const edge of this.node(result).edges) if (edge.role == EdgeRole.Specifiers) {
      const item: AstNode = this.node(edge.node);
      if (item.get(AttributeKind.Imported) == "default") this.jsonClasses.push(item.get(AttributeKind.Local));
      else if (item.get(AttributeKind.Imported) == "parse") this.jsonParsers.push(item.get(AttributeKind.Local));
    }
    this.setEnd(result, this.moduleEnd()); return result;
  }
  exportList(keyword: ParserToken, typeOnly: boolean): number {
    const result: number = this.add(this.check("*") ? NodeKind.ExportAllDeclaration : NodeKind.ExportNamedDeclaration, keyword, keyword);
    if (typeOnly) this.attr(result, AttributeKind.TypeOnly, "true");
    if (this.accept("*")) {
      this.skipNewlines(); if (this.acceptWord("as")) { this.skipNewlines(); this.attr(result, AttributeKind.Namespace, this.moduleName().lexeme); }
      this.moduleSource(result);
    } else {
      this.moduleSpecifiers(result, false, typeOnly);
      if (this.fromAfterNewlines()) this.moduleSource(result);
      this.checkModuleNames(result, false);
    }
    this.setEnd(result, this.moduleEnd()); return result;
  }
  exportDefault(keyword: ParserToken): number {
    const result: number = this.add(NodeKind.ExportDefaultDeclaration, keyword, keyword); this.skipNewlines();
    let declaration: number = -1;
    if (this.check("function") || (this.check("async") && this.peek(1).kind == "function")) declaration = this.functionDeclaration(true);
    else if (this.accept("class")) declaration = this.classDeclaration(this.previous(), true);
    else if (this.check("let") || this.check("const")) declaration = this.variable(true);
    else { declaration = this.expression(); this.terminator(); }
    this.edge(result, EdgeRole.Declaration, declaration); this.setEnd(result, this.node(declaration).end); return result;
  }
  synchronize(): void {
    let depth: number = 0;
    while (!this.check("eof")) {
      if (depth == 0 && (this.check(";") || this.check("newline"))) { this.take(); return; }
      if (this.check("{")) depth = depth + 1;
      if (this.check("}")) { if (depth == 0) return; depth = depth - 1; }
      this.take();
    }
  }
  digitValue(c: string): number {
    if (c == "") return -1;
    const digit: number = "0123456789abcdefABCDEF".indexOf(c, 0);
    return digit >= 16 ? digit - 6 : digit;
  }
  decimalMultiplyAdd(text: string, factor: number, extra: number): string {
    let carry: number = extra; let result: string = "";
    for (let i: number = text.length - 1; i >= 0; i = i - 1) {
      const value: number = (text.charCodeAt(i) - 48) * factor + carry;
      result = "0123456789".charAt(value % 10) + result; carry = Math.floor(value / 10);
    }
    while (carry > 0) { result = "0123456789".charAt(carry % 10) + result; carry = Math.floor(carry / 10); }
    let first: number = 0;
    while (first + 1 < result.length && result.charAt(first) == "0") first = first + 1;
    return result.slice(first, result.length);
  }
  // Canonical decimal text, never a double: enum counters and discriminators
  // preserve precision until a future checker chooses the numeric type.
  numericText(token: ParserToken): string {
    const text: string = token.lexeme; let radix: number = 10; let begin: number = 0;
    if (text.charAt(0) == "0") {
      const prefix: string = text.charAt(1);
      if (prefix == "x" || prefix == "X") { radix = 16; begin = 2; }
      else if (prefix == "o" || prefix == "O") { radix = 8; begin = 2; }
      else if (prefix == "b" || prefix == "B") { radix = 2; begin = 2; }
    }
    let whole: string = ""; let fraction: string = ""; let point: boolean = false;
    for (let i: number = begin; i < text.length; i = i + 1) {
      const c: string = text.charAt(i);
      if (c == "_") {
        const before: number = this.digitValue(text.charAt(i - 1)); const after: number = this.digitValue(text.charAt(i + 1));
        if (i == begin || before < 0 || before >= radix || after < 0 || after >= radix) { this.reportAt(token, "Separador numérico no válido"); return "0"; }
      } else if (c == "." && radix == 10 && !point && whole != "" && i + 1 < text.length) point = true;
      else {
        const digit: number = this.digitValue(c);
        if (digit < 0 || digit >= radix) { this.reportAt(token, "Literal numérico no válido"); return "0"; }
        if (radix != 10) whole = this.decimalMultiplyAdd(whole == "" ? "0" : whole, radix, digit);
        else if (point) fraction = fraction + c;
        else whole = whole + c;
      }
    }
    if (whole == "" || (point && fraction == "")) { this.reportAt(token, "Literal numérico no válido"); return "0"; }
    let first: number = 0; while (first + 1 < whole.length && whole.charAt(first) == "0") first = first + 1;
    whole = whole.slice(first, whole.length);
    let last: number = fraction.length;
    while (last > 0 && fraction.charAt(last - 1) == "0") last = last - 1;
    return last == 0 ? whole : whole + "." + fraction.slice(0, last);
  }
  incrementDecimal(value: string): string {
    const point: number = value.indexOf(".", 0); const cut: number = point < 0 ? value.length : point;
    const suffix: string = point < 0 ? "" : value.slice(point, value.length);
    return this.decimalMultiplyAdd(value.slice(0, cut), 1, 1) + suffix;
  }
  enumDeclaration(keyword: ParserToken): number {
    const name: ParserToken = this.expect("identifier"); const result: number = this.add(NodeKind.EnumDeclaration, keyword, name);
    this.attr(result, AttributeKind.Name, name.lexeme); this.expect("{"); this.skipNewlines();
    let nextValue: string = "0"; let mode: string = ""; let names: string[] = [];
    while (!this.check("}") && !this.check("eof")) {
      const before: number = this.current; const memberName: ParserToken = this.expect("identifier");
      if (names.includes(memberName.lexeme)) this.reportAt(memberName, "Miembro de enum duplicado");
      names.push(memberName.lexeme);
      const member: number = this.add(NodeKind.EnumMember, memberName, memberName); this.attr(member, AttributeKind.Name, memberName.lexeme);
      let literal: number = -1;
      if (this.accept("=")) {
        const value: ParserToken = this.peek(0);
        if (this.check("number") || this.check("string")) {
          this.take(); literal = this.add(NodeKind.LiteralExpression, value, value);
          this.attr(literal, AttributeKind.LiteralType, value.kind); const canonical: string = value.kind == "number" ? this.numericText(value) : value.lexeme;
          this.attr(literal, AttributeKind.Value, canonical);
          if (mode != "" && mode != value.kind) this.reportAt(value, "Un enum no puede mezclar miembros numéricos y de cadena");
          mode = value.kind;
          if (value.kind == "number") nextValue = this.incrementDecimal(canonical);
        } else {
          this.report("El valor del miembro de enum debe ser un literal numérico no negativo o de cadena");
          while (!this.check(",") && !this.check("}") && !this.check("newline") && !this.check("eof")) this.take();
        }
      } else {
        if (mode == "string") this.reportAt(memberName, "Un enum de cadena requiere valores explícitos en todos los miembros");
        literal = this.add(NodeKind.LiteralExpression, memberName, memberName); this.attr(literal, AttributeKind.LiteralType, "number");
        this.attr(literal, AttributeKind.Value, nextValue); nextValue = this.incrementDecimal(nextValue);
        if (mode == "") mode = "number";
      }
      if (literal >= 0) { this.edge(member, EdgeRole.Value, literal); this.setEnd(member, this.node(literal).end); }
      this.edge(result, EdgeRole.Members, member); this.skipNewlines();
      if (!this.check("}") && !this.check("eof")) {
        if (!this.accept(",")) this.report("Se esperaba ',' o '}' entre miembros del enum");
        this.skipNewlines();
      }
      if (this.current == before && !this.check("eof")) this.take();
    }
    if (names.length == 0) this.report("El enum debe tener al menos un miembro");
    this.attr(result, AttributeKind.Underlying, mode == "string" ? "string" : "number"); this.setEnd(result, this.expect("}")); return result;
  }
  unionDeclaration(keyword: ParserToken): number {
    const result: number = this.add(NodeKind.UnionDeclaration, keyword, keyword);
    const beforeName: boolean = this.check("<"); this.typeParameters(result, false);
    const name: ParserToken = this.expect("identifier"); this.attr(result, AttributeKind.Name, name.lexeme);
    if (beforeName && this.check("<")) this.report("La unión sólo admite una lista de parámetros de tipo");
    this.typeParameters(result, false); this.expect("="); this.skipNewlines();
    let names: string[] = []; let reading: boolean = true;
    while (reading && !this.check("eof")) {
      let variant: number = -1;
      if (this.check("{")) variant = this.objectVariant();
      else if (this.check("identifier")) {
        const token: ParserToken = this.take(); variant = this.add(NodeKind.UnionVariant, token, token); this.attr(variant, AttributeKind.Name, token.lexeme);
        if (this.accept("(")) { this.attr(variant, AttributeKind.Payload, this.typeName()); this.setEnd(variant, this.expect(")")); }
      } else { this.report("Se esperaba una variante de la unión"); reading = false; }
      if (variant >= 0) {
        const variantName: string = this.get(variant, AttributeKind.Name);
        if (names.includes(variantName)) this.reportAt(this.node(variant).start, "Variante de unión duplicada");
        names.push(variantName); this.edge(result, EdgeRole.Variants, variant);
        if (this.accept("|")) this.skipNewlines(); else reading = false;
      }
    }
    this.setEnd(result, this.terminator()); return result;
  }
  objectVariant(): number {
    const open: ParserToken = this.expect("{"); this.skipNewlines();
    const field: ParserToken = this.expect("identifier"); this.expect(":"); const token: ParserToken = this.peek(0);
    const result: number = this.add(NodeKind.UnionVariant, open, token);
    let value: string = token.lexeme; let literalType: string = token.kind;
    if (this.check("number") || this.check("string") || this.check("true") || this.check("false")) {
      this.take(); if (token.kind == "number") value = this.numericText(token);
      else if (token.kind == "true" || token.kind == "false") literalType = "boolean";
    } else {
      this.report("El discriminador de una object-variant debe ser un literal");
      while (!this.check(";") && !this.check(",") && !this.check("}") && !this.check("eof")) this.take();
    }
    let variantName: string = field.lexeme + "_" + value;
    if (literalType == "string") variantName = value;
    else if (literalType == "boolean" && field.lexeme == "ok") variantName = (value == "true" ? "Ok" : "Err");
    this.attr(result, AttributeKind.Name, variantName);
    const discriminator: number = this.add(NodeKind.Discriminator, field, token);
    this.attr(discriminator, AttributeKind.Field, field.lexeme); this.attr(discriminator, AttributeKind.LiteralType, literalType); this.attr(discriminator, AttributeKind.Value, value);
    this.edge(result, EdgeRole.Discriminator, discriminator);
    let names: string[] = [field.lexeme]; let types: string[] = []; this.skipNewlines();
    while (this.accept(";") || this.accept(",")) {
      this.skipNewlines(); if (this.check("}") || this.check("eof")) break;
      const before: number = this.current; const bindingName: ParserToken = this.expect("identifier");
      if (names.includes(bindingName.lexeme)) this.reportAt(bindingName, "Binding de variante duplicado");
      names.push(bindingName.lexeme); this.expect(":"); const annotation: string = this.typeName();
      const binding: number = this.add(NodeKind.Binding, bindingName, this.previous());
      this.attr(binding, AttributeKind.Name, bindingName.lexeme); this.attr(binding, AttributeKind.Type, annotation);
      this.edge(result, EdgeRole.Bindings, binding); types.push(annotation); this.skipNewlines();
      if (this.current == before && !this.check("eof")) this.take();
    }
    if (types.length == 1) this.attr(result, AttributeKind.Payload, types[0]);
    else if (types.length > 1) this.attr(result, AttributeKind.Payload, "[" + types.join(",") + "]");
    this.setEnd(result, this.expect("}")); return result;
  }
  switchStatement(keyword: ParserToken): number {
    const result: number = this.add(NodeKind.SwitchStatement, keyword, keyword);
    this.expect("("); this.edge(result, EdgeRole.Discriminant, this.expression()); this.expect(")"); this.expect("{");
    let hasDefault: boolean = false;
    while (!this.check("}") && !this.check("eof")) {
      this.skipNewlines(); if (this.check("}") || this.check("eof")) break;
      if (this.check("case") || this.check("default")) {
        const token: ParserToken = this.take(); const clause: number = this.add(token.kind == "case" ? NodeKind.CaseClause : NodeKind.DefaultClause, token, token);
        if (token.kind == "case") {
          if (this.check(":")) { this.report("case necesita una expresión"); this.edge(clause, EdgeRole.Labels, this.add(NodeKind.ErrorNode, this.peek(0), this.peek(0))); }
          else this.edge(clause, EdgeRole.Labels, this.expression());
        } else { if (hasDefault) this.reportAt(token, "Un switch solo puede tener un default"); hasDefault = true; }
        this.setEnd(clause, this.expect(":")); this.skipNewlines();
        while (!this.check("case") && !this.check("default") && !this.check("}") && !this.check("eof")) {
          this.skipNewlines(); if (this.check("case") || this.check("default") || this.check("}") || this.check("eof")) break;
          if (!this.accept(";")) {
            const before: number = this.current; const child: number = this.statement(false); this.pushStatement(clause, EdgeRole.Body, child);
            this.setEnd(clause, this.node(child).end);
            if (this.current == before && !this.check("eof")) { this.report("E1006: No se esperaba " + this.found() + " en el switch\nayuda: cada rama del switch empieza con 'case valor:' o 'default:'" + this.foundArg() + catalogVariant("switch")); this.take(); }
          }
        }
        this.edge(result, EdgeRole.Clauses, clause);
      } else { this.report("Se esperaba case o default en switch"); this.take(); }
    }
    this.setEnd(result, this.expect("}")); return result;
  }
  recoverBinding(close: string): void {
    let nested: string[] = [];
    while (!this.check("eof")) {
      const kind: string = this.peek(0).kind;
      if (kind == ";") return;
      if (nested.length == 0 && (kind == close || kind == "," || kind == "=" || kind == "newline")) return;
      if (kind == "[") nested.push("]");
      else if (kind == "{") nested.push("}");
      else if (kind == "(") nested.push(")");
      else if (kind == "]" || kind == "}" || kind == ")") { if (nested.length == 0) return; nested.pop(); }
      this.take();
    }
  }
  // Un patrón anidado: const <patrón> = <local>, después de su sentencia.
  nestedPattern(owner: number, local: string, start: ParserToken): void {
    const nested: number = this.add(NodeKind.VariableDeclaration, start, start); this.attr(nested, AttributeKind.Mutable, this.get(owner, AttributeKind.Mutable) == "true" ? "true" : "false");
    this.bindingPattern(nested, this.check("[")); this.setEnd(nested, this.previous());
    const source: number = this.add(NodeKind.IdentifierExpression, start, start); this.attr(source, AttributeKind.Name, local);
    this.edge(nested, EdgeRole.Initializer, source); this.finishPattern(nested);
    this.extraOwners.push(owner); this.extraNodes.push(nested); this.extraBefore.push(false);
  }
  // Con el inicializador ya puesto: el resto de array (fuente.slice(k)). Si la
  // fuente no es una variable, se guarda antes en una (__src<N>).
  finishPattern(owner: number, sourceType: string = ""): void {
    for (let at: number = 0; at < this.restOwners.length; at = at + 1) if (this.restOwners[at] == owner) {
      let initializer: number = -1; for (const edge of this.node(owner).edges) if (edge.role == EdgeRole.Initializer) initializer = edge.node;
      if (initializer < 0) return;
      const token: ParserToken = this.restNames[at]; let sourceName: string = "";
      const objectRest: boolean = this.restIndexes[at] < 0;
      if (objectRest && sourceType == "" && this.node(initializer).kind == NodeKind.IdentifierExpression) sourceType = this.visibleType(this.get(initializer, AttributeKind.Name));
      if (objectRest && sourceType == "") { this.reportAt(token, "El resto de un patrón de objeto necesita el tipo de la fuente: usa una variable o un parámetro con el tipo anotado, o anota el patrón (const { a, ...resto }: T = …)"); return; }
      if (this.node(initializer).kind == NodeKind.IdentifierExpression) sourceName = this.get(initializer, AttributeKind.Name);
      else {
        sourceName = "__src" + numberToString(owner);
        const holder: number = this.add(NodeKind.VariableDeclaration, this.node(owner).start, this.node(owner).start); this.attr(holder, AttributeKind.Name, sourceName); this.attr(holder, AttributeKind.Mutable, "false");
        this.edge(holder, EdgeRole.Initializer, initializer);
        const reference: number = this.add(NodeKind.IdentifierExpression, token, token); this.attr(reference, AttributeKind.Name, sourceName);
        let edges: AstEdge[] = []; for (const edge of this.nodes[owner].edges) edges.push(edge.role == EdgeRole.Initializer ? new AstEdge(EdgeRole.Initializer, reference) : edge);
        this.nodes[owner].edges = edges;
        this.extraOwners.push(owner); this.extraNodes.push(holder); this.extraBefore.push(true);
      }
      const rest: number = this.add(NodeKind.VariableDeclaration, token, token); this.attr(rest, AttributeKind.Name, token.lexeme); this.attr(rest, AttributeKind.Mutable, this.get(owner, AttributeKind.Mutable) == "true" ? "true" : "false");
      if (objectRest) {
        // resto = { c: fuente.c, … } con los campos que no nombra el patrón; los
        // rellena el binder al expandir el Omit (literal vacío marcado con la fuente).
        let keys: string[] = []; for (const edge of this.node(owner).edges) if (edge.role == EdgeRole.ObjectBindings) keys.push(this.get(edge.node, AttributeKind.Property));
        const derived: string = this.derivedType("Omit", sourceType, keys, token);
        const literal: number = this.add(NodeKind.ObjectLiteralExpression, token, token); this.attr(literal, AttributeKind.Underlying, sourceName); this.attr(literal, AttributeKind.DeclaredType, derived);
        this.attr(rest, AttributeKind.DeclaredType, derived); this.edge(rest, EdgeRole.Initializer, literal);
        this.extraOwners.push(owner); this.extraNodes.push(rest); this.extraBefore.push(false); continue;
      }
      const object: number = this.add(NodeKind.IdentifierExpression, token, token); this.attr(object, AttributeKind.Name, sourceName);
      const call: number = this.add(NodeKind.MemberCallExpression, token, token); this.edge(call, EdgeRole.Object, object); this.attr(call, AttributeKind.Optional, "false"); this.attr(call, AttributeKind.Method, "slice");
      const index: number = this.add(NodeKind.LiteralExpression, token, token); this.attr(index, AttributeKind.LiteralType, "number"); this.attr(index, AttributeKind.Raw, numberToString(this.restIndexes[at]));
      this.edge(call, EdgeRole.Args, index); this.edge(rest, EdgeRole.Initializer, call);
      this.extraOwners.push(owner); this.extraNodes.push(rest); this.extraBefore.push(false);
    }
  }
  // La sentencia con sus declaraciones extra, en orden.
  withExtras(statement: number): number[] {
    let result: number[] = [];
    for (let at: number = 0; at < this.extraOwners.length; at = at + 1) if (this.extraOwners[at] == statement && this.extraBefore[at]) for (const item of this.withExtras(this.extraNodes[at])) result.push(item);
    result.push(statement);
    for (let at: number = 0; at < this.extraOwners.length; at = at + 1) if (this.extraOwners[at] == statement && !this.extraBefore[at]) for (const item of this.withExtras(this.extraNodes[at])) result.push(item);
    return result;
  }
  pushStatement(container: number, role: EdgeRole, statement: number): void { for (const item of this.withExtras(statement)) this.edge(container, role, item); }
  bindingPattern(owner: number, array: boolean): void {
    this.take(); const close: string = array ? "]" : "}";
    this.attr(owner, AttributeKind.Pattern, array ? "array" : "object"); this.attr(owner, AttributeKind.Name, "");
    let names: string[] = [];
    while (!this.check("eof")) {
      this.skipNewlines(); if (this.check(close)) break;
      // [, b]: un hueco ocupa una posición con un nombre sintético.
      if (array && this.check(",")) {
        const hole: ParserToken = this.peek(0); const skipped: number = this.add(NodeKind.ArrayBinding, hole, hole);
        this.attr(skipped, AttributeKind.Name, "__hole" + numberToString(skipped)); this.edge(owner, EdgeRole.ArrayBindings, skipped);
        this.take(); continue;
      }
      // [a, ...resto]: el resto es fuente.slice(k), una declaración aparte.
      if (this.accept("...")) {
        const restName: ParserToken = this.expect("identifier");
        // { a, ...resto }: el resto es un Omit del tipo de la fuente (índice -1).
        if (!array) { this.restOwners.push(owner); this.restNames.push(restName); this.restIndexes.push(-1); }
        else { let count: number = 0; for (const edge of this.node(owner).edges) if (edge.role == EdgeRole.ArrayBindings) count = count + 1; this.restOwners.push(owner); this.restNames.push(restName); this.restIndexes.push(count); }
        this.skipNewlines(); if (!this.check(close)) this.report("El resto tiene que ser el último elemento del patrón");
        break;
      }
      // [[a, b], c] o [{ x }]: un elemento que es a su vez un patrón.
      if (array && (this.check("[") || this.check("{"))) {
        const start: ParserToken = this.peek(0); const binding: number = this.add(NodeKind.ArrayBinding, start, start);
        const local: string = "__nest" + numberToString(binding); this.attr(binding, AttributeKind.Name, local);
        this.nestedPattern(owner, local, start);
        this.skipNewlines(); if (this.accept("=")) { this.skipNewlines(); this.edge(binding, EdgeRole.DefaultValue, this.expression()); }
        this.setEnd(binding, this.previous()); this.edge(owner, EdgeRole.ArrayBindings, binding);
        this.skipNewlines(); if (this.accept(",")) continue;
        if (!this.check(close)) { this.report("Se esperaba ',' o '" + close + "' en el patrón"); this.recoverBinding(close); if (this.accept(",")) continue; }
        break;
      }
      if (!this.check("identifier")) {
        this.report("Se esperaba un identificador en el patrón");
        this.recoverBinding(close); if (this.accept(",")) continue; break;
      }
      const key: ParserToken = this.take(); let local: ParserToken = key; let end: ParserToken = key; let nestedLocal: string = "";
      const binding: number = this.add(array ? NodeKind.ArrayBinding : NodeKind.ObjectBinding, key, key);
      if (!array) this.attr(binding, AttributeKind.Property, key.lexeme);
      this.skipNewlines();
      if (this.accept(":")) {
        this.skipNewlines();
        // { dir: { ciudad } } o { xs: [a, b] }: patrón anidado, como en TypeScript.
        if (!array && (this.check("{") || this.check("["))) {
          nestedLocal = "__nest" + numberToString(binding); this.nestedPattern(owner, nestedLocal, this.peek(0)); end = this.previous();
        } else if (!array && this.check("identifier")) {
          local = this.take(); end = local; this.skipNewlines();
          if (this.accept(":")) { this.skipNewlines(); this.attr(binding, AttributeKind.DeclaredType, this.typeName()); end = this.previous(); }
        } else { this.attr(binding, AttributeKind.DeclaredType, this.typeName()); end = this.previous(); }
      }
      const localName: string = nestedLocal != "" ? nestedLocal : local.lexeme;
      this.attr(binding, AttributeKind.Name, localName);
      if (names.includes(localName)) this.reportAt(local, "Binding duplicado '" + localName + "'");
      names.push(localName); this.skipNewlines();
      if (this.accept("=")) { this.skipNewlines(); this.edge(binding, EdgeRole.DefaultValue, this.expression()); end = this.previous(); }
      this.setEnd(binding, end); this.edge(owner, array ? EdgeRole.ArrayBindings : EdgeRole.ObjectBindings, binding);
      this.skipNewlines(); if (this.accept(",")) continue;
      if (!this.check(close)) {
        this.report("Se esperaba ',' o '" + close + "' en el patrón"); this.recoverBinding(close);
        if (this.accept(",")) continue;
      }
      break;
    }
    this.expect(close);
  }
  variable(terminated: boolean): number {
    if (!this.check("using") && (this.peek(1).kind == "[" || this.peek(1).kind == "{")) {
      const keyword: ParserToken = this.take(); const result: number = this.add(NodeKind.VariableDeclaration, keyword, keyword);
      this.attr(result, AttributeKind.Mutable, keyword.kind == "let" ? "true" : "false");
      this.bindingPattern(result, this.check("["));
      if (this.accept(":")) this.attr(result, AttributeKind.DeclaredType, this.typeName());
      this.expect("=");
      if (this.check(";") || this.check("newline") || this.check("}") || this.check("eof")) {
        this.report("El destructuring necesita un inicializador");
        const missing: number = this.add(NodeKind.ErrorNode, this.peek(0), this.peek(0)); this.edge(result, EdgeRole.Initializer, missing);
      } else this.edge(result, EdgeRole.Initializer, this.expression());
      this.finishPattern(result, this.get(result, AttributeKind.DeclaredType));
      this.setEnd(result, terminated ? this.terminator() : this.previous()); return result;
    }
    const keyword: ParserToken = this.take(); const name: ParserToken = this.expect("identifier");
    const kind: NodeKind = keyword.kind == "using" ? NodeKind.UsingDeclaration : NodeKind.VariableDeclaration;
    const result: number = this.add(kind, keyword, name); this.attr(result, AttributeKind.Name, name.lexeme);
    if (kind == NodeKind.VariableDeclaration) this.attr(result, AttributeKind.Mutable, keyword.kind == "let" ? "true" : "false");
    const typed: boolean = this.accept(":"); if (typed) this.attr(result, AttributeKind.DeclaredType, this.typeName());
    this.scopeNames.push(name.lexeme); this.scopeTypes.push(typed ? this.get(result, AttributeKind.DeclaredType) : "");
    // `let x: T | undefined;` empieza sin valor (el checker exige que T admita undefined).
    if (typed && kind == NodeKind.VariableDeclaration && keyword.kind == "let" && !this.check("=")) { this.setEnd(result, terminated ? this.terminator() : this.previous()); return result; }
    this.expect("="); this.edge(result, EdgeRole.Initializer, this.expression());
    this.setEnd(result, terminated ? this.terminator() : this.previous()); return result;
  }
  block(open: ParserToken): number {
    const result: number = this.add(NodeKind.BlockStatement, open, open);
    const mark: number = this.scopeNames.length;
    for (let at: number = 0; at < this.pendingNames.length; at = at + 1) { this.scopeNames.push(this.pendingNames[at]); this.scopeTypes.push(this.pendingTypes[at]); }
    this.pendingNames = []; this.pendingTypes = [];
    while (!this.check("}") && !this.check("eof")) {
      this.skipNewlines();
      if (this.check("}") || this.check("eof")) break;
      if (!this.accept(";")) {
        const before: number = this.current; this.pushStatement(result, EdgeRole.Statements, this.statement(false));
        if (this.current == before && !this.check("eof")) { this.report("E1006: No se esperaba " + this.found() + " dentro del bloque" + this.foundArg() + catalogVariant("bloque")); this.take(); }
      }
    }
    this.scopeNames = this.scopeNames.slice(0, mark); this.scopeTypes = this.scopeTypes.slice(0, mark);
    this.setEnd(result, this.expect("}")); return result;
  }
  // Tipo anotado de la variable visible con ese nombre ("" si no hay o no lo tiene).
  visibleType(name: string): string {
    for (let at: number = this.scopeNames.length - 1; at >= 0; at = at - 1) if (this.scopeNames[at] == name) return this.scopeTypes[at];
    return "";
  }
  parametersInto(owner: number, arrow: boolean, properties: boolean): void {
    this.expect("("); this.pendingNames = []; this.pendingTypes = [];
    while (!this.check(")") && !this.check("eof")) {
      const before: number = this.current;
      const start: ParserToken = this.peek(0);
      const variadic: boolean = this.accept("...");
      let access: string = ""; let isReadonly: boolean = false;
      while (this.check("public") || this.check("private") || this.check("protected") || this.check("readonly")) {
        const modifier: ParserToken = this.take();
        if (modifier.kind == "readonly") {
          if (isReadonly) this.reportAt(modifier, "Modificador readonly duplicado");
          isReadonly = true;
        } else {
          if (access != "") this.reportAt(modifier, "Modificador de acceso duplicado o incompatible");
          else access = modifier.lexeme;
          if (isReadonly) this.reportAt(modifier, "El modificador de acceso debe preceder a readonly");
        }
      }
      const property: boolean = access != "" || isReadonly;
      if (property && !properties) this.reportAt(start, "Las propiedades de parámetro solo se permiten en constructores de instancia");
      if (property && variadic) this.reportAt(start, "Una propiedad de parámetro no puede ser variádica");
      let pattern: number = -1; let parameterName: string = "";
      if (!variadic && !property && (this.check("{") || this.check("["))) {
        // { nombre, edad = 18 }: T → parámetro __arg<N> y const { ... } = __arg<N> en el cuerpo.
        pattern = this.add(NodeKind.VariableDeclaration, start, start); this.attr(pattern, AttributeKind.Mutable, "false");
        this.bindingPattern(pattern, this.check("[")); this.setEnd(pattern, this.previous());
        parameterName = "__arg" + numberToString(pattern);
      } else parameterName = this.expect("identifier").lexeme;
      const optional: boolean = this.accept("?");
      let annotation: string = "";
      if (pattern >= 0 && !this.check(":")) annotation = this.patternType(pattern);
      else { this.expect(":"); annotation = this.typeName(); }
      const param: number = this.add(NodeKind.Parameter, start, this.previous());
      this.attr(param, AttributeKind.Name, parameterName); this.attr(param, AttributeKind.Type, annotation);
      this.pendingNames.push(parameterName); this.pendingTypes.push(optional || variadic ? "" : annotation);
      if (pattern >= 0) {
        const source: number = this.add(NodeKind.IdentifierExpression, start, start); this.attr(source, AttributeKind.Name, parameterName);
        this.edge(pattern, EdgeRole.Initializer, source); this.finishPattern(pattern, annotation); this.patternOwners.push(owner); this.patternDeclarations.push(pattern);
      }
      if (access != "") this.attr(param, AttributeKind.Access, access);
      if (isReadonly) this.attr(param, AttributeKind.Readonly, "true");
      if (property && properties) this.attr(param, AttributeKind.ParameterProperty, "true");
      if (!arrow) { this.attr(param, AttributeKind.Variadic, variadic ? "true" : "false"); this.attr(param, AttributeKind.Optional, optional ? "true" : "false"); }
      if (this.accept("=")) {
        if (this.check(",") || this.check(")") || this.check("eof")) {
          this.report("Se esperaba un valor por defecto del parámetro");
          const missing: number = this.add(NodeKind.ErrorNode, this.peek(0), this.peek(0)); this.edge(param, EdgeRole.DefaultValue, missing);
        } else this.edge(param, EdgeRole.DefaultValue, this.expression());
      }
      this.setEnd(param, this.previous());
      this.edge(owner, EdgeRole.Params, param);
      if (this.current == before || !this.accept(",")) break;
    }
    this.expect(")");
  }
  // #273: JSON.parse("texto constante") sin <T>: el tipo sale del propio texto
  // (los objetos son tipos objeto con nombre por forma) y la llamada pasa a ser
  // JSON.parse<Tipo>(texto). El checker comprueba el texto al compilar.
  jsonParseType(call: number, object: number, member: ParserToken): void {
    if (this.get(call, AttributeKind.TypeArgument) != "") return;
    if (object >= 0 && (member.lexeme != "parse" || this.node(object).kind != NodeKind.IdentifierExpression || !this.jsonClasses.includes(this.get(object, AttributeKind.Name)))) return;
    if (object < 0 && !this.jsonParsers.includes(member.lexeme)) return;
    let args: number[] = []; for (const edge of this.node(call).edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    if (args.length != 1 || this.node(args[0]).kind != NodeKind.LiteralExpression || this.get(args[0], AttributeKind.LiteralType) != "string") return;
    const text: string = this.get(args[0], AttributeKind.Value); this.jsonAt = 0;
    const inferred: string = this.jsonType(text, member);
    while (this.jsonAt < text.length && jsonSpace(text.charCodeAt(this.jsonAt))) this.jsonAt = this.jsonAt + 1;
    if (inferred == "" || this.jsonAt != text.length) { this.reportAt(this.node(args[0]).start, "JSON no válido en JSON.parse (posición " + numberToString(this.jsonAt) + ")"); return; }
    this.attr(call, AttributeKind.TypeArgument, inferred);
  }
  jsonType(text: string, token: ParserToken): string {
    while (this.jsonAt < text.length && jsonSpace(text.charCodeAt(this.jsonAt))) this.jsonAt = this.jsonAt + 1;
    if (this.jsonAt >= text.length) return "";
    const c: string = text.charAt(this.jsonAt);
    if (c == "\"") { if (this.jsonString(text) < 0) return ""; return "string"; }
    if (c == "t" && text.slice(this.jsonAt, this.jsonAt + 4) == "true") { this.jsonAt = this.jsonAt + 4; return "boolean"; }
    if (c == "f" && text.slice(this.jsonAt, this.jsonAt + 5) == "false") { this.jsonAt = this.jsonAt + 5; return "boolean"; }
    if (c == "n" && text.slice(this.jsonAt, this.jsonAt + 4) == "null") { this.jsonAt = this.jsonAt + 4; return "JsonValue"; }
    if (c == "-" || "0123456789".includes(c, 0)) { const start: number = this.jsonAt; this.jsonAt = this.jsonAt + 1; while (this.jsonAt < text.length && "0123456789.eE+-".includes(text.charAt(this.jsonAt), 0)) this.jsonAt = this.jsonAt + 1; return this.jsonAt > start ? "number" : ""; }
    if (c == "[") {
      this.jsonAt = this.jsonAt + 1; let types: string[] = [];
      while (true) {
        while (this.jsonAt < text.length && jsonSpace(text.charCodeAt(this.jsonAt))) this.jsonAt = this.jsonAt + 1;
        if (text.charAt(this.jsonAt) == "]" && types.length == 0) { this.jsonAt = this.jsonAt + 1; return "JsonValue[]"; }
        const element: string = this.jsonType(text, token); if (element == "") return "";
        if (!types.includes(element)) types.push(element);
        while (this.jsonAt < text.length && jsonSpace(text.charCodeAt(this.jsonAt))) this.jsonAt = this.jsonAt + 1;
        if (text.charAt(this.jsonAt) == ",") { this.jsonAt = this.jsonAt + 1; continue; }
        if (text.charAt(this.jsonAt) == "]") { this.jsonAt = this.jsonAt + 1; break; }
        return "";
      }
      return types.length == 1 ? types[0] + "[]" : "(" + types.join("|") + ")[]";
    }
    if (c == "{") {
      this.jsonAt = this.jsonAt + 1; let names: string[] = []; let types: string[] = []; let optionals: boolean[] = []; let tokens: ParserToken[] = [];
      while (true) {
        while (this.jsonAt < text.length && jsonSpace(text.charCodeAt(this.jsonAt))) this.jsonAt = this.jsonAt + 1;
        if (text.charAt(this.jsonAt) == "}" && names.length == 0) { this.jsonAt = this.jsonAt + 1; break; }
        const keyStart: number = this.jsonAt; if (text.charAt(this.jsonAt) != "\"" || this.jsonString(text) < 0) return "";
        const key: string = text.slice(keyStart + 1, this.jsonAt - 1);
        while (this.jsonAt < text.length && jsonSpace(text.charCodeAt(this.jsonAt))) this.jsonAt = this.jsonAt + 1;
        if (text.charAt(this.jsonAt) != ":") return ""; this.jsonAt = this.jsonAt + 1;
        const value: string = this.jsonType(text, token); if (value == "") return "";
        if (!names.includes(key)) { names.push(key); types.push(value); optionals.push(false); tokens.push(token); }
        while (this.jsonAt < text.length && jsonSpace(text.charCodeAt(this.jsonAt))) this.jsonAt = this.jsonAt + 1;
        if (text.charAt(this.jsonAt) == ",") { this.jsonAt = this.jsonAt + 1; continue; }
        if (text.charAt(this.jsonAt) == "}") { this.jsonAt = this.jsonAt + 1; break; }
        return "";
      }
      return this.objectTypeFrom(names, types, optionals, tokens, token, token);
    }
    return "";
  }
  // Avanza sobre un string JSON (con escapes); -1 si no se cierra.
  jsonString(text: string): number {
    this.jsonAt = this.jsonAt + 1;
    while (this.jsonAt < text.length) {
      const c: string = text.charAt(this.jsonAt);
      if (c == "\\") { this.jsonAt = this.jsonAt + 2; continue; }
      if (c == "\"") { this.jsonAt = this.jsonAt + 1; return this.jsonAt; }
      this.jsonAt = this.jsonAt + 1;
    }
    return -1;
  }
  // Tipo de un patrón de objeto sin anotación: un campo con valor por defecto
  // es opcional y tiene el tipo de ese valor; uno sin valor por defecto necesita tipo.
  patternType(pattern: number): string {
    if (this.node(pattern).get(AttributeKind.Pattern) != "object") { this.report("Un patrón de array en un parámetro necesita tipo: añade ': Tipo'"); return "<error>"; }
    let names: string[] = []; let types: string[] = []; let optionals: boolean[] = []; let tokens: ParserToken[] = [];
    for (const edge of this.node(pattern).edges) if (edge.role == EdgeRole.ObjectBindings) {
      const binding: AstNode = this.node(edge.node); const value: number = bindingChildOf(binding, EdgeRole.DefaultValue);
      if (value < 0) { this.reportAt(binding.start, "El campo '" + binding.get(AttributeKind.Property) + "' del patrón necesita tipo: anota el parámetro (por ejemplo { a }: { a: number })"); continue; }
      names.push(binding.get(AttributeKind.Property)); types.push("$valueof$" + numberToString(value)); optionals.push(true); tokens.push(binding.start);
    }
    return this.objectTypeFrom(names, types, optionals, tokens, this.node(pattern).start, this.node(pattern).end);
  }
  // Cuerpo de una función con parámetros desestructurados: primero sus patrones.
  withPatterns(owner: number, body: number): number {
    let patterns: number[] = [];
    for (let at: number = 0; at < this.patternOwners.length; at = at + 1) if (this.patternOwners[at] == owner) patterns.push(this.patternDeclarations[at]);
    if (patterns.length == 0) return body;
    let block: number = body;
    if (this.node(body).kind != NodeKind.BlockStatement) {
      block = this.add(NodeKind.BlockStatement, this.node(body).start, this.node(body).end);
      const result: number = this.add(NodeKind.ReturnStatement, this.node(body).start, this.node(body).end); this.edge(result, EdgeRole.Value, body);
      this.edge(block, EdgeRole.Statements, result);
    }
    let edges: AstEdge[] = [];
    for (const pattern of patterns) for (const item of this.withExtras(pattern)) edges.push(new AstEdge(EdgeRole.Statements, item));
    for (const edge of this.nodes[block].edges) edges.push(edge);
    this.nodes[block].edges = edges;
    return block;
  }
  typeParameters(owner: number, packs: boolean): void {
    if (!this.accept("<")) return;
    this.skipNewlines(); let names: string[] = [];
    if (this.check(">")) this.report("La lista de parámetros de tipo no puede estar vacía");
    while (!this.check(">") && !this.check("eof")) {
      const start: ParserToken = this.peek(0); const variadic: boolean = this.accept("...");
      if (variadic && !packs) this.reportAt(start, "Los packs de tipos no están soportados en esta declaración");
      if (!this.check("identifier")) {
        this.report("Se esperaba un nombre de parámetro de tipo");
        while (!this.check("eof") && !this.check(">") && !this.check(",") && !this.check("(") && !this.check("{") && !this.check(";") && !this.check("=")) this.take();
        if (this.accept(",")) { this.skipNewlines(); continue; } break;
      }
      const name: ParserToken = this.take(); const param: number = this.add(NodeKind.TypeParameter, start, name); let end: ParserToken = name;
      this.attr(param, AttributeKind.Name, name.lexeme);
      if (names.includes(name.lexeme)) this.reportAt(name, "Parámetro de tipo duplicado '" + name.lexeme + "'");
      names.push(name.lexeme);
      if (variadic) { this.attr(param, AttributeKind.Variadic, "true"); this.attr(owner, AttributeKind.VariadicTypeParameter, name.lexeme); }
      this.skipNewlines();
      if (this.accept("extends")) { this.skipNewlines(); this.attr(param, AttributeKind.Constraint, this.typeName()); end = this.previous(); }
      this.skipNewlines();
      if (this.accept("=")) { this.skipNewlines(); this.attr(param, AttributeKind.Default, this.typeName()); end = this.previous(); }
      this.setEnd(param, end); this.edge(owner, EdgeRole.TypeParameters, param); this.skipNewlines();
      if (this.accept(",")) { this.skipNewlines(); continue; }
      if (this.check(">")) break;
      this.report("Se esperaba ',' o '>' después del parámetro de tipo");
      if (!this.check("identifier") && !this.check("...")) break;
    }
    this.closeAngle();
  }
  functionDeclaration(allowAnonymous: boolean): number {
    const keyword: ParserToken = this.take(); const isAsync: boolean = keyword.kind == "async";
    if (isAsync) this.expect("function");
    const decorators: number[] = this.decorators();
    const anonymous: boolean = allowAnonymous && (this.check("(") || this.check("<"));
    const name: ParserToken = anonymous ? this.peek(0) : this.expect("identifier");
    const result: number = this.add(NodeKind.FunctionDeclaration, keyword, name);
    this.prependDecorators(result, decorators);
    if (anonymous) this.attr(result, AttributeKind.Anonymous, "true"); else this.attr(result, AttributeKind.Name, name.lexeme);
    this.attr(result, AttributeKind.Async, isAsync ? "true" : "false");
    this.typeParameters(result, true); this.parametersInto(result, false, false);
    this.attr(result, AttributeKind.ReturnType, this.returnType(anonymous ? "La función" : "La función '" + name.lexeme + "'"));
    let body: number = -1;
    if (this.accept(";")) body = this.add(NodeKind.BlockStatement, this.previous(), this.previous());
    else { const open: ParserToken = this.expect("{"); body = this.withPatterns(result, this.block(open)); }
    this.edge(result, EdgeRole.Body, body); this.setEnd(result, this.node(body).end); return result;
  }
  classDeclaration(keyword: ParserToken, allowAnonymous: boolean): number {
    const decorators: number[] = this.decorators();
    const anonymous: boolean = allowAnonymous && (this.check("{") || this.check("<"));
    const name: ParserToken = anonymous ? this.peek(0) : this.expect("identifier"); const result: number = this.add(NodeKind.ClassDeclaration, keyword, name);
    this.prependDecorators(result, decorators);
    if (anonymous) this.attr(result, AttributeKind.Anonymous, "true"); else this.attr(result, AttributeKind.Name, name.lexeme);
    this.typeParameters(result, true); this.expect("{");
    while (!this.check("}") && !this.check("eof")) {
      this.skipNewlines(); if (this.check("}") || this.check("eof")) break;
      if (!this.accept(";")) {
        const before: number = this.current;
        const memberDecorators: number[] = this.decorators();
        if (this.check("}") || this.check("eof")) { this.report("El decorador necesita un miembro de clase"); break; }
        let access: string = "";
        if (this.check("public") || this.check("private") || this.check("protected")) access = this.take().lexeme;
        let isReadonly: boolean = this.accept("readonly"); const isStatic: boolean = this.accept("static");
        if (!isReadonly) isReadonly = this.accept("readonly");
        // `async metodo()`: `async` solo es modificador si le sigue el nombre del método.
        let isAsync: boolean = false;
        if (this.check("async") && this.peek(1).kind == "identifier") { this.take(); isAsync = true; }
        // #200: un operador se declara como método con el nombre entre comillas ("+"(o: T): T).
        const quoted: boolean = this.check("string");
        const member: ParserToken = quoted ? this.take() : this.expect("identifier");
        if (quoted && !operatorMethodNames().includes(member.lexeme)) this.reportAt(member, "'" + member.lexeme + "' no es un operador que se pueda definir; se admiten: " + operatorMethodNames().join(" "));
        if (quoted && !(this.check("(") || this.check("<"))) this.reportAt(member, "Un operador se define como método: \"" + member.lexeme + "\"(...): T { ... }");
        if (quoted && isStatic) this.reportAt(member, "Un operador no puede ser static: se busca en la clase del operando izquierdo");
        const item: number = this.add(NodeKind.ClassField, member, member); this.attr(item, AttributeKind.Name, member.lexeme);
        this.prependDecorators(item, memberDecorators);
        if (access != "") this.attr(item, AttributeKind.Access, access);
        if (isStatic) this.attr(item, AttributeKind.IsStatic, "true");
        if (isReadonly) this.attr(item, AttributeKind.Readonly, "true");
        if (this.check("(") || this.check("<")) {
          this.setKind(item, NodeKind.ClassMethod); if (isAsync) this.attr(item, AttributeKind.Async, "true"); this.typeParameters(item, false); this.parametersInto(item, false, member.lexeme == "constructor" && !isStatic);
          let returnType: string = "void";
          if (this.accept(":")) returnType = this.typeName();
          else if (member.lexeme != "constructor") this.report(this.missingReturnType("El método '" + member.lexeme + "'"));
          this.attr(item, AttributeKind.ReturnType, returnType);
          const open: ParserToken = this.expect("{"); const body: number = this.withPatterns(item, this.block(open));
          this.edge(item, EdgeRole.Body, body); this.setEnd(item, this.node(body).end);
          this.edge(result, EdgeRole.Methods, item);
        } else {
          if (isAsync) this.report("'async' solo puede ir delante de un método");
          this.expect(":"); this.attr(item, AttributeKind.Type, this.typeName());
          if (this.accept("=")) this.edge(item, EdgeRole.DefaultValue, this.expression());
          this.setEnd(item, this.terminator()); this.edge(result, EdgeRole.Fields, item);
        }
        if (this.current == before) { this.report("Miembro de clase no reconocido"); this.take(); }
      }
    }
    this.setEnd(result, this.expect("}")); return result;
  }
  // { a: T; b?: U } en un tipo: una interfaz sintética con nombre estable por
  // forma (campos y tipos, sin importar el orden). La misma forma se reutiliza.
  // #226: { [K in …] …: … } (con readonly/+readonly/-readonly delante).
  mappedStart(): boolean {
    let at: number = 0; while (this.peek(at).kind == "newline") at = at + 1;
    if (this.peek(at).kind == "-" || this.peek(at).kind == "+") at = at + 1;
    if (this.peek(at).kind == "readonly") at = at + 1;
    return this.peek(at).kind == "[" && this.peek(at + 1).kind == "identifier" && this.peek(at + 2).kind == "in";
  }
  // { [K in Claves]?: V }: una interfaz derivada "Mapped" con la especificación
  // claves~modificadores~valor (K en el valor es $key$). Dentro de un alias genérico
  // que la usa con sus parámetros queda como $mapped<…> y se expande en cada uso.
  mappedType(open: ParserToken): string {
    this.skipNewlines(); let readonlyMod: string = "";
    if (this.check("-") || this.check("+")) { readonlyMod = this.take().kind; this.expect("readonly"); } else if (this.accept("readonly")) readonlyMod = "+";
    this.expect("["); const key: ParserToken = this.expect("identifier"); this.expect("in");
    const keys: string = this.typeName();
    if (this.check("as")) { this.report("El remapeo de claves con 'as' en un mapped type todavía no está soportado"); while (!this.check("]") && !this.check("eof")) this.take(); }
    this.expect("]"); let optionalMod: string = "";
    if (this.check("-") || this.check("+")) { optionalMod = this.take().kind; this.expect("?"); } else if (this.accept("?")) optionalMod = "+";
    this.expect(":"); const outerKey: string = this.mappedKey; this.mappedKey = key.lexeme;
    const value: string = this.typeName(); this.mappedKey = outerKey;
    if (!this.accept(";")) this.accept(","); this.skipNewlines(); this.expect("}");
    // Modificadores como dígitos (0 sin cambio, 1 añade, 2 quita): sin letras que el binder lea como nombres.
    const spec: string = keys + "~" + (readonlyMod == "+" ? "1" : readonlyMod == "-" ? "2" : "0") + (optionalMod == "+" ? "1" : optionalMod == "-" ? "2" : "0") + "~" + value;
    let generic: boolean = false;
    for (const param of this.aliasParams) if (containsWord(spec, param)) generic = true;
    if (generic) return "$mapped<" + spec + ">";
    let none: string[] = []; return this.derivedType("Mapped", spec, none, open);
  }
  objectType(): string {
    const open: ParserToken = this.take();
    if (this.mappedStart()) return this.mappedType(open);
    this.skipNewlines();
    if (this.indexSignatureStart()) {
      const signature: string = this.indexSignature(); if (!this.accept(";")) this.accept(","); this.skipNewlines();
      if (!this.check("}")) this.report("Un tipo objeto con campos fijos y una index signature todavía no está soportado");
      while (!this.check("}") && !this.check("eof")) this.take();
      this.expect("}"); return signature;
    }
    let names: string[] = []; let types: string[] = []; let optionals: boolean[] = []; let tokens: ParserToken[] = [];
    this.skipNewlines();
    while (!this.check("}") && !this.check("eof")) {
      const before: number = this.current;
      const member: ParserToken = this.check("string") ? this.take() : this.expect("identifier");
      const optional: boolean = this.accept("?"); this.expect(":"); const memberType: string = this.typeName();
      if (names.includes(member.lexeme)) this.reportAt(member, "Campo duplicado '" + member.lexeme + "' en el tipo objeto");
      names.push(member.lexeme); types.push(memberType); optionals.push(optional); tokens.push(member);
      if (!this.accept(";")) this.accept(",");
      this.skipNewlines();
      if (this.current == before) { this.report("Miembro de tipo objeto no reconocido"); this.take(); }
    }
    const close: ParserToken = this.expect("}");
    return this.objectTypeFrom(names, types, optionals, tokens, open, close);
  }
  // La interfaz sintética de una forma; la misma forma da el mismo nombre.
  objectTypeFrom(names: string[], types: string[], optionals: boolean[], tokens: ParserToken[], open: ParserToken, close: ParserToken): string {
    let order: number[] = []; for (let at: number = 0; at < names.length; at = at + 1) order.push(at);
    order.sort((a: number, b: number): number => compareText(names[a], names[b]));
    let key: string = ""; let label: string = "";
    for (const at of order) { key = key + names[at] + (optionals[at] ? "?:" : ":") + types[at] + ";"; label = label + "_" + names[at]; }
    let hash: number = 0;
    for (let at: number = 0; at < key.length; at = at + 1) hash = (hash * 31 + key.charCodeAt(at)) % 4294967296;
    const name: string = "__Obj" + label + "_" + numberToString(hash);
    if (!this.objectTypeNames.includes(name)) {
      const declaration: number = this.add(NodeKind.InterfaceDeclaration, open, close); this.attr(declaration, AttributeKind.Name, name);
      for (let at: number = 0; at < names.length; at = at + 1) {
        const item: number = this.add(NodeKind.InterfaceField, tokens[at], tokens[at]); this.attr(item, AttributeKind.Name, names[at]);
        this.attr(item, AttributeKind.Type, types[at]); this.attr(item, AttributeKind.Optional, optionals[at] ? "true" : "false"); this.edge(declaration, EdgeRole.Fields, item);
      }
      this.objectTypes.push(declaration); this.objectTypeNames.push(name);
    }
    return name;
  }
  // Partial/Required/Pick/Omit<X>: interfaz sintética sin campos que el binder
  // rellena a partir de X (Underlying = "Tipo#X#claves").
  derivedType(kind: string, source: string, keys: string[], token: ParserToken): string {
    let label: string = ""; for (let at: number = 0; at < source.length; at = at + 1) { const code: number = source.charCodeAt(at); if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code == 95) label = label + source.charAt(at); }
    const key: string = kind + "#" + source + "#" + keys.join(","); let hash: number = 0;
    for (let at: number = 0; at < key.length; at = at + 1) hash = (hash * 31 + key.charCodeAt(at)) % 4294967296;
    const name: string = "__" + kind + "_" + label + "_" + numberToString(hash);
    if (!this.objectTypeNames.includes(name)) {
      const declaration: number = this.add(NodeKind.InterfaceDeclaration, token, token); this.attr(declaration, AttributeKind.Name, name); this.attr(declaration, AttributeKind.Underlying, key);
      this.objectTypes.push(declaration); this.objectTypeNames.push(name);
    }
    return name;
  }
  // "a" | "b" (tipos literales de string) -> [a, b].
  literalKeys(text: string): string[] {
    let keys: string[] = [];
    for (const part of text.split(" | ")) { if (part.startsWith("$lit:string=")) keys.push(part.slice(12, part.length)); else this.report("Las claves de Pick/Omit/Record tienen que ser literales de string (\"a\" | \"b\")"); }
    return keys;
  }
  interfaceDeclaration(keyword: ParserToken): number {
    const decorators: number[] = this.decorators();
    const name: ParserToken = this.expect("identifier"); const result: number = this.add(NodeKind.InterfaceDeclaration, keyword, name);
    this.prependDecorators(result, decorators);
    this.attr(result, AttributeKind.Name, name.lexeme); this.expect("{");
    let indexType: string = ""; let members: number = 0;
    while (!this.check("}") && !this.check("eof")) {
      this.skipNewlines(); if (this.check("}") || this.check("eof")) break;
      // #232: [clave: string]: T (index signature).
      if (this.indexSignatureStart()) { const signature: string = this.indexSignature(); if (indexType != "") this.report("Una interfaz solo puede tener una index signature"); indexType = signature; this.terminator(); continue; }
      members = members + 1;
      const before: number = this.current; const memberDecorators: number[] = this.decorators();
      if (this.check("}") || this.check("eof")) { this.report("El decorador necesita un miembro de interface"); break; }
      const member: ParserToken = this.expect("identifier");
      const item: number = this.add(NodeKind.InterfaceField, member, member); this.attr(item, AttributeKind.Name, member.lexeme);
      this.prependDecorators(item, memberDecorators);
      if (this.check("(") || this.check("<")) {
        this.setKind(item, NodeKind.InterfaceMethod); this.typeParameters(item, false); this.parametersInto(item, false, false);
        this.attr(item, AttributeKind.ReturnType, this.returnType("El método '" + member.lexeme + "'")); this.edge(result, EdgeRole.Methods, item);
      } else {
        const optional: boolean = this.accept("?"); this.expect(":"); this.attr(item, AttributeKind.Type, this.typeName());
        this.attr(item, AttributeKind.Optional, optional ? "true" : "false"); this.edge(result, EdgeRole.Fields, item);
      }
      this.setEnd(item, this.terminator());
      if (this.current == before) { this.report("Miembro de interface no reconocido"); this.take(); }
    }
    this.setEnd(result, this.expect("}"));
    // #232: una interfaz que solo es una index signature es un Record (diccionario).
    if (indexType != "") {
      if (members > 0) this.report("Una interfaz con campos fijos y una index signature todavía no está soportada: pon el diccionario en un campo (extra: Record<string, T>)");
      else { this.setKind(result, NodeKind.TypeAliasDeclaration); this.attr(result, AttributeKind.Type, indexType); }
    }
    return result;
  }
  indexSignatureStart(): boolean {
    let at: number = 0; if (this.peek(0).kind == "readonly") at = 1;
    return this.peek(at).kind == "[" && this.peek(at + 1).kind == "identifier" && this.peek(at + 2).kind == ":";
  }
  // [clave: string | number]: T → Map<clave, T> (lo mismo que Record<clave, T>).
  indexSignature(): string {
    if (this.accept("readonly")) this.report("Una index signature readonly todavía no está soportada");
    this.expect("["); this.expect("identifier"); this.expect(":"); const key: string = this.typeName(); this.expect("]");
    if (key != "string" && key != "number") this.report("La clave de una index signature tiene que ser string o number");
    this.expect(":"); return "Map<" + key + "," + this.typeName() + ">";
  }
  forStatement(keyword: ParserToken): number {
    const awaited: boolean = this.accept("await"); this.expect("(");
    const result: number = this.add(NodeKind.ForStatement, keyword, keyword);
    let iteration: boolean = false; let pattern: number = -1; let patternName: string = "";
    if (this.check("let") || this.check("const")) {
      const saved: number = this.current;
      let cursor: number = 0; let depth: number = 0;
      while (this.peek(cursor).kind != "eof" && !iteration) {
        const kind: string = this.peek(cursor).kind;
        if (kind == "(") depth = depth + 1;
        else if (kind == ")") { if (depth == 0) break; depth = depth - 1; }
        else if (depth == 0) {
          if (kind == ";") break;
          if (kind == "of" || kind == "in") iteration = true;
        }
        cursor = cursor + 1;
      }
      if (iteration) {
        const bindingKeyword: ParserToken = this.take();
        let binding: number = -1;
        if (this.check("[") || this.check("{")) {
          // for (const [k, v] of x) se reescribe como
          // for (const __forN of x) { const [k, v] = __forN; ... } (destructuring normal).
          pattern = this.add(NodeKind.VariableDeclaration, bindingKeyword, this.peek(0));
          this.attr(pattern, AttributeKind.Mutable, bindingKeyword.kind == "let" ? "true" : "false");
          this.bindingPattern(pattern, this.check("["));
          if (this.accept(":")) this.attr(pattern, AttributeKind.DeclaredType, this.typeName());
          this.setEnd(pattern, this.previous());
          patternName = "__for" + numberToString(result);
          binding = this.add(NodeKind.VariableDeclaration, bindingKeyword, bindingKeyword);
          this.attr(binding, AttributeKind.Name, patternName); this.attr(binding, AttributeKind.Mutable, "false");
        } else {
          const name: ParserToken = this.expect("identifier");
          binding = this.add(NodeKind.VariableDeclaration, bindingKeyword, name);
          this.attr(binding, AttributeKind.Name, name.lexeme); this.attr(binding, AttributeKind.Mutable, bindingKeyword.kind == "let" ? "true" : "false");
          if (this.accept(":")) this.attr(binding, AttributeKind.DeclaredType, this.typeName());
        }
        const iterationToken: ParserToken = this.take();
        this.setKind(result, iterationToken.kind == "of" ? NodeKind.ForOfStatement : NodeKind.ForInStatement);
        if (iterationToken.kind == "of") this.attr(result, AttributeKind.Await, awaited ? "true" : "false");
        else if (awaited) this.report("for await requiere of");
        this.edge(result, EdgeRole.Binding, binding);
        const iterable: number = this.expression(); this.edge(result, iterationToken.kind == "of" ? EdgeRole.Iterable : EdgeRole.Target, iterable);
      } else { this.current = saved; this.edge(result, EdgeRole.Initializer, this.variable(true)); }
    } else if (!this.accept(";")) {
      const value: number = this.expression(); const init: number = this.add(NodeKind.ExpressionStatement, this.node(value).start, this.terminator());
      this.edge(init, EdgeRole.Expression, value); this.edge(result, EdgeRole.Initializer, init);
    }
    if (!iteration) {
      if (awaited) this.report("for await requiere of");
      if (!this.check(";")) this.edge(result, EdgeRole.Condition, this.expression());
      this.expect(";"); if (!this.check(")")) this.edge(result, EdgeRole.Increment, this.expression());
    }
    this.expect(")"); let body: number = this.statement(false);
    if (pattern >= 0) {
      // Bloque con el destructuring del patrón y después el cuerpo original.
      const source: number = this.add(NodeKind.IdentifierExpression, this.previous(), this.previous());
      this.attr(source, AttributeKind.Name, patternName); this.edge(pattern, EdgeRole.Initializer, source);
      const block: number = this.add(NodeKind.BlockStatement, this.previous(), this.previous());
      this.finishPattern(pattern); this.pushStatement(block, EdgeRole.Statements, pattern); this.edge(block, EdgeRole.Statements, body);
      this.nodes[block].end = this.node(body).end; body = block;
    }
    this.edge(result, EdgeRole.Body, body);
    this.setEnd(result, this.node(body).end); return result;
  }
  // Una palabra clave (for, delete, default, new…) usada como nombre tras un punto.
  keywordWord(token: ParserToken): boolean {
    if (token.kind == "string" || token.kind == "number" || token.kind == "identifier" || token.lexeme.length == 0) return false;
    for (let at: number = 0; at < token.lexeme.length; at = at + 1) { const code: number = token.lexeme.charCodeAt(at); if (!((code >= 97 && code <= 122) || (code >= 65 && code <= 90))) return false; }
    return true;
  }
  typeName(): string {
    if (!this.enter()) return "<error>";
    const outerConst: boolean = this.constMemory; this.constMemory = false; const outerOperand: boolean = this.typeOperand; this.typeOperand = false;
    let result: string = this.typeInner(); this.constMemory = outerConst; this.typeOperand = outerOperand;
    // #231: `x is T` como tipo de retorno (type predicate) → $pred<$param$x$,T>.
    if (this.check("identifier") && this.peek(0).lexeme == "is" && simpleTypeName(result)) { this.take(); result = "$pred<$param$" + result + "$," + this.typeName() + ">"; this.leave(); return result; }
    // #227: C extends P ? X : Y. Con C un parámetro del alias, se distribuye sobre uniones.
    if (this.check("extends") && !outerOperand) {
      this.take(); const check: string = result;
      const outerCollecting: boolean = this.inferCollecting; const outerNames: string[] = this.inferNames; this.inferCollecting = true; this.inferNames = [];
      const pattern: string = this.typeInner(); const bound: string[] = this.inferNames;
      this.inferCollecting = outerCollecting; this.inferNames = outerNames;
      this.expect("?");
      const outerVisible: string[] = this.inferVisible; this.inferVisible = outerVisible.concat(bound);
      const yes: string = this.typeName(); this.inferVisible = outerVisible;
      this.expect(":"); const no: string = this.typeName();
      result = (this.aliasParams.includes(check.trim()) ? "$dcond<" : "$cond<") + check + "," + pattern + "," + yes + "," + no + ">";
    }
    this.leave(); return result;
  }
  // Un literal usado como tipo se codifica con el prefijo `$lit:` seguido
  // del tipo y el valor separados por `=`. El prefijo no puede colisionar con
  // un identificador: el lexer solo admite letras, `_` y digitos. El valor se
  // escapa para que un `|` o un `=` no rompan el texto canonico.
  literalType(): string {
    const token: ParserToken = this.peek(0);
    if (token.kind == "string") { this.take(); return "$lit:string=" + escapeLiteralValue(token.lexeme); }
    if (token.kind == "number") { this.take(); return "$lit:number=" + escapeLiteralValue(this.numericText(token)); }
    if (token.kind == "true" || token.kind == "false") { this.take(); return "$lit:boolean=" + token.lexeme; }
    return "";
  }
  typeInner(): string {
    if (this.accept("readonly")) return "readonly<" + this.typeName() + ">";
    // Sintaxis estilo C++ de los modificadores de memoria:
    //   const T& -> constRef<T>   const T* -> constPtr<T>
    if (this.check("const")) {
      const keyword: ParserToken = this.take(); this.constMemory = true;
      const constant: string = this.typeInner();
      if (this.constMemory) { this.constMemory = false; this.reportAt(keyword, "'const' en un tipo requiere '&' (constRef) o '*' (constPtr)"); }
      return constant;
    }
    if (this.check("{")) return this.typeSuffix(this.objectType());
    // #230: `texto${T}texto` como tipo → $tpl<partes> (lo combina el checker).
    if (this.accept("template-start")) {
      let parts: string[] = [];
      while (!this.check("template-end") && !this.check("eof")) {
        if (this.check("template-text")) { const text: string = this.take().lexeme; if (text != "") parts.push("$lit:string=" + escapeLiteralValue(text)); }
        else if (this.accept("interpolation-start")) { parts.push(this.typeName()); this.expect("interpolation-end"); }
        else { this.report("Se esperaba texto o ${tipo} en un template literal type"); break; }
      }
      this.expect("template-end");
      if (parts.length == 0) parts.push("$lit:string=");
      return this.typeSuffix("$tpl<" + parts.join(",") + ">");
    }
    // #231: `asserts x is T` como tipo de retorno → $assert<$param$x$,T>.
    if (this.check("identifier") && this.peek(0).lexeme == "asserts" && this.peek(1).kind == "identifier" && this.peek(2).kind == "identifier" && this.peek(2).lexeme == "is") {
      this.take(); const name: string = this.take().lexeme; this.take(); return "$assert<$param$" + name + "$," + this.typeName() + ">";
    }
    // #224: keyof T → keyof<T> (lo resuelve el checker).
    if (this.check("identifier") && this.peek(0).lexeme == "keyof" && ["identifier","type","typeof","{","(","["].includes(this.peek(1).kind)) {
      this.take(); const outer: boolean = this.typeOperand; this.typeOperand = true;
      const operand: string = this.typeInner(); this.typeOperand = outer;
      return this.typeSuffix("keyof<" + operand + ">");
    }
    // #228: infer U dentro de la condición de un tipo condicional.
    if (this.check("identifier") && this.peek(0).lexeme == "infer" && this.peek(1).kind == "identifier") {
      const keyword: ParserToken = this.take(); const name: ParserToken = this.take();
      if (!this.inferCollecting) this.reportAt(keyword, "'infer' solo puede ir en la condición de un tipo condicional (T extends … infer U … ? X : Y)");
      else if (!this.inferNames.includes(name.lexeme)) this.inferNames.push(name.lexeme);
      return this.typeSuffix("$infer$" + name.lexeme + "$");
    }
    if (this.check("identifier") && this.inferVisible.includes(this.peek(0).lexeme) && this.peek(1).kind != "." && this.peek(1).kind != "<") return this.typeSuffix("$infer$" + this.take().lexeme + "$");
    if (this.check("identifier") && this.mappedKey != "" && this.peek(0).lexeme == this.mappedKey && this.peek(1).kind != "." && this.peek(1).kind != "<") { this.take(); return this.typeSuffix("$key$"); }
    if (this.accept("typeof")) {
      let query: string = "$typeof$" + this.expect("identifier").lexeme;
      while (this.accept(".")) query = query + "." + (this.check("default") ? this.take().lexeme : this.expect("identifier").lexeme);
      return this.typeSuffix(query);
    }
    if (this.accept("(")) {
      if (!this.check(")") && !(this.check("identifier") && this.peek(1).kind == ":")) {
        const grouped: string = this.typeName(); this.expect(")"); return this.typeSuffix("(" + grouped + ")");
      }
      let params: string[] = [];
      while (!this.check(")") && !this.check("eof")) {
        this.expect("identifier"); this.expect(":"); params.push(this.typeName()); if (!this.accept(",")) break;
      }
      this.expect(")"); this.expect("=>"); return "(" + params.join(",") + ")=>" + this.typeName();
    }
    if (this.accept("[")) {
      let parts: string[] = [];
      while (!this.check("]") && !this.check("eof")) { parts.push(this.typeName()); if (!this.accept(",")) break; }
      this.expect("]"); return this.typeSuffix("[" + parts.join(",") + "]");
    }
    let result: string = "";
    const literal: string = this.literalType();
    if (literal != "") return this.typeSuffix(literal);
    if (this.check("identifier") || this.check("type")) result = this.take().lexeme;
    else { this.report("E1005: Se esperaba un tipo y se encontró " + this.found() + this.foundArg()); if (!this.check("eof")) this.take(); return "<error>"; }
    while (this.accept(".")) { if (this.check("default")) result = result + "." + this.take().lexeme; else result = result + "." + this.expect("identifier").lexeme; }
    if (this.accept("<")) {
      let args: string[] = [];
      while (!this.check(">") && !this.check("eof")) { args.push(this.typeName()); if (!this.accept(",")) break; }
      this.closeAngle();
      if (result == "Array" && args.length == 1) result = args[0] + "[]";
      else if ((result == "Partial" || result == "Required" || result == "Readonly") && args.length == 1) { let none: string[] = []; result = this.derivedType(result, args[0], none, this.previous()); }
      // Record<"a" | "b", V> es un struct con esos campos; Record<K, V> con K abierto, un Map ordenado.
      else if (result == "Record" && args.length == 2 && args[0].startsWith("$lit:string=")) result = this.derivedType("Record", args[1], this.literalKeys(args[0]), this.previous());
      else if (result == "Record" && args.length == 2) result = "Map<" + args[0] + "," + args[1] + ">";
      else if ((result == "Pick" || result == "Omit") && args.length == 2) result = this.derivedType(result, args[0], this.literalKeys(args[1]), this.previous());
      else result = result + "<" + args.join(",") + ">";
    }
    return this.typeSuffix(result);
  }
  typeSuffix(input: string): string {
    let result: string = input;
    while (this.accept("[")) {
      let size: string = "";
      // T[3] / T[N]: array fijo; T["campo"], T[number], T[keyof U], T["a" | "b"]: acceso por índice (#225).
      if (!this.check("]")) {
        if (this.check("identifier") && this.peek(1).kind == "]" && this.mappedKey != "" && this.peek(0).lexeme == this.mappedKey) { this.take(); size = "$key$"; }
        else if (this.check("identifier") && this.peek(1).kind == "]" && this.inferVisible.includes(this.peek(0).lexeme)) size = "$infer$" + this.take().lexeme + "$";
        else if ((this.check("number") || this.check("identifier")) && this.peek(1).kind == "]" && this.peek(0).lexeme != "keyof") size = this.take().lexeme;
        else if (this.check("string") || this.check("type") || this.check("identifier") || this.check("(")) size = this.typeName();
        else this.report("Tamaño de array no válido");
      }
      this.expect("]"); result = result + "[" + size + "]";
    }
    //   T& -> ref<T>   T* -> ptr<T>   (con const delante: constRef / constPtr)
    // Un `&` seguido de otro tipo sigue siendo una interseccion (`A & B`), y un
    // `*` seguido de un operando sigue siendo una multiplicacion (`x as n * 2`).
    while ((this.check("&") || this.check("*")) && this.memoryModifierEnd(this.peek(1).kind)) {
      const pointer: boolean = this.take().kind == "*";
      if (this.constMemory) { this.constMemory = false; result = (pointer ? "constPtr<" : "constRef<") + result + ">"; }
      else result = (pointer ? "ptr<" : "ref<") + result + ">";
    }
    if (this.typeOperand) return result;
    while (this.accept("|")) result = result + " | " + this.typeName();
    while (this.accept("&")) result = result + " & " + this.typeName();
    return result;
  }
  // Tokens que pueden seguir a un `&`/`*` usado como modificador de memoria.
  memoryModifierEnd(kind: string): boolean {
    return kind == ")" || kind == "," || kind == ">" || kind == "=" || kind == ";" || kind == "]" || kind == "|"
      || kind == "&" || kind == "*" || kind == "{" || kind == "}" || kind == "newline" || kind == "eof" || kind == "=>"
      || kind == "?" || kind == ":";
  }
  expression(): number {
    const token: ParserToken = this.peek(0);
    if (!this.enter()) return this.add(NodeKind.ErrorNode, token, token);
    let result: number = -1;
    if (this.arrowStart()) result = this.arrow();
    else result = this.assignment();
    if (this.accept("?")) {
      const yes: number = this.expression(); this.expect(":"); const no: number = this.expression();
      const conditional: number = this.add(NodeKind.TernaryExpression, this.node(result).start, this.node(no).end);
      this.edge(conditional, EdgeRole.Condition, result); this.edge(conditional, EdgeRole.ThenBranch, yes); this.edge(conditional, EdgeRole.ElseBranch, no); result = conditional;
    }
    this.leave(); return result;
  }
  arrowStart(): boolean {
    let cursor: number = this.check("async") ? 1 : 0;
    if (this.peek(cursor).kind != "(") return false;
    let depth: number = 0;
    while (this.peek(cursor).kind != "eof") {
      const kind: string = this.peek(cursor).kind;
      if (kind == "(") depth = depth + 1;
      else if (kind == ")") { depth = depth - 1; if (depth == 0) break; }
      cursor = cursor + 1;
    }
    cursor = cursor + 1;
    if (this.peek(cursor).kind == "=>") return true;
    if (this.peek(cursor).kind != ":") return false;
    while (this.peek(cursor).kind != "eof" && this.peek(cursor).kind != ";" && this.peek(cursor).kind != "{" && this.peek(cursor).kind != "newline") {
      if (this.peek(cursor).kind == "=>") return true;
      // #369: `Promise<void>=>` llega como `>=` `>` contiguos.
      if ((this.peek(cursor).kind == ">=" || this.peek(cursor).kind == ">>=") && this.peek(cursor+1).kind == ">" && this.peek(cursor+1).offset == this.peek(cursor).endOffset) return true;
      cursor = cursor + 1;
    }
    return false;
  }
  arrow(): number {
    const isAsync: boolean = this.accept("async"); const open: ParserToken = this.peek(0);
    const result: number = this.add(NodeKind.ArrowFunctionExpression, open, open);
    this.attr(result, AttributeKind.IsAsync, isAsync ? "true" : "false"); this.parametersInto(result, true, false);
    if (this.accept(":")) this.attr(result, AttributeKind.ReturnType, this.typeName());
    this.expect("=>"); let body: number = -1;
    if (this.accept("{")) body = this.block(this.previous()); else { body = this.expression(); this.pendingNames = []; this.pendingTypes = []; }
    body = this.withPatterns(result, body);
    this.edge(result, EdgeRole.Body, body); this.setEnd(result, this.node(body).end); return result;
  }
  assignment(): number {
    const left: number = this.binary(1); const op: ParserToken = this.peek(0);
    const operators: string[] = ["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>="];
    if (!operators.includes(op.kind)) return left;
    this.take();
    if (!this.enter()) return left;
    // El lado derecho es una expresión completa: x = c ? a : b, f = (): void => {}.
    const right: number = this.expression(); this.leave();
    const kind: NodeKind = this.node(left).kind;
    if (kind != NodeKind.IdentifierExpression && kind != NodeKind.MemberExpression && kind != NodeKind.IndexExpression) this.report("E1007: El lado izquierdo de una asignación debe ser una variable, un campo o un índice");
    const result: number = this.add(op.kind == "=" ? NodeKind.AssignmentExpression : NodeKind.CompoundAssignmentExpression, this.node(left).start, this.node(right).end);
    if (op.kind != "=") this.attr(result, AttributeKind.Operator, op.lexeme);
    this.edge(result, EdgeRole.Target, left); this.edge(result, EdgeRole.Value, right); return result;
  }
  binaryKind(): string {
    const first: ParserToken = this.peek(0); const second: ParserToken = this.peek(1);
    if ((first.kind == "<" || first.kind == ">" || first.kind == "*") && second.kind == first.kind && first.endOffset == second.offset) return first.kind + second.kind;
    return first.kind;
  }
  precedence(kind: string): number {
    if (kind == "??") return 1; if (kind == "||") return 2; if (kind == "&&") return 3;
    if (kind == "==" || kind == "!=") return 4;
    if (kind == "<" || kind == "<=" || kind == ">" || kind == ">=" || kind == "instanceof" || kind == "in") return 5;
    // Precedencia de los operadores bitwise: `|` es el mas bajo, luego `^`,
    // luego `&`, y por ultimo el desplazamiento. Igual que en TypeScript:
    // `a | b & c` es `a | (b & c)`, no `(a | b) & c`.
    if (kind == "|") return 6;
    if (kind == "^") return 7;
    if (kind == "&") return 8;
    if (kind == "<<" || kind == ">>") return 9;
    if (kind == "+" || kind == "-") return 10;
    if (kind == "*" || kind == "/" || kind == "%") return 11;
    if (kind == "**") return 12;
    return 0;
  }
  binary(minimum: number): number {
    let left: number = this.unary();
    while (this.precedence(this.binaryKind()) >= minimum) {
      const kind: string = this.binaryKind(); const before: ParserToken = this.previous(); const op: ParserToken = this.take(); if (kind != op.kind) this.take();
      if (!this.enter()) return left;
      let right: number = -1;
      if (kind == "instanceof") { const annotation: string = this.typeName(); right = this.add(NodeKind.IdentifierExpression, op, op); this.attr(right, AttributeKind.Name, annotation); }
      // `**` asocia por la derecha: 2 ** 3 ** 2 es 2 ** (3 ** 2).
      else right = this.binary(kind == "**" ? this.precedence(kind) : this.precedence(kind) + 1);
      if (kind == "**" && this.node(left).kind == NodeKind.UnaryExpression && this.node(left).end.offset == before.offset) this.reportAt(op,"E1004: Como en TypeScript, el operando izquierdo de '**' no puede ser una expresión unaria: usa paréntesis, (-a) ** b");
      this.leave(); const parent: number = this.add(NodeKind.BinaryExpression, this.node(left).start, this.node(right).end);
      this.attr(parent, AttributeKind.Operator, kind); this.edge(parent, EdgeRole.Left, left); this.edge(parent, EdgeRole.Right, right); left = parent;
    }
    return left;
  }
  unary(): number {
    const op: ParserToken = this.peek(0);
    if (op.kind == "++" || op.kind == "--") {
      this.take(); this.skipNewlines();
      if (!this.enter()) return this.add(NodeKind.ErrorNode,op,op);
      const target: number = this.unary(); this.leave(); return this.update(target,op,true);
    }
    if (op.kind == "!" || op.kind == "-" || op.kind == "+" || op.kind == "~" || op.kind == "typeof" || op.kind == "await") {
      this.take(); if (!this.enter()) return this.add(NodeKind.ErrorNode, op, op);
      const operand: number = this.unary(); this.leave();
      const result: number = this.add(op.kind == "await" ? NodeKind.AwaitExpression : NodeKind.UnaryExpression, op, this.node(operand).end);
      if (op.kind != "await") this.attr(result, AttributeKind.Operator, op.lexeme);
      this.edge(result, EdgeRole.Operand, operand); return result;
    }
    let operand: number = this.postfix();
    if ((this.check("++") || this.check("--")) && this.peek(0).line == this.node(operand).end.endLine) operand = this.update(operand,this.take(),false);
    if (this.check("as") || this.check("satisfies")) {
      const op: ParserToken = this.take(); const annotation: string = this.typeName();
      const next: ParserToken = this.peek(0);
      const end: ParserToken = new ParserToken("", "", next.offset, next.line, next.column, next.offset, next.line, next.column);
      const result: number = this.add(op.kind == "as" ? NodeKind.AsExpression : NodeKind.SatisfiesExpression, this.node(operand).start, end);
      this.attr(result, op.kind == "as" ? AttributeKind.TargetType : AttributeKind.DeclaredType, annotation);
      this.edge(result, op.kind == "as" ? EdgeRole.Expression : EdgeRole.Operand, operand); return result;
    }
    return operand;
  }
  update(target: number, op: ParserToken, prefix: boolean): number {
    const kind: NodeKind = this.node(target).kind;
    if (![NodeKind.IdentifierExpression,NodeKind.MemberExpression,NodeKind.IndexExpression].includes(kind)) this.reportAt(op,"El operando de '"+op.lexeme+"' debe ser una variable, campo o índice");
    const result: number = this.add(NodeKind.UpdateExpression,prefix ? op : this.node(target).start,prefix ? this.node(target).end : op);
    this.attr(result,AttributeKind.Operator,op.lexeme); this.attr(result,AttributeKind.Prefix,prefix ? "true" : "false");
    this.edge(result,EdgeRole.Target,target); return result;
  }
  // A `<` after a member access is a comparison unless the matching `>` is
  // followed by a call: `obj.method<T>(x)` keeps its type arguments, while
  // `obj.field < 5` stays a comparison. Identifiers use the same lookahead.
  genericMethodFollower(): string {
    if (!this.check("<")) return "";
    let depth: number = 0; let parens: number = 0;
    let cursor: number = 0;
    while (this.peek(cursor).kind != "eof") {
      const kind: string = this.peek(cursor).kind;
      if (kind == "<") depth = depth + 1;
      else if (kind == ">") { depth = depth - 1; if (depth == 0) return this.peek(cursor + 1).kind; }
      // #270: un tipo entre paréntesis dentro de los argumentos: f<(A | B)[]>(x).
      else if (kind == "(") parens = parens + 1;
      else if (kind == ")" && parens > 0) parens = parens - 1;
      else if (kind == ";" || kind == "newline" || kind == "{" || kind == "}" || kind == ")") return "";
      cursor = cursor + 1;
    }
    return "";
  }
  genericFollower(): string {
    if (!this.check("<")) return "";
    let depth: number = 0; let cursor: number = 0;
    while (this.peek(cursor).kind != "eof") {
      const kind: string = this.peek(cursor).kind;
      if (kind == "<") depth = depth + 1;
      else if (kind == ">") { depth = depth - 1; if (depth == 0) return this.peek(cursor + 1).kind; }
      else if (kind == ";" || kind == "newline" || kind == "=" || kind == "{") return "";
      cursor = cursor + 1;
    }
    return "";
  }
  typeArguments(owner: number): void {
    this.expect("<");
    while (!this.check(">") && !this.check("eof")) {
      this.attr(owner, AttributeKind.TypeArgument, this.typeName()); if (!this.accept(",")) break;
    }
    this.closeAngle();
  }
  argumentsInto(owner: number, role: EdgeRole, close: string): void {
    while (!this.check(close) && !this.check("eof")) {
      const before: number = this.current; let value: number = -1;
      if (role != EdgeRole.Elements && this.check("identifier") && this.peek(1).kind == ":") {
        const name: ParserToken = this.take(); this.take(); const child: number = this.expression();
        value = this.add(NodeKind.NamedArgumentExpression, this.node(child).start, this.node(child).end);
        this.attr(value, AttributeKind.Name, name.lexeme); this.edge(value, EdgeRole.Value, child);
      } else if (this.accept("...")) {
        const child: number = this.expression(); value = this.add(NodeKind.SpreadElement, this.node(child).start, this.node(child).end); this.edge(value, EdgeRole.Expression, child);
      } else value = this.expression();
      this.edge(owner, role, value);
      if (this.current == before || !this.accept(",")) break;
      if (this.check(close) && close != "]") this.report("Coma final no admitida aquí");
    }
    this.expect(close);
  }
  postfix(): number {
    let result: number = this.primary();
    let scanning: boolean = true;
    while (scanning && !this.check("eof")) {
      if (this.check("(") || (this.node(result).kind == NodeKind.IdentifierExpression && this.genericFollower() == "(")) {
        const parent: number = this.add(NodeKind.CallExpression, this.node(result).start, this.node(result).end);
        if (this.node(result).kind != NodeKind.IdentifierExpression) this.report("E1008: Solo se pueden llamar funciones por su nombre (f(...), obj.metodo(...))");
        this.attr(parent, AttributeKind.Callee, this.get(result, AttributeKind.Name));
        if (this.check("<")) this.typeArguments(parent);
        this.expect("("); this.argumentsInto(parent, EdgeRole.Args, ")"); this.setEnd(parent, this.previous());
        if (this.node(result).kind == NodeKind.IdentifierExpression) this.jsonParseType(parent, -1, this.node(result).start);
        result = parent;
      } else if (this.node(result).kind == NodeKind.IdentifierExpression && this.genericFollower() == ".") {
        this.setKind(result, NodeKind.GenericIdentifierExpression); this.typeArguments(result);
      } else if (this.check(".") || this.check("?.")) {
        const optional: boolean = this.take().kind == "?.";
        let member: ParserToken = this.peek(0);
        // Como en TypeScript, tras el punto vale una palabra clave (map.delete, Array.of).
        if (!this.check("identifier") && this.keywordWord(this.peek(0))) member = this.take(); else member = this.expect("identifier");
        const parent: number = this.add(NodeKind.MemberExpression, this.node(result).start, member);
        this.edge(parent, EdgeRole.Object, result); this.attr(parent, AttributeKind.Optional, optional ? "true" : "false");
        if (this.check("<") && this.genericMethodFollower() == "(") this.typeArguments(parent);
        if (this.accept("(")) {
          this.setKind(parent, NodeKind.MemberCallExpression); this.attr(parent, AttributeKind.Method, member.lexeme);
          this.argumentsInto(parent, EdgeRole.Args, ")"); this.setEnd(parent, this.previous());
          this.jsonParseType(parent, result, member);
        } else { this.attr(parent, AttributeKind.Member, member.lexeme); if (this.get(parent, AttributeKind.TypeArgument) != "") this.report("Los argumentos de tipo requieren una llamada"); }
        result = parent;
      } else if (this.accept("[")) {
        const cursor: number = this.expression(); const close: ParserToken = this.expect("]");
        const parent: number = this.add(NodeKind.IndexExpression, this.node(result).start, close);
        this.edge(parent, EdgeRole.Object, result); this.edge(parent, EdgeRole.Index, cursor); result = parent;
      } else scanning = false;
    }
    return result;
  }
  templateLiteral(start: ParserToken): number {
    const result: number = this.add(NodeKind.TemplateLiteralExpression, start, start);
    let scanning: boolean = true;
    while (scanning && !this.check("eof")) {
      if (!this.check("template-text")) { this.report("Se esperaba texto de template"); break; }
      const part: ParserToken = this.take();
      const segment: number = this.add(NodeKind.TemplatePart, part, part);
      this.attr(segment, AttributeKind.Value, part.lexeme); this.edge(result, EdgeRole.Parts, segment);
      if (!this.accept("interpolation-start")) { scanning = false; }
      else {
        this.skipNewlines();
        if (this.check("interpolation-end")) {
          this.report("La interpolación necesita una expresión");
          const missing: number = this.add(NodeKind.ErrorNode, this.peek(0), this.peek(0)); this.edge(result, EdgeRole.Expressions, missing);
        } else this.edge(result, EdgeRole.Expressions, this.expression());
        this.skipNewlines();
        if (!this.check("interpolation-end")) {
          this.report("Se esperaba fin de interpolación");
          while (!this.check("interpolation-end") && !this.check("template-end") && !this.check("eof")) this.take();
        }
        this.accept("interpolation-end");
      }
    }
    this.setEnd(result, this.expect("template-end")); return result;
  }
  primary(): number {
    const token: ParserToken = this.take();
    if (token.kind == "template-start") return this.templateLiteral(token);
    // /patrón/flags es new RegExp("patrón", "flags") con el RegExp importado de estatic:regexp.
    if (token.kind == "regex") {
      const close: number = token.lexeme.lastIndexOf("/");
      const result: number = this.add(NodeKind.NewExpression, token, token); this.attr(result, AttributeKind.ClassName, "RegExp");
      const pattern: number = this.add(NodeKind.LiteralExpression, token, token); this.attr(pattern, AttributeKind.LiteralType, "string"); this.attr(pattern, AttributeKind.Value, token.lexeme.slice(1, close));
      const flags: number = this.add(NodeKind.LiteralExpression, token, token); this.attr(flags, AttributeKind.LiteralType, "string"); this.attr(flags, AttributeKind.Value, token.lexeme.slice(close + 1, token.lexeme.length));
      this.edge(result, EdgeRole.Args, pattern); this.edge(result, EdgeRole.Args, flags); return result;
    }
    if (token.kind == "template-error") { this.reportAt(token, token.lexeme); return this.add(NodeKind.ErrorNode, token, token); }
    if (token.kind == "number" || token.kind == "string" || token.kind == "true" || token.kind == "false") {
      const result: number = this.add(NodeKind.LiteralExpression, token, token);
      const annotation: string = token.kind == "number" ? "number" : token.kind == "string" ? "string" : "boolean";
      this.attr(result, AttributeKind.LiteralType, annotation);
      this.attr(result, annotation == "number" ? AttributeKind.Raw : AttributeKind.Value, token.lexeme); return result;
    }
    if (token.kind == "identifier") { const result: number = this.add(NodeKind.IdentifierExpression, token, token); this.attr(result, AttributeKind.Name, token.lexeme); return result; }
    if (token.kind == "(") { const result: number = this.expression(); this.expect(")"); return result; }
    if (token.kind == "[") {
      const result: number = this.add(NodeKind.ArrayLiteralExpression, token, token); this.argumentsInto(result, EdgeRole.Elements, "]"); this.setEnd(result, this.previous()); return result;
    }
    if (token.kind == "{") {
      const result: number = this.add(NodeKind.ObjectLiteralExpression, token, token);
      this.skipNewlines();
      while (!this.check("}") && !this.check("eof")) {
        // { "X-Clave": v }: una clave entre comillas (sin forma abreviada).
        const quoted: boolean = this.check("string");
        const key: ParserToken = quoted ? this.take() : this.expect("identifier"); let value: number = -1;
        this.skipNewlines();
        if (quoted) { this.expect(":"); this.skipNewlines(); value = this.expression(); }
        else if (this.accept(":")) { this.skipNewlines(); value = this.expression(); }
        else { value = this.add(NodeKind.IdentifierExpression, key, key); this.attr(value, AttributeKind.Name, key.lexeme); }
        const property: number = this.add(NodeKind.ObjectProperty, key, this.node(value).end);
        this.attr(property, AttributeKind.Key, key.lexeme); this.edge(property, EdgeRole.Value, value); this.edge(result, EdgeRole.Properties, property);
        this.skipNewlines();
        if (!this.accept(",")) break;
        this.skipNewlines();
      }
      this.setEnd(result, this.expect("}"));
      // #223: sin otro contexto, el literal es de una interfaz sintética cuyos
      // campos tienen el tipo de su valor ($valueof$<nodo>).
      const shape: number = this.add(NodeKind.InterfaceDeclaration, token, this.previous()); const shapeName: string = "__Lit" + numberToString(result);
      this.attr(shape, AttributeKind.Name, shapeName);
      for (const edge of this.node(result).edges) if (edge.role == EdgeRole.Properties) {
        const property: AstNode = this.node(edge.node); const value: number = bindingChildOf(property, EdgeRole.Value);
        const item: number = this.add(NodeKind.InterfaceField, property.start, property.start); this.attr(item, AttributeKind.Name, property.get(AttributeKind.Key));
        this.attr(item, AttributeKind.Type, "$valueof$" + numberToString(value)); this.attr(item, AttributeKind.Optional, "false"); this.edge(shape, EdgeRole.Fields, item);
      }
      this.objectTypes.push(shape); this.attr(result, AttributeKind.DeclaredType, shapeName);
      return result;
    }
    if (token.kind == "new") {
      let name: string = this.expect("identifier").lexeme;
      while (this.accept(".")) { if (this.check("default")) name = name + "." + this.take().lexeme; else name = name + "." + this.expect("identifier").lexeme; }
      const result: number = this.add(NodeKind.NewExpression, token, token);
      if (this.accept("<")) {
        let args: string[] = [];
        while (!this.check(">") && !this.check("eof")) { args.push(this.typeName()); if (!this.accept(",")) break; }
        this.expect(">"); name = name + "<" + args.join(",") + ">";
      }
      this.attr(result, AttributeKind.ClassName, name); this.expect("("); this.argumentsInto(result, EdgeRole.Args, ")"); this.setEnd(result, this.previous()); return result;
    }
    if (token.kind == "template") this.reportAt(token, "El token template requiere preparación léxica: template-start/text/end e interpolaciones");
    else this.report("E1004: Se esperaba una expresión y se encontró " + this.found() + this.foundArg());
    return this.add(NodeKind.ErrorNode, token, token);
  }
  inspect(): string { return formatAst(this.parseProgram()); }
}

// Formatting an already parsed arena must not run the parser a second time.
function quoteAst(text: string): string {
  let result: string = "\""; const hex: string = "0123456789abcdef";
  for (let i: number = 0; i < text.length; i = i + 1) {
    const c: string = text.charAt(i); const code: number = text.charCodeAt(i);
    if (c == "\"") result = result + "\\\""; else if (c == "\\") result = result + "\\\\";
    else if (code < 32) result = result + "\\u00" + hex.charAt(Math.floor(code / 16)) + hex.charAt(code % 16);
    else result = result + c;
  }
  return result + "\"";
}
function positionAst(offset: number, line: number, column: number): string {
  return "{\"offset\":" + numberToString(offset) + ",\"line\":" + numberToString(line) + ",\"column\":" + numberToString(column) + "}";
}
function spanAst(start: ParserToken, end: ParserToken): string {
  return "{\"start\":" + positionAst(start.offset, start.line, start.column) + ",\"end\":" + positionAst(end.endOffset, end.endLine, end.endColumn) + "}";
}
export function formatAst(result: ParseResult): string {
  let output: string[] = ["{\"root\":" + numberToString(result.root) + ",\"nodes\":["]; let separator: string = "";
  for (const item of result.nodes) {
    output.push(separator + "{\"kind\":" + quoteAst(nodeKindName(item.kind)) + ",\"span\":" + spanAst(item.start, item.end) + ",\"attributes\":[");
    let comma: string = "";
    for (const field of item.attributes) { output.push(comma + "{\"name\":" + quoteAst(attributeKindName(field.name)) + ",\"value\":" + quoteAst(field.value) + "}"); comma = ","; }
    output.push("],\"edges\":["); comma = "";
    for (const edge of item.edges) { output.push(comma + "{\"role\":" + quoteAst(edgeRoleName(edge.role)) + ",\"node\":" + numberToString(edge.node) + "}"); comma = ","; }
    output.push("]}"); separator = ",";
  }
  output.push("],\"diagnostics\":["); separator = "";
  for (const diagnostic of result.diagnostics) {
    output.push(separator + "{\"phase\":\"parser\",\"message\":" + quoteAst(diagnostic.message) + ",\"span\":" + spanAst(diagnostic.token, diagnostic.token) + "}"); separator = ",";
  }
  output.push("]}"); return output.join("");
}
export function parseTokens(tokens: ParserToken[]): ParseResult { let parser: Parser = new Parser(tokens); return parser.parseProgram(); }
export function inspectAst(tokens: ParserToken[]): string { let parser: Parser = new Parser(tokens); return parser.inspect(); }

// `word` aparece en `text` como identificador completo (no dentro de otro nombre).
export function containsWord(text: string, word: string): boolean {
  let from: number = 0;
  while (true) {
    const at: number = text.indexOf(word, from); if (at < 0) return false;
    const before: number = at > 0 ? text.charCodeAt(at - 1) : 32; const after: number = at + word.length < text.length ? text.charCodeAt(at + word.length) : 32;
    if (!wordCode(before) && !wordCode(after)) return true;
    from = at + 1;
  }
  return false;
}
function wordCode(code: number): boolean { return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code == 95 || code == 36; }
function simpleTypeName(text: string): boolean { if (text.length == 0) return false; for (let at: number = 0; at < text.length; at = at + 1) if (!wordCode(text.charCodeAt(at)) || text.charCodeAt(at) == 36) return false; return true; }
