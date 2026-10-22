// Bootstrap parser. Tokens are supplied by the caller; no lexer/checker imports.
// An arena owns all nodes. Edges are indices, so recursive ASTs need no cycles.
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
  name: string; value: string;
  constructor(name: string, value: string) { this.name = name; this.value = value; }
}
export class AstEdge {
  role: string; node: number;
  constructor(role: string, node: number) { this.role = role; this.node = node; }
}
export class AstNode {
  kind: string; start: ParserToken; end: ParserToken;
  attributes: AstAttribute[]; edges: AstEdge[];
  constructor(kind: string, start: ParserToken, end: ParserToken) {
    this.kind = kind; this.start = start; this.end = end; this.attributes = []; this.edges = [];
  }
  attr(name: string, value: string): void { this.attributes.push(new AstAttribute(name, value)); }
  edge(role: string, node: number): void { this.edges.push(new AstEdge(role, node)); }
  get(name: string): string {
    for (const field of this.attributes) { if (field.name == name) return field.value; }
    return "";
  }
}
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

export class Parser {
  tokens: ParserToken[]; current: number; nodes: AstNode[]; diagnostics: ParserDiagnostic[];
  nesting: number; exhausted: boolean;
  constructor(tokens: ParserToken[]) {
    this.tokens = tokens; this.current = 0; this.nodes = []; this.diagnostics = [];
    this.nesting = 0; this.exhausted = false;
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
  expect(kind: string): ParserToken {
    if (this.check(kind)) return this.take();
    this.report("Se esperaba '" + kind + "'");
    return this.peek(0);
  }
  enter(): boolean {
    if (this.nesting >= 128) {
      this.report("Límite de anidamiento del parser (128)"); this.exhausted = true;
      this.current = this.tokens.length - 1; return false;
    }
    this.nesting = this.nesting + 1; return true;
  }
  leave(): void { this.nesting = this.nesting - 1; }
  add(kind: string, start: ParserToken, end: ParserToken): number {
    this.nodes.push(new AstNode(kind, start, end)); return this.nodes.length - 1;
  }
  node(cursor: number): AstNode { return this.nodes[cursor]; }
  attr(cursor: number, name: string, value: string): void { this.nodes[cursor].attributes.push(new AstAttribute(name, value)); }
  edge(cursor: number, role: string, child: number): void { this.nodes[cursor].edges.push(new AstEdge(role, child)); }
  get(cursor: number, name: string): string { return this.nodes[cursor].get(name); }
  setEnd(cursor: number, end: ParserToken): void { this.nodes[cursor].end = end; }
  setKind(cursor: number, kind: string): void { this.nodes[cursor].kind = kind; }
  skipNewlines(): void { while (this.accept("newline")) {} }
  terminator(): ParserToken {
    if (this.check(";") || this.check("newline")) return this.take();
    if (!this.check("}") && !this.check("eof") && !this.check(",")) this.report("Se esperaba un terminador de sentencia");
    return this.peek(0);
  }
  parseProgram(): ParseResult {
    const start: ParserToken = this.peek(0);
    const program: number = this.add("Program", start, start);
    while (!this.check("eof")) {
      this.skipNewlines();
      if (this.check("eof")) break;
      if (!this.accept(";")) {
        const before: number = this.current;
        const child: number = this.statement(true);
        this.edge(program, "statements", child);
        if (this.current == before && !this.check("eof")) { this.report("Token inesperado en el programa"); this.take(); }
      }
    }
    this.setEnd(program, this.peek(0));
    return new ParseResult(program, this.nodes, this.diagnostics);
  }
  statement(topLevel: boolean): number {
    const start: ParserToken = this.peek(0);
    if (!this.enter()) return this.add("ErrorNode", start, start);
    const result: number = this.statementInner(topLevel);
    this.leave(); return result;
  }
  statementInner(topLevel: boolean): number {
    this.skipNewlines();
    const start: ParserToken = this.peek(0);
    let decorators: number[] = [];
    while (this.accept("@")) {
      const at: ParserToken = this.previous();
      const name: ParserToken = this.expect("identifier");
      const decorator: number = this.add("Decorator", at, name);
      this.attr(decorator, "name", name.lexeme);
      if (this.accept("(")) { this.argumentsInto(decorator, "args", ")"); this.setEnd(decorator, this.previous()); }
      decorators.push(decorator); this.skipNewlines();
    }
    const exported: boolean = this.accept("export");
    if (exported) this.skipNewlines();
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
      result = this.add("TypeAliasDeclaration", keyword, name); this.attr(result, "name", name.lexeme);
      this.typeParameters(result); this.expect("=");
      this.attr(result, "type", this.typeName()); this.setEnd(result, this.terminator());
    } else if (this.accept("if")) {
      const keyword: ParserToken = this.previous();
      this.expect("("); const condition: number = this.expression(); this.expect(")");
      const thenBranch: number = this.statement(false); this.skipNewlines();
      result = this.add("IfStatement", keyword, this.node(thenBranch).end);
      this.edge(result, "condition", condition); this.edge(result, "thenBranch", thenBranch);
      if (this.accept("else")) { const branch: number = this.statement(false); this.edge(result, "elseBranch", branch); this.setEnd(result, this.node(branch).end); }
    } else if (this.accept("while")) {
      const keyword: ParserToken = this.previous(); this.expect("("); const condition: number = this.expression(); this.expect(")");
      const body: number = this.statement(false); result = this.add("WhileStatement", keyword, this.node(body).end);
      this.edge(result, "condition", condition); this.edge(result, "body", body);
    } else if (this.accept("for")) result = this.forStatement(this.previous());
    else if (this.accept("{")) result = this.block(this.previous());
    else if (this.check("return") || this.check("break") || this.check("continue") || this.check("delete")) {
      const keyword: ParserToken = this.take();
      let kind: string = "ReturnStatement";
      if (keyword.kind == "break") kind = "BreakStatement";
      else if (keyword.kind == "continue") kind = "ContinueStatement";
      else if (keyword.kind == "delete") kind = "DeleteStatement";
      result = this.add(kind, keyword, keyword);
      if (keyword.kind == "delete") {
        const target: number = this.expression(); this.edge(result, "target", target);
        if (this.node(target).kind != "IndexExpression") this.report("delete requiere un acceso por índice");
      } else if (keyword.kind == "return" && !this.check(";") && !this.check("newline") && !this.check("}") && !this.check("eof")) {
        this.edge(result, "value", this.expression());
      }
      this.setEnd(result, this.terminator());
    } else if (this.check("case") || this.check("default")) {
      this.report("case/default requiere un switch"); result = this.add("ErrorNode", start, this.take());
    } else {
      const value: number = this.expression();
      result = this.add("ExpressionStatement", this.node(value).start, this.terminator()); this.edge(result, "expression", value);
      if (exported || decorators.length > 0) this.report("El modificador necesita una declaración compatible");
    }
    const declarationKind: string = this.node(result).kind;
    const moduleExport: boolean = declarationKind == "ExportDefaultDeclaration" || declarationKind == "ExportNamedDeclaration" || declarationKind == "ExportAllDeclaration";
    if (exported && !moduleExport) {
      if (declarationKind != "VariableDeclaration" && declarationKind != "UsingDeclaration" && declarationKind != "FunctionDeclaration"
          && declarationKind != "ClassDeclaration" && declarationKind != "InterfaceDeclaration" && declarationKind != "TypeAliasDeclaration"
          && declarationKind != "EnumDeclaration" && declarationKind != "UnionDeclaration"
          && declarationKind != "ErrorNode") this.report("export necesita una declaración compatible");
      this.attr(result, "exported", "true");
    }
    let decorated: number = result;
    if (declarationKind == "ExportDefaultDeclaration") decorated = this.nodes[result].edges[0].node;
    if (decorators.length > 0 && (declarationKind == "ImportDeclaration" || declarationKind == "ExportNamedDeclaration" || declarationKind == "ExportAllDeclaration"
        || (declarationKind == "ExportDefaultDeclaration" && this.node(decorated).kind != "FunctionDeclaration" && this.node(decorated).kind != "ClassDeclaration" && this.node(decorated).kind != "VariableDeclaration"))) {
      this.reportAt(start, "Los decoradores requieren una declaración compatible");
    } else for (const decorator of decorators) this.edge(decorated, "decorators", decorator);
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
    if (this.check("string")) this.attr(owner, "source", this.take().lexeme);
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
      const specifier: number = this.add(importing ? "ImportSpecifier" : "ExportSpecifier", start, alias);
      if (importing) {
        this.attr(specifier, "imported", name.lexeme); this.attr(specifier, "local", alias.lexeme); this.attr(specifier, "form", "named");
        if (alias.kind != "identifier") this.reportAt(alias, "El nombre local del import necesita un identificador; usa 'as nombre'");
      } else { this.attr(specifier, "name", name.lexeme); if (renamed) this.attr(specifier, "alias", alias.lexeme); }
      if (itemTypeOnly) this.attr(specifier, "typeOnly", "true");
      this.edge(owner, "specifiers", specifier); this.skipNewlines();
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
      if (edge.role == "specifiers") {
        const name: string = importing ? this.get(edge.node, "local") : this.get(edge.node, "alias");
        const effective: string = name == "" ? this.get(edge.node, "name") : name;
        if (names.includes(effective)) this.reportAt(this.node(edge.node).start, "Nombre duplicado en la lista de import/export");
        names.push(effective);
      }
    }
  }
  importDeclaration(keyword: ParserToken): number {
    const result: number = this.add("ImportDeclaration", keyword, keyword); this.skipNewlines();
    if (this.check("string")) {
      this.attr(result, "source", this.take().lexeme); this.attr(result, "sideEffect", "true");
      this.setEnd(result, this.moduleEnd()); return result;
    }
    if (this.check("(")) {
      this.report("import dinámico no está soportado por este parser"); this.synchronize(); this.setEnd(result, this.previous()); return result;
    }
    const typeOnly: boolean = this.acceptWord("type"); if (typeOnly) this.attr(result, "typeOnly", "true");
    this.skipNewlines(); let hasDefault: boolean = false; let more: boolean = true;
    if (this.check("identifier")) {
      const local: ParserToken = this.take(); const item: number = this.add("ImportSpecifier", local, local);
      this.attr(item, "imported", "default"); this.attr(item, "local", local.lexeme); this.attr(item, "form", "default");
      if (typeOnly) this.attr(item, "typeOnly", "true"); this.edge(result, "specifiers", item);
      hasDefault = true; this.skipNewlines(); more = this.accept(","); if (more) this.skipNewlines();
    }
    if (more) {
      if (this.accept("*")) {
        const star: ParserToken = this.previous(); this.skipNewlines();
        if (!this.acceptWord("as")) this.report("Un import '*' requiere 'as nombre'");
        this.skipNewlines(); const local: ParserToken = this.expect("identifier");
        const item: number = this.add("ImportSpecifier", star, local);
        this.attr(item, "imported", "*"); this.attr(item, "local", local.lexeme); this.attr(item, "form", "namespace");
        if (typeOnly) this.attr(item, "typeOnly", "true"); this.edge(result, "specifiers", item);
      } else if (this.check("{")) this.moduleSpecifiers(result, true, typeOnly);
      else this.report("Se esperaba un binding, namespace o lista de nombres en import");
    } else if (!hasDefault) this.report("Se esperaba un nombre local en import");
    this.moduleSource(result); this.checkModuleNames(result, true); this.setEnd(result, this.moduleEnd()); return result;
  }
  exportList(keyword: ParserToken, typeOnly: boolean): number {
    const result: number = this.add(this.check("*") ? "ExportAllDeclaration" : "ExportNamedDeclaration", keyword, keyword);
    if (typeOnly) this.attr(result, "typeOnly", "true");
    if (this.accept("*")) {
      this.skipNewlines(); if (this.acceptWord("as")) { this.skipNewlines(); this.attr(result, "namespace", this.moduleName().lexeme); }
      this.moduleSource(result);
    } else {
      this.moduleSpecifiers(result, false, typeOnly);
      if (this.fromAfterNewlines()) this.moduleSource(result);
      this.checkModuleNames(result, false);
    }
    this.setEnd(result, this.moduleEnd()); return result;
  }
  exportDefault(keyword: ParserToken): number {
    const result: number = this.add("ExportDefaultDeclaration", keyword, keyword); this.skipNewlines();
    let declaration: number = -1;
    if (this.check("function") || (this.check("async") && this.peek(1).kind == "function")) declaration = this.functionDeclaration(true);
    else if (this.accept("class")) declaration = this.classDeclaration(this.previous(), true);
    else if (this.check("let") || this.check("const")) declaration = this.variable(true);
    else { declaration = this.expression(); this.terminator(); }
    this.edge(result, "declaration", declaration); this.setEnd(result, this.node(declaration).end); return result;
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
    const name: ParserToken = this.expect("identifier"); const result: number = this.add("EnumDeclaration", keyword, name);
    this.attr(result, "name", name.lexeme); this.expect("{"); this.skipNewlines();
    let nextValue: string = "0"; let mode: string = ""; let names: string[] = [];
    while (!this.check("}") && !this.check("eof")) {
      const before: number = this.current; const memberName: ParserToken = this.expect("identifier");
      if (names.includes(memberName.lexeme)) this.reportAt(memberName, "Miembro de enum duplicado");
      names.push(memberName.lexeme);
      const member: number = this.add("EnumMember", memberName, memberName); this.attr(member, "name", memberName.lexeme);
      let literal: number = -1;
      if (this.accept("=")) {
        const value: ParserToken = this.peek(0);
        if (this.check("number") || this.check("string")) {
          this.take(); literal = this.add("LiteralExpression", value, value);
          this.attr(literal, "literalType", value.kind); const canonical: string = value.kind == "number" ? this.numericText(value) : value.lexeme;
          this.attr(literal, "value", canonical);
          if (mode != "" && mode != value.kind) this.reportAt(value, "Un enum no puede mezclar miembros numéricos y de cadena");
          mode = value.kind;
          if (value.kind == "number") nextValue = this.incrementDecimal(canonical);
        } else {
          this.report("El valor del miembro de enum debe ser un literal numérico no negativo o de cadena");
          while (!this.check(",") && !this.check("}") && !this.check("newline") && !this.check("eof")) this.take();
        }
      } else {
        if (mode == "string") this.reportAt(memberName, "Un enum de cadena requiere valores explícitos en todos los miembros");
        literal = this.add("LiteralExpression", memberName, memberName); this.attr(literal, "literalType", "number");
        this.attr(literal, "value", nextValue); nextValue = this.incrementDecimal(nextValue);
        if (mode == "") mode = "number";
      }
      if (literal >= 0) { this.edge(member, "value", literal); this.setEnd(member, this.node(literal).end); }
      this.edge(result, "members", member); this.skipNewlines();
      if (!this.check("}") && !this.check("eof")) {
        if (!this.accept(",")) this.report("Se esperaba ',' o '}' entre miembros del enum");
        this.skipNewlines();
      }
      if (this.current == before && !this.check("eof")) this.take();
    }
    if (names.length == 0) this.report("El enum debe tener al menos un miembro");
    this.attr(result, "underlying", mode == "string" ? "string" : "number"); this.setEnd(result, this.expect("}")); return result;
  }
  unionDeclaration(keyword: ParserToken): number {
    const name: ParserToken = this.expect("identifier"); const result: number = this.add("UnionDeclaration", keyword, name);
    this.attr(result, "name", name.lexeme); this.typeParameters(result); this.expect("="); this.skipNewlines();
    let names: string[] = []; let reading: boolean = true;
    while (reading && !this.check("eof")) {
      let variant: number = -1;
      if (this.check("{")) variant = this.objectVariant();
      else if (this.check("identifier")) {
        const token: ParserToken = this.take(); variant = this.add("UnionVariant", token, token); this.attr(variant, "name", token.lexeme);
        if (this.accept("(")) { this.attr(variant, "payload", this.typeName()); this.setEnd(variant, this.expect(")")); }
      } else { this.report("Se esperaba una variante de la unión"); reading = false; }
      if (variant >= 0) {
        const variantName: string = this.get(variant, "name");
        if (names.includes(variantName)) this.reportAt(this.node(variant).start, "Variante de unión duplicada");
        names.push(variantName); this.edge(result, "variants", variant);
        if (this.accept("|")) this.skipNewlines(); else reading = false;
      }
    }
    this.setEnd(result, this.terminator()); return result;
  }
  objectVariant(): number {
    const open: ParserToken = this.expect("{"); this.skipNewlines();
    const field: ParserToken = this.expect("identifier"); this.expect(":"); const token: ParserToken = this.peek(0);
    const result: number = this.add("UnionVariant", open, token);
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
    this.attr(result, "name", variantName);
    const discriminator: number = this.add("Discriminator", field, token);
    this.attr(discriminator, "field", field.lexeme); this.attr(discriminator, "literalType", literalType); this.attr(discriminator, "value", value);
    this.edge(result, "discriminator", discriminator);
    let names: string[] = [field.lexeme]; let types: string[] = []; this.skipNewlines();
    while (this.accept(";") || this.accept(",")) {
      this.skipNewlines(); if (this.check("}") || this.check("eof")) break;
      const before: number = this.current; const bindingName: ParserToken = this.expect("identifier");
      if (names.includes(bindingName.lexeme)) this.reportAt(bindingName, "Binding de variante duplicado");
      names.push(bindingName.lexeme); this.expect(":"); const annotation: string = this.typeName();
      const binding: number = this.add("Binding", bindingName, this.previous());
      this.attr(binding, "name", bindingName.lexeme); this.attr(binding, "type", annotation);
      this.edge(result, "bindings", binding); types.push(annotation); this.skipNewlines();
      if (this.current == before && !this.check("eof")) this.take();
    }
    if (types.length == 1) this.attr(result, "payload", types[0]);
    else if (types.length > 1) this.attr(result, "payload", "[" + types.join(",") + "]");
    this.setEnd(result, this.expect("}")); return result;
  }
  switchStatement(keyword: ParserToken): number {
    const result: number = this.add("SwitchStatement", keyword, keyword);
    this.expect("("); this.edge(result, "discriminant", this.expression()); this.expect(")"); this.expect("{");
    let hasDefault: boolean = false;
    while (!this.check("}") && !this.check("eof")) {
      this.skipNewlines(); if (this.check("}") || this.check("eof")) break;
      if (this.check("case") || this.check("default")) {
        const token: ParserToken = this.take(); const clause: number = this.add(token.kind == "case" ? "CaseClause" : "DefaultClause", token, token);
        if (token.kind == "case") {
          if (this.check(":")) { this.report("case necesita una expresión"); this.edge(clause, "labels", this.add("ErrorNode", this.peek(0), this.peek(0))); }
          else this.edge(clause, "labels", this.expression());
        } else { if (hasDefault) this.reportAt(token, "Un switch solo puede tener un default"); hasDefault = true; }
        this.setEnd(clause, this.expect(":")); this.skipNewlines();
        while (!this.check("case") && !this.check("default") && !this.check("}") && !this.check("eof")) {
          this.skipNewlines(); if (this.check("case") || this.check("default") || this.check("}") || this.check("eof")) break;
          if (!this.accept(";")) {
            const before: number = this.current; const child: number = this.statement(false); this.edge(clause, "body", child);
            this.setEnd(clause, this.node(child).end);
            if (this.current == before && !this.check("eof")) { this.report("Token inesperado en la cláusula de switch"); this.take(); }
          }
        }
        this.edge(result, "clauses", clause);
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
  bindingPattern(owner: number, array: boolean): void {
    this.take(); const close: string = array ? "]" : "}";
    this.attr(owner, "pattern", array ? "array" : "object"); this.attr(owner, "name", "");
    let names: string[] = [];
    while (!this.check("eof")) {
      this.skipNewlines(); if (this.check(close)) break;
      if (!this.check("identifier")) {
        this.report("Se esperaba un identificador: patrones anidados, rest y huecos no están soportados");
        this.recoverBinding(close); if (this.accept(",")) continue; break;
      }
      const key: ParserToken = this.take(); let local: ParserToken = key; let end: ParserToken = key;
      const binding: number = this.add(array ? "ArrayBinding" : "ObjectBinding", key, key);
      if (!array) this.attr(binding, "property", key.lexeme);
      this.skipNewlines();
      if (this.accept(":")) {
        this.skipNewlines();
        if (!array && this.check("identifier")) {
          local = this.take(); end = local; this.skipNewlines();
          if (this.accept(":")) { this.skipNewlines(); this.attr(binding, "declaredType", this.typeName()); end = this.previous(); }
        } else { this.attr(binding, "declaredType", this.typeName()); end = this.previous(); }
      }
      this.attr(binding, "name", local.lexeme);
      if (names.includes(local.lexeme)) this.reportAt(local, "Binding duplicado '" + local.lexeme + "'");
      names.push(local.lexeme); this.skipNewlines();
      if (this.accept("=")) { this.skipNewlines(); this.edge(binding, "defaultValue", this.expression()); end = this.previous(); }
      this.setEnd(binding, end); this.edge(owner, array ? "arrayBindings" : "objectBindings", binding);
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
      const keyword: ParserToken = this.take(); const result: number = this.add("VariableDeclaration", keyword, keyword);
      this.attr(result, "mutable", keyword.kind == "let" ? "true" : "false");
      this.bindingPattern(result, this.check("["));
      if (this.accept(":")) this.attr(result, "declaredType", this.typeName());
      this.expect("=");
      if (this.check(";") || this.check("newline") || this.check("}") || this.check("eof")) {
        this.report("El destructuring necesita un inicializador");
        const missing: number = this.add("ErrorNode", this.peek(0), this.peek(0)); this.edge(result, "initializer", missing);
      } else this.edge(result, "initializer", this.expression());
      this.setEnd(result, terminated ? this.terminator() : this.previous()); return result;
    }
    const keyword: ParserToken = this.take(); const name: ParserToken = this.expect("identifier");
    const kind: string = keyword.kind == "using" ? "UsingDeclaration" : "VariableDeclaration";
    const result: number = this.add(kind, keyword, name); this.attr(result, "name", name.lexeme);
    if (kind == "VariableDeclaration") this.attr(result, "mutable", keyword.kind == "let" ? "true" : "false");
    if (this.accept(":")) this.attr(result, "declaredType", this.typeName());
    this.expect("="); this.edge(result, "initializer", this.expression());
    this.setEnd(result, terminated ? this.terminator() : this.previous()); return result;
  }
  block(open: ParserToken): number {
    const result: number = this.add("BlockStatement", open, open);
    while (!this.check("}") && !this.check("eof")) {
      this.skipNewlines();
      if (this.check("}") || this.check("eof")) break;
      if (!this.accept(";")) {
        const before: number = this.current; this.edge(result, "statements", this.statement(false));
        if (this.current == before && !this.check("eof")) { this.report("Token inesperado en el bloque"); this.take(); }
      }
    }
    this.setEnd(result, this.expect("}")); return result;
  }
  parametersInto(owner: number, arrow: boolean, properties: boolean): void {
    this.expect("(");
    while (!this.check(")") && !this.check("eof")) {
      const before: number = this.current;
      const start: ParserToken = this.peek(0);
      const variadic: boolean = this.accept("..."); const isOut: boolean = this.accept("out");
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
      const name: ParserToken = this.expect("identifier"); const optional: boolean = this.accept("?");
      this.expect(":"); const annotation: string = this.typeName();
      const param: number = this.add("Parameter", start, this.previous());
      this.attr(param, "name", name.lexeme); this.attr(param, "type", annotation);
      this.attr(param, "out", isOut ? "true" : "false"); this.attr(param, "passing", isOut ? "out" : "value");
      if (access != "") this.attr(param, "access", access);
      if (isReadonly) this.attr(param, "readonly", "true");
      if (property && properties) this.attr(param, "parameterProperty", "true");
      if (!arrow) { this.attr(param, "variadic", variadic ? "true" : "false"); this.attr(param, "optional", optional ? "true" : "false"); }
      if (this.accept("=")) {
        if (this.check(",") || this.check(")") || this.check("eof")) {
          this.report("Se esperaba un valor por defecto del parámetro");
          const missing: number = this.add("ErrorNode", this.peek(0), this.peek(0)); this.edge(param, "defaultValue", missing);
        } else this.edge(param, "defaultValue", this.expression());
      }
      this.setEnd(param, this.previous());
      this.edge(owner, "params", param);
      if (this.current == before || !this.accept(",")) break;
    }
    this.expect(")");
  }
  typeParameters(owner: number): void {
    if (!this.accept("<")) return;
    while (!this.check(">") && !this.check("eof")) {
      const name: ParserToken = this.expect("identifier"); const param: number = this.add("TypeParameter", name, name);
      this.attr(param, "name", name.lexeme);
      if (this.accept("extends")) this.attr(param, "constraint", this.typeName());
      if (this.accept("=")) this.attr(param, "default", this.typeName());
      this.edge(owner, "typeParameters", param);
      if (!this.accept(",")) break;
    }
    this.expect(">");
  }
  functionDeclaration(allowAnonymous: boolean): number {
    const keyword: ParserToken = this.take(); const isAsync: boolean = keyword.kind == "async";
    if (isAsync) this.expect("function");
    const anonymous: boolean = allowAnonymous && (this.check("(") || this.check("<"));
    const name: ParserToken = anonymous ? this.peek(0) : this.expect("identifier");
    const result: number = this.add("FunctionDeclaration", keyword, name);
    if (anonymous) this.attr(result, "anonymous", "true"); else this.attr(result, "name", name.lexeme);
    this.attr(result, "async", isAsync ? "true" : "false");
    this.typeParameters(result); this.parametersInto(result, false, false); this.expect(":");
    this.attr(result, "returnType", this.typeName());
    let body: number = -1;
    if (this.accept(";")) body = this.add("BlockStatement", this.previous(), this.previous());
    else { const open: ParserToken = this.expect("{"); body = this.block(open); }
    this.edge(result, "body", body); this.setEnd(result, this.node(body).end); return result;
  }
  classDeclaration(keyword: ParserToken, allowAnonymous: boolean): number {
    const anonymous: boolean = allowAnonymous && (this.check("{") || this.check("<"));
    const name: ParserToken = anonymous ? this.peek(0) : this.expect("identifier"); const result: number = this.add("ClassDeclaration", keyword, name);
    if (anonymous) this.attr(result, "anonymous", "true"); else this.attr(result, "name", name.lexeme);
    this.typeParameters(result); this.expect("{");
    while (!this.check("}") && !this.check("eof")) {
      this.skipNewlines(); if (this.check("}") || this.check("eof")) break;
      if (!this.accept(";")) {
        const before: number = this.current;
        let access: string = "";
        if (this.check("public") || this.check("private") || this.check("protected")) access = this.take().lexeme;
        let isReadonly: boolean = this.accept("readonly"); const isStatic: boolean = this.accept("static");
        if (!isReadonly) isReadonly = this.accept("readonly");
        const member: ParserToken = this.expect("identifier");
        const item: number = this.add("ClassField", member, member); this.attr(item, "name", member.lexeme);
        if (access != "") this.attr(item, "access", access);
        if (isStatic) this.attr(item, "isStatic", "true");
        if (isReadonly) this.attr(item, "readonly", "true");
        if (this.check("(") || this.check("<")) {
          this.setKind(item, "ClassMethod"); this.typeParameters(item); this.parametersInto(item, false, member.lexeme == "constructor" && !isStatic);
          let returnType: string = "void";
          if (this.accept(":")) returnType = this.typeName();
          else if (member.lexeme != "constructor") this.report("El método necesita un tipo de retorno");
          this.attr(item, "returnType", returnType);
          const open: ParserToken = this.expect("{"); const body: number = this.block(open);
          this.edge(item, "body", body); this.setEnd(item, this.node(body).end);
          this.edge(result, "methods", item);
        } else {
          this.expect(":"); this.attr(item, "type", this.typeName());
          if (this.accept("=")) this.edge(item, "defaultValue", this.expression());
          this.setEnd(item, this.terminator()); this.edge(result, "fields", item);
        }
        if (this.current == before) { this.report("Miembro de clase no reconocido"); this.take(); }
      }
    }
    this.setEnd(result, this.expect("}")); return result;
  }
  interfaceDeclaration(keyword: ParserToken): number {
    const name: ParserToken = this.expect("identifier"); const result: number = this.add("InterfaceDeclaration", keyword, name);
    this.attr(result, "name", name.lexeme); this.expect("{");
    while (!this.check("}") && !this.check("eof")) {
      this.skipNewlines(); if (this.check("}") || this.check("eof")) break;
      const before: number = this.current; const member: ParserToken = this.expect("identifier");
      const item: number = this.add("InterfaceField", member, member); this.attr(item, "name", member.lexeme);
      if (this.check("(") || this.check("<")) {
        this.setKind(item, "InterfaceMethod"); this.typeParameters(item); this.parametersInto(item, false, false);
        this.expect(":"); this.attr(item, "returnType", this.typeName()); this.edge(result, "methods", item);
      } else {
        const optional: boolean = this.accept("?"); this.expect(":"); this.attr(item, "type", this.typeName());
        this.attr(item, "optional", optional ? "true" : "false"); this.edge(result, "fields", item);
      }
      this.setEnd(item, this.terminator());
      if (this.current == before) { this.report("Miembro de interface no reconocido"); this.take(); }
    }
    this.setEnd(result, this.expect("}")); return result;
  }
  forStatement(keyword: ParserToken): number {
    const awaited: boolean = this.accept("await"); this.expect("(");
    const result: number = this.add("ForStatement", keyword, keyword);
    let iteration: boolean = false;
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
        const bindingKeyword: ParserToken = this.take(); const name: ParserToken = this.expect("identifier");
        const binding: number = this.add("VariableDeclaration", bindingKeyword, name);
        this.attr(binding, "name", name.lexeme); this.attr(binding, "mutable", bindingKeyword.kind == "let" ? "true" : "false");
        if (this.accept(":")) this.attr(binding, "declaredType", this.typeName());
        const iterationToken: ParserToken = this.take();
        this.setKind(result, iterationToken.kind == "of" ? "ForOfStatement" : "ForInStatement");
        if (iterationToken.kind == "of") this.attr(result, "await", awaited ? "true" : "false");
        else if (awaited) this.report("for await requiere of");
        this.edge(result, "binding", binding);
        const iterable: number = this.expression(); this.edge(result, iterationToken.kind == "of" ? "iterable" : "target", iterable);
      } else { this.current = saved; this.edge(result, "initializer", this.variable(true)); }
    } else if (!this.accept(";")) {
      const value: number = this.expression(); const init: number = this.add("ExpressionStatement", this.node(value).start, this.terminator());
      this.edge(init, "expression", value); this.edge(result, "initializer", init);
    }
    if (!iteration) {
      if (awaited) this.report("for await requiere of");
      if (!this.check(";")) this.edge(result, "condition", this.expression());
      this.expect(";"); if (!this.check(")")) this.edge(result, "increment", this.expression());
    }
    this.expect(")"); const body: number = this.statement(false); this.edge(result, "body", body);
    this.setEnd(result, this.node(body).end); return result;
  }
  typeName(): string {
    if (!this.enter()) return "<error>";
    const result: string = this.typeInner(); this.leave(); return result;
  }
  typeInner(): string {
    if (this.accept("readonly")) return "readonly<" + this.typeName() + ">";
    if (this.accept("typeof")) return "$typeof$" + this.expect("identifier").lexeme;
    if (this.accept("(")) {
      let params: string[] = [];
      while (!this.check(")") && !this.check("eof")) {
        this.expect("identifier"); this.expect(":"); params.push(this.typeName()); if (!this.accept(",")) break;
      }
      this.expect(")"); this.expect("=>"); return "(" + params.join(",") + ")=>" + this.typeName();
    }
    if (this.accept("[")) {
      let parts: string[] = [];
      while (!this.check("]") && !this.check("eof")) { parts.push(this.typeName()); if (!this.accept(",")) break; }
      this.expect("]"); return "[" + parts.join(",") + "]";
    }
    let result: string = "";
    if (this.check("identifier") || this.check("type")) result = this.take().lexeme;
    else { this.report("Se esperaba un tipo"); if (!this.check("eof")) this.take(); return "<error>"; }
    while (this.accept(".")) { if (this.check("default")) result = result + "." + this.take().lexeme; else result = result + "." + this.expect("identifier").lexeme; }
    if (this.accept("<")) {
      let args: string[] = [];
      while (!this.check(">") && !this.check("eof")) { args.push(this.typeName()); if (!this.accept(",")) break; }
      this.expect(">");
      if (result == "Array" && args.length == 1) result = args[0] + "[]";
      else result = result + "<" + args.join(",") + ">";
    }
    while (this.accept("[")) {
      let size: string = "";
      if (!this.check("]")) { if (this.check("number") || this.check("identifier")) size = this.take().lexeme; else this.report("Tamaño de array no válido"); }
      this.expect("]"); result = result + "[" + size + "]";
    }
    while (this.accept("|")) result = result + " | " + this.typeName();
    while (this.accept("&")) result = result + " & " + this.typeName();
    return result;
  }
  expression(): number {
    const token: ParserToken = this.peek(0);
    if (!this.enter()) return this.add("ErrorNode", token, token);
    let result: number = -1;
    if (this.arrowStart()) result = this.arrow();
    else result = this.assignment();
    if (this.accept("?")) {
      const yes: number = this.expression(); this.expect(":"); const no: number = this.expression();
      const conditional: number = this.add("TernaryExpression", this.node(result).start, this.node(no).end);
      this.edge(conditional, "condition", result); this.edge(conditional, "thenBranch", yes); this.edge(conditional, "elseBranch", no); result = conditional;
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
      if (this.peek(cursor).kind == "=>") return true; cursor = cursor + 1;
    }
    return false;
  }
  arrow(): number {
    const isAsync: boolean = this.accept("async"); const open: ParserToken = this.peek(0);
    const result: number = this.add("ArrowFunctionExpression", open, open);
    this.attr(result, "isAsync", isAsync ? "true" : "false"); this.parametersInto(result, true, false);
    if (this.accept(":")) this.attr(result, "returnType", this.typeName());
    this.expect("=>"); let body: number = -1;
    if (this.accept("{")) body = this.block(this.previous()); else body = this.expression();
    this.edge(result, "body", body); this.setEnd(result, this.node(body).end); return result;
  }
  assignment(): number {
    const left: number = this.binary(1); const op: ParserToken = this.peek(0);
    const operators: string[] = ["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>="];
    if (!operators.includes(op.kind)) return left;
    this.take();
    if (!this.enter()) return left;
    const right: number = this.assignment(); this.leave();
    const kind: string = this.node(left).kind;
    if (kind != "IdentifierExpression" && kind != "MemberExpression" && kind != "IndexExpression") this.report("El lado izquierdo de una asignación debe ser una variable, campo o índice");
    const result: number = this.add(op.kind == "=" ? "AssignmentExpression" : "CompoundAssignmentExpression", this.node(left).start, this.node(right).end);
    if (op.kind != "=") this.attr(result, "operator", op.lexeme);
    this.edge(result, "target", left); this.edge(result, "value", right); return result;
  }
  binaryKind(): string {
    const first: ParserToken = this.peek(0); const second: ParserToken = this.peek(1);
    if ((first.kind == "<" || first.kind == ">") && second.kind == first.kind && first.endOffset == second.offset) return first.kind + second.kind;
    return first.kind;
  }
  precedence(kind: string): number {
    if (kind == "??") return 1; if (kind == "||") return 2; if (kind == "&&") return 3;
    if (kind == "==" || kind == "!=") return 4;
    if (kind == "<" || kind == "<=" || kind == ">" || kind == ">=" || kind == "instanceof") return 5;
    if (kind == "|" || kind == "&" || kind == "^" || kind == "<<" || kind == ">>") return 6;
    if (kind == "+" || kind == "-") return 7;
    if (kind == "*" || kind == "/" || kind == "%") return 8;
    return 0;
  }
  binary(minimum: number): number {
    let left: number = this.unary();
    while (this.precedence(this.binaryKind()) >= minimum) {
      const kind: string = this.binaryKind(); const op: ParserToken = this.take(); if (kind != op.kind) this.take();
      if (!this.enter()) return left;
      let right: number = -1;
      if (kind == "instanceof") { const annotation: string = this.typeName(); right = this.add("IdentifierExpression", op, op); this.attr(right, "name", annotation); }
      else right = this.binary(this.precedence(kind) + 1);
      this.leave(); const parent: number = this.add("BinaryExpression", this.node(left).start, this.node(right).end);
      this.attr(parent, "operator", kind); this.edge(parent, "left", left); this.edge(parent, "right", right); left = parent;
    }
    return left;
  }
  unary(): number {
    const op: ParserToken = this.peek(0);
    if (op.kind == "!" || op.kind == "-" || op.kind == "+" || op.kind == "~" || op.kind == "typeof" || op.kind == "await") {
      this.take(); if (!this.enter()) return this.add("ErrorNode", op, op);
      const operand: number = this.unary(); this.leave();
      const result: number = this.add(op.kind == "await" ? "AwaitExpression" : "UnaryExpression", op, this.node(operand).end);
      if (op.kind != "await") this.attr(result, "operator", op.lexeme);
      this.edge(result, "operand", operand); return result;
    }
    const operand: number = this.postfix();
    if (this.check("as") || this.check("satisfies")) {
      const op: ParserToken = this.take(); const annotation: string = this.typeName();
      const next: ParserToken = this.peek(0);
      const end: ParserToken = new ParserToken("", "", next.offset, next.line, next.column, next.offset, next.line, next.column);
      const result: number = this.add(op.kind == "as" ? "AsExpression" : "SatisfiesExpression", this.node(operand).start, end);
      this.attr(result, op.kind == "as" ? "targetType" : "declaredType", annotation);
      this.edge(result, op.kind == "as" ? "expression" : "operand", operand); return result;
    }
    return operand;
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
      this.attr(owner, "typeArgument", this.typeName()); if (!this.accept(",")) break;
    }
    this.expect(">");
  }
  argumentsInto(owner: number, role: string, close: string): void {
    while (!this.check(close) && !this.check("eof")) {
      const before: number = this.current; let value: number = -1;
      if (role != "elements" && this.check("identifier") && this.peek(1).kind == ":") {
        const name: ParserToken = this.take(); this.take(); const child: number = this.expression();
        value = this.add("NamedArgumentExpression", this.node(child).start, this.node(child).end);
        this.attr(value, "name", name.lexeme); this.edge(value, "value", child);
      } else if (this.accept("...")) {
        const child: number = this.expression(); value = this.add("SpreadElement", this.node(child).start, this.node(child).end); this.edge(value, "expression", child);
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
      if (this.check("(") || (this.node(result).kind == "IdentifierExpression" && this.genericFollower() == "(")) {
        const parent: number = this.add("CallExpression", this.node(result).start, this.node(result).end);
        if (this.node(result).kind != "IdentifierExpression") this.report("Solo se pueden invocar funciones por nombre");
        this.attr(parent, "callee", this.get(result, "name"));
        if (this.check("<")) this.typeArguments(parent);
        this.expect("("); this.argumentsInto(parent, "args", ")"); this.setEnd(parent, this.previous()); result = parent;
      } else if (this.node(result).kind == "IdentifierExpression" && this.genericFollower() == ".") {
        this.setKind(result, "GenericIdentifierExpression"); this.typeArguments(result);
      } else if (this.check(".") || this.check("?.")) {
        const optional: boolean = this.take().kind == "?.";
        let member: ParserToken = this.peek(0);
        if (this.check("delete") || this.check("default")) member = this.take(); else member = this.expect("identifier");
        const parent: number = this.add("MemberExpression", this.node(result).start, member);
        this.edge(parent, "object", result); this.attr(parent, "optional", optional ? "true" : "false");
        if (this.check("<")) this.typeArguments(parent);
        if (this.accept("(")) {
          this.setKind(parent, "MemberCallExpression"); this.attr(parent, "method", member.lexeme);
          this.argumentsInto(parent, "args", ")"); this.setEnd(parent, this.previous());
        } else { this.attr(parent, "member", member.lexeme); if (this.get(parent, "typeArgument") != "") this.report("Los argumentos de tipo requieren una llamada"); }
        result = parent;
      } else if (this.accept("[")) {
        const cursor: number = this.expression(); const close: ParserToken = this.expect("]");
        const parent: number = this.add("IndexExpression", this.node(result).start, close);
        this.edge(parent, "object", result); this.edge(parent, "index", cursor); result = parent;
      } else scanning = false;
    }
    return result;
  }
  templateLiteral(start: ParserToken): number {
    const result: number = this.add("TemplateLiteralExpression", start, start);
    let scanning: boolean = true;
    while (scanning && !this.check("eof")) {
      if (!this.check("template-text")) { this.report("Se esperaba texto de template"); break; }
      const part: ParserToken = this.take();
      const segment: number = this.add("TemplatePart", part, part);
      this.attr(segment, "value", part.lexeme); this.edge(result, "parts", segment);
      if (!this.accept("interpolation-start")) { scanning = false; }
      else {
        this.skipNewlines();
        if (this.check("interpolation-end")) {
          this.report("La interpolación necesita una expresión");
          const missing: number = this.add("ErrorNode", this.peek(0), this.peek(0)); this.edge(result, "expressions", missing);
        } else this.edge(result, "expressions", this.expression());
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
    if (token.kind == "template-error") { this.reportAt(token, token.lexeme); return this.add("ErrorNode", token, token); }
    if (token.kind == "number" || token.kind == "string" || token.kind == "true" || token.kind == "false") {
      const result: number = this.add("LiteralExpression", token, token);
      const annotation: string = token.kind == "number" ? "number" : token.kind == "string" ? "string" : "boolean";
      this.attr(result, "literalType", annotation);
      this.attr(result, annotation == "number" ? "raw" : "value", token.lexeme); return result;
    }
    if (token.kind == "identifier") { const result: number = this.add("IdentifierExpression", token, token); this.attr(result, "name", token.lexeme); return result; }
    if (token.kind == "(") { const result: number = this.expression(); this.expect(")"); return result; }
    if (token.kind == "[") {
      const result: number = this.add("ArrayLiteralExpression", token, token); this.argumentsInto(result, "elements", "]"); this.setEnd(result, this.previous()); return result;
    }
    if (token.kind == "{") {
      const result: number = this.add("ObjectLiteralExpression", token, token);
      while (!this.check("}") && !this.check("eof")) {
        const key: ParserToken = this.expect("identifier"); let value: number = -1;
        if (this.accept(":")) value = this.expression();
        else { value = this.add("IdentifierExpression", key, key); this.attr(value, "name", key.lexeme); }
        const property: number = this.add("ObjectProperty", key, this.node(value).end);
        this.attr(property, "key", key.lexeme); this.edge(property, "value", value); this.edge(result, "properties", property);
        if (!this.accept(",")) break;
      }
      this.setEnd(result, this.expect("}")); return result;
    }
    if (token.kind == "new") {
      let name: string = this.expect("identifier").lexeme;
      while (this.accept(".")) { if (this.check("default")) name = name + "." + this.take().lexeme; else name = name + "." + this.expect("identifier").lexeme; }
      const result: number = this.add("NewExpression", token, token);
      if (this.accept("<")) {
        let args: string[] = [];
        while (!this.check(">") && !this.check("eof")) { args.push(this.typeName()); if (!this.accept(",")) break; }
        this.expect(">"); name = name + "<" + args.join(",") + ">";
      }
      this.attr(result, "className", name); this.expect("("); this.argumentsInto(result, "args", ")"); this.setEnd(result, this.previous()); return result;
    }
    if (token.kind == "template") this.reportAt(token, "El token template requiere preparación léxica: template-start/text/end e interpolaciones");
    else this.report("Se esperaba una expresión");
    return this.add("ErrorNode", token, token);
  }
  quote(text: string): string {
    let result: string = "\""; const hex: string = "0123456789abcdef";
    for (let i: number = 0; i < text.length; i = i + 1) {
      const c: string = text.charAt(i); const code: number = text.charCodeAt(i);
      if (c == "\"") result = result + "\\\""; else if (c == "\\") result = result + "\\\\";
      else if (code < 32) result = result + "\\u00" + hex.charAt(Math.floor(code / 16)) + hex.charAt(code % 16);
      else result = result + c;
    }
    return result + "\"";
  }
  position(offset: number, line: number, column: number): string {
    return "{\"offset\":" + numberToString(offset) + ",\"line\":" + numberToString(line) + ",\"column\":" + numberToString(column) + "}";
  }
  spanJson(start: ParserToken, end: ParserToken): string {
    return "{\"start\":" + this.position(start.offset, start.line, start.column) + ",\"end\":" + this.position(end.endOffset, end.endLine, end.endColumn) + "}";
  }
  inspect(): string {
    const result: ParseResult = this.parseProgram();
    let output: string = "{\"root\":" + numberToString(result.root) + ",\"nodes\":["; let separator: string = "";
    for (const item of result.nodes) {
      output = output + separator + "{\"kind\":" + this.quote(item.kind) + ",\"span\":" + this.spanJson(item.start, item.end) + ",\"attributes\":[";
      let comma: string = "";
      for (const field of item.attributes) { output = output + comma + "{\"name\":" + this.quote(field.name) + ",\"value\":" + this.quote(field.value) + "}"; comma = ","; }
      output = output + "],\"edges\":["; comma = "";
      for (const edge of item.edges) { output = output + comma + "{\"role\":" + this.quote(edge.role) + ",\"node\":" + numberToString(edge.node) + "}"; comma = ","; }
      output = output + "]}"; separator = ",";
    }
    output = output + "],\"diagnostics\":["; separator = "";
    for (const diagnostic of result.diagnostics) {
      output = output + separator + "{\"phase\":\"parser\",\"message\":" + this.quote(diagnostic.message) + ",\"span\":" + this.spanJson(diagnostic.token, diagnostic.token) + "}"; separator = ",";
    }
    return output + "]}";
  }
}

export function parseTokens(tokens: ParserToken[]): ParseResult { let parser: Parser = new Parser(tokens); return parser.parseProgram(); }
export function inspectAst(tokens: ParserToken[]): string { let parser: Parser = new Parser(tokens); return parser.inspect(); }
