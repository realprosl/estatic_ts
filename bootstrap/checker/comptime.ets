import { AttributeKind, EdgeRole, NodeKind, isCallableNodeKind, isExpressionNodeKind, nodeKindName } from "../parser/ast-schema";
import { ModuleGraph } from "../modules/loader";
import { BindingResult, bindingChild, callableBinding } from "../binder/binder";
import { nodeBegin, AstNode } from "../parser/parser";
import { diagnosticAt, SourceDiagnostic, quoteSource } from "../frontend/frontend";
import { CheckResult, argumentParameter } from "./model";
import { ConstantValue, constantNumber, constantInteger, constantIntegerText, constantBoolean, constantString, constantCast, constantNumeric, constantFloat, constantWord, constantSignedDouble } from "./constant";
import { nativeNumericLiteral, nativeIntegerText, nativeBinaryPromotion } from "./numeric";
import { numericType, functionParams, functionReturn, genericBase, genericArguments, semanticElement, semanticTuple, splitTypes, fixedArrayElement, fixedArraySize, replaceType, containsMemory } from "./types";

export class ConstantCell {
  value: number; state: number;
  constructor() { this.value = 0; this.state = 0; }
}
export class ConstantEnvironment {
  parent: number; symbols: number[]; cells: number[];
  constructor(parent: number) { this.parent = parent; this.symbols = []; this.cells = []; }
}
export class ConstantLocation {
  cell: number; receiver: number; index: number;
  constructor() { this.cell = -1; this.receiver = -1; this.index = -1; }
}
// A deterministic AST interpreter. All state and budgets belong to one root;
// neither syntax nor binding is rewritten, and no runtime I/O is dispatched.
export class NativeComptime {
  graph: ModuleGraph; binding: BindingResult; checked: CheckResult;
  values: ConstantValue[]; cells: ConstantCell[]; environments: ConstantEnvironment[];
  instructions: number; bytes: number; depth: number; rootModule: number; rootNode: number;
  lastValue: number; failureCode: string; failure: string; failureModule: number; failureNode: number; signal: string; returned: number;
  constructor(graph: ModuleGraph, binding: BindingResult, checked: CheckResult) {
    this.graph = graph; this.binding = binding; this.checked = checked; this.values = []; this.cells = []; this.environments = [];
    this.instructions = 0; this.bytes = 0; this.depth = 0; this.rootModule = 0; this.rootNode = 0;
    this.lastValue = 0; this.failureCode = ""; this.failure = ""; this.failureModule = 0; this.failureNode = 0; this.signal = ""; this.returned = 0;
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  origin(sid: number): number { let at: number = sid; while (at >= 0 && this.binding.symbols[at].target >= 0) at = this.binding.symbols[at].target; return at; }
  reference(module: number, id: number): number {
    return id < 0 ? -1 : this.origin(this.binding.files[module].valueTargets[id]);
  }
  helper(module: number, id: number): string { const sid: number = this.reference(module,id); return sid >= 0 && (this.binding.symbols[sid].module) < 0 ? this.binding.symbols[sid].name : ""; }
  decorated(module: number, id: number, name: string): boolean {
    for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Decorators && this.node(module,edge.node).get(AttributeKind.Name) == name) return true; return false;
  }
  functionOwner(scope: number): number {
    let at: number = scope; while (at >= 0) { const s = this.binding.scopes[at]; if (s.kind == "function" || s.kind == "arrow") return s.node; at = s.parent; } return -1;
  }
  fail(module: number, id: number, code: string, message: string): number {
    if (this.failure == "") { this.failureCode = code; this.failure = message; this.failureModule = module; this.failureNode = id; } return 0;
  }
  step(module: number, id: number): boolean {
    if (this.failure != "") return false; this.instructions = this.instructions+1;
    if (this.instructions > 10000) { this.fail(module,id,"COMPTIME_INSTRUCTION_LIMIT","presupuesto de instrucciones agotado"); return false; } return true;
  }
  utf8(text: string): number { return text.length; }
  charge(module: number, id: number, size: number): boolean {
    if (size > 1048576-this.bytes) { this.fail(module,id,"COMPTIME_VALUE_LIMIT","presupuesto lógico de valores agotado"); return false; }
    this.bytes = this.bytes+size; return true;
  }
  put(value: ConstantValue, module: number, id: number): number {
    if (value.kind == "error") return this.fail(module,id,value.typeName,value.text);
    let size: number = 8; if (value.kind == "string") size = size+this.utf8(value.text); for (const key of value.keys) size = size+this.utf8(key);
    if (!this.charge(module,id,size)) return 0;
    this.values.push(value); return this.values.length-1;
  }
  copy(value: number, module: number, id: number): number {
    if (!this.step(module,id)) return 0; let v = this.values[value];
    if (v.kind == "array" || v.kind == "object" || v.kind == "optional" || v.kind == "result") { let entries: number[] = []; for (const entry of v.entries) entries.push(this.copy(entry,module,id)); v.entries = entries; }
    return this.put(v,module,id);
  }
  environment(parent: number): number { this.environments.push(new ConstantEnvironment(parent)); return this.environments.length-1; }
  reserve(environment: number, sid: number): number {
    if (sid < 0) return -1; let env = this.environments[environment];
    for (let at: number = 0; at < env.symbols.length; at = at+1) if (env.symbols[at] == sid) return env.cells[at];
    const cell: number = this.cells.length; this.cells.push(new ConstantCell()); env.symbols.push(sid); env.cells.push(cell); this.environments[environment] = env; return cell;
  }
  find(environment: number, sid: number): number {
    let at: number = environment;
    while (at >= 0) { const env = this.environments[at]; for (let p: number = 0; p < env.symbols.length; p = p+1) if (env.symbols[p] == sid) return env.cells[p]; at = env.parent; } return -1;
  }
  argumentCell(module: number, id: number, environment: number): number {
    const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.NamedArgumentExpression) return this.argumentCell(module,bindingChild(n,EdgeRole.Value),environment);
    return n.kind == NodeKind.IdentifierExpression ? this.find(environment,this.reference(module,id)) : -1;
  }
  alias(environment: number, sid: number, cell: number): void {
    let env = this.environments[environment];
    for (let at: number = 0; at < env.symbols.length; at = at+1) if (env.symbols[at] == sid) env.cells[at] = cell;
    this.environments[environment] = env;
  }
  functionValue(module: number, id: number, environment: number): number {
    let v = new ConstantValue("function",this.checked.files[module].types[id]); v.module = module; v.node = id; v.environment = environment; return this.put(v,module,id);
  }
  prepare(module: number, id: number, environment: number): void {
    const n: AstNode = this.node(module,id);
    for (const edge of n.edges) if (edge.role == EdgeRole.Statements) {
      let declaration: number = edge.node; if (this.node(module,declaration).kind == NodeKind.ExportDefaultDeclaration) declaration = bindingChild(this.node(module,declaration),EdgeRole.Declaration);
      const item: AstNode = this.node(module,declaration);
      if (item.kind == NodeKind.VariableDeclaration || item.kind == NodeKind.UsingDeclaration || item.kind == NodeKind.FunctionDeclaration) {
        const cell: number = this.reserve(environment,this.binding.files[module].declarations[declaration]);
        if (item.kind == NodeKind.FunctionDeclaration && cell >= 0) { this.cells[cell].value = this.functionValue(module,declaration,environment); this.cells[cell].state = 1; }
        for (const binding of item.edges) if (binding.role == EdgeRole.ArrayBindings || binding.role == EdgeRole.ObjectBindings) this.reserve(environment,this.binding.files[module].declarations[binding.node]);
      }
    }
  }
  directRoot(module: number, id: number): number {
    let at: number = id; while (at >= 0) { const n: AstNode = this.node(module,at); if (n.kind == NodeKind.IdentifierExpression) return this.reference(module,at); if (n.kind == NodeKind.MemberExpression || n.kind == NodeKind.IndexExpression) at = bindingChild(n,EdgeRole.Object); else return -1; } return -1;
  }
  runtimeWrite(sid: number): boolean {
    const rootOwner: number = this.functionOwner(this.binding.files[this.rootModule].nodeScopes[this.rootNode]);
    for (let id: number = 0; id < this.checked.files[this.rootModule].types.length; id = id+1) {
      const n: AstNode = this.node(this.rootModule,id); if (nodeBegin(n) >= nodeBegin(this.node(this.rootModule,this.rootNode)) || this.functionOwner(this.binding.files[this.rootModule].nodeScopes[id]) != rootOwner) continue;
      if ((n.kind == NodeKind.AssignmentExpression || n.kind == NodeKind.CompoundAssignmentExpression || n.kind == NodeKind.DeleteStatement) && this.directRoot(this.rootModule,bindingChild(n,EdgeRole.Target)) == sid) return true;
      if (n.kind == NodeKind.MemberCallExpression && ["push","pop","sort","set","add","delete","clear"].includes(n.get(AttributeKind.Method)) && this.directRoot(this.rootModule,bindingChild(n,EdgeRole.Object)) == sid) return true;
      if ((n.kind == NodeKind.CallExpression || n.kind == NodeKind.MemberCallExpression) && this.checked.files[this.rootModule].constantStates[id] != "evaluated") {
        const selected: number = this.checked.files[this.rootModule].selected[id]; const module: number = this.checked.files[this.rootModule].selectedModules[id];
        for (const effect of this.checked.effects) if (effect.module == module && effect.node == selected && effect.phase == "body" && (effect.writes.includes(sid) || effect.moves.includes(sid) || effect.unknown)) return true;
      }
    } return false;
  }
  read(module: number, id: number, environment: number, sid: number, mode: string): number {
    if (sid < 0) return this.fail(module,id,"COMPTIME_VALUE_UNAVAILABLE","símbolo no disponible");
    const s = this.binding.symbols[sid]; const cell: number = this.find(environment,sid);
    if (cell >= 0 && this.cells[cell].state == 1) return this.cells[cell].value;
    if (s.module >= 0 && (s.kind == "FunctionDeclaration" || s.kind == "ClassMethod")) return this.functionValue(s.module,s.node,0);
    if (s.module >= 0 && s.kind == "EnumMember") { const value: number = this.eval(s.module,bindingChild(this.node(s.module,s.node),EdgeRole.Value),environment,mode); let literal = this.values[value]; literal.typeName = this.checked.symbolTypes[sid]; return this.put(literal,module,id); }
    if (cell >= 0 && (this.functionOwner(s.scope) >= 0 || this.cells[cell].state == 2)) return this.fail(module,id,"COMPTIME_TDZ","lectura antes de inicializar el binding");
    if (s.module >= 0 && (s.kind == "VariableDeclaration" || s.kind == "UsingDeclaration") && (this.functionOwner(s.scope) < 0 || (cell < 0 && s.module == this.rootModule && this.functionOwner(s.scope) == this.functionOwner(this.binding.files[this.rootModule].nodeScopes[this.rootNode])))) {
      if (this.functionOwner(s.scope) < 0 && s.module > this.rootModule) return this.fail(module,id,"COMPTIME_TDZ","Módulo todavía no inicializado");
      if (s.module == this.rootModule && nodeBegin(this.node(s.module,s.node)) >= nodeBegin(this.node(this.rootModule,this.rootNode))) return this.fail(module,id,"COMPTIME_TDZ","declaración global posterior a la evaluación");
      if (this.runtimeWrite(sid)) return this.fail(module,id,"COMPTIME_VALUE_UNAVAILABLE","Una escritura runtime anterior invalida la captura estática");
      const slot: number = cell >= 0 ? cell : this.reserve(0,sid); this.cells[slot].state = 2;
      const init: number = bindingChild(this.node(s.module,s.node),EdgeRole.Initializer); const value: number = this.eval(s.module,init,0,"input");
      const converted: number = this.convert(value,this.checked.symbolTypes[sid],s.module,init);
      this.cells[slot].value = converted; this.cells[slot].state = 1; return converted;
    }
    return this.fail(module,id,"COMPTIME_VALUE_UNAVAILABLE","valor sólo disponible en runtime");
  }
  fieldType(name: string, key: string): string {
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) {
      const owner = this.binding.symbols[sid]; if (name != "#"+numberToString(sid) && !name.startsWith("#"+numberToString(sid)+"<")) continue;
      for (let member: number = 0; member < this.binding.symbols.length; member = member+1) {
        const field = this.binding.symbols[member]; if (field.module != owner.module || (field.scope) < 0 || field.name != key || this.binding.scopes[field.scope].node != owner.node) continue;
        if (field.kind != "ClassField" && field.kind != "InterfaceField") continue;
        let text: string = this.checked.symbolTypes[member]; const inputs: string[] = genericArguments(name); let at: number = 0;
        for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == EdgeRole.TypeParameters) { if (at < inputs.length) text = replaceType(text,"@"+numberToString(this.binding.files[owner.module].declarations[edge.node]),inputs[at]); at = at+1; }
        return text;
      }
    } return "";
  }
  convert(value: number, name: string, module: number, id: number): number {
    if (this.failure != "") return 0;
    const source = this.values[value]; if (name == "") return this.copy(value,module,id);
    const alternatives: string[] = splitTypes(name,"|");
    if (alternatives.length > 1) {
      for (const part of alternatives) if (source.typeName == part) return this.convert(value,part,module,id);
      for (const part of alternatives) if (numericType(source.typeName) && numericType(part)) return this.convert(value,part,module,id);
      return this.fail(module,id,"COMPTIME_INVALID_CAST","El valor no pertenece a las alternativas del union");
    }
    if (numericType(name)) {
      if (source.kind != "number" && source.kind != "integer") return this.fail(module,id,"COMPTIME_INVALID_CAST","Conversión numérica de un valor no numérico");
      return this.put(constantCast(source,name),module,id);
    }
    if (source.kind == "function" && name.startsWith("(")) { let result = source; result.text = functionReturn(name); return this.put(result,module,id); }
    if (name == "string" && source.kind != "string") return this.put(constantString(this.text(value,module,id)),module,id);
    if (source.kind == "array" && (name.endsWith("[]") || fixedArraySize(name) >= 0 || semanticTuple(name))) {
      let result = new ConstantValue("array",name); const items: string[] = semanticTuple(name) ? splitTypes(name.slice(1,name.length-1),",") : [];
      for (let at: number = 0; at < source.entries.length; at = at+1) { const element: string = name.endsWith("[]") ? semanticElement(name) : fixedArraySize(name) >= 0 ? fixedArrayElement(name) : at < items.length ? items[at] : ""; result.entries.push(this.convert(source.entries[at],element,module,id)); }
      return this.put(result,module,id);
    }
    if (source.kind == "object") { let result = source; result.typeName = name; result.entries = []; for (let at: number = 0; at < source.entries.length; at = at+1) result.entries.push(this.convert(source.entries[at],this.fieldType(name,source.keys[at]),module,id)); return this.put(result,module,id); }
    if (source.kind == "optional" && genericBase(name) == "Optional") { let result = new ConstantValue("optional",name); for (const item of source.entries) result.entries.push(this.convert(item,genericArguments(name)[0],module,id)); return this.put(result,module,id); }
    if (genericBase(name) == "Optional" && this.values[value].kind != "optional") { let v = new ConstantValue("optional",name); v.entries.push(this.convert(value,genericArguments(name)[0],module,id)); return this.put(v,module,id); }
    return this.copy(value,module,id);
  }
  text(value: number, module: number, id: number): string {
    const v = this.values[value]; if (v.kind == "string") return v.text; if (v.kind == "integer") return constantIntegerText(v);
    if (v.kind == "number") return numberToString(v.scalar); if (v.kind == "boolean") return v.scalar == 1 ? "true" : "false";
    this.fail(module,id,"COMPTIME_UNSUPPORTED","conversión de agregado a string"); return "";
  }
  binary(module: number, id: number, left: number, right: number, op: string): number {
    const a = this.values[left]; const b = this.values[right];
    if (op == "===") return this.binary(module,id,left,right,"=="); if (op == "!==") return this.binary(module,id,left,right,"!=");
    if (op == "+" && (a.kind == "string" || b.kind == "string")) {
      const x: string = this.text(left,module,id); const y: string = this.text(right,module,id);
      if (!this.charge(module,id,this.utf8(x)+this.utf8(y))) return 0; return this.put(constantString(x+y),module,id);
    }
    if (a.kind == "string" && b.kind == "string") {
      const order: number = a.text.localeCompare(b.text); let yes: boolean = false;
      if (op == "==") yes = a.text == b.text; else if (op == "!=") yes = a.text != b.text; else if (op == "<") yes = order < 0; else if (op == "<=") yes = order <= 0; else if (op == ">") yes = order > 0; else if (op == ">=") yes = order >= 0; else return this.fail(module,id,"COMPTIME_UNSUPPORTED","operador de string");
      return this.put(constantBoolean(yes),module,id);
    }
    if (a.kind == "boolean" && b.kind == "boolean") return this.put(constantNumeric(constantNumber(a.scalar),constantNumber(b.scalar),op,"number"),module,id);
    const name: string = nativeBinaryPromotion(a.typeName,b.typeName,op);
    let x = constantCast(a,name); let y = op == "<<" || op == ">>" ? b : constantCast(b,name);
    return this.put(constantNumeric(x,y,op,name),module,id);
  }
  bindReceiver(module: number, declaration: number, parent: number, receiver: number): number {
    const environment: number = this.environment(parent);
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) {
      const s = this.binding.symbols[sid];
      if (s.kind == "receiver" && s.module == module && this.binding.scopes[s.scope].node == declaration) {
        const cell: number = this.reserve(environment,sid); this.cells[cell].value = receiver; this.cells[cell].state = 1;
      }
    }
    return environment;
  }
  construct(module: number, id: number, environment: number, mode: string): number {
    this.depth = this.depth+1;
    if (this.depth > 100) { this.depth = this.depth-1; return this.fail(module,id,"COMPTIME_RECURSION_LIMIT","profundidad máxima de construcción excedida"); }
    const result: number = this.constructValue(module,id,environment,mode); this.depth = this.depth-1; return result;
  }
  constructValue(module: number, id: number, environment: number, mode: string): number {
    const n: AstNode = this.node(module,id); const name: string = this.checked.files[module].types[id]; let owner: number = -1;
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) if (this.binding.symbols[sid].kind == "ClassDeclaration" && (name == "#"+numberToString(sid) || name.startsWith("#"+numberToString(sid)+"<"))) owner = sid;
    if (owner < 0) return this.fail(module,id,"COMPTIME_UNSUPPORTED","Constructor no materializable");
    const symbol = this.binding.symbols[owner]; let args: number[] = []; let positions: number[] = []; let argumentCells: number[] = [];
    let at: number = 0; for (const edge of n.edges) if (edge.role == EdgeRole.Args) { args.push(this.eval(module,edge.node,environment,mode)); argumentCells.push(this.argumentCell(module,edge.node,environment)); positions.push(argumentParameter(this.checked.files[module],edge.node,at)); at = at+1; }
    let object = new ConstantValue("object",name); let fields: number[] = [];
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) {
      const field = this.binding.symbols[sid];
      if (field.kind == "ClassField" && field.module == symbol.module && this.binding.scopes[field.scope].node == symbol.node && this.node(field.module,field.node).get(AttributeKind.IsStatic) != "true") { fields.push(sid); object.keys.push(field.name); object.entries.push(0); }
    }
    const receiver: number = this.put(object,module,id); const defaults: number = this.bindReceiver(symbol.module,symbol.node,environment,receiver);
    for (let p: number = 0; p < fields.length; p = p+1) {
      const field = this.binding.symbols[fields[p]]; const node: AstNode = this.node(field.module,field.node); const initializer: number = bindingChild(node,EdgeRole.DefaultValue);
      let value: number = 0;
      if (node.kind != NodeKind.Parameter && initializer >= 0) value = this.eval(field.module,initializer,defaults,mode);
      else if (numericType(this.fieldType(name,field.name))) value = this.put(constantNumber(0),module,id);
      else if (this.fieldType(name,field.name) == "string") value = this.put(constantString(""),module,id);
      else if (this.fieldType(name,field.name) == "boolean") value = this.put(constantBoolean(false),module,id);
      if (value != 0) { let changed = this.values[receiver]; changed.entries[p] = this.convert(value,this.fieldType(name,field.name),module,id); this.values[receiver] = changed; }
    }
    const selected: number = this.checked.files[module].selected[id]; const selectedModule: number = this.checked.files[module].selectedModules[id];
    if (selected >= 0) {
      const frame: number = this.bindReceiver(selectedModule,selected,environment,receiver);
      this.invoke(this.functionValue(selectedModule,selected,frame),args,positions,module,id,mode,this.checked.files[module].signatures[id],argumentCells);
    } else if (args.length > 0) {
      let changed = this.values[receiver];
      for (let a: number = 0; a < args.length; a = a+1) if (positions[a] < changed.entries.length) changed.entries[positions[a]] = this.convert(args[a],this.fieldType(name,changed.keys[positions[a]]),module,id);
      this.values[receiver] = changed;
    }
    return receiver;
  }
  optionalValue(module: number, id: number, value: number): number {
    if (this.node(module,id).get(AttributeKind.Optional) != "true" || this.checked.files[module].types[id] == "void") return value;
    let result = new ConstantValue("optional",this.checked.files[module].types[id]); result.entries.push(this.copy(value,module,id)); return this.put(result,module,id);
  }
  eval(module: number, id: number, environment: number, mode: string): number {
    const value: number = this.inner(module,id,environment,mode); if (id < 0 || this.failure != "") return value;
    const conversion: string = this.checked.files[module].conversions[id]; const parent: number = this.binding.files[module].parents[id];
    if (parent >= 0 && this.node(module,parent).kind == NodeKind.MemberCallExpression) { const object: number = bindingChild(this.node(module,parent),EdgeRole.Object); if (object >= 0 && this.checked.files[module].types[object] == "!Math") return value; }
    return conversion == "" ? value : this.convert(value,conversion,module,id);
  }
  inner(module: number, id: number, environment: number, mode: string): number {
    if (id < 0 || !this.step(module,id)) return 0;
    const n: AstNode = this.node(module,id); const name: string = this.checked.files[module].types[id];
    const exact: string = this.checked.files[module].exactIntegers[id]; if (exact != "") return this.put(constantInteger(exact,name),module,id);
    if (n.kind == NodeKind.LiteralExpression) {
      if (n.get(AttributeKind.LiteralType) == "string") return this.put(constantString(n.get(AttributeKind.Value)),module,id);
      if (n.get(AttributeKind.LiteralType) == "boolean") return this.put(constantBoolean(n.get(AttributeKind.Value) == "true"),module,id);
      const raw: string = n.get(AttributeKind.Raw) == "" ? n.get(AttributeKind.Value) : n.get(AttributeKind.Raw); const parsed = nativeNumericLiteral(raw);
      if (!parsed.valid) return this.fail(module,id,"COMPTIME_INVALID_NUMBER","literal inválido");
      if (name != "number" && name != "f32" && name != "f64" && numericType(name)) return this.put(constantCast(constantInteger(nativeIntegerText(raw),name),name),module,id);
      return this.put(constantCast(constantNumber(parsed.value),name),module,id);
    }
    if (n.kind == NodeKind.IdentifierExpression) return this.read(module,id,environment,this.reference(module,id),mode);
    if (n.kind == NodeKind.ArrowFunctionExpression) return this.functionValue(module,id,environment);
    if (n.kind == NodeKind.NewExpression) return this.construct(module,id,environment,mode);
    if (n.kind == NodeKind.NamedArgumentExpression) return this.eval(module,bindingChild(n,EdgeRole.Value),environment,mode);
    if (n.kind == NodeKind.SpreadElement || n.kind == NodeKind.SatisfiesExpression) return this.eval(module,bindingChild(n,n.kind == NodeKind.SpreadElement ? EdgeRole.Expression : EdgeRole.Operand),environment,mode);
    if (n.kind == NodeKind.AsExpression) return this.eval(module,bindingChild(n,EdgeRole.Expression),environment,mode);
    if (n.kind == NodeKind.ArrayLiteralExpression || n.kind == NodeKind.ObjectLiteralExpression) {
      let v = new ConstantValue(n.kind == NodeKind.ArrayLiteralExpression ? "array" : "object",name);
      for (const edge of n.edges) if (edge.role == EdgeRole.Elements) {
        const entry: number = this.eval(module,edge.node,environment,mode);
        if (this.node(module,edge.node).kind == NodeKind.SpreadElement) for (const item of this.values[entry].entries) v.entries.push(this.copy(item,module,id)); else v.entries.push(this.copy(entry,module,id));
      } else if (edge.role == EdgeRole.Properties) { const property: AstNode = this.node(module,edge.node); v.keys.push(property.get(AttributeKind.Key)); v.entries.push(this.copy(this.eval(module,bindingChild(property,EdgeRole.Value),environment,mode),module,id)); }
      return this.put(v,module,id);
    }
    if (n.kind == NodeKind.MemberExpression && this.checked.files[module].types[bindingChild(n,EdgeRole.Object)] == "!Math" && ["PI","E"].includes(n.get(AttributeKind.Member))) return this.put(constantNumber(n.get(AttributeKind.Member) == "PI" ? 3.141592653589793 : 2.718281828459045),module,id);
    if (n.kind == NodeKind.MemberExpression) {
      const member: number = this.checked.files[module].members[id];
      if (member >= 0 && ["VariableDeclaration","FunctionDeclaration","EnumMember"].includes(this.binding.symbols[this.origin(member)].kind)) return this.read(module,id,environment,this.origin(member),mode);
    }
    if (n.kind == NodeKind.IndexExpression || n.kind == NodeKind.MemberExpression) {
      const object: number = this.eval(module,bindingChild(n,EdgeRole.Object),environment,mode); let v = this.values[object];
      if (n.get(AttributeKind.Optional) == "true") {
        if (v.kind != "optional") return this.fail(module,id,"COMPTIME_INVALID_CONTAINER","receptor opcional inválido");
        if (v.entries.length == 0) return this.put(new ConstantValue("optional",name),module,id);
        v = this.values[v.entries[0]];
      }
      if (n.kind == NodeKind.MemberExpression) {
        const key: string = n.get(AttributeKind.Member);
        if (v.kind == "result" && key == "kind") return this.put(constantString(v.text == "error" ? "Err" : "Ok"),module,id);
        if (v.kind == "result" && key == "ok") return this.put(constantBoolean(v.text != "error"),module,id);
        if (key == "length" && (v.kind == "array" || v.kind == "string")) return this.optionalValue(module,id,this.put(constantNumber(v.kind == "array" ? v.entries.length : v.text.length),module,id));
        for (let at: number = 0; at < v.keys.length; at = at+1) if (v.keys[at] == key) return this.optionalValue(module,id,v.entries[at]);
        return this.fail(module,id,"COMPTIME_INVALID_MEMBER","campo no disponible");
      }
      const index: number = this.index(this.eval(module,bindingChild(n,EdgeRole.Index),environment,mode),module,id);
      if (index < 0) return 0;
      if (v.kind == "string") return this.put(constantString(v.text.charAt(index)),module,id);
      if (index >= v.entries.length) return this.fail(module,id,"COMPTIME_INVALID_INDEX","índice fuera de rango"); return v.entries[index];
    }
    if (n.kind == NodeKind.BinaryExpression) {
      const left: number = this.eval(module,bindingChild(n,EdgeRole.Left),environment,mode); const op: string = n.get(AttributeKind.Operator);
      if (op == "instanceof") { const right: string = this.checked.files[module].types[bindingChild(n,EdgeRole.Right)]; const target: string = right.slice(6,right.length); const actual: string = this.values[left].typeName; return this.put(constantBoolean(actual == target || (target == "number" && numericType(actual))),module,id); }
      if (op == "&&" && this.values[left].scalar == 0) return left; if (op == "||" && this.values[left].scalar != 0) return left;
      if (op == "??") { if (this.values[left].kind == "optional") { if (this.values[left].entries.length > 0) return this.values[left].entries[0]; } else return left; return this.eval(module,bindingChild(n,EdgeRole.Right),environment,mode); }
      const right: number = this.eval(module,bindingChild(n,EdgeRole.Right),environment,mode); if (op == "&&" || op == "||") return right;
      return this.binary(module,id,left,right,op);
    }
    if (n.kind == NodeKind.TernaryExpression) { const condition: number = this.eval(module,bindingChild(n,EdgeRole.Condition),environment,mode); return this.eval(module,bindingChild(n,this.values[condition].scalar != 0 ? EdgeRole.ThenBranch : EdgeRole.ElseBranch),environment,mode); }
    if (n.kind == NodeKind.UnaryExpression) {
      const value: number = this.eval(module,bindingChild(n,EdgeRole.Operand),environment,mode); const v = this.values[value]; const op: string = n.get(AttributeKind.Operator);
      if (op == "typeof") return this.put(constantString(v.kind == "integer" || v.kind == "number" ? "number" : v.kind == "void" ? "undefined" : v.kind == "function" ? "function" : v.kind == "string" || v.kind == "boolean" ? v.kind : "object"),module,id);
      if (op == "!") return this.put(constantBoolean(v.scalar == 0),module,id);
      if (op == "+") return this.convert(value,name,module,id);
      if (op == "-" && v.kind == "number") return this.put(constantCast(constantNumber(-v.scalar),name),module,id);
      if (op == "-") { const zero = v.kind == "integer" ? constantInteger("0",name) : constantNumber(0,name); return this.put(constantNumeric(zero,v,"-",name),module,id); }
      if (op == "~") { if (v.kind == "integer") { let result = v; result.bits = ~result.bits; return this.put(constantCast(result,name),module,id); } const bits: i32 = constantWord(v.scalar); return this.put(constantNumber(constantSignedDouble(~bits)),module,id); }
    }
    if (n.kind == NodeKind.AssignmentExpression || n.kind == NodeKind.CompoundAssignmentExpression) {
      const target: number = bindingChild(n,EdgeRole.Target); const location: ConstantLocation = this.location(module,target,environment,mode);
      const previous: number = n.kind == NodeKind.CompoundAssignmentExpression ? this.load(location,module,target) : 0;
      let value: number = this.eval(module,bindingChild(n,EdgeRole.Value),environment,mode);
      if (n.kind == NodeKind.CompoundAssignmentExpression) value = this.binary(module,id,previous,value,n.get(AttributeKind.Operator).slice(0,n.get(AttributeKind.Operator).length-1));
      value = this.convert(value,this.checked.files[module].types[target],module,id); this.store(location,value,module,target); return value;
    }
    if (n.kind == NodeKind.TemplateLiteralExpression) {
      let text: string = ""; for (const edge of n.edges) { const part: string = edge.role == EdgeRole.Parts ? this.node(module,edge.node).get(AttributeKind.Value) : this.text(this.eval(module,edge.node,environment,mode),module,id); if (!this.charge(module,id,this.utf8(part))) return 0; text = text+part; } return this.put(constantString(text),module,id);
    }
    if (n.kind == NodeKind.CallExpression) return this.call(module,id,environment,mode);
    if (n.kind == NodeKind.MemberCallExpression) return this.method(module,id,environment,mode);
    return this.fail(module,id,"COMPTIME_UNSUPPORTED","construcción " + nodeKindName(n.kind));
  }
  keyIndex(keys: string[], key: string): number { for (let at: number = 0; at < keys.length; at = at+1) if (keys[at] == key) return at; return -1; }
  index(value: number, module: number, id: number): number {
    const v = constantFloat(this.values[value],false); if (v.kind == "error") { this.fail(module,id,v.typeName,v.text); return -1; }
    if ((v.scalar) < 0 || v.scalar != Math.floor(v.scalar) || v.scalar > 1048576) { this.fail(module,id,"COMPTIME_INVALID_INDEX","índice inválido o demasiado grande"); return -1; } return v.scalar;
  }
  location(module: number, id: number, environment: number, mode: string): ConstantLocation {
    let result = new ConstantLocation(); const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.IdentifierExpression) {
      const sid: number = this.reference(module,id); this.read(module,id,environment,sid,mode); result.cell = this.find(environment,sid); return result;
    }
    result.receiver = this.eval(module,bindingChild(n,EdgeRole.Object),environment,mode); const v = this.values[result.receiver];
    if (n.kind == NodeKind.MemberExpression) result.index = this.keyIndex(v.keys,n.get(AttributeKind.Member));
    else result.index = this.index(this.eval(module,bindingChild(n,EdgeRole.Index),environment,mode),module,id);
    if ((result.index) < 0 && this.failure == "") this.fail(module,id,"COMPTIME_INVALID_MEMBER","Lvalue sin una posición conocida"); return result;
  }
  load(location: ConstantLocation, module: number, id: number): number {
    if (this.failure != "") return 0;
    if (location.cell >= 0) return this.cells[location.cell].value;
    if ((location.receiver) < 0 || (location.index) < 0 || location.index >= this.values[location.receiver].entries.length) return this.fail(module,id,"COMPTIME_INVALID_INDEX","Lectura fuera del agregado");
    return this.values[location.receiver].entries[location.index];
  }
  store(location: ConstantLocation, value: number, module: number, id: number): void {
    if (this.failure != "") return;
    if (location.cell >= 0) { this.cells[location.cell].value = this.copy(value,module,id); return; }
    if ((location.receiver) < 0 || (location.index) < 0) { this.fail(module,id,"COMPTIME_INVALID_INDEX","Destino de asignación inválido"); return; }
    let aggregate = this.values[location.receiver];
    if (location.index >= aggregate.entries.length) {
      if (!this.charge(module,id,8*(location.index+1-aggregate.entries.length))) return;
      const element: string = semanticElement(aggregate.typeName);
      while (aggregate.entries.length <= location.index && this.failure == "") {
        if (numericType(element)) aggregate.entries.push(this.put(constantCast(constantNumber(0),element),module,id));
        else { this.fail(module,id,"COMPTIME_UNSUPPORTED","El crecimiento disperso necesita un valor por defecto del elemento"); return; }
      }
    }
    aggregate.entries[location.index] = this.copy(value,module,id); this.values[location.receiver] = aggregate;
  }
  variant(module: number, id: number, environment: number, mode: string, sid: number): number {
    const symbol = this.binding.symbols[sid]; const declaration: AstNode = this.node(symbol.module,symbol.node); const n: AstNode = this.node(module,id);
    let result = new ConstantValue("object",this.checked.files[module].types[id]); result.keys.push("kind"); result.entries.push(this.put(constantString(symbol.name),module,id));
    const discriminator: number = bindingChild(declaration,EdgeRole.Discriminator);
    if (discriminator >= 0) {
      const tag: AstNode = this.node(symbol.module,discriminator); result.keys.push(tag.get(AttributeKind.Field));
      if (tag.get(AttributeKind.LiteralType) == "string") result.entries.push(this.put(constantString(tag.get(AttributeKind.Value)),module,id));
      else if (tag.get(AttributeKind.LiteralType) == "boolean") result.entries.push(this.put(constantBoolean(tag.get(AttributeKind.Value) == "true"),module,id));
      else result.entries.push(this.put(constantNumber(nativeNumericLiteral(tag.get(AttributeKind.Value)).value),module,id));
    }
    const params: string[] = functionParams(this.checked.files[module].signatures[id]); let at: number = 0;
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) { const value: number = this.eval(module,edge.node,environment,mode); result.keys.push("value"); result.entries.push(this.convert(value,at < params.length ? params[at] : "",module,id)); at = at+1; }
    return this.put(result,module,id);
  }
  match(module: number, id: number, environment: number, mode: string): number {
    let args: number[] = []; for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    const subject: number = this.eval(module,args[0],environment,mode); let pattern: number = subject;
    if (args.length == 3) {
      const key: string = this.node(module,args[1]).get(AttributeKind.Value); const object = this.values[subject]; let found: boolean = false;
      if (object.kind == "result" && (key == "kind" || key == "ok")) { pattern = (key == "kind" ? this.put(constantString(object.text == "error" ? "Err" : "Ok"),module,id) : this.put(constantBoolean(object.text != "error"),module,id)); found = true; }
      else for (let at: number = 0; at < object.keys.length; at = at+1) if (object.keys[at] == key) { pattern = object.entries[at]; found = true; }
      if (!found) return this.fail(module,id,"COMPTIME_INVALID_MEMBER","Discriminador de match no disponible");
    }
    for (const edge of this.node(module,args[args.length-1]).edges) if (edge.role == EdgeRole.Elements) {
      if (!this.step(module,edge.node)) return 0; const item: AstNode = this.node(module,edge.node); const helper: string = this.helper(module,edge.node); let values: number[] = [];
      for (const value of item.edges) if (value.role == EdgeRole.Args) values.push(value.node);
      let chosen: boolean = helper == "otherwise";
      if (helper == "when") { const candidate: number = this.eval(module,values[0],environment,mode); const equal: number = this.binary(module,edge.node,pattern,candidate,"=="); chosen = this.values[equal].scalar != 0; }
      if (helper == "whenType") { const key: string = this.checked.files[module].caseValues[edge.node]; chosen = key == "type:"+this.values[subject].typeName; }
      if (chosen) {
        const callback: number = this.eval(module,values[values.length-1],environment,mode); let inputs: number[] = [];
        if (functionParams(this.values[callback].typeName).length > 0) inputs.push(subject);
        const result: number = this.invoke(callback,inputs,[],module,id,mode,""); return this.convert(result,this.checked.files[module].types[id],module,id);
      }
    }
    return this.fail(module,id,"COMPTIME_MATCH_UNMATCHED","Ningún caso de match coincide; la operación termina sin retorno");
  }
  call(module: number, id: number, environment: number, mode: string): number {
    const n: AstNode = this.node(module,id); const helper: string = this.helper(module,id);
    if (helper == "match") return this.match(module,id,environment,mode);
    const target: number = this.reference(module,id); if (target >= 0 && this.binding.symbols[target].kind == "UnionVariant") return this.variant(module,id,environment,mode,target);
    let args: number[] = []; let positions: number[] = []; let argumentCells: number[] = []; let at: number = 0;
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) {
      const value: number = this.eval(module,edge.node,environment,helper == "comptime" ? "strict" : mode);
      if (this.node(module,edge.node).kind == NodeKind.SpreadElement) for (const item of this.values[value].entries) { args.push(item); argumentCells.push(-1); positions.push(argumentParameter(this.checked.files[module],edge.node,at)); }
      else { args.push(value); argumentCells.push(this.argumentCell(module,edge.node,environment)); positions.push(argumentParameter(this.checked.files[module],edge.node,at)); } at = at+1;
    }
    if (this.failure != "") return 0;
    if (helper == "comptime") return this.invoke(args[0],[],[],module,id,"strict","");
    if (numericType(helper)) return this.put(constantCast(this.values[args[0]],helper),module,id);
    if (helper == "numberToString") return this.put(constantString(this.text(args[0],module,id)),module,id);
    if (helper == "length") { const v = this.values[args[0]]; return this.put(constantNumber(v.kind == "string" ? v.text.length : v.entries.length),module,id); }
    if (["charAt","substring","indexOf","startsWith","trim"].includes(helper)) { let rest: number[] = []; for (let p: number = 1; p < args.length; p = p+1) rest.push(args[p]); return this.stringMethod(module,id,args[0],helper,rest); }
    if (["optionalSome","optionalNone","optionalIsPresent","optionalValueOr","optionalOrElse","ok","err","resultOk","resultErr","resultIsOk","resultValueOr"].includes(helper)) {
      if (helper == "optionalSome" || helper == "optionalNone" || ["ok","err","resultOk","resultErr"].includes(helper)) {
        let v = new ConstantValue(helper.startsWith("optional") ? "optional" : "result",this.checked.files[module].types[id]); v.text = (helper == "err" || helper == "resultErr" ? "error" : "ok");
        if (args.length > 0) v.entries.push(this.copy(args[0],module,id)); return this.put(v,module,id);
      }
      const v = this.values[args[0]]; const present: boolean = v.entries.length > 0 && v.text != "error";
      if (helper == "optionalIsPresent" || helper == "resultIsOk") return this.put(constantBoolean(present),module,id);
      if (helper == "optionalOrElse") return present ? args[0] : args[1];
      if (present) return v.entries[0]; return args[1];
    }
    if (helper == "optionalMap" || helper == "optionalAndThen") {
      let result = new ConstantValue("optional",this.checked.files[module].types[id]); const container = this.values[args[0]];
      if (container.entries.length == 0) return this.put(result,module,id);
      const returned: number = this.invoke(args[1],[container.entries[0]],[],module,id,mode,"");
      if (helper == "optionalAndThen") return this.convert(returned,result.typeName,module,id);
      result.entries.push(this.convert(returned,genericArguments(result.typeName)[0],module,id)); return this.put(result,module,id);
    }
    if (helper != "") return this.fail(module,id,mode == "input" ? "COMPTIME_VALUE_UNAVAILABLE" : "COMPTIME_FORBIDDEN_EFFECT","Builtin runtime o externo: " + helper);
    const selected: number = this.checked.files[module].selected[id]; const selectedModule: number = this.checked.files[module].selectedModules[id]; let callable: number = 0;
    if (selected >= 0) {
      const sid: number = this.reference(module,id); const cell: number = this.find(environment,sid);
      callable = (cell >= 0 && this.cells[cell].state == 1 ? this.cells[cell].value : this.functionValue(selectedModule,selected,0));
      // An overload's own body is authoritative, not its group's first cell.
      let fn = this.values[callable]; fn.module = selectedModule; fn.node = selected; callable = this.put(fn,module,id);
    } else callable = this.read(module,id,environment,this.reference(module,id),mode);
    return this.invoke(callable,args,positions,module,id,selected >= 0 && this.decorated(selectedModule,selected,"comptime") ? "strict" : mode,this.checked.files[module].signatures[id],argumentCells);
  }
  invoke(callable: number, args: number[], positions: number[], module: number, id: number, mode: string, signature: string, argumentCells: number[] = []): number {
    if (this.failure != "") return 0; const fn = this.values[callable];
    if (fn.kind != "function") return this.fail(module,id,"COMPTIME_VALUE_UNAVAILABLE","destino invocable no disponible");
    const declaration: AstNode = this.node(fn.module,fn.node); const body: number = bindingChild(declaration,EdgeRole.Body);
    if (this.decorated(fn.module,fn.node,"cppgen")) return this.fail(module,id,mode == "input" ? "COMPTIME_VALUE_UNAVAILABLE" : "COMPTIME_FORBIDDEN_EFFECT","Escape opaco de backend; no se ejecuta durante el análisis del frontend");
    if (declaration.get(AttributeKind.Async) == "true" || declaration.get(AttributeKind.IsAsync) == "true") return this.fail(module,id,"COMPTIME_FORBIDDEN_EFFECT","tarea async durante evaluación");
    if (body < 0 || this.node(fn.module,body).start.kind == ";") return this.fail(module,id,mode == "input" ? "COMPTIME_VALUE_UNAVAILABLE" : "COMPTIME_FORBIDDEN_EFFECT","Implementación externa");
    this.depth = this.depth+1; if (this.depth > 100) { this.depth = this.depth-1; return this.fail(module,id,"COMPTIME_RECURSION_LIMIT","profundidad máxima excedida"); }
    const frame: number = this.environment(fn.environment); let parameters: number[] = []; for (const edge of declaration.edges) if (edge.role == EdgeRole.Params) { parameters.push(edge.node); this.reserve(frame,this.binding.files[fn.module].declarations[edge.node]); }
    const effective: string = fn.typeName.indexOf("@",0) >= 0 && signature != "" ? signature : fn.typeName;
    const types: string[] = functionParams(effective);
    for (let p: number = 0; p < parameters.length; p = p+1) {
      const parameter: AstNode = this.node(fn.module,parameters[p]); const sid: number = this.binding.files[fn.module].declarations[parameters[p]]; const cell: number = this.find(frame,sid);
      if (parameter.get(AttributeKind.Out) == "true") {
        let aliasCell: number = -1;
        for (let a: number = 0; a < args.length; a = a+1) if ((a < positions.length ? positions[a] : a) == p && a < argumentCells.length) aliasCell = argumentCells[a];
        if (aliasCell < 0) { this.fail(module,id,"COMPTIME_INVALID_ALIAS","Un argumento out necesita una celda mutable inicializada"); break; }
        this.alias(frame,sid,aliasCell); continue;
      }
      const target: string = p < types.length ? types[p] : this.checked.symbolTypes[sid]; if (containsMemory(target)) { this.fail(module,id,"COMPTIME_UNSUPPORTED","Un contrato de memoria requiere una prueba de aliasing del evaluador"); break; } let value: number = 0; let supplied: boolean = false;
      if (parameter.get(AttributeKind.Variadic) == "true") {
        let rest = new ConstantValue("array",target.startsWith("...") ? target.slice(3,target.length) : target);
        for (let a: number = 0; a < args.length; a = a+1) if ((a < positions.length ? positions[a] : a) >= p) rest.entries.push(this.copy(args[a],module,id));
        value = this.put(rest,module,id); supplied = true;
      } else for (let a: number = 0; a < args.length; a = a+1) if ((a < positions.length ? positions[a] : a) == p) { value = this.convert(args[a],target,module,id); supplied = true; }
      if (!supplied) {
        const fallback: number = bindingChild(parameter,EdgeRole.DefaultValue);
        if (fallback >= 0) value = this.convert(this.eval(fn.module,fallback,frame,mode),target,fn.module,fallback);
        else if (genericBase(target) == "Optional") value = this.put(new ConstantValue("optional",target),module,id);
        else { this.fail(module,id,"COMPTIME_ARITY","argumento requerido ausente"); break; }
      }
      if (cell >= 0) { this.cells[cell].value = value; this.cells[cell].state = 1; }
      if (parameter.get(AttributeKind.ParameterProperty) == "true") for (let receiverSid: number = 0; receiverSid < this.binding.symbols.length; receiverSid = receiverSid+1) {
        const s = this.binding.symbols[receiverSid];
        if (s.kind == "receiver" && s.module == fn.module && this.binding.scopes[s.scope].node == fn.node) {
          const receiverCell: number = this.find(frame,receiverSid);
          if (receiverCell >= 0) { const receiver: number = this.cells[receiverCell].value; let object = this.values[receiver]; for (let f: number = 0; f < object.keys.length; f = f+1) if (object.keys[f] == parameter.get(AttributeKind.Name)) object.entries[f] = this.copy(value,module,id); this.values[receiver] = object; }
        }
      }
    }
    const outerSignal: string = this.signal; const outerReturned: number = this.returned; this.signal = ""; this.returned = 0;
    let value: number = 0;
    if (this.node(fn.module,body).kind == NodeKind.BlockStatement) { this.walk(fn.module,body,frame,mode); value = this.returned; }
    else value = this.eval(fn.module,body,frame,mode);
    if (this.signal == "break" || this.signal == "continue") this.fail(fn.module,body,"COMPTIME_INVALID_CONTROL","control fuera de un bucle");
    const returns: string = functionReturn(effective); if (this.failure == "" && returns != "void") value = this.convert(value,returns,fn.module,body);
    if (this.failure == "" && fn.text != "" && fn.text != "void") value = this.convert(value,fn.text,fn.module,body);
    this.signal = outerSignal; this.returned = outerReturned; this.depth = this.depth-1; return value;
  }
  stringMethod(module: number, id: number, receiver: number, name: string, args: number[]): number {
    const text: string = this.values[receiver].text; const first: string = args.length > 0 ? this.text(args[0],module,id) : "";
    const a: number = args.length > 0 && numericType(this.values[args[0]].typeName) ? constantFloat(this.values[args[0]],false).scalar : 0; const b: number = args.length > 1 && numericType(this.values[args[1]].typeName) ? constantFloat(this.values[args[1]],false).scalar : 0;
    let result: string = "";
    if (name == "charCodeAt") return this.put(constantNumber(text.charCodeAt(a)),module,id);
    if (name == "indexOf") return this.put(constantNumber(text.indexOf(first,b)),module,id);
    if (name == "lastIndexOf") return this.put(constantNumber(text.lastIndexOf(first)),module,id);
    if (name == "localeCompare") return this.put(constantNumber(text.localeCompare(first)),module,id);
    if (name == "includes") return this.put(constantBoolean(text.indexOf(first,b) >= 0),module,id);
    if (name == "startsWith") return this.put(constantBoolean(text.startsWith(first)),module,id);
    if (name == "endsWith") return this.put(constantBoolean(text.endsWith(first)),module,id);
    if (name == "split") { let v = new ConstantValue("array","string[]"); for (const part of text.split(first)) v.entries.push(this.put(constantString(part),module,id)); return this.put(v,module,id); }
    if (name == "repeat" || name == "padStart" || name == "padEnd") {
      const count: number = this.index(args[0],module,id); if (count < 0) return 0;
      if (!this.charge(module,id,name == "repeat" ? text.length*count : Math.max(text.length,count))) return 0;
      if (name == "repeat") result = text.repeat(count); else if (name == "padStart") result = text.padStart(count,this.values[args[1]].text); else result = text.padEnd(count,this.values[args[1]].text);
    } else if (name == "charAt") result = text.charAt(a);
    else if (name == "slice") result = text.slice(a,b); else if (name == "substring") result = text.substring(a,b); else if (name == "substr") result = text.substr(a,b);
    else if (name == "trim") result = text.trim(); else if (name == "trimStart") result = text.trimStart(); else if (name == "trimEnd") result = text.trimEnd();
    else if (name == "toUpperCase") result = text.toUpperCase(); else if (name == "toLowerCase") result = text.toLowerCase(); else if (name == "toString") result = text;
    else if (name == "replace") result = text.replace(first,this.values[args[1]].text); else if (name == "replaceAll") { if (!this.charge(module,id,text.length*(this.values[args[1]].text.length+1))) return 0; result = text.replaceAll(first,this.values[args[1]].text); }
    else return this.fail(module,id,"COMPTIME_UNSUPPORTED","método string " + name);
    return this.put(constantString(result),module,id);
  }
  method(module: number, id: number, environment: number, mode: string): number {
    const n: AstNode = this.node(module,id); const object: number = bindingChild(n,EdgeRole.Object); const name: string = n.get(AttributeKind.Method);
    const member: number = this.checked.files[module].members[id]; if (member >= 0 && this.binding.symbols[member].kind == "UnionVariant") return this.variant(module,id,environment,mode,member);
    let receiver: number = ["!Math","namespace"].includes(this.checked.files[module].types[object]) ? 0 : this.eval(module,object,environment,mode);
    if (n.get(AttributeKind.Optional) == "true") {
      const container = this.values[receiver];
      if (container.kind != "optional") return this.fail(module,id,"COMPTIME_INVALID_CONTAINER","receptor opcional inválido");
      if (container.entries.length == 0) return this.checked.files[module].types[id] == "void" ? 0 : this.put(new ConstantValue("optional",this.checked.files[module].types[id]),module,id);
      receiver = container.entries[0];
    }
    return this.optionalValue(module,id,this.methodValue(module,id,environment,mode,receiver));
  }
  methodValue(module: number, id: number, environment: number, mode: string, receiver: number): number {
    const n: AstNode = this.node(module,id); const object: number = bindingChild(n,EdgeRole.Object); const name: string = n.get(AttributeKind.Method);
    let args: number[] = []; let argumentCells: number[] = [];
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) { args.push(this.eval(module,edge.node,environment,mode)); argumentCells.push(this.argumentCell(module,edge.node,environment)); }
    if (this.checked.files[module].types[object] == "namespace" || this.checked.files[module].selected[id] >= 0) {
      const selected: number = this.checked.files[module].selected[id]; const targetModule: number = this.checked.files[module].selectedModules[id];
      if (selected < 0) return this.fail(module,id,"COMPTIME_VALUE_UNAVAILABLE","Miembro de namespace no invocable");
      let positions: number[] = []; let at: number = 0; for (const edge of n.edges) if (edge.role == EdgeRole.Args) { positions.push(argumentParameter(this.checked.files[module],edge.node,at)); at = at+1; }
      const receiverEnvironment: number = this.bindReceiver(targetModule,selected,environment,receiver);
      return this.invoke(this.functionValue(targetModule,selected,receiverEnvironment),args,positions,module,id,this.decorated(targetModule,selected,"comptime") ? "strict" : mode,this.checked.files[module].signatures[id],argumentCells);
    }
    if (this.checked.files[module].types[object] == "!Math") {
      if (name == "random") return this.fail(module,id,mode == "input" ? "COMPTIME_VALUE_UNAVAILABLE" : "COMPTIME_FORBIDDEN_EFFECT","Aleatoriedad no determinista");
      let input = args.length > 0 ? constantFloat(this.values[args[0]],false) : constantNumber(0); if (input.kind == "error") return this.put(input,module,id);
      let other = args.length > 1 ? constantFloat(this.values[args[1]],false) : constantNumber(0); if (other.kind == "error") return this.put(other,module,id);
      const a: number = input.scalar; const b: number = other.scalar; let result: number = 0;
      if (name == "abs") result = Math.abs(a); else if (name == "floor") result = Math.floor(a); else if (name == "ceil") result = Math.ceil(a); else if (name == "round") result = Math.round(a); else if (name == "sqrt") result = Math.sqrt(a); else if (name == "pow") result = Math.pow(a,b); else if (name == "min") result = Math.min(a,b); else if (name == "max") result = Math.max(a,b);
      else return this.fail(module,id,"COMPTIME_UNSUPPORTED","método Math " + name);
      return this.put(constantNumber(result),module,id);
    }
    const value = this.values[receiver]; if (this.failure != "") return 0;
    if (value.kind == "string") return this.stringMethod(module,id,receiver,name,args);
    if (value.kind == "optional" || value.kind == "result") {
      const present: boolean = value.entries.length > 0 && value.text != "error";
      if (name == "isPresent" || name == "isOk") return this.put(constantBoolean(present),module,id);
      if (name == "isEmpty") return this.put(constantBoolean(!present),module,id);
      if (name == "orElse") return present ? receiver : args[0];
      if (value.kind == "optional" && (name == "map" || name == "andThen")) {
        let result = new ConstantValue("optional",this.checked.files[module].types[id]);
        if (!present) return this.put(result,module,id);
        const returned: number = this.invoke(args[0],[value.entries[0]],[],module,id,mode,"");
        if (name == "andThen") return this.convert(returned,result.typeName,module,id);
        result.entries.push(this.convert(returned,genericArguments(result.typeName)[0],module,id)); return this.put(result,module,id);
      }
      if (name == "valueOr") return present ? value.entries[0] : args[0];
      if (name == "value" && present) return value.entries[0]; if (name == "error" && value.text == "error") return value.entries[0];
      return this.fail(module,id,"COMPTIME_INVALID_CONTAINER","acceso a payload ausente");
    }
    if (value.kind != "array") return this.fail(module,id,mode == "input" ? "COMPTIME_VALUE_UNAVAILABLE" : "COMPTIME_UNSUPPORTED","Método de objeto no disponible");
    let result = new ConstantValue("array",this.checked.files[module].types[id]); let changed = value;
    if (name == "push") { for (const arg of args) changed.entries.push(this.copy(arg,module,id)); this.values[receiver] = changed; return 0; }
    if (name == "pop") { if (changed.entries.length > 0) changed.entries.pop(); this.values[receiver] = changed; return 0; }
    if (name == "join") {
      let text: string = ""; const separator: string = this.values[args[0]].text;
      for (let at: number = 0; at < value.entries.length; at = at+1) { const part: string = this.text(value.entries[at],module,id); if (!this.charge(module,id,part.length+(at > 0 ? separator.length : 0))) return 0; text = (text+(at > 0 ? separator : "")+part); }
      return this.put(constantString(text),module,id);
    }
    if (name == "slice") { const from: number = this.index(args[0],module,id); const to: number = this.index(args[1],module,id); for (let at: number = from; at < to && at < value.entries.length; at = at+1) result.entries.push(this.copy(value.entries[at],module,id)); return this.put(result,module,id); }
    if (name == "concat") { for (const entry of value.entries) result.entries.push(this.copy(entry,module,id)); for (const arg of args) for (const entry of this.values[arg].entries) result.entries.push(this.copy(entry,module,id)); return this.put(result,module,id); }
    if (name == "includes") { for (const entry of value.entries) { const equal: number = this.binary(module,id,entry,args[0],"=="); if (this.values[equal].scalar == 1) return equal; } return this.put(constantBoolean(false),module,id); }
    if (name == "sort") {
      for (let at: number = 1; at < changed.entries.length && this.failure == ""; at = at+1) { let p: number = at;
        while (p > 0) { const order: number = args.length == 0 ? this.binary(module,id,changed.entries[p-1],changed.entries[p],">") : this.invoke(args[0],[changed.entries[p-1],changed.entries[p]],[],module,id,mode,""); const scalar = constantFloat(this.values[order],false); if (scalar.kind == "error") return this.put(scalar,module,id); if (scalar.scalar <= 0) break; const saved: number = changed.entries[p]; changed.entries[p] = changed.entries[p-1]; changed.entries[p-1] = saved; p = p-1; }
      } this.values[receiver] = changed; return this.copy(receiver,module,id);
    }
    let accumulator: number = name == "reduce" ? this.convert(args[0],this.checked.files[module].types[id],module,id) : 0; const callback: number = name == "reduce" ? args[1] : args[0];
    for (const entry of value.entries) {
      if (this.failure != "") return 0; const returned: number = this.invoke(callback,name == "reduce" ? [accumulator,entry] : [entry],[],module,id,mode,""); const yes: boolean = this.values[returned].scalar != 0;
      if (name == "map") result.entries.push(this.convert(returned,semanticElement(result.typeName),module,id)); else if (name == "flatMap") for (const item of this.values[returned].entries) result.entries.push(this.convert(item,semanticElement(result.typeName),module,id));
      else if (name == "filter" && yes) result.entries.push(this.copy(entry,module,id)); else if (name == "reduce") accumulator = this.convert(returned,this.checked.files[module].types[id],module,id);
      else if (name == "find" && yes) { let found = new ConstantValue("optional",this.checked.files[module].types[id]); found.entries.push(this.copy(entry,module,id)); return this.put(found,module,id); }
      else if (name == "some" && yes) return this.put(constantBoolean(true),module,id); else if (name == "every" && !yes) return this.put(constantBoolean(false),module,id);
    }
    if (name == "some" || name == "every") return this.put(constantBoolean(name == "every"),module,id);
    if (name == "find") return this.put(new ConstantValue("optional",this.checked.files[module].types[id]),module,id);
    if (name == "reduce") return accumulator; if (name == "forEach") return 0;
    if (!["map","flatMap","filter"].includes(name)) return this.fail(module,id,"COMPTIME_UNSUPPORTED","método array " + name);
    return this.put(result,module,id);
  }
  declare(module: number, id: number, environment: number, mode: string): void {
    const n: AstNode = this.node(module,id); const initializer: number = bindingChild(n,EdgeRole.Initializer); const value: number = this.eval(module,initializer,environment,mode);
    const sid: number = this.binding.files[module].declarations[id];
    if (sid >= 0) { const cell: number = this.reserve(environment,sid); this.cells[cell].value = this.convert(value,this.checked.symbolTypes[sid],module,initializer); this.cells[cell].state = 1; }
    let position: number = 0;
    for (const edge of n.edges) if (edge.role == EdgeRole.ArrayBindings || edge.role == EdgeRole.ObjectBindings) {
      const binding: AstNode = this.node(module,edge.node); const target: number = this.binding.files[module].declarations[edge.node]; const cell: number = this.reserve(environment,target);
      const v = this.values[value]; const at: number = edge.role == EdgeRole.ArrayBindings ? position : this.keyIndex(v.keys,binding.get(AttributeKind.Property)); let item: number = 0;
      if (at >= 0 && at < v.entries.length) item = v.entries[at]; else item = this.eval(module,bindingChild(binding,EdgeRole.DefaultValue),environment,mode);
      this.cells[cell].value = this.convert(item,this.checked.symbolTypes[target],module,edge.node); this.cells[cell].state = 1; position = position+1;
    }
  }
  walk(module: number, id: number, environment: number, mode: string): void {
    if (id < 0 || this.signal != "" || !this.step(module,id)) return; const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.BlockStatement || n.kind == NodeKind.Program) { const block: number = this.environment(environment); this.prepare(module,id,block); for (const edge of n.edges) if (edge.role == EdgeRole.Statements) this.walk(module,edge.node,block,mode); return; }
    if (n.kind == NodeKind.VariableDeclaration || n.kind == NodeKind.UsingDeclaration) { this.declare(module,id,environment,mode); return; }
    if (n.kind == NodeKind.FunctionDeclaration || n.kind == NodeKind.TypeAliasDeclaration || n.kind == NodeKind.InterfaceDeclaration || n.kind == NodeKind.ClassDeclaration || n.kind == NodeKind.UnionDeclaration || n.kind == NodeKind.EnumDeclaration) return;
    if (n.kind == NodeKind.ExpressionStatement) { this.eval(module,bindingChild(n,EdgeRole.Expression),environment,mode); return; }
    if (n.kind == NodeKind.ReturnStatement) { this.returned = this.eval(module,bindingChild(n,EdgeRole.Value),environment,mode); this.signal = "return"; return; }
    if (n.kind == NodeKind.BreakStatement || n.kind == NodeKind.ContinueStatement) { this.signal = (n.kind == NodeKind.BreakStatement ? "break" : "continue"); return; }
    if (n.kind == NodeKind.IfStatement) { const value: number = this.eval(module,bindingChild(n,EdgeRole.Condition),environment,mode); this.walk(module,bindingChild(n,this.values[value].scalar != 0 ? EdgeRole.ThenBranch : EdgeRole.ElseBranch),environment,mode); return; }
    if (n.kind == NodeKind.WhileStatement || n.kind == NodeKind.ForStatement) {
      const loop: number = this.environment(environment); const init: number = bindingChild(n,EdgeRole.Initializer);
      if (init >= 0) { if (this.node(module,init).kind == NodeKind.VariableDeclaration) this.reserve(loop,this.binding.files[module].declarations[init]); if (isExpressionNodeKind(this.node(module,init).kind)) this.eval(module,init,loop,mode); else this.walk(module,init,loop,mode); }
      while (this.step(module,id)) {
        const condition: number = bindingChild(n,EdgeRole.Condition); if (condition >= 0 && this.values[this.eval(module,condition,loop,mode)].scalar == 0) break;
        this.walk(module,bindingChild(n,EdgeRole.Body),loop,mode); if (this.signal == "return") return; if (this.signal == "break") { this.signal = ""; break; } this.signal = "";
        this.eval(module,bindingChild(n,EdgeRole.Increment),loop,mode);
      } return;
    }
    if (n.kind == NodeKind.ForOfStatement || n.kind == NodeKind.ForInStatement) {
      if (n.get(AttributeKind.Await) == "true") { this.fail(module,id,"COMPTIME_FORBIDDEN_EFFECT","suspensión"); return; }
      const input: number = this.eval(module,bindingChild(n,n.kind == NodeKind.ForOfStatement ? EdgeRole.Iterable : EdgeRole.Target),environment,mode); const value = this.values[input];
      const binding: number = bindingChild(n,EdgeRole.Binding); const sid: number = this.binding.files[module].declarations[binding];
      const count: number = value.kind == "string" ? value.text.length : value.entries.length;
      for (let at: number = 0; at < count && this.step(module,id); at = at+1) {
        const loop: number = this.environment(environment); const cell: number = this.reserve(loop,sid);
        let item: number = n.kind == NodeKind.ForInStatement ? this.put(constantNumber(at),module,id) : value.kind == "string" ? this.put(constantString(value.text.charAt(at)),module,id) : value.entries[at];
        this.cells[cell].value = this.convert(item,this.checked.symbolTypes[sid],module,id); this.cells[cell].state = 1;
        this.walk(module,bindingChild(n,EdgeRole.Body),loop,mode); if (this.signal == "return") return; if (this.signal == "break") { this.signal = ""; break; } this.signal = "";
      } return;
    }
    if (n.kind == NodeKind.SwitchStatement) {
      const subject: number = this.eval(module,bindingChild(n,EdgeRole.Discriminant),environment,mode); let matched: boolean = false; let fallback: number = -1;
      for (const edge of n.edges) if (edge.role == EdgeRole.Clauses) { const clause: AstNode = this.node(module,edge.node); if (clause.kind == NodeKind.DefaultClause) fallback = edge.node; else { const value: number = this.eval(module,bindingChild(clause,EdgeRole.Labels),environment,mode); const equal: number = this.binary(module,id,subject,value,"=="); if (this.values[equal].scalar != 0) matched = true; } if (matched) break; }
      let running: boolean = false; for (const edge of n.edges) if (edge.role == EdgeRole.Clauses) { const clause: AstNode = this.node(module,edge.node); if (!running) { if (!matched) running = edge.node == fallback; else if (clause.kind != NodeKind.DefaultClause) { const equal: number = this.binary(module,id,subject,this.eval(module,bindingChild(clause,EdgeRole.Labels),environment,mode),"=="); running = this.values[equal].scalar != 0; } } if (running) for (const statement of clause.edges) if (statement.role == EdgeRole.Body) this.walk(module,statement.node,environment,mode); if (this.signal != "") break; }
      if (this.signal == "break") this.signal = ""; return;
    }
    this.fail(module,id,"COMPTIME_UNSUPPORTED","sentencia " + nodeKindName(n.kind));
  }
  serialize(value: number, module: number, id: number): string {
    if (!this.step(module,id)) return ""; const v = this.values[value];
    if (v.kind == "number") { if (v.scalar-v.scalar != 0) { this.fail(module,id,"COMPTIME_FLOAT_RANGE","resultado no finito"); return ""; } return "{\"type\":" + quoteSource(v.typeName) + ",\"value\":" + numberToString(v.scalar) + "}"; }
    if (v.kind == "integer") return "{\"type\":" + quoteSource(v.typeName) + ",\"exactInteger\":" + quoteSource(constantIntegerText(v)) + "}";
    if (v.kind == "boolean") return "{\"type\":\"boolean\",\"value\":" + (v.scalar == 1 ? "true" : "false") + "}";
    if (v.kind == "string") return "{\"type\":" + quoteSource(v.typeName) + ",\"value\":" + quoteSource(v.text) + "}";
    if (["array","object","optional","result"].includes(v.kind)) {
      let entries: string[] = []; for (let at: number = 0; at < v.entries.length; at = at+1) entries.push((v.kind == "object" ? quoteSource(v.keys[at])+":" : "")+this.serialize(v.entries[at],module,id));
      return "{\"type\":" + quoteSource(v.typeName) + ",\"kind\":" + quoteSource(v.kind) + ",\"tag\":" + quoteSource(v.text) + ",\"value\":" + (v.kind == "object" ? "{" : "[") + entries.join(",") + (v.kind == "object" ? "}" : "]") + "}";
    }
    this.fail(module,id,"COMPTIME_NON_LITERAL","el resultado no se puede materializar"); return "";
  }
  nested(module: number, id: number): boolean {
    let at: number = this.binding.files[module].parents[id];
    while (at >= 0) { const n: AstNode = this.node(module,at); if (n.kind == NodeKind.CallExpression && this.helper(module,at) == "comptime") return true; if (isCallableNodeKind(n.kind) && this.decorated(module,at,"comptime")) return true; at = this.binding.files[module].parents[at]; } return false;
  }
  evaluate(module: number, id: number, strict: boolean): void {
    this.values = []; this.cells = []; this.environments = []; this.instructions = 0; this.bytes = 0; this.depth = 0; this.signal = ""; this.returned = 0; this.failureCode = ""; this.failure = ""; this.rootModule = module; this.rootNode = id;
    this.values.push(new ConstantValue("void","void")); this.environment(-1);
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) { const s = this.binding.symbols[sid]; if (s.module >= 0 && (s.target) < 0 && this.functionOwner(s.scope) < 0 && (s.kind == "VariableDeclaration" || s.kind == "UsingDeclaration")) this.reserve(0,sid); }
    const value: number = this.eval(module,id,0,strict ? "strict" : "input"); this.lastValue = value;
    let serialized: string = ""; if (this.failure == "") serialized = this.serialize(value,module,id);
    this.checked.files[module].constantCodes[id] = this.failureCode;
    if (this.failure == "") { this.checked.files[module].constantStates[id] = "evaluated"; this.checked.files[module].constantValues[id] = serialized; }
    else if (!strict && this.failureCode == "COMPTIME_VALUE_UNAVAILABLE") this.checked.files[module].constantStates[id] = "deferred";
    else { this.checked.files[module].constantStates[id] = "error"; this.checked.diagnostics.push(diagnosticAt("checker",this.failureCode + ": " + this.failure,this.graph.modules[this.failureModule].file,this.node(this.failureModule,this.failureNode))); }
  }
  run(): CheckResult {
    for (let m: number = 0; m < this.checked.files.length; m = m+1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id+1) {
      if (this.binding.files[m].nodeScopes[id] < 0 || ![NodeKind.CallExpression,NodeKind.MemberCallExpression].includes(this.node(m,id).kind)) continue;
      const selected: number = this.checked.files[m].selected[id]; const selectedModule: number = this.checked.files[m].selectedModules[id]; const strict: boolean = this.helper(m,id) == "comptime";
      if (!strict && !(selected >= 0 && this.decorated(selectedModule,selected,"comptime"))) continue;
      if (this.nested(m,id)) this.checked.files[m].constantStates[id] = "deferred"; else this.evaluate(m,id,strict);
    }
    return this.checked;
  }
}
export function evaluateNativeComptime(graph: ModuleGraph, binding: BindingResult, checked: CheckResult): CheckResult { let evaluator = new NativeComptime(graph,binding,checked); return evaluator.run(); }
