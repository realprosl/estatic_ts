import { ModuleGraph } from "../modules/loader";
import { BindingResult, BindingSymbol, bindingChild, callableBinding } from "../binder/binder";
import { AstNode } from "../parser/parser";
import { SourceDiagnostic } from "../frontend/frontend";
import { splitTypes, functionClose, functionParams, functionReturn, numericType, primitiveType, typeCompatible, replaceType, memoryMode, memoryInner, memoryValue, ownedType, readonlyType, semanticArray, semanticElement, containsMemory } from "./types";

import { TypedFile, CheckResult } from "./model";
export { TypedFile, CheckResult } from "./model";
import { validateSafety } from "./safety";

export class NativeChecker {
  graph: ModuleGraph; binding: BindingResult; result: CheckResult; symbolStates: number[]; depth: number;
  constructor(graph: ModuleGraph, binding: BindingResult) {
    this.graph = graph; this.binding = binding; this.result = new CheckResult(); this.symbolStates = []; this.depth = 0;
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  report(module: number, id: number, message: string): void {
    // Suppress cascades with the exact same owner/message, not independent errors.
    const token = this.node(module, id).start;
    for (const d of this.result.diagnostics) if (d.file == this.graph.modules[module].file && d.token.offset == token.offset && d.message == message) return;
    this.result.diagnostics.push(new SourceDiagnostic("checker", message, this.graph.modules[module].file, token));
  }
  unsupported(module: number, id: number, feature: string): string { this.report(module, id, "Comprobación nativa pendiente: " + feature); return "!error"; }
  requireType(module: number, id: number, actual: string, expected: string): void {
    this.literalRange(module,id,expected);
    if (ownedType(expected) && actual == memoryInner(expected) && id >= 0 && this.node(module,id).kind == "NewExpression") return;
    if (!typeCompatible(actual, expected)) this.report(module, id, "Tipo '" + actual + "' incompatible con '" + expected + "'");
  }
  literalRange(module: number, id: number, expected: string): void {
    if (!numericType(expected) || expected == "number" || expected == "f64" || id < 0) return;
    let n: AstNode = this.node(module,id); let sign: number = 1;
    if (n.kind == "UnaryExpression" && (n.get("operator") == "-" || n.get("operator") == "+")) { if (n.get("operator") == "-") sign = -1; n = this.node(module,bindingChild(n,"operand")); }
    if (n.kind != "LiteralExpression" || n.get("literalType") != "number") return;
    let value: number = 0; const raw: string = n.get("raw");
    for (let at: number = 0; at < raw.length; at = at + 1) {
      const digit: number = raw.charCodeAt(at) - 48;
      if (digit < 0 || digit > 9) { this.unsupported(module,id,"rango de literal numérico no decimal entero"); return; }
      value = value * 10 + digit;
    }
    value = value * sign; let minimum: number = -340282346638528860000000000000000000000; let maximum: number = 340282346638528860000000000000000000000;
    if (expected == "i8") { minimum = -128; maximum = 127; }
    if (expected == "u8") { minimum = 0; maximum = 255; }
    if (expected == "i16") { minimum = -32768; maximum = 32767; }
    if (expected == "u16") { minimum = 0; maximum = 65535; }
    if (expected == "i32") { minimum = -2147483648; maximum = 2147483647; }
    if (expected == "u32") { minimum = 0; maximum = 4294967295; }
    if (value < minimum || value > maximum) this.report(module,id,"Literal fuera de rango para " + expected);
  }
  origin(sid: number): number {
    let current: number = sid; let remaining: number = this.binding.symbols.length;
    while (current >= 0 && this.binding.symbols[current].target >= 0 && remaining > 0) { current = this.binding.symbols[current].target; remaining = remaining - 1; } return current;
  }
  lookup(scope: number, name: string, types: boolean): number {
    let current: number = scope;
    while (current >= 0) {
      for (const sid of this.binding.scopes[current].symbols) {
        const s: BindingSymbol = this.binding.symbols[sid];
        if (s.name == name && (types ? s.types : s.values)) return this.origin(sid);
      } current = this.binding.scopes[current].parent;
    } return -1;
  }
  qualifiedType(module: number, id: number, text: string): number {
    const names: string[] = splitTypes(text,"."); if (names.length == 0) return -1;
    let sid: number = this.lookup(this.binding.files[module].nodeScopes[id],names[0],true);
    for (let part: number = 1; part < names.length; part = part + 1) {
      if (sid < 0) return -1; const dependency: number = this.binding.symbols[sid].namespaceModule; let next: number = -1;
      if (dependency < 0) return -1;
      for (const entry of this.binding.exports) if (entry.module == dependency && entry.name == names[part]) next = this.origin(entry.symbol);
      sid = next;
    } return sid;
  }
  reference(module: number, id: number): number {
    for (const ref of this.binding.references) if (ref.module == module && ref.node == id && ref.space == "value" && !ref.deferred) return ref.target;
    return -1;
  }
  nominal(sid: number): string { return "#" + numberToString(sid); }
  nominalSymbol(text: string): number {
    for (let i: number = 0; i < this.binding.symbols.length; i = i + 1) if (this.nominal(i) == text) return i; return -1;
  }
  annotation(module: number, id: number, input: string): string {
    if ((this.depth) > 128) { this.report(module,id,"Límite de resolución de tipos excedido"); return "!error"; }
    this.depth = this.depth + 1; const result: string = this.annotationInner(module, id, input.trim()); this.depth = this.depth - 1; return result;
  }
  annotationInner(module: number, id: number, text: string): string {
    if (text == "") return "";
    if (text == "i64" || text == "u64") return this.unsupported(module,id,"enteros exactos de 64 bits");
    if (primitiveType(text)) return text;
    const mode: string = memoryMode(text);
    if (mode != "") {
      const args: string[] = splitTypes(memoryInner(text),",");
      if (args.length != 1) { this.report(module,id,"El modificador de memoria necesita un tipo"); return "!error"; }
      return mode + "<" + this.annotation(module,id,args[0]) + ">";
    }
    const close: number = functionClose(text);
    if (close >= 0) {
      let params: string[] = []; for (const p of functionParams(text)) params.push(this.annotation(module,id,p));
      return "(" + params.join(",") + ")=>" + this.annotation(module,id,functionReturn(text));
    }
    const unions: string[] = splitTypes(text,"|");
    if (unions.length > 1) { let parts: string[] = []; for (const p of unions) parts.push(this.annotation(module,id,p)); return parts.join("|"); }
    if (text.endsWith("[]")) return semanticArray(this.annotation(module,id,semanticElement(text)));
    if (text.startsWith("[") && text.endsWith("]")) {
      let parts: string[] = []; for (const p of splitTypes(text.slice(1,text.length-1),",")) parts.push(this.annotation(module,id,p)); return "[" + parts.join(",") + "]";
    }
    if (text.startsWith("Array<") && text.endsWith(">")) return semanticArray(this.annotation(module,id,text.slice(6,text.length-1)));
    if (text.startsWith("$typeof$")) {
      const name: string = text.slice(8,text.length); const sid: number = this.lookup(this.binding.files[module].nodeScopes[id],name,false);
      // Query references also permit a type-only import of a runtime declaration.
      for (const ref of this.binding.references) if (ref.module == module && ref.node == id && ref.name == (name.indexOf(".",0) < 0 ? name : name.slice(name.lastIndexOf(".")+1,name.length)) && ref.space == "query") return this.symbolType(ref.target,module,id);
      return this.symbolType(sid,module,id);
    }
    if (text.indexOf("<",0) >= 0 || text.indexOf("[",0) >= 0) return this.unsupported(module,id,"tipo " + text);
    const sid: number = this.qualifiedType(module,id,text);
    if (sid < 0) { this.report(module,id,"No se pudo resolver el tipo '" + text + "'"); return "!error"; }
    const s: BindingSymbol = this.binding.symbols[sid];
    if (s.kind == "TypeParameter") return "@" + numberToString(sid);
    if (s.kind == "TypeAliasDeclaration") return this.symbolType(sid,module,id);
    if (s.kind == "ClassDeclaration" || s.kind == "InterfaceDeclaration") return this.nominal(sid);
    return this.unsupported(module,id,"tipo " + text);
  }
  signature(module: number, id: number): string {
    const n: AstNode = this.node(module,id); let params: string[] = [];
    for (const e of n.edges) if (e.role == "params") params.push(this.annotation(module,e.node,this.node(module,e.node).get("type")));
    let returns: string = this.annotation(module,id,n.get("returnType"));
    if (returns == "") returns = this.expression(module,bindingChild(n,"body"),"");
    return "(" + params.join(",") + ")=>" + returns;
  }
  symbolType(sid: number, useModule: number, useNode: number): string {
    const target: number = this.origin(sid); if (target < 0) { this.report(useModule,useNode,"No se pudo recuperar el símbolo vinculado"); return "!error"; }
    if (this.result.symbolTypes[target] != "") return this.result.symbolTypes[target];
    if (this.symbolStates[target] == 1) { this.report(useModule,useNode,"Inferencia circular; añade una anotación de tipo"); return "!error"; }
    this.symbolStates[target] = 1;
    const s: BindingSymbol = this.binding.symbols[target]; let valueType: string = "!error";
    if ((s.module) < 0) {
      valueType = this.builtin(s.name); if (valueType == "!error") valueType = this.unsupported(useModule,useNode,"builtin " + s.name);
    } else {
      const n: AstNode = this.node(s.module,(s.node) < 0 ? this.graph.modules[s.module].cached.result.ast.root : s.node);
      if (callableBinding(s.kind)) valueType = this.signature(s.module,s.node);
      else if (s.kind == "ClassDeclaration") valueType = "class:" + this.nominal(target);
      else if (s.kind == "InterfaceDeclaration") valueType = this.nominal(target);
      else if (s.kind == "TypeParameter") valueType = "@" + numberToString(target);
      else if (s.kind == "receiver") {
        let scope: number = s.scope;
        while (scope >= 0 && this.binding.scopes[scope].kind != "ClassDeclaration") scope = this.binding.scopes[scope].parent;
        if (scope >= 0) valueType = this.nominal(this.binding.files[s.module].declarations[this.binding.scopes[scope].node]);
      } else if (s.kind == "TypeAliasDeclaration") valueType = this.annotation(s.module,s.node,n.get("type"));
      else if (s.kind == "VariableDeclaration" || s.kind == "UsingDeclaration") {
        valueType = this.annotation(s.module,s.node,n.get("declaredType"));
        if (valueType == "") valueType = this.expression(s.module,bindingChild(n,"initializer"),"");
      } else if (s.kind == "Parameter" || s.kind == "ClassField" || s.kind == "InterfaceField") valueType = this.annotation(s.module,s.node,n.get("type"));
      else if (s.namespaceModule >= 0) valueType = "namespace";
      else if (s.kind.endsWith("Expression")) valueType = this.expression(s.module,s.node,"");
      else valueType = this.unsupported(useModule,useNode,"símbolo " + s.kind);
    }
    this.result.symbolTypes[target] = valueType; this.symbolStates[target] = 2; return valueType;
  }
  builtin(name: string): string {
    if (name == "print" || name == "printError" || name == "write" || name == "writeError") return "!print";
    if (name == "numberToString") return "(number)=>string";
    if (name == "argument") return "(number)=>string";
    if (name == "argumentCount") return "()=>number";
    if (name == "exitProcess") return "(number)=>void";
    if (name == "move" || name == "ref" || name == "constRef") return "!" + name;
    return "!error";
  }
  memberSymbol(valueType: string, name: string): number {
    let receiver: string = memoryValue(valueType); if (receiver.startsWith("class:")) receiver = receiver.slice(6,receiver.length);
    const owner: number = this.nominalSymbol(receiver); if (owner < 0) return -1;
    const s: BindingSymbol = this.binding.symbols[owner];
    for (let i: number = 0; i < this.binding.symbols.length; i = i + 1) {
      const item: BindingSymbol = this.binding.symbols[i];
      if (item.name == name && item.module == s.module && item.scope >= 0 && this.binding.scopes[item.scope].node == s.node) return i;
    } return -1;
  }
  member(module: number, id: number, input: string, name: string): string {
    const valueType: string = memoryValue(input);
    const bound: number = this.reference(module,id); if (bound >= 0) { this.result.files[module].members[id] = bound; return this.symbolType(bound,module,id); }
    if (valueType == "!error") return valueType;
    if (name == "length" && (valueType == "string" || valueType.endsWith("[]"))) return "number";
    if (valueType == "string") {
      if (name == "charAt") return "(number)=>string";
      if (name == "charCodeAt") return "(number)=>number";
      if (name == "includes") return "(string,number)=>boolean";
      if (["startsWith","endsWith"].includes(name)) return "(string)=>boolean";
      if (name == "indexOf") return "(string,number)=>number";
      if (name == "lastIndexOf" || name == "localeCompare") return "(string)=>number";
      if (["trim","trimStart","trimEnd","toUpperCase","toLowerCase","toString"].includes(name)) return "()=>string";
      if (name == "slice" || name == "substring" || name == "substr") return "(number,number)=>string";
      if (name == "split") return "(string)=>string[]";
      if (name == "repeat") return "(number)=>string";
      if (name == "padStart" || name == "padEnd") return "(number,string)=>string";
      if (name == "replace" || name == "replaceAll") return "(string,string)=>string";
    }
    if (valueType.endsWith("[]")) {
      const element: string = semanticElement(valueType);
      if (name == "push") return "(" + element + ")=>void";
      if (name == "pop") return "()=>void";
      if (name == "includes") return "(" + element + ")=>boolean";
      if (name == "join" && element == "string") return "(string)=>string";
      if (name == "slice") return "(number,number)=>" + valueType;
    }
    const sid: number = this.memberSymbol(valueType,name);
    if (sid < 0) { this.report(module,id,"El tipo '" + valueType + "' no declara el miembro '" + name + "'"); return "!error"; }
    this.result.files[module].members[id] = sid;
    const s: BindingSymbol = this.binding.symbols[sid]; const n: AstNode = this.node(s.module,(s.node) < 0 ? this.graph.modules[s.module].cached.result.ast.root : s.node);
    if ((n.get("isStatic") == "true") != valueType.startsWith("class:")) this.report(module,id,"Receptor estático/de instancia incorrecto para '" + name + "'");
    if (n.get("access") == "private" || n.get("access") == "protected") {
      const owner: number = this.binding.scopes[s.scope].node; let scope: number = this.binding.files[module].nodeScopes[id]; let allowed: boolean = false;
      while (scope >= 0) { if (this.binding.scopes[scope].module == s.module && this.binding.scopes[scope].node == owner) allowed = true; scope = this.binding.scopes[scope].parent; }
      if (!allowed) this.report(module,id,"Miembro privado '" + name + "'");
    }
    return this.symbolType(sid,module,id);
  }
  methodMutates(sid: number): boolean {
    const s: BindingSymbol = this.binding.symbols[sid]; if ((s.module) < 0 || s.kind != "ClassMethod") return false;
    let work: number[] = []; for (const declaration of s.declarations) work.push(declaration);
    while (work.length > 0) {
      const n: AstNode = this.node(s.module,work[work.length-1]); work.pop();
      let target: number = -1;
      if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression") target = bindingChild(n,"target");
      else if (n.kind == "MemberCallExpression") target = bindingChild(n,"object");
      while (target >= 0) {
        const receiver: AstNode = this.node(s.module,target);
        if (receiver.kind == "IdentifierExpression" && receiver.get("name") == "this") return true;
        if (receiver.kind != "MemberExpression" && receiver.kind != "IndexExpression") break;
        target = bindingChild(receiver,"object");
      }
      for (const edge of n.edges) work.push(edge.node);
    } return false;
  }
  writable(module: number, id: number): void { this.writableTarget(module,id,false); }
  writableTarget(module: number, id: number, through: boolean): void {
    const n: AstNode = this.node(module,id); let sid: number = this.reference(module,id);
    if (readonlyType(this.result.files[module].types[id])) this.report(module,id,"E4300: destino readonly");
    if (n.kind == "MemberExpression") {
      sid = this.result.files[module].members[id];
      const object: number = bindingChild(n,"object");
      if (!this.result.files[module].types[object].startsWith("class:")) this.writableTarget(module,object,true);
    }
    if (n.kind == "IndexExpression") {
      const object: number = bindingChild(n,"object");
      if (this.result.files[module].types[object] == "string") this.report(module,id,"No se puede modificar un string por índice");
      this.writableTarget(module,object,true); return;
    }
    if (sid >= 0) {
      const s: BindingSymbol = this.binding.symbols[sid];
      if ((s.module) < 0) { this.report(module,id,"No se puede modificar un builtin"); return; }
      if (s.kind == "receiver" || memoryMode(this.result.files[module].types[id]) == "ref") return;
      const declaration: AstNode = this.node(s.module,s.node);
      if ((s.kind == "VariableDeclaration" && declaration.get("mutable") != "true") || declaration.get("readonly") == "true" || (s.kind != "VariableDeclaration" && s.kind != "ClassField" && s.kind != "Parameter")) this.report(module,id,"Destino inmutable '" + s.name + "'");
      for (const ref of this.binding.references) if (ref.module == module && ref.node == id && ref.symbol >= 0 && this.binding.symbols[ref.symbol].kind == "import") this.report(module,id,"No se puede reasignar un import");
    }
  }
  call(module: number, id: number, callable: string, sid: number): string {
    const n: AstNode = this.node(module,id); let args: number[] = []; let actual: string[] = [];
    let contexts: string[] = functionParams(callable);
    if (sid >= 0 && (this.binding.symbols[sid].module) >= 0 && this.binding.symbols[sid].declarations.length > 1) {
      for (const declaration of this.binding.symbols[sid].declarations) {
        const other: string[] = functionParams(this.signature(this.binding.symbols[sid].module,declaration));
        for (let p: number = 0; p < contexts.length; p = p + 1) if (p >= other.length || contexts[p] != other[p]) contexts[p] = "";
      }
    }
    for (const edge of n.edges) if (edge.role == "args") {
      const context: string = (args.length) < contexts.length && contexts[args.length].indexOf("@",0) < 0 ? contexts[args.length] : "";
      args.push(edge.node); actual.push(this.expression(module,edge.node,context));
    }
    if (callable == "!move" || callable == "!ref" || callable == "!constRef") {
      if (args.length != 1) { this.report(module,id,"El helper de memoria necesita un argumento"); return "!error"; }
      const arg: AstNode = this.node(module,args[0]);
      if (callable == "!move") {
        if (arg.kind != "IdentifierExpression" || !ownedType(actual[0])) this.report(module,id,"E4100: move requiere un identificador ptr/constPtr");
        return actual[0];
      }
      if (arg.kind != "IdentifierExpression" && arg.kind != "MemberExpression" && arg.kind != "IndexExpression") this.report(module,id,"E4208: un préstamo necesita un lvalue");
      if (callable == "!ref") this.writable(module,args[0]);
      return callable.slice(1,callable.length) + "<" + memoryValue(actual[0]) + ">";
    }
    if (callable == "!print") { if (args.length != 1) this.report(module,id,"print requiere un argumento"); return "void"; }
    if (callable == "!error") return callable;
    let candidates: number[] = [];
    if (sid >= 0 && (this.binding.symbols[sid].module) >= 0 && callableBinding(this.binding.symbols[sid].kind)) candidates = this.binding.symbols[sid].declarations;
    if (candidates.length == 0) {
      for (const attr of n.attributes) if (attr.name == "typeArgument") this.unsupported(module,id,"argumentos de tipo sobre un valor callable");
      if (functionClose(callable) < 0) { this.report(module,id,"El valor no es invocable: " + callable); return "!error"; }
      const parameters: string[] = functionParams(callable);
      if (args.length != parameters.length) this.report(module,id,"Aridad incorrecta: esperaba " + numberToString(parameters.length));
      for (let i: number = 0; i < args.length && i < parameters.length; i = i + 1) this.requireType(module,args[i],actual[i],parameters[i]);
      this.result.files[module].signatures[id] = callable; return functionReturn(callable);
    }
    const ownerModule: number = this.binding.symbols[sid].module; let selected: number = -1; let selectedType: string = "!error";
    for (const candidate of candidates) {
      const declaration: AstNode = this.node(ownerModule,candidate); const signature: string = this.signature(ownerModule,candidate);
      let parameters: string[] = functionParams(signature); let returns: string = functionReturn(signature);
      let genericNames: string[] = []; let genericValues: string[] = [];
      for (const edge of declaration.edges) if (edge.role == "typeParameters") { genericNames.push("@" + numberToString(this.binding.files[ownerModule].declarations[edge.node])); genericValues.push(""); }
      let explicitTypes: string[] = []; for (const attr of n.attributes) if (attr.name == "typeArgument") explicitTypes.push(this.annotation(module,id,attr.value));
      let matches: boolean = explicitTypes.length == 0 || explicitTypes.length == genericNames.length;
      for (let g: number = 0; g < genericNames.length; g = g + 1) {
        if (g < explicitTypes.length) genericValues[g] = explicitTypes[g];
        else for (let p: number = 0; p < parameters.length && p < actual.length; p = p + 1) {
          let inferred: string = "";
          if (parameters[p] == genericNames[g]) inferred = actual[p];
          else if (parameters[p] == genericNames[g] + "[]" && actual[p].endsWith("[]")) inferred = semanticElement(actual[p]);
          if (inferred != "") { if (genericValues[g] != "" && genericValues[g] != inferred) matches = false; genericValues[g] = inferred; }
        }
        if (genericValues[g] == "") matches = false;
        if (containsMemory(genericValues[g])) this.unsupported(module,id,"instanciación genérica con contrato de memoria");
        for (let p: number = 0; p < parameters.length; p = p + 1) parameters[p] = replaceType(parameters[p],genericNames[g],genericValues[g]);
        returns = replaceType(returns,genericNames[g],genericValues[g]);
      }
      let required: number = 0; let count: number = 0;
      for (const edge of declaration.edges) if (edge.role == "params") {
        const param: AstNode = this.node(ownerModule,edge.node);
        if (param.get("optional") != "true" && bindingChild(param,"defaultValue") < 0) required = count + 1;
        if (param.get("variadic") == "true" || param.get("out") == "true") matches = false;
        count = count + 1;
      }
      if ((args.length) < required || args.length > parameters.length) matches = false;
      for (let p: number = 0; p < actual.length && p < parameters.length; p = p + 1) if (!typeCompatible(actual[p],parameters[p]) && !(ownedType(parameters[p]) && actual[p] == memoryInner(parameters[p]) && this.node(module,args[p]).kind == "NewExpression")) matches = false;
      if (matches) { for (let p: number = 0; p < args.length && p < parameters.length; p = p + 1) this.literalRange(module,args[p],parameters[p]); if (selected >= 0) { this.report(module,id,"Llamada ambigua entre sobrecargas"); return "!error"; } selected = candidate; selectedType = returns; this.result.files[module].signatures[id] = "(" + parameters.join(",") + ")=>" + returns; }
    }
    if (selected < 0) this.report(module,id,"Ninguna firma compatible con los argumentos");
    this.result.files[module].selected[id] = selected; if (selected >= 0) this.result.files[module].selectedModules[id] = ownerModule; return selectedType;
  }
  expression(module: number, id: number, expected: string): string {
    if (id < 0) return "void";
    if ((this.depth) > 128) { this.report(module,id,"Límite de inferencia excedido"); return "!error"; }
    if (this.result.files[module].states[id] == 2) return this.result.files[module].types[id];
    if (this.result.files[module].states[id] == 1) { this.report(module,id,"Inferencia circular; añade una anotación de tipo"); return "!error"; }
    this.result.files[module].states[id] = 1; this.depth = this.depth + 1;
    const valueType: string = this.expressionInner(module,id,expected);
    this.depth = this.depth - 1; this.result.files[module].types[id] = valueType; this.result.files[module].states[id] = 2; return valueType;
  }
  expressionInner(module: number, id: number, expected: string): string {
    const n: AstNode = this.node(module,id); const kind: string = n.kind;
    if (kind == "LiteralExpression") return n.get("literalType");
    if (kind == "IdentifierExpression") {
      const sid: number = this.reference(module,id);
      if (sid >= 0) {
        const s: BindingSymbol = this.binding.symbols[sid];
        if (s.declarations.length > 1) this.unsupported(module,id,"sobrecarga usada como valor");
        if (s.kind == "ClassDeclaration") {
          const parent: number = this.binding.files[module].parents[id]; let staticReceiver: boolean = false;
          if (parent >= 0) { const p: AstNode = this.node(module,parent); staticReceiver = (p.kind == "MemberExpression" || p.kind == "MemberCallExpression") && bindingChild(p,"object") == id; }
          if (!staticReceiver) this.report(module,id,"Una clase requiere new o un miembro estático");
        }
      } return this.symbolType(sid,module,id);
    }
    if (kind == "CallExpression") { const sid: number = this.reference(module,id); return this.call(module,id,this.symbolType(sid,module,id),sid); }
    if (kind == "MemberExpression" || kind == "MemberCallExpression") {
      if (n.get("optional") == "true") return this.unsupported(module,id,"acceso opcional");
      const object: number = bindingChild(n,"object"); const bound: number = this.reference(module,id);
      let receiver: string = "namespace";
      if (bound < 0) receiver = this.expression(module,object,"");
      else { this.result.files[module].types[object] = "namespace"; this.result.files[module].states[object] = 2; }
      const valueType: string = this.member(module,id,receiver,kind == "MemberExpression" ? n.get("member") : n.get("method"));
      if (kind == "MemberExpression") return valueType;
      const memberId: number = this.result.files[module].members[id];
      if ((memberId >= 0 && this.methodMutates(memberId)) || (memoryValue(receiver).endsWith("[]") && ["push","pop"].includes(n.get("method")))) this.writableTarget(module,object,true);
      return this.call(module,id,valueType,this.result.files[module].members[id]);
    }
    if (kind == "NewExpression") {
      const valueType: string = this.annotation(module,id,n.get("className")); const sid: number = this.nominalSymbol(valueType);
      if (sid < 0 || this.binding.symbols[sid].kind != "ClassDeclaration") { this.report(module,id,"new requiere una clase"); return "!error"; }
      const constructorId: number = this.memberSymbol(valueType,"constructor");
      if (constructorId >= 0) this.call(module,id,this.symbolType(constructorId,module,id),constructorId);
      else for (const edge of n.edges) if (edge.role == "args") { this.expression(module,edge.node,""); this.report(module,id,"El constructor no admite argumentos"); }
      return valueType;
    }
    if (kind == "BinaryExpression") {
      const left: string = memoryValue(this.expression(module,bindingChild(n,"left"),"")); const right: string = memoryValue(this.expression(module,bindingChild(n,"right"),"")); const op: string = n.get("operator");
      if (op == "+" && (left == "string" || right == "string")) return "string";
      if (["==","!=","<",">","<=",">="].includes(op)) { this.requireType(module,id,left,right); return "boolean"; }
      if (op == "&&" || op == "||") { this.requireType(module,id,left,"boolean"); this.requireType(module,id,right,"boolean"); return "boolean"; }
      if (!numericType(left) && left != "!error") this.report(module,id,"Operador numérico sobre '" + left + "'");
      if (!numericType(right) && right != "!error") this.report(module,id,"Operador numérico sobre '" + right + "'");
      if (op == "??" || op == "instanceof") return this.unsupported(module,id,op);
      return left;
    }
    if (kind == "UnaryExpression") {
      const operand: string = memoryValue(this.expression(module,bindingChild(n,"operand"),"")); const op: string = n.get("operator");
      if (op == "typeof") return "string";
      if (op == "!") { this.requireType(module,id,operand,"boolean"); return "boolean"; }
      if (!numericType(operand) && operand != "!error") this.report(module,id,"Operador numérico sobre '" + operand + "'"); return operand;
    }
    if (kind == "AssignmentExpression" || kind == "CompoundAssignmentExpression") {
      const target: number = bindingChild(n,"target"); const valueType: string = this.expression(module,target,"");
      const value: string = this.expression(module,bindingChild(n,"value"),valueType); this.requireType(module,bindingChild(n,"value"),value,valueType); this.writable(module,target);
      if (kind == "CompoundAssignmentExpression" && !numericType(memoryValue(valueType)) && !(memoryValue(valueType) == "string" && n.get("operator") == "+=")) this.report(module,id,"Asignación compuesta inválida"); return valueType;
    }
    if (kind == "ArrayLiteralExpression") {
      const element: string = expected.endsWith("[]") ? semanticElement(expected) : "";
      const tuple: string[] = expected.startsWith("[") ? splitTypes(expected.slice(1,expected.length-1),",") : [];
      let items: string[] = [];
      for (const edge of n.edges) if (edge.role == "elements") {
        const context: string = element != "" ? element : (items.length) < tuple.length ? tuple[items.length] : "";
        const actual: string = this.expression(module,edge.node,context); if (context != "") this.requireType(module,edge.node,actual,context); items.push(actual);
      }
      if (element != "") return expected;
      if (tuple.length > 0) { if (tuple.length != items.length) this.report(module,id,"Tamaño de tupla incorrecto"); return expected; }
      if (items.length == 0) { this.report(module,id,"Un array vacío requiere anotación"); return "!error"; }
      let same: boolean = true; for (const item of items) if (item != items[0]) same = false;
      return same ? semanticArray(items[0]) : "[" + items.join(",") + "]";
    }
    if (kind == "IndexExpression") {
      const object: string = memoryValue(this.expression(module,bindingChild(n,"object"),""));
      const indexId: number = bindingChild(n,"index"); this.requireType(module,indexId,this.expression(module,indexId,""),"number");
      if (object == "string") return "string";
      if (object.endsWith("[]")) return semanticElement(object);
      if (object.startsWith("[")) {
        const index: AstNode = this.node(module,indexId); const items: string[] = splitTypes(object.slice(1,object.length-1),",");
        for (let i: number = 0; i < items.length; i = i + 1) if (index.kind == "LiteralExpression" && index.get("raw") == numberToString(i)) return items[i];
        this.report(module,id,"Índice de tupla fuera de rango o no constante"); return "!error";
      }
      if (object != "!error") this.report(module,id,"El tipo no admite índices: " + object); return "!error";
    }
    if (kind == "ObjectLiteralExpression") {
      const sid: number = this.nominalSymbol(expected);
      if (sid < 0 || this.binding.symbols[sid].kind != "InterfaceDeclaration") return this.unsupported(module,id,"literal de objeto sin contexto de interfaz");
      let provided: string[] = [];
      for (const edge of n.edges) if (edge.role == "properties") {
        const prop: AstNode = this.node(module,edge.node); const name: string = prop.get("key");
        if (provided.includes(name)) this.report(module,edge.node,"Campo duplicado '" + name + "'"); provided.push(name);
        const field: number = this.memberSymbol(expected,name); const value: number = bindingChild(prop,"value");
        if (field < 0) { this.report(module,edge.node,"Campo desconocido '" + name + "'"); this.expression(module,value,""); }
        else { const valueType: string = this.symbolType(field,module,id); this.requireType(module,value,this.expression(module,value,valueType),valueType); }
      }
      const declaration: AstNode = this.node(this.binding.symbols[sid].module,this.binding.symbols[sid].node);
      for (const edge of declaration.edges) if (edge.role == "fields" || edge.role == "methods") {
        const field: AstNode = this.node(this.binding.symbols[sid].module,edge.node);
        if (!provided.includes(field.get("name")) && field.get("optional") != "true") this.report(module,id,"Falta el campo '" + field.get("name") + "'");
      } return expected;
    }
    if (kind == "ArrowFunctionExpression") return this.signature(module,id);
    if (kind == "TemplateLiteralExpression") { for (const edge of n.edges) if (edge.role == "expressions") this.expression(module,edge.node,""); return "string"; }
    if (kind == "AsExpression" || kind == "SatisfiesExpression") {
      const valueType: string = this.annotation(module,id,n.get(kind == "AsExpression" ? "targetType" : "declaredType"));
      const actual: string = this.expression(module,bindingChild(n,kind == "AsExpression" ? "expression" : "operand"),valueType);
      if (kind == "SatisfiesExpression") this.requireType(module,id,actual,valueType);
      else if (containsMemory(actual) || containsMemory(valueType)) this.report(module,id,"E4301: un cast no puede cambiar un contrato de memoria");
      return valueType;
    }
    if (kind == "TernaryExpression") {
      const condition: number = bindingChild(n,"condition"); this.requireType(module,condition,this.expression(module,condition,""),"boolean");
      const yes: string = this.expression(module,bindingChild(n,"thenBranch"),expected); const no: string = this.expression(module,bindingChild(n,"elseBranch"),expected);
      this.requireType(module,id,no,yes); return yes;
    }
    return this.unsupported(module,id,kind);
  }
  statement(module: number, id: number, returns: string, loop: number): void {
    const n: AstNode = this.node(module,id); const kind: string = n.kind;
    if (kind == "Program" || kind == "BlockStatement") { for (const e of n.edges) if (e.role == "statements") this.statement(module,e.node,returns,loop); return; }
    if (kind == "VariableDeclaration") {
      if (n.get("pattern") != "") { this.unsupported(module,id,"destructuring"); return; }
      const sid: number = this.binding.files[module].declarations[id]; const valueType: string = this.symbolType(sid,module,id);
      if (valueType == "void") this.report(module,id,"Una variable no puede ser void");
      const init: number = bindingChild(n,"initializer"); this.requireType(module,init,this.expression(module,init,valueType),valueType); this.result.files[module].types[id] = valueType; return;
    }
    if (callableBinding(kind)) {
      const valueType: string = this.signature(module,id); this.result.files[module].types[id] = valueType;
      const declared: number = this.binding.files[module].declarations[id];
      if (declared >= 0) this.symbolType(declared,module,id);
      for (const edge of n.edges) {
        if (edge.role == "params") {
          const param: AstNode = this.node(module,edge.node); const pt: string = this.annotation(module,edge.node,param.get("type")); if (pt == "void") this.report(module,edge.node,"Un parámetro no puede ser void"); this.result.files[module].types[edge.node] = pt;
          if (param.get("out") == "true" || param.get("variadic") == "true") this.unsupported(module,edge.node,"parámetro out/variádico");
          const value: number = bindingChild(param,"defaultValue"); if (value >= 0) this.requireType(module,value,this.expression(module,value,pt),pt);
        }
        if (edge.role == "typeParameters") {
          const parameter: AstNode = this.node(module,edge.node);
          if (parameter.get("constraint") != "" || parameter.get("default") != "" || parameter.get("variadic") == "true") this.unsupported(module,edge.node,"constraint/default/pack genérico");
        }
      }
      if ((n.get("async") == "true" || n.get("isAsync") == "true")) this.unsupported(module,id,"función async");
      const body: number = bindingChild(n,"body");
      if (body >= 0) {
        if (this.node(module,body).kind == "BlockStatement") {
          this.statement(module,body,functionReturn(valueType),0);

        } else this.requireType(module,body,this.expression(module,body,functionReturn(valueType)),functionReturn(valueType));
      } return;
    }
    if (kind == "ReturnStatement") {
      if (returns == "") this.report(module,id,"return fuera de una función");
      const value: number = bindingChild(n,"value"); this.requireType(module,id,this.expression(module,value,returns),returns); return;
    }
    if (kind == "ExpressionStatement") { this.expression(module,bindingChild(n,"expression"),""); return; }
    if (kind == "IfStatement" || kind == "WhileStatement" || kind == "ForStatement") {
      const condition: number = bindingChild(n,"condition"); if (condition >= 0) this.requireType(module,condition,this.expression(module,condition,""),"boolean");
      const init: number = bindingChild(n,"initializer"); if (init >= 0) this.statement(module,init,returns,loop);
      const update: number = bindingChild(n,"increment"); if (update >= 0) this.expression(module,update,"");
      for (const e of n.edges) if (e.role == "body" || e.role == "thenBranch" || e.role == "elseBranch") this.statement(module,e.node,returns,kind == "IfStatement" ? loop : loop + 1); return;
    }
    if (kind == "BreakStatement" || kind == "ContinueStatement") { if (loop == 0) this.report(module,id,"Control de bucle fuera de un bucle"); return; }
    if (kind == "ClassDeclaration" || kind == "InterfaceDeclaration") {
      for (const edge of n.edges) {
        if (edge.role == "typeParameters") this.unsupported(module,id,"clase genérica");
        if (edge.role == "fields") {
          const field: AstNode = this.node(module,edge.node); const valueType: string = this.annotation(module,edge.node,field.get("type")); if (valueType == "void") this.report(module,edge.node,"Un campo no puede ser void"); this.result.files[module].types[edge.node] = valueType;
          const value: number = bindingChild(field,"defaultValue"); if (value >= 0) this.requireType(module,value,this.expression(module,value,valueType),valueType);
        }
        if (edge.role == "methods") this.statement(module,edge.node,returns,0);
      } return;
    }
    if (kind == "TypeAliasDeclaration") { for (const e of n.edges) if (e.role == "typeParameters") this.unsupported(module,id,"alias genérico"); this.symbolType(this.binding.files[module].declarations[id],module,id); return; }
    if (kind == "ExportDefaultDeclaration") {
      const declaration: number = bindingChild(n,"declaration");
      if (this.node(module,declaration).kind.endsWith("Expression")) this.expression(module,declaration,""); else this.statement(module,declaration,returns,loop); return;
    }
    if (["ImportDeclaration","ExportAllDeclaration","ExportNamedDeclaration"].includes(kind)) return;
    this.unsupported(module,id,kind);
  }
  check(): CheckResult {
    for (const diagnostic of this.binding.diagnostics) this.result.diagnostics.push(diagnostic);
    if (!this.binding.success) return this.result;
    for (const s of this.binding.symbols) { this.result.symbolTypes.push(""); this.symbolStates.push(0); }
    for (const m of this.graph.modules) this.result.files.push(new TypedFile(m.cached.result.ast.nodes.length));
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) this.statement(m,this.graph.modules[m].cached.result.ast.root,"",0);
    // Arrows may be reached only as values, not statements. Validate their bodies too.
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.result.files[m].types.length; id = id + 1) {
      if (this.binding.files[m].nodeScopes[id] >= 0 && this.node(m,id).kind == "ArrowFunctionExpression") this.statement(m,id,"",0);
      if (this.binding.files[m].nodeScopes[id] >= 0 && this.node(m,id).kind == "Decorator") this.unsupported(m,id,"decorador/expansión");
    }
    // Safety checks also need the types of unused fields/parameters/receivers.
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
      const symbol: BindingSymbol = this.binding.symbols[sid];
      if (symbol.module >= 0 && ["Parameter","ClassField","InterfaceField","receiver"].includes(symbol.kind)) this.symbolType(sid,symbol.module,(symbol.node) < 0 ? this.graph.modules[symbol.module].cached.result.ast.root : symbol.node);
    }
    // Resolve all public signatures, including declarations not used at runtime.
    for (const item of this.binding.exports) {
      const sid: number = this.origin(item.symbol); const symbol: BindingSymbol = this.binding.symbols[sid];
      if (symbol.module >= 0 && (symbol.namespaceModule) < 0) this.symbolType(sid,symbol.module,symbol.node);
    }
    if (this.result.diagnostics.length == 0) { let checked: CheckResult = this.result; validateSafety(this.graph,this.binding,checked); this.result = checked; }
    this.result.success = this.result.diagnostics.length == 0; return this.result;
  }
}
export function checkProject(graph: ModuleGraph, binding: BindingResult): CheckResult { let checker: NativeChecker = new NativeChecker(graph,binding); return checker.check(); }
