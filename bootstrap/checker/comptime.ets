import { ModuleGraph } from "../modules/loader";
import { BindingResult, bindingChild, callableBinding } from "../binder/binder";
import { AstNode } from "../parser/parser";
import { SourceDiagnostic, quoteSource } from "../frontend/frontend";
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
  failureCode: string; failure: string; failureModule: number; failureNode: number; signal: string; returned: number;
  constructor(graph: ModuleGraph, binding: BindingResult, checked: CheckResult) {
    this.graph = graph; this.binding = binding; this.checked = checked; this.values = []; this.cells = []; this.environments = [];
    this.instructions = 0; this.bytes = 0; this.depth = 0; this.rootModule = 0; this.rootNode = 0;
    this.failureCode = ""; this.failure = ""; this.failureModule = 0; this.failureNode = 0; this.signal = ""; this.returned = 0;
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  origin(sid: number): number { let at: number = sid; while (at >= 0 && this.binding.symbols[at].target >= 0) at = this.binding.symbols[at].target; return at; }
  reference(module: number, id: number): number {
    for (const r of this.binding.references) if (r.module == module && r.node == id && r.space == "value" && !r.deferred) return this.origin(r.target);
    return -1;
  }
  helper(module: number, id: number): string { const sid: number = this.reference(module,id); return sid >= 0 && (this.binding.symbols[sid].module) < 0 ? this.binding.symbols[sid].name : ""; }
  decorated(module: number, id: number, name: string): boolean {
    for (const edge of this.node(module,id).edges) if (edge.role == "decorators" && this.node(module,edge.node).get("name") == name) return true; return false;
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
  functionValue(module: number, id: number, environment: number): number {
    let v = new ConstantValue("function",this.checked.files[module].types[id]); v.module = module; v.node = id; v.environment = environment; return this.put(v,module,id);
  }
  prepare(module: number, id: number, environment: number): void {
    const n: AstNode = this.node(module,id);
    for (const edge of n.edges) if (edge.role == "statements") {
      let declaration: number = edge.node; if (this.node(module,declaration).kind == "ExportDefaultDeclaration") declaration = bindingChild(this.node(module,declaration),"declaration");
      const item: AstNode = this.node(module,declaration);
      if (item.kind == "VariableDeclaration" || item.kind == "UsingDeclaration" || item.kind == "FunctionDeclaration") {
        const cell: number = this.reserve(environment,this.binding.files[module].declarations[declaration]);
        if (item.kind == "FunctionDeclaration" && cell >= 0) { this.cells[cell].value = this.functionValue(module,declaration,environment); this.cells[cell].state = 1; }
        for (const binding of item.edges) if (binding.role == "arrayBindings" || binding.role == "objectBindings") this.reserve(environment,this.binding.files[module].declarations[binding.node]);
      }
    }
  }
  directRoot(module: number, id: number): number {
    let at: number = id; while (at >= 0) { const n: AstNode = this.node(module,at); if (n.kind == "IdentifierExpression") return this.reference(module,at); if (n.kind == "MemberExpression" || n.kind == "IndexExpression") at = bindingChild(n,"object"); else return -1; } return -1;
  }
  runtimeWrite(sid: number): boolean {
    const rootOwner: number = this.functionOwner(this.binding.files[this.rootModule].nodeScopes[this.rootNode]);
    for (let id: number = 0; id < this.checked.files[this.rootModule].types.length; id = id+1) {
      const n: AstNode = this.node(this.rootModule,id); if (n.start.offset >= this.node(this.rootModule,this.rootNode).start.offset || this.functionOwner(this.binding.files[this.rootModule].nodeScopes[id]) != rootOwner) continue;
      if ((n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression" || n.kind == "DeleteStatement") && this.directRoot(this.rootModule,bindingChild(n,"target")) == sid) return true;
      if (n.kind == "MemberCallExpression" && ["push","pop","sort","set","add","delete","clear"].includes(n.get("method")) && this.directRoot(this.rootModule,bindingChild(n,"object")) == sid) return true;
      if ((n.kind == "CallExpression" || n.kind == "MemberCallExpression") && this.checked.files[this.rootModule].constantStates[id] != "evaluated") {
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
    if (cell >= 0 && (this.functionOwner(s.scope) >= 0 || this.cells[cell].state == 2)) return this.fail(module,id,"COMPTIME_TDZ","lectura antes de inicializar el binding");
    if (s.module >= 0 && (s.kind == "VariableDeclaration" || s.kind == "UsingDeclaration") && (this.functionOwner(s.scope) < 0 || (cell < 0 && s.module == this.rootModule && this.functionOwner(s.scope) == this.functionOwner(this.binding.files[this.rootModule].nodeScopes[this.rootNode])))) {
      if (this.functionOwner(s.scope) < 0 && s.module > this.rootModule) return this.fail(module,id,"COMPTIME_TDZ","Módulo todavía no inicializado");
      if (s.module == this.rootModule && this.node(s.module,s.node).start.offset >= this.node(this.rootModule,this.rootNode).start.offset) return this.fail(module,id,"COMPTIME_TDZ","declaración global posterior a la evaluación");
      if (this.runtimeWrite(sid)) return this.fail(module,id,"COMPTIME_VALUE_UNAVAILABLE","Una escritura runtime anterior invalida la captura estática");
      const slot: number = cell >= 0 ? cell : this.reserve(0,sid); this.cells[slot].state = 2;
      const init: number = bindingChild(this.node(s.module,s.node),"initializer"); const value: number = this.eval(s.module,init,0,"input");
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
        for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == "typeParameters") { if (at < inputs.length) text = replaceType(text,"@"+numberToString(this.binding.files[owner.module].declarations[edge.node]),inputs[at]); at = at+1; }
        return text;
      }
    } return "";
  }
  convert(value: number, name: string, module: number, id: number): number {
    if (this.failure != "") return 0;
    const source = this.values[value]; if (name == "") return this.copy(value,module,id);
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
  eval(module: number, id: number, environment: number, mode: string): number {
    const value: number = this.inner(module,id,environment,mode); if (id < 0 || this.failure != "") return value;
    const conversion: string = this.checked.files[module].conversions[id]; const parent: number = this.binding.files[module].parents[id];
    if (parent >= 0 && this.node(module,parent).kind == "MemberCallExpression") { const object: number = bindingChild(this.node(module,parent),"object"); if (object >= 0 && this.checked.files[module].types[object] == "!Math") return value; }
    return conversion == "" ? value : this.convert(value,conversion,module,id);
  }
  inner(module: number, id: number, environment: number, mode: string): number {
    if (id < 0 || !this.step(module,id)) return 0;
    const n: AstNode = this.node(module,id); const name: string = this.checked.files[module].types[id];
    const exact: string = this.checked.files[module].exactIntegers[id]; if (exact != "") return this.put(constantInteger(exact,name),module,id);
    if (n.kind == "LiteralExpression") {
      if (n.get("literalType") == "string") return this.put(constantString(n.get("value")),module,id);
      if (n.get("literalType") == "boolean") return this.put(constantBoolean(n.get("value") == "true"),module,id);
      const raw: string = n.get("raw") == "" ? n.get("value") : n.get("raw"); const parsed = nativeNumericLiteral(raw);
      if (!parsed.valid) return this.fail(module,id,"COMPTIME_INVALID_NUMBER","literal inválido");
      if (name != "number" && name != "f32" && name != "f64" && numericType(name)) return this.put(constantCast(constantInteger(nativeIntegerText(raw),name),name),module,id);
      return this.put(constantCast(constantNumber(parsed.value),name),module,id);
    }
    if (n.kind == "IdentifierExpression") return this.read(module,id,environment,this.reference(module,id),mode);
    if (n.kind == "ArrowFunctionExpression") return this.functionValue(module,id,environment);
    if (n.kind == "NamedArgumentExpression") return this.eval(module,bindingChild(n,"value"),environment,mode);
    if (n.kind == "SpreadElement" || n.kind == "SatisfiesExpression") return this.eval(module,bindingChild(n,n.kind == "SpreadElement" ? "expression" : "operand"),environment,mode);
    if (n.kind == "AsExpression") return this.eval(module,bindingChild(n,"expression"),environment,mode);
    if (n.kind == "ArrayLiteralExpression" || n.kind == "ObjectLiteralExpression") {
      let v = new ConstantValue(n.kind == "ArrayLiteralExpression" ? "array" : "object",name);
      for (const edge of n.edges) if (edge.role == "elements") {
        const entry: number = this.eval(module,edge.node,environment,mode);
        if (this.node(module,edge.node).kind == "SpreadElement") for (const item of this.values[entry].entries) v.entries.push(this.copy(item,module,id)); else v.entries.push(this.copy(entry,module,id));
      } else if (edge.role == "properties") { const property: AstNode = this.node(module,edge.node); v.keys.push(property.get("key")); v.entries.push(this.copy(this.eval(module,bindingChild(property,"value"),environment,mode),module,id)); }
      return this.put(v,module,id);
    }
    if (n.kind == "MemberExpression" && this.checked.files[module].types[bindingChild(n,"object")] == "!Math" && ["PI","E"].includes(n.get("member"))) return this.put(constantNumber(n.get("member") == "PI" ? 3.141592653589793 : 2.718281828459045),module,id);
    if (n.kind == "MemberExpression") {
      const member: number = this.checked.files[module].members[id];
      if (member >= 0 && ["VariableDeclaration","FunctionDeclaration"].includes(this.binding.symbols[this.origin(member)].kind)) return this.read(module,id,environment,this.origin(member),mode);
    }
    if (n.kind == "IndexExpression" || n.kind == "MemberExpression") {
      const object: number = this.eval(module,bindingChild(n,"object"),environment,mode); const v = this.values[object];
      if (n.kind == "MemberExpression") {
        const key: string = n.get("member"); if (key == "length" && (v.kind == "array" || v.kind == "string")) return this.put(constantNumber(v.kind == "array" ? v.entries.length : v.text.length),module,id);
        for (let at: number = 0; at < v.keys.length; at = at+1) if (v.keys[at] == key) return v.entries[at];
        return this.fail(module,id,"COMPTIME_INVALID_MEMBER","campo no disponible");
      }
      const index: number = this.index(this.eval(module,bindingChild(n,"index"),environment,mode),module,id);
      if (index < 0) return 0;
      if (v.kind == "string") return this.put(constantString(v.text.charAt(index)),module,id);
      if (index >= v.entries.length) return this.fail(module,id,"COMPTIME_INVALID_INDEX","índice fuera de rango"); return v.entries[index];
    }
    if (n.kind == "BinaryExpression") {
      const left: number = this.eval(module,bindingChild(n,"left"),environment,mode); const op: string = n.get("operator");
      if (op == "&&" && this.values[left].scalar == 0) return left; if (op == "||" && this.values[left].scalar != 0) return left;
      if (op == "??") { if (this.values[left].kind == "optional") { if (this.values[left].entries.length > 0) return this.values[left].entries[0]; } else return left; return this.eval(module,bindingChild(n,"right"),environment,mode); }
      const right: number = this.eval(module,bindingChild(n,"right"),environment,mode); if (op == "&&" || op == "||") return right;
      return this.binary(module,id,left,right,op);
    }
    if (n.kind == "TernaryExpression") { const condition: number = this.eval(module,bindingChild(n,"condition"),environment,mode); return this.eval(module,bindingChild(n,this.values[condition].scalar != 0 ? "thenBranch" : "elseBranch"),environment,mode); }
    if (n.kind == "UnaryExpression") {
      const value: number = this.eval(module,bindingChild(n,"operand"),environment,mode); const v = this.values[value]; const op: string = n.get("operator");
      if (op == "typeof") return this.put(constantString(v.kind == "integer" || v.kind == "number" ? "number" : v.kind == "void" ? "undefined" : v.kind == "function" ? "function" : v.kind == "string" || v.kind == "boolean" ? v.kind : "object"),module,id);
      if (op == "!") return this.put(constantBoolean(v.scalar == 0),module,id);
      if (op == "+") return this.convert(value,name,module,id);
      if (op == "-" && v.kind == "number") return this.put(constantCast(constantNumber(-v.scalar),name),module,id);
      if (op == "-") { const zero = v.kind == "integer" ? constantInteger("0",name) : constantNumber(0,name); return this.put(constantNumeric(zero,v,"-",name),module,id); }
      if (op == "~") { if (v.kind == "integer") { let result = v; result.bits = ~result.bits; return this.put(constantCast(result,name),module,id); } const bits: i32 = constantWord(v.scalar); return this.put(constantNumber(constantSignedDouble(~bits)),module,id); }
    }
    if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression") {
      const target: number = bindingChild(n,"target"); const location: ConstantLocation = this.location(module,target,environment,mode);
      const previous: number = n.kind == "CompoundAssignmentExpression" ? this.load(location,module,target) : 0;
      let value: number = this.eval(module,bindingChild(n,"value"),environment,mode);
      if (n.kind == "CompoundAssignmentExpression") value = this.binary(module,id,previous,value,n.get("operator").slice(0,n.get("operator").length-1));
      value = this.convert(value,this.checked.files[module].types[target],module,id); this.store(location,value,module,target); return value;
    }
    if (n.kind == "TemplateLiteralExpression") {
      let text: string = ""; for (const edge of n.edges) { const part: string = edge.role == "parts" ? this.node(module,edge.node).get("value") : this.text(this.eval(module,edge.node,environment,mode),module,id); if (!this.charge(module,id,this.utf8(part))) return 0; text = text+part; } return this.put(constantString(text),module,id);
    }
    if (n.kind == "CallExpression") return this.call(module,id,environment,mode);
    if (n.kind == "MemberCallExpression") return this.method(module,id,environment,mode);
    return this.fail(module,id,"COMPTIME_UNSUPPORTED","construcción " + n.kind);
  }
  keyIndex(keys: string[], key: string): number { for (let at: number = 0; at < keys.length; at = at+1) if (keys[at] == key) return at; return -1; }
  index(value: number, module: number, id: number): number {
    const v = constantFloat(this.values[value],false); if (v.kind == "error") { this.fail(module,id,v.typeName,v.text); return -1; }
    if ((v.scalar) < 0 || v.scalar != Math.floor(v.scalar) || v.scalar > 1048576) { this.fail(module,id,"COMPTIME_INVALID_INDEX","índice inválido o demasiado grande"); return -1; } return v.scalar;
  }
  location(module: number, id: number, environment: number, mode: string): ConstantLocation {
    let result = new ConstantLocation(); const n: AstNode = this.node(module,id);
    if (n.kind == "IdentifierExpression") {
      const sid: number = this.reference(module,id); this.read(module,id,environment,sid,mode); result.cell = this.find(environment,sid); return result;
    }
    result.receiver = this.eval(module,bindingChild(n,"object"),environment,mode); const v = this.values[result.receiver];
    if (n.kind == "MemberExpression") result.index = this.keyIndex(v.keys,n.get("member"));
    else result.index = this.index(this.eval(module,bindingChild(n,"index"),environment,mode),module,id);
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
  call(module: number, id: number, environment: number, mode: string): number {
    const n: AstNode = this.node(module,id); const helper: string = this.helper(module,id);
    let args: number[] = []; let positions: number[] = []; let at: number = 0;
    for (const edge of n.edges) if (edge.role == "args") {
      const value: number = this.eval(module,edge.node,environment,helper == "comptime" ? "strict" : mode);
      if (this.node(module,edge.node).kind == "SpreadElement") for (const item of this.values[value].entries) { args.push(item); positions.push(argumentParameter(this.checked.files[module],edge.node,at)); }
      else { args.push(value); positions.push(argumentParameter(this.checked.files[module],edge.node,at)); } at = at+1;
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
      if (present) return v.entries[0]; if (helper == "optionalOrElse") return this.invoke(args[1],[],[],module,id,mode,""); return args[1];
    }
    if (helper != "") return this.fail(module,id,mode == "input" ? "COMPTIME_VALUE_UNAVAILABLE" : "COMPTIME_FORBIDDEN_EFFECT","Builtin runtime o externo: " + helper);
    const selected: number = this.checked.files[module].selected[id]; const selectedModule: number = this.checked.files[module].selectedModules[id]; let callable: number = 0;
    if (selected >= 0) {
      const sid: number = this.reference(module,id); const cell: number = this.find(environment,sid);
      callable = (cell >= 0 && this.cells[cell].state == 1 ? this.cells[cell].value : this.functionValue(selectedModule,selected,0));
      // An overload's own body is authoritative, not its group's first cell.
      let fn = this.values[callable]; fn.module = selectedModule; fn.node = selected; callable = this.put(fn,module,id);
    } else callable = this.read(module,id,environment,this.reference(module,id),mode);
    return this.invoke(callable,args,positions,module,id,selected >= 0 && this.decorated(selectedModule,selected,"comptime") ? "strict" : mode,this.checked.files[module].signatures[id]);
  }
  invoke(callable: number, args: number[], positions: number[], module: number, id: number, mode: string, signature: string): number {
    if (this.failure != "") return 0; const fn = this.values[callable];
    if (fn.kind != "function") return this.fail(module,id,"COMPTIME_VALUE_UNAVAILABLE","destino invocable no disponible");
    const declaration: AstNode = this.node(fn.module,fn.node); const body: number = bindingChild(declaration,"body");
    if (declaration.get("async") == "true" || declaration.get("isAsync") == "true") return this.fail(module,id,"COMPTIME_FORBIDDEN_EFFECT","tarea async durante evaluación");
    if (body < 0 || this.node(fn.module,body).start.kind == ";") return this.fail(module,id,mode == "input" ? "COMPTIME_VALUE_UNAVAILABLE" : "COMPTIME_FORBIDDEN_EFFECT","Implementación externa");
    this.depth = this.depth+1; if (this.depth > 100) { this.depth = this.depth-1; return this.fail(module,id,"COMPTIME_RECURSION_LIMIT","profundidad máxima excedida"); }
    const frame: number = this.environment(fn.environment); let parameters: number[] = []; for (const edge of declaration.edges) if (edge.role == "params") { parameters.push(edge.node); this.reserve(frame,this.binding.files[fn.module].declarations[edge.node]); }
    const effective: string = fn.typeName.indexOf("@",0) >= 0 && signature != "" ? signature : fn.typeName;
    const types: string[] = functionParams(effective);
    for (let p: number = 0; p < parameters.length; p = p+1) {
      const parameter: AstNode = this.node(fn.module,parameters[p]); const sid: number = this.binding.files[fn.module].declarations[parameters[p]]; const cell: number = this.find(frame,sid);
      const target: string = p < types.length ? types[p] : this.checked.symbolTypes[sid]; if (containsMemory(target)) { this.fail(module,id,"COMPTIME_UNSUPPORTED","Un contrato de memoria requiere una prueba de aliasing del evaluador"); break; } let value: number = 0; let supplied: boolean = false;
      if (parameter.get("variadic") == "true") {
        let rest = new ConstantValue("array",target.startsWith("...") ? target.slice(3,target.length) : target);
        for (let a: number = 0; a < args.length; a = a+1) if ((a < positions.length ? positions[a] : a) >= p) rest.entries.push(this.copy(args[a],module,id));
        value = this.put(rest,module,id); supplied = true;
      } else for (let a: number = 0; a < args.length; a = a+1) if ((a < positions.length ? positions[a] : a) == p) { value = this.convert(args[a],target,module,id); supplied = true; }
      if (!supplied) {
        const fallback: number = bindingChild(parameter,"defaultValue");
        if (fallback >= 0) value = this.convert(this.eval(fn.module,fallback,frame,mode),target,fn.module,fallback);
        else if (genericBase(target) == "Optional") value = this.put(new ConstantValue("optional",target),module,id);
        else { this.fail(module,id,"COMPTIME_ARITY","argumento requerido ausente"); break; }
      }
      if (cell >= 0) { this.cells[cell].value = value; this.cells[cell].state = 1; }
    }
    const outerSignal: string = this.signal; const outerReturned: number = this.returned; this.signal = ""; this.returned = 0;
    let value: number = 0;
    if (this.node(fn.module,body).kind == "BlockStatement") { this.walk(fn.module,body,frame,mode); value = this.returned; }
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
    const n: AstNode = this.node(module,id); const object: number = bindingChild(n,"object"); const name: string = n.get("method");
    const receiver: number = ["!Math","namespace"].includes(this.checked.files[module].types[object]) ? 0 : this.eval(module,object,environment,mode);
    let args: number[] = []; for (const edge of n.edges) if (edge.role == "args") args.push(this.eval(module,edge.node,environment,mode));
    if (this.checked.files[module].types[object] == "namespace") {
      const selected: number = this.checked.files[module].selected[id]; const targetModule: number = this.checked.files[module].selectedModules[id];
      if (selected < 0) return this.fail(module,id,"COMPTIME_VALUE_UNAVAILABLE","Miembro de namespace no invocable");
      let positions: number[] = []; let at: number = 0; for (const edge of n.edges) if (edge.role == "args") { positions.push(argumentParameter(this.checked.files[module],edge.node,at)); at = at+1; }
      return this.invoke(this.functionValue(targetModule,selected,0),args,positions,module,id,this.decorated(targetModule,selected,"comptime") ? "strict" : mode,this.checked.files[module].signatures[id]);
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
    const n: AstNode = this.node(module,id); const initializer: number = bindingChild(n,"initializer"); const value: number = this.eval(module,initializer,environment,mode);
    const sid: number = this.binding.files[module].declarations[id];
    if (sid >= 0) { const cell: number = this.reserve(environment,sid); this.cells[cell].value = this.convert(value,this.checked.symbolTypes[sid],module,initializer); this.cells[cell].state = 1; }
    let position: number = 0;
    for (const edge of n.edges) if (edge.role == "arrayBindings" || edge.role == "objectBindings") {
      const binding: AstNode = this.node(module,edge.node); const target: number = this.binding.files[module].declarations[edge.node]; const cell: number = this.reserve(environment,target);
      const v = this.values[value]; const at: number = edge.role == "arrayBindings" ? position : this.keyIndex(v.keys,binding.get("property")); let item: number = 0;
      if (at >= 0 && at < v.entries.length) item = v.entries[at]; else item = this.eval(module,bindingChild(binding,"defaultValue"),environment,mode);
      this.cells[cell].value = this.convert(item,this.checked.symbolTypes[target],module,edge.node); this.cells[cell].state = 1; position = position+1;
    }
  }
  walk(module: number, id: number, environment: number, mode: string): void {
    if (id < 0 || this.signal != "" || !this.step(module,id)) return; const n: AstNode = this.node(module,id);
    if (n.kind == "BlockStatement" || n.kind == "Program") { const block: number = this.environment(environment); this.prepare(module,id,block); for (const edge of n.edges) if (edge.role == "statements") this.walk(module,edge.node,block,mode); return; }
    if (n.kind == "VariableDeclaration" || n.kind == "UsingDeclaration") { this.declare(module,id,environment,mode); return; }
    if (n.kind == "FunctionDeclaration" || n.kind == "TypeAliasDeclaration" || n.kind == "InterfaceDeclaration") return;
    if (n.kind == "ExpressionStatement") { this.eval(module,bindingChild(n,"expression"),environment,mode); return; }
    if (n.kind == "ReturnStatement") { this.returned = this.eval(module,bindingChild(n,"value"),environment,mode); this.signal = "return"; return; }
    if (n.kind == "BreakStatement" || n.kind == "ContinueStatement") { this.signal = (n.kind == "BreakStatement" ? "break" : "continue"); return; }
    if (n.kind == "IfStatement") { const value: number = this.eval(module,bindingChild(n,"condition"),environment,mode); this.walk(module,bindingChild(n,this.values[value].scalar != 0 ? "thenBranch" : "elseBranch"),environment,mode); return; }
    if (n.kind == "WhileStatement" || n.kind == "ForStatement") {
      const loop: number = this.environment(environment); const init: number = bindingChild(n,"initializer");
      if (init >= 0) { if (this.node(module,init).kind == "VariableDeclaration") this.reserve(loop,this.binding.files[module].declarations[init]); if (this.node(module,init).kind.endsWith("Expression")) this.eval(module,init,loop,mode); else this.walk(module,init,loop,mode); }
      while (this.step(module,id)) {
        const condition: number = bindingChild(n,"condition"); if (condition >= 0 && this.values[this.eval(module,condition,loop,mode)].scalar == 0) break;
        this.walk(module,bindingChild(n,"body"),loop,mode); if (this.signal == "return") return; if (this.signal == "break") { this.signal = ""; break; } this.signal = "";
        this.eval(module,bindingChild(n,"increment"),loop,mode);
      } return;
    }
    if (n.kind == "ForOfStatement" || n.kind == "ForInStatement") {
      if (n.get("await") == "true") { this.fail(module,id,"COMPTIME_FORBIDDEN_EFFECT","suspensión"); return; }
      const input: number = this.eval(module,bindingChild(n,n.kind == "ForOfStatement" ? "iterable" : "target"),environment,mode); const value = this.values[input];
      const binding: number = bindingChild(n,"binding"); const sid: number = this.binding.files[module].declarations[binding];
      const count: number = value.kind == "string" ? value.text.length : value.entries.length;
      for (let at: number = 0; at < count && this.step(module,id); at = at+1) {
        const loop: number = this.environment(environment); const cell: number = this.reserve(loop,sid);
        let item: number = n.kind == "ForInStatement" ? this.put(constantNumber(at),module,id) : value.kind == "string" ? this.put(constantString(value.text.charAt(at)),module,id) : value.entries[at];
        this.cells[cell].value = this.convert(item,this.checked.symbolTypes[sid],module,id); this.cells[cell].state = 1;
        this.walk(module,bindingChild(n,"body"),loop,mode); if (this.signal == "return") return; if (this.signal == "break") { this.signal = ""; break; } this.signal = "";
      } return;
    }
    if (n.kind == "SwitchStatement") {
      const subject: number = this.eval(module,bindingChild(n,"discriminant"),environment,mode); let matched: boolean = false; let fallback: number = -1;
      for (const edge of n.edges) if (edge.role == "clauses") { const clause: AstNode = this.node(module,edge.node); if (clause.kind == "DefaultClause") fallback = edge.node; else { const value: number = this.eval(module,bindingChild(clause,"labels"),environment,mode); const equal: number = this.binary(module,id,subject,value,"=="); if (this.values[equal].scalar != 0) matched = true; } if (matched) break; }
      let running: boolean = false; for (const edge of n.edges) if (edge.role == "clauses") { const clause: AstNode = this.node(module,edge.node); if (!running) { if (!matched) running = edge.node == fallback; else if (clause.kind != "DefaultClause") { const equal: number = this.binary(module,id,subject,this.eval(module,bindingChild(clause,"labels"),environment,mode),"=="); running = this.values[equal].scalar != 0; } } if (running) for (const statement of clause.edges) if (statement.role == "body") this.walk(module,statement.node,environment,mode); if (this.signal != "") break; }
      if (this.signal == "break") this.signal = ""; return;
    }
    this.fail(module,id,"COMPTIME_UNSUPPORTED","sentencia " + n.kind);
  }
  serialize(value: number, module: number, id: number): string {
    if (!this.step(module,id)) return ""; const v = this.values[value];
    if (v.kind == "number") { if (v.scalar-v.scalar != 0) { this.fail(module,id,"COMPTIME_FLOAT_RANGE","resultado no finito"); return ""; } return "{\"type\":" + quoteSource(v.typeName) + ",\"value\":" + numberToString(v.scalar) + "}"; }
    if (v.kind == "integer") return "{\"type\":" + quoteSource(v.typeName) + ",\"exactInteger\":" + quoteSource(constantIntegerText(v)) + "}";
    if (v.kind == "boolean") return "{\"type\":\"boolean\",\"value\":" + (v.scalar == 1 ? "true" : "false") + "}";
    if (v.kind == "string") return "{\"type\":\"string\",\"value\":" + quoteSource(v.text) + "}";
    if (["array","object","optional","result"].includes(v.kind)) {
      let entries: string[] = []; for (let at: number = 0; at < v.entries.length; at = at+1) entries.push((v.kind == "object" ? quoteSource(v.keys[at])+":" : "")+this.serialize(v.entries[at],module,id));
      return "{\"type\":" + quoteSource(v.typeName) + ",\"kind\":" + quoteSource(v.kind) + ",\"tag\":" + quoteSource(v.text) + ",\"value\":" + (v.kind == "object" ? "{" : "[") + entries.join(",") + (v.kind == "object" ? "}" : "]") + "}";
    }
    this.fail(module,id,"COMPTIME_NON_LITERAL","el resultado no se puede materializar"); return "";
  }
  nested(module: number, id: number): boolean {
    let at: number = this.binding.files[module].parents[id];
    while (at >= 0) { const n: AstNode = this.node(module,at); if (n.kind == "CallExpression" && this.helper(module,at) == "comptime") return true; if (callableBinding(n.kind) && this.decorated(module,at,"comptime")) return true; at = this.binding.files[module].parents[at]; } return false;
  }
  evaluate(module: number, id: number, strict: boolean): void {
    this.values = []; this.cells = []; this.environments = []; this.instructions = 0; this.bytes = 0; this.depth = 0; this.signal = ""; this.returned = 0; this.failureCode = ""; this.failure = ""; this.rootModule = module; this.rootNode = id;
    this.values.push(new ConstantValue("void","void")); this.environment(-1);
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) { const s = this.binding.symbols[sid]; if (s.module >= 0 && (s.target) < 0 && this.functionOwner(s.scope) < 0 && (s.kind == "VariableDeclaration" || s.kind == "UsingDeclaration")) this.reserve(0,sid); }
    const value: number = this.eval(module,id,0,strict ? "strict" : "input");
    let serialized: string = ""; if (this.failure == "") serialized = this.serialize(value,module,id);
    this.checked.files[module].constantCodes[id] = this.failureCode;
    if (this.failure == "") { this.checked.files[module].constantStates[id] = "evaluated"; this.checked.files[module].constantValues[id] = serialized; }
    else if (!strict && this.failureCode == "COMPTIME_VALUE_UNAVAILABLE") this.checked.files[module].constantStates[id] = "deferred";
    else { this.checked.files[module].constantStates[id] = "error"; this.checked.diagnostics.push(new SourceDiagnostic("checker",this.failureCode + ": " + this.failure,this.graph.modules[this.failureModule].file,this.node(this.failureModule,this.failureNode).start)); }
  }
  run(): CheckResult {
    for (let m: number = 0; m < this.checked.files.length; m = m+1) for (let id: number = 0; id < this.checked.files[m].types.length; id = id+1) {
      if (this.binding.files[m].nodeScopes[id] < 0 || !["CallExpression","MemberCallExpression"].includes(this.node(m,id).kind)) continue;
      const selected: number = this.checked.files[m].selected[id]; const selectedModule: number = this.checked.files[m].selectedModules[id]; const strict: boolean = this.helper(m,id) == "comptime";
      if (!strict && !(selected >= 0 && this.decorated(selectedModule,selected,"comptime"))) continue;
      if (this.nested(m,id)) this.checked.files[m].constantStates[id] = "deferred"; else this.evaluate(m,id,strict);
    }
    return this.checked;
  }
}
export function evaluateNativeComptime(graph: ModuleGraph, binding: BindingResult, checked: CheckResult): CheckResult { let evaluator = new NativeComptime(graph,binding,checked); return evaluator.run(); }
