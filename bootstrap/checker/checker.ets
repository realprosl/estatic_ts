import { ModuleGraph } from "../modules/loader";
import { BindingResult, BindingSymbol, bindingChild, callableBinding } from "../binder/binder";
import { AstNode } from "../parser/parser";
import { SourceDiagnostic } from "../frontend/frontend";
import { splitTypes, functionClose, functionParams, functionReturn, restPosition, argumentType, numericType, primitiveType, typeCompatible, replaceType, memoryMode, memoryInner, memoryValue, ownedType, borrowedType, readonlyType, semanticArray, semanticTuple, semanticElement, containsMemory, fixedArraySize, fixedArrayElement, semanticFixedArray, genericBase, genericArguments } from "./types";

import { TypedFile, CheckResult, NativeDecorator, NativeTypeQuery } from "./model";
export { TypedFile, CheckResult } from "./model";
import { evaluateNativeComptime } from "./comptime";
import { validateSafety } from "./safety";
import { resourceType, resourceSubstitution } from "./ownership";
import { nativeNumericLiteral, nativeUnaryPromotion, nativeBinaryPromotion, nativeIntegerText, nativeInteger64 } from "./numeric";

export class NativeChecker {
  graph: ModuleGraph; binding: BindingResult; result: CheckResult; symbolStates: number[]; depth: number; switches: number; compatibilityDepth: number;
  narrowedSymbols: number[]; narrowedTypes: string[];
  constructor(graph: ModuleGraph, binding: BindingResult) {
    this.graph = graph; this.binding = binding; this.result = new CheckResult(); this.symbolStates = []; this.depth = 0; this.switches = 0; this.compatibilityDepth = 0;
    this.narrowedSymbols = []; this.narrowedTypes = [];
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  report(module: number, id: number, message: string): void {
    // Suppress cascades with the exact same owner/message, not independent errors.
    const token = this.node(module, id).start;
    for (const d of this.result.diagnostics) if (d.file == this.graph.modules[module].file && d.token.offset == token.offset && d.message == message) return;
    this.result.diagnostics.push(new SourceDiagnostic("checker", message, this.graph.modules[module].file, token));
  }
  unsupported(module: number, id: number, feature: string): string { this.report(module, id, "Comprobación nativa pendiente: " + feature); return "!error"; }
  compatible(actual: string, expected: string): boolean {
    if (this.compatibilityDepth > 128) return false;
    this.compatibilityDepth = this.compatibilityDepth + 1; const result: boolean = this.compatibleInner(actual,expected); this.compatibilityDepth = this.compatibilityDepth - 1; return result;
  }
  parameterBound(text: string): string {
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (text == "@" + numberToString(sid)) {
      const s = this.binding.symbols[sid]; const n: AstNode = this.node(s.module,s.node);
      if (n.get("constraint") != "") return this.annotation(s.module,s.node,n.get("constraint"));
    } return "";
  }
  compatibleInner(actual: string, expected: string): boolean {
    if (actual == "!never") return true;
    if (typeCompatible(actual,expected)) return true;
    if (genericBase(actual) == "variant" && this.compatible(genericArguments(actual)[0],expected)) return true;
    const bound: string = this.parameterBound(actual); if (bound != "") return this.compatible(bound,expected);
    const alternatives: string[] = splitTypes(expected,"|");
    if (alternatives.length > 1) {
      for (const source of splitTypes(actual,"|")) { let found: boolean = false; for (const target of alternatives) if (this.compatible(source,target)) found = true; if (!found) return false; } return true;
    }
    const sourceUnion: string[] = splitTypes(actual,"|");
    if (sourceUnion.length > 1) { for (const source of sourceUnion) if (!this.compatible(source,expected)) return false; return true; }
    const requirements: string[] = splitTypes(expected,"&");
    if (requirements.length > 1) { for (const target of requirements) if (!this.compatible(actual,target)) return false; return true; }
    if (functionClose(actual) >= 0 && functionClose(expected) >= 0 && !containsMemory(actual) && !containsMemory(expected)) {
      const a: string[] = functionParams(actual); const e: string[] = functionParams(expected); if (a.length != e.length) return false;
      for (let p: number = 0; p < a.length; p = p + 1) if (!this.compatible(e[p],a[p])) return false;
      return this.compatible(functionReturn(actual),functionReturn(expected));
    }
    const target: number = this.nominalSymbol(expected);
    if (target >= 0 && this.binding.symbols[target].kind == "InterfaceDeclaration") {
      if (this.nominalSymbol(actual) < 0 && (splitTypes(actual,"&").length) < 2) return false;
      const owner = this.binding.symbols[target];
      for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == "fields" || edge.role == "methods") {
        const field: AstNode = this.node(owner.module,edge.node); const member: number = this.memberSymbol(actual,field.get("name"));
        if (member < 0) { if (field.get("optional") != "true") return false; }
        else {
          const source = this.binding.symbols[member]; const declaration: AstNode = this.node(source.module,source.node);
          if (declaration.get("access") == "private" || declaration.get("access") == "protected" || declaration.get("isStatic") == "true") return false;
          const required: number = this.binding.files[owner.module].declarations[edge.node];
          if (!this.compatible(this.instantiateMember(actual,this.symbolType(member,source.module,source.node)),this.instantiateMember(expected,this.symbolType(required,owner.module,edge.node)))) return false;
        }
      } return true;
    }
    const sid: number = this.nominalSymbol(actual);
    if (sid >= 0 && this.binding.symbols[sid].kind == "EnumDeclaration") {
      const s = this.binding.symbols[sid]; return this.node(s.module,s.node).get("underlying") == expected;
    } return false;
  }
  requireType(module: number, id: number, actual: string, expected: string): void {
    if (borrowedType(actual) && this.transferType(expected)) this.report(module,id,"E4101: una vista prestada no puede copiarse como owner");
    this.literalRange(module,id,expected);
    if (ownedType(expected) && actual == memoryInner(expected) && id >= 0 && this.node(module,id).kind == "NewExpression") return;
    if (id >= 0 && actual != expected && actual != "!error" && expected != "!error" && expected != "" && this.compatible(actual,expected)) this.result.files[module].conversions[id] = expected;
    if (!this.compatible(actual, expected)) this.report(module, id, "Tipo '" + actual + "' incompatible con '" + expected + "'");
  }
  literalRange(module: number, id: number, expected: string): void {
    if (!numericType(expected) || id < 0) return;
    let n: AstNode = this.node(module,id); let sign: number = 1;
    if (n.kind == "UnaryExpression" && (n.get("operator") == "-" || n.get("operator") == "+")) { if (n.get("operator") == "-") sign = -1; n = this.node(module,bindingChild(n,"operand")); }
    if (n.kind != "LiteralExpression" || n.get("literalType") != "number") return;
    if (expected == "i64" || expected == "u64") {
      const exact: string = nativeInteger64(n.get("raw"),sign < 0,expected);
      if (exact == "") this.report(module,id,"Literal fuera de rango para " + expected);
      else this.result.files[module].exactIntegers[id] = exact;
      return;
    }
    const parsed = nativeNumericLiteral(n.get("raw") == "" ? n.get("value") : n.get("raw"));
    if (!parsed.valid) { this.report(module,id,"Literal numérico no válido o no finito"); return; }
    if (expected == "number" || expected == "f64") return;
    let value: number = parsed.value * sign;
    if (expected != "f32" && value % 1 != 0) { this.report(module,id,"Literal fuera de rango para " + expected + ": se esperaba un entero"); return; }
    let minimum: number = -340282346638528860000000000000000000000; let maximum: number = 340282346638528860000000000000000000000;
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
  queryType(module: number, id: number, text: string): string {
    const names: string[] = splitTypes(text,"."); if (names.length == 0) return "!error";
    let sid: number = -1;
    // Query space permits a type-only import of an original runtime declaration.
    // Resolve from the root, not a terminal name shared by unrelated query paths.
    for (const ref of this.binding.references) if (ref.module == module && ref.node == id && ref.name == names[0] && ref.space == "query" && !ref.deferred) { sid = ref.target; break; }
    if (sid < 0) { this.report(module,id,"No se pudo resolver typeof '" + text + "'"); return "!error"; }
    let symbols: number[] = [sid]; let value: string = "";
    for (let part: number = 1; part < names.length; part = part+1) {
      if (sid >= 0 && this.binding.symbols[sid].namespaceModule >= 0) {
        const dependency: number = this.binding.symbols[sid].namespaceModule; let next: number = -1;
        for (const entry of this.binding.exports) if (entry.module == dependency && entry.name == names[part]) next = this.origin(entry.symbol);
        sid = next; symbols.push(sid);
        if (sid < 0 || (!this.binding.symbols[sid].values && (this.binding.symbols[sid].namespaceModule) < 0)) { this.report(module,id,"typeof requiere un miembro con declaración de valor: '" + names[part] + "'"); return "!error"; }
      } else {
        if (sid >= 0) value = this.symbolType(sid,module,id);
        symbols.push(this.memberSymbol(memoryValue(value),names[part]));
        value = this.member(module,id,value,names[part],true); sid = -1;
      }
    }
    if (sid >= 0) {
      if (this.binding.symbols[sid].namespaceModule >= 0) { this.report(module,id,"typeof requiere un valor; un namespace necesita un miembro"); return "!error"; }
      value = this.symbolType(sid,module,id);
    }
    if (value != "!error") {
      let present: boolean = false;
      for (const query of this.result.queries) if (query.module == module && query.node == id && query.text == text) present = true;
      if (!present) this.result.queries.push(new NativeTypeQuery(module,id,text,value,symbols));
    }
    return value;
  }
  reference(module: number, id: number): number {
    for (const ref of this.binding.references) if (ref.module == module && ref.node == id && ref.space == "value" && !ref.deferred) return ref.target;
    return -1;
  }
  nominal(sid: number): string { return "#" + numberToString(sid); }
  flowType(sid: number, module: number, id: number): string {
    for (let at: number = this.narrowedSymbols.length - 1; at >= 0; at = at - 1) if (this.narrowedSymbols[at] == sid) return this.narrowedTypes[at];
    const declared: string = this.symbolType(sid,module,id);
    if (sid >= 0) { const s = this.binding.symbols[sid]; if (s.kind == "VariableDeclaration" && this.node(s.module,s.node).get("mutable") != "true") { const init: number = bindingChild(this.node(s.module,s.node),"initializer"); if (init >= 0 && genericBase(this.result.files[s.module].types[init]) == "variant") return this.result.files[s.module].types[init]; } }
    return declared;
  }
  alwaysReturns(module: number, id: number): boolean {
    if (id < 0) return false; const n: AstNode = this.node(module,id);
    if (n.kind == "ReturnStatement") return true;
    if (n.kind == "BlockStatement") { for (const edge of n.edges) if (edge.role == "statements" && this.alwaysReturns(module,edge.node)) return true; }
    if (n.kind == "IfStatement") return this.alwaysReturns(module,bindingChild(n,"thenBranch")) && this.alwaysReturns(module,bindingChild(n,"elseBranch"));
    return false;
  }
  affectsFacts(module: number, id: number): boolean {
    if (id < 0) return false; const n: AstNode = this.node(module,id);
    if (callableBinding(n.kind) || n.kind == "ClassDeclaration") return false;
    if (["CallExpression","MemberCallExpression","NewExpression","AssignmentExpression","CompoundAssignmentExpression"].includes(n.kind)) return true;
    for (const edge of n.edges) if (this.affectsFacts(module,edge.node)) return true;
    return false;
  }
  afterIf(module: number, condition: number, yes: number, no: number): void {
    if (this.alwaysReturns(module,yes) && !this.alwaysReturns(module,no)) {
      if (!this.affectsFacts(module,no)) { this.narrowCondition(module,condition,false); return; }
    } else if (this.alwaysReturns(module,no) && !this.alwaysReturns(module,yes)) {
      if (!this.affectsFacts(module,yes)) { this.narrowCondition(module,condition,true); return; }
    } else if (!this.affectsFacts(module,yes) && !this.affectsFacts(module,no)) return;
    this.narrowedSymbols = []; this.narrowedTypes = [];
  }
  narrowCondition(module: number, id: number, truth: boolean): void {
    if (id < 0) return; const n: AstNode = this.node(module,id);
    if (n.kind == "UnaryExpression" && n.get("operator") == "!") { this.narrowCondition(module,bindingChild(n,"operand"),!truth); return; }
    if (n.kind == "BinaryExpression" && ((n.get("operator") == "&&" && truth) || (n.get("operator") == "||" && !truth))) { this.narrowCondition(module,bindingChild(n,"left"),truth); this.narrowCondition(module,bindingChild(n,"right"),truth); return; }
    if (n.kind == "BinaryExpression" && n.get("operator") == "instanceof") {
      const source: number = bindingChild(n,"left"); if (this.node(module,source).kind != "IdentifierExpression") return;
      const sid: number = this.reference(module,source); const receiver: string = this.result.files[module].types[bindingChild(n,"right")]; const target: number = this.nominalSymbol(receiver.slice(6,receiver.length));
      let parts: string[] = []; for (const part of splitTypes(this.flowType(sid,module,id),"|")) if ((this.nominalSymbol(part) == target) == truth) parts.push(part);
      this.narrowedSymbols.push(sid); this.narrowedTypes.push(parts.length == 0 ? "!never" : parts.join("|")); return;
    }
    let member: number = id; let key: string = "boolean:true";
    if (n.kind == "BinaryExpression" && ["==","!=","===","!=="].includes(n.get("operator"))) {
      member = bindingChild(n,"left"); let literal: number = bindingChild(n,"right");
      if (this.node(module,member).kind != "MemberExpression") { member = bindingChild(n,"right"); literal = bindingChild(n,"left"); }
      key = this.caseKey(module,literal,[]);
      if (n.get("operator") == "!=" || n.get("operator") == "!==") truth = !truth;
    }
    const access: AstNode = this.node(module,member); if (access.kind != "MemberExpression" || key == "") return;
    const object: number = bindingChild(access,"object"); if (this.node(module,object).kind != "IdentifierExpression") return;
    const sid: number = this.reference(module,object); const valueType: string = this.flowType(sid,module,id); let parts: string[] = [];
    for (const alternative of splitTypes(valueType,"|")) {
    const owner: number = this.nominalSymbol(alternative);
    if (owner < 0 || this.binding.symbols[owner].kind != "UnionDeclaration") continue;
    const declaration = this.binding.symbols[owner]; const base: string = genericBase(alternative) == "variant" ? genericArguments(alternative)[0] : alternative;
    const current: string = genericBase(alternative) == "variant" ? genericArguments(alternative)[1] : "";
    for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == "variants" && (current == "" || current == numberToString(edge.node))) {
      const variant: AstNode = this.node(declaration.module,edge.node); const discriminator: number = bindingChild(variant,"discriminator"); let value: string = "";
      if (access.get("member") == "kind") value = "string:" + variant.get("name");
      if (discriminator >= 0) { const d: AstNode = this.node(declaration.module,discriminator); if (d.get("field") == access.get("member")) value = d.get("literalType") + ":" + d.get("value"); }
      if (value == "") { parts.push(alternative); break; }
      if ((value == key) == truth) parts.push("variant<" + base + "," + numberToString(edge.node) + ">");
    }
    }
    this.narrowedSymbols.push(sid); this.narrowedTypes.push(parts.length == 0 ? "!never" : parts.join("|"));
  }
  nominalSymbol(text: string): number {
    if (genericBase(text) == "variant") return this.nominalSymbol(genericArguments(text)[0]);
    const open: number = text.indexOf("<",0); const base: string = open >= 0 ? text.slice(0,open) : text;
    for (let i: number = 0; i < this.binding.symbols.length; i = i + 1) if (this.nominal(i) == base) return i; return -1;
  }
  genericParameters(sid: number): number[] {
    let result: number[] = []; const s = this.binding.symbols[sid]; if ((s.module) < 0) return result;
    for (const e of this.node(s.module,s.node).edges) if (e.role == "typeParameters") result.push(e.node); return result;
  }
  instantiateMember(receiver: string, text: string): string {
    const value: string = receiver.startsWith("class:") ? receiver.slice(6,receiver.length) : memoryValue(receiver);
    const sid: number = this.nominalSymbol(value); const open: number = value.indexOf("<",0);
    if (sid < 0 || open < 0) return text;
    const s = this.binding.symbols[sid]; const params: number[] = this.genericParameters(sid); const args: string[] = splitTypes(value.slice(open+1,value.length-1),",");
    let result: string = text;
    for (let i: number = 0; i < params.length && i < args.length; i = i + 1) result = replaceType(result,"@" + numberToString(this.binding.files[s.module].declarations[params[i]]),args[i]);
    return result;
  }
  instantiateType(module: number, id: number, sid: number, inputs: string[]): string {
    const s = this.binding.symbols[sid]; const parameters: number[] = this.genericParameters(sid); let values: string[] = inputs;
    if (values.length > parameters.length) { this.report(module,id,"Demasiados argumentos de tipo"); return "!error"; }
    for (let i: number = 0; i < parameters.length; i = i + 1) {
      const parameter: AstNode = this.node(s.module,parameters[i]);
      if (parameter.get("variadic") == "true") return this.unsupported(module,id,"pack de tipos en una instancia nominal");
      if (i >= values.length || values[i] == "") {
        if (parameter.get("default") == "") { this.report(module,id,"Falta un argumento de tipo para '" + parameter.get("name") + "'"); return "!error"; }
        let value: string = this.annotation(s.module,parameters[i],parameter.get("default"));
        for (let p: number = 0; p < i; p = p + 1) value = replaceType(value,"@" + numberToString(this.binding.files[s.module].declarations[parameters[p]]),values[p]);
        if (i >= values.length) values.push(value); else values[i] = value;
      }
      if (parameter.get("constraint") != "") {
        let constraint: string = this.annotation(s.module,parameters[i],parameter.get("constraint"));
        for (let p: number = 0; p <= i; p = p + 1) constraint = replaceType(constraint,"@" + numberToString(this.binding.files[s.module].declarations[parameters[p]]),values[p]);
        if (!this.compatible(values[i],constraint)) this.report(module,id,"El argumento no satisface la restricción genérica");
      }
    }
    if (s.kind == "TypeAliasDeclaration") {
      let result: string = this.symbolType(sid,module,id);
      for (let i: number = 0; i < parameters.length; i = i + 1) result = replaceType(result,"@" + numberToString(this.binding.files[s.module].declarations[parameters[i]]),values[i]);
      return result;
    }
    return this.nominal(sid) + (values.length == 0 ? "" : "<" + values.join(",") + ">");
  }
  annotation(module: number, id: number, input: string): string {
    if ((this.depth) > 128) { this.report(module,id,"Límite de resolución de tipos excedido"); return "!error"; }
    this.depth = this.depth + 1; const result: string = this.annotationInner(module, id, input.trim()); this.depth = this.depth - 1; return result;
  }
  annotationInner(module: number, id: number, text: string): string {
    if (text == "") return "";
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
    if (unions.length > 1) {
      let parts: string[] = [];
      for (const p of unions) { const part: string = this.annotation(module,id,p); if (functionClose(part) >= 0) return this.unsupported(module,id,"composición de unions con callables"); parts.push(part); }
      return parts.join("|");
    }
    const intersection: string[] = splitTypes(text,"&");
    if (intersection.length > 1) {
      let parts: string[] = []; for (const p of intersection) {
        const part: string = this.annotation(module,id,p); const sid: number = this.nominalSymbol(part);
        if (sid < 0 || !["ClassDeclaration","InterfaceDeclaration"].includes(this.binding.symbols[sid].kind)) this.report(module,id,"Una intersección requiere contratos de clase o interfaz");
        parts.push(part);
      } return parts.join("&");
    }
    if (text.endsWith("[]")) return semanticArray(this.annotation(module,id,semanticElement(text)));
    if (semanticTuple(text)) {
      let parts: string[] = []; for (const p of splitTypes(text.slice(1,text.length-1),",")) parts.push(this.annotation(module,id,p)); return "[" + parts.join(",") + "]";
    }
    if (text.startsWith("Array<") && text.endsWith(">")) return semanticArray(this.annotation(module,id,text.slice(6,text.length-1)));
    if (text.endsWith("]") && text.lastIndexOf("[") > 0) {
      const open: number = text.lastIndexOf("["); const raw: string = text.slice(open+1,text.length-1);
      let extent: string = nativeIntegerText(raw);
      if (extent == "") {
        let sid: number = this.lookup(this.binding.files[module].nodeScopes[id],raw,false); let seen: number[] = [];
        while (sid >= 0 && !seen.includes(sid)) {
          seen.push(sid); const s = this.binding.symbols[sid];
          if ((s.module) < 0 || s.kind != "VariableDeclaration") break;
          const declaration: AstNode = this.node(s.module,s.node); if (declaration.get("mutable") == "true") break;
          const init: number = bindingChild(declaration,"initializer"); if (init < 0) break;
          const value: AstNode = this.node(s.module,init);
          if (value.kind == "LiteralExpression" && value.get("literalType") == "number") { extent = nativeIntegerText(value.get("raw")); break; }
          if (value.kind == "IdentifierExpression") sid = this.origin(this.reference(s.module,init)); else sid = -1;
        }
      }
      const size = nativeNumericLiteral(extent);
      if (extent == "" || !size.valid || size.value <= 0 || size.value > 2147483647) { this.report(module,id,"Tamaño de array fijo fuera de rango; requiere constante entera positiva hasta 2147483647"); return "!error"; }
      const element: string = this.annotation(module,id,text.slice(0,open));
      if (element == "void") this.report(module,id,"Un array fijo no puede contener void");
      return semanticFixedArray(element,size.value);
    }
    if (text.startsWith("$typeof$")) return this.queryType(module,id,text.slice(8,text.length));
    const generic: number = text.indexOf("<",0);
    if (generic > 0 && text.endsWith(">")) {
      const sid: number = this.qualifiedType(module,id,text.slice(0,generic));
      if (sid >= 0 && ["ClassDeclaration","TypeAliasDeclaration","UnionDeclaration"].includes(this.binding.symbols[sid].kind)) {
        let inputs: string[] = []; for (const raw of splitTypes(text.slice(generic+1,text.length-1),",")) inputs.push(this.annotation(module,id,raw));
        return this.instantiateType(module,id,sid,inputs);
      }
      if (sid >= 0 && this.binding.symbols[sid].kind == "builtin-type" && ["Optional","Result","Promise","Map","Set"].includes(this.binding.symbols[sid].name)) {
        const name: string = this.binding.symbols[sid].name; let inputs: string[] = [];
        for (const raw of splitTypes(text.slice(generic+1,text.length-1),",")) inputs.push(this.annotation(module,id,raw));
        if (name == "Result" && inputs.length == 1) inputs.push("string");
        const count: number = name == "Map" || name == "Result" ? 2 : 1;
        if (inputs.length != count) { this.report(module,id,"Aridad de tipo incorrecta para " + name); return "!error"; }
        return name + "<" + inputs.join(",") + ">";
      }
    }
    if (generic >= 0 || text.indexOf("[",0) >= 0) return this.unsupported(module,id,"tipo " + text);
    const sid: number = this.qualifiedType(module,id,text);
    if (sid < 0) { this.report(module,id,"No se pudo resolver el tipo '" + text + "'"); return "!error"; }
    const s: BindingSymbol = this.binding.symbols[sid];
    if (s.kind == "TypeParameter") return "@" + numberToString(sid);
    if (["ClassDeclaration","TypeAliasDeclaration","UnionDeclaration"].includes(s.kind) && this.genericParameters(sid).length > 0) { let empty: string[] = []; return this.instantiateType(module,id,sid,empty); }
    if (s.kind == "TypeAliasDeclaration") return this.symbolType(sid,module,id);
    if (["ClassDeclaration","InterfaceDeclaration","EnumDeclaration","UnionDeclaration"].includes(s.kind)) return this.nominal(sid);
    if (s.kind == "builtin-type" && ["JsonValue","FileReader","TcpListener","TcpConnection","TlsContext","TlsConnection","CancellationSource","CancellationToken","Request","Response","Server","HttpClientResponse","Timer","FsWatcher","FsEvent","Console"].includes(s.name)) return s.name;
    return this.unsupported(module,id,"tipo " + text);
  }
  asynchronous(module: number, id: number): boolean {
    const n: AstNode = this.node(module,id); return n.get("async") == "true" || n.get("isAsync") == "true";
  }
  suspensionContext(module: number, id: number): void {
    let at: number = this.binding.files[module].parents[id];
    while (at >= 0) {
      const n: AstNode = this.node(module,at); if (callableBinding(n.kind)) return;
      if (n.kind == "ClassField") { this.report(module,id,"E4204: suspender en un inicializador de campo requiere un contrato de duración del constructor"); return; }
      at = this.binding.files[module].parents[at];
    }
  }
  awaitContext(module: number, id: number): void {
    this.suspensionContext(module,id);
    let at: number = this.binding.files[module].parents[id];
    while (at >= 0) {
      const n: AstNode = this.node(module,at);
      if (n.kind == "Parameter") { this.report(module,id,"await no es válido en un default de parámetro"); return; }
      if (callableBinding(n.kind)) { if (!this.asynchronous(module,at)) this.report(module,id,"await sólo es válido dentro de async o en el nivel superior"); return; }
      at = this.binding.files[module].parents[at];
    }
  }
  signature(module: number, id: number): string {
    const n: AstNode = this.node(module,id); let params: string[] = [];
    for (const e of n.edges) if (e.role == "params") {
      let value: string = this.parameterType(module,e.node); const rest: boolean = this.node(module,e.node).get("variadic") == "true";
      if (rest && genericBase(value) == "pack") value = genericArguments(value)[0];
      params.push((rest ? "..." : "") + value);
    }
    let returns: string = this.annotation(module,id,n.get("returnType"));
    if (returns == "") {
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes; this.narrowedSymbols = []; this.narrowedTypes = [];
      const body: number = bindingChild(n,"body");
      if (body >= 0 && this.node(module,body).kind == "BlockStatement") {
        let values: string[] = []; this.inferReturns(module,body,values);
        if (values.length == 0) returns = "void"; else returns = values.join("|");
      } else returns = this.expression(module,body,"");
      this.narrowedSymbols = symbols; this.narrowedTypes = types;
    }
    if (this.asynchronous(module,id)) {
      if (n.get("returnType") == "") returns = "Promise<" + returns + ">";
      else if (genericBase(returns) != "Promise") this.report(module,id,"Una función async debe retornar Promise<T>");
    }
    return "(" + params.join(",") + ")=>" + returns;
  }
  inferReturns(module: number, id: number, out values: string[]): void {
    const n: AstNode = this.node(module,id);
    // Nested callables own their returns; they cannot determine this signature.
    if (callableBinding(n.kind) || n.kind == "ClassDeclaration") return;
    if (["CallExpression","MemberCallExpression","NewExpression","AssignmentExpression","CompoundAssignmentExpression"].includes(n.kind)) { this.narrowedSymbols = []; this.narrowedTypes = []; return; }
    if (n.kind == "IfStatement") {
      const condition: number = bindingChild(n,"condition"); this.expression(module,condition,"");
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes;
      this.narrowCondition(module,condition,true); const yes: number = bindingChild(n,"thenBranch"); if (yes >= 0) this.inferReturns(module,yes,values);
      this.narrowedSymbols = symbols; this.narrowedTypes = types; this.narrowCondition(module,condition,false);
      const no: number = bindingChild(n,"elseBranch"); if (no >= 0) this.inferReturns(module,no,values);
      this.narrowedSymbols = symbols; this.narrowedTypes = types;
      this.afterIf(module,condition,yes,no);
      return;
    }
    if (n.kind == "ReturnStatement") {
      const value: string = this.expression(module,bindingChild(n,"value"),"");
      if (!values.includes(value)) values.push(value);
      return;
    }
    for (const edge of n.edges) this.inferReturns(module,edge.node,values);
  }
  parameterType(module: number, id: number): string {
    const n: AstNode = this.node(module,id); const text: string = this.annotation(module,id,n.get("type"));
    if (n.get("variadic") == "true" && this.packToken(text)) return "pack<" + text + ">";
    return n.get("optional") == "true" && genericBase(text) != "Optional" ? "Optional<" + text + ">" : text;
  }
  transferType(text: string): boolean {
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
      const field = this.binding.symbols[sid];
      if (["ClassField","InterfaceField","UnionVariant"].includes(field.kind) && this.result.symbolTypes[sid] == "" && this.symbolStates[sid] != 1) this.symbolType(sid,field.module,field.node);
    }
    return resourceType(this.graph,this.binding,this.result.symbolTypes,text,[]);
  }
  packToken(text: string): boolean {
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) if (text == "@" + numberToString(sid)) {
      const symbol = this.binding.symbols[sid]; return symbol.kind == "TypeParameter" && this.node(symbol.module,symbol.node).get("variadic") == "true";
    }
    return false;
  }
  packActuals(module: number, args: number[], actual: string[], positions: number[], rest: number): string[] {
    let values: string[] = [];
    for (let at: number = 0; at < args.length; at = at + 1) if (positions[at] == rest) {
      if (genericBase(actual[at]) == "pack") { for (const item of genericArguments(actual[at])) values.push(item); }
      else if (this.node(module,args[at]).kind == "SpreadElement") {
        if (semanticTuple(actual[at])) for (const item of splitTypes(actual[at].slice(1,actual[at].length-1),",")) values.push(item);
        else values.push("!invalid-pack-spread");
      } else values.push(actual[at]);
    }
    return values;
  }
  inferToken(pattern: string, actual: string, token: string): string { return resourceSubstitution(pattern,actual,token); }
  packSignature(module: number, id: number, ownerModule: number, candidate: number, args: number[], actual: string[], positions: number[], expected: string): string {
    const declaration: AstNode = this.node(ownerModule,candidate); let signature: string = this.signature(ownerModule,candidate);
    const parameters: string[] = functionParams(signature); const rest: number = restPosition(signature); if (rest < 0) return "";
    let genericNodes: number[] = []; let explicitTypes: string[] = [];
    for (const edge of declaration.edges) if (edge.role == "typeParameters") genericNodes.push(edge.node);
    for (const attr of this.node(module,id).attributes) if (attr.name == "typeArgument") explicitTypes.push(this.annotation(module,id,attr.value));
    const values: string[] = this.packActuals(module,args,actual,positions,rest);
    if (values.includes("!invalid-pack-spread")) return "";
    const normal: number = genericNodes.length-1;
    if (explicitTypes.length > 0 && (explicitTypes.length) < normal) return "";
    for (let g: number = 0; g < genericNodes.length; g = g + 1) {
      const parameter: AstNode = this.node(ownerModule,genericNodes[g]); const token: string = "@" + numberToString(this.binding.files[ownerModule].declarations[genericNodes[g]]); let value: string = "";
      if (parameter.get("variadic") == "true") {
        let elements: string[] = values;
        if (explicitTypes.length > 0) { elements = []; for (let at: number = normal; at < explicitTypes.length; at = at + 1) elements.push(explicitTypes[at]); }
        if (elements.length != values.length) return "";
        for (let at: number = 0; at < values.length; at = at + 1) if (!this.compatible(values[at],elements[at])) return "";
        value = "pack<" + elements.join(",") + ">";
      } else {
        if (g < explicitTypes.length) value = explicitTypes[g];
        else for (let at: number = 0; at < args.length; at = at + 1) {
          const position: number = positions[at]; if (position < 0 || position >= rest) continue;
          const inferred: string = this.inferToken(parameters[position],actual[at],token);
          if (inferred != "") { if (value != "" && value != inferred) return ""; value = inferred; }
        }
        if (value == "" && expected != "") value = this.inferToken(functionReturn(signature),expected,token);
        if (value == "" && parameter.get("default") != "") value = this.annotation(ownerModule,genericNodes[g],parameter.get("default"));
        if (value == "") return "";
        if (parameter.get("constraint") != "" && !this.compatible(value,this.annotation(ownerModule,genericNodes[g],parameter.get("constraint")))) return "";
      }
      if (containsMemory(value) || this.transferType(value)) { this.report(module,id,"E4203: un pack genérico no puede ocultar transferencia de ownership o préstamos"); return ""; }
      signature = replaceType(signature,token,value);
    }
    const instantiated: string[] = functionParams(signature); let at: number = 0;
    for (const edge of declaration.edges) if (edge.role == "params") {
      const parameter: AstNode = this.node(ownerModule,edge.node);
      if (at != rest && parameter.get("optional") != "true" && bindingChild(parameter,"defaultValue") < 0 && !positions.includes(at)) return "";
      at = at + 1;
    }
    let used: number[] = [];
    for (let a: number = 0; a < args.length; a = a + 1) {
      const position: number = positions[a]; if (position < 0 || position > rest) return "";
      if (position == rest) { if (this.node(module,args[a]).kind == "NamedArgumentExpression") return ""; continue; }
      if (used.includes(position) || this.node(module,args[a]).kind == "SpreadElement") return ""; used.push(position);
      let target: string = instantiated[position];
      if (this.optionalParameter(ownerModule,candidate,position) && genericBase(target) == "Optional" && genericBase(actual[a]) != "Optional") target = genericArguments(target)[0];
      if (!this.compatible(actual[a],target)) return "";
    }
    return signature;
  }
  optionalParameter(module: number, id: number, position: number): boolean {
    let at: number = 0; for (const e of this.node(module,id).edges) if (e.role == "params") { if (at == position) return this.node(module,e.node).get("optional") == "true"; at = at + 1; } return false;
  }
  argumentPosition(module: number, declaration: number, sourceModule: number, argument: number, position: number): number {
    const n: AstNode = this.node(sourceModule,argument);
    if (n.kind != "NamedArgumentExpression") {
      const rest: number = restPosition(this.signature(module,declaration));
      return rest >= 0 && position >= rest ? rest : position;
    }
    let at: number = 0;
    for (const edge of this.node(module,declaration).edges) if (edge.role == "params") {
      if (this.node(module,edge.node).get("name") == n.get("name")) return at;
      at = at + 1;
    } return -1;
  }
  argumentValue(module: number, id: number): number {
    const n: AstNode = this.node(module,id);
    if (n.kind == "NamedArgumentExpression") return bindingChild(n,"value");
    if (n.kind == "SpreadElement") return bindingChild(n,"expression");
    return id;
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
      else if (["ClassDeclaration","EnumDeclaration","UnionDeclaration"].includes(s.kind)) valueType = "class:" + this.nominal(target);
      else if (s.kind == "UnionVariant") {
        const owner: number = this.binding.files[s.module].parents[s.node]; const unionSymbol: number = this.binding.files[s.module].declarations[owner]; let inputs: string[] = [];
        for (const p of this.genericParameters(unionSymbol)) inputs.push("@" + numberToString(this.binding.files[s.module].declarations[p]));
        const base: string = this.nominal(unionSymbol) + (inputs.length == 0 ? "" : "<" + inputs.join(",") + ">");
        const payload: string = this.annotation(s.module,s.node,n.get("payload"));
        valueType = "(" + payload + ")=>variant<" + base + "," + numberToString(s.node) + ">";
      }
      else if (s.kind == "EnumMember") {
        const owner: number = this.binding.scopes[s.scope].node; valueType = this.nominal(this.binding.files[s.module].declarations[owner]);
      }
      else if (s.kind == "InterfaceDeclaration") valueType = this.nominal(target);
      else if (s.kind == "TypeParameter") valueType = "@" + numberToString(target);
      else if (s.kind == "ArrayBinding" || s.kind == "ObjectBinding") {
        this.destructure(s.module,this.binding.files[s.module].parents[s.node]); valueType = this.result.symbolTypes[target];
        if (valueType == "") valueType = "!error";
      }
      else if (s.kind == "receiver") {
        let scope: number = s.scope;
        while (scope >= 0 && this.binding.scopes[scope].kind != "ClassDeclaration") scope = this.binding.scopes[scope].parent;
        if (scope >= 0) valueType = this.nominal(this.binding.files[s.module].declarations[this.binding.scopes[scope].node]);
      } else if (s.kind == "TypeAliasDeclaration") valueType = this.annotation(s.module,s.node,n.get("type"));
      else if (s.kind == "VariableDeclaration" || s.kind == "UsingDeclaration") {
        valueType = this.annotation(s.module,s.node,n.get("declaredType"));
        if (valueType == "") valueType = this.expression(s.module,bindingChild(n,"initializer"),"");
        if (genericBase(valueType) == "variant") valueType = genericArguments(valueType)[0];
      } else if (s.kind == "Parameter" || s.kind == "ClassField" || s.kind == "InterfaceField" || s.kind == "UnionVariantBinding") { if (n.kind == "Parameter") valueType = this.parameterType(s.module,s.node); else valueType = this.annotation(s.module,s.node,n.get("type")); }
      else if (s.namespaceModule >= 0) valueType = "namespace";
      else if (s.kind.endsWith("Expression")) valueType = this.expression(s.module,s.node,"");
      else valueType = this.unsupported(useModule,useNode,"símbolo " + s.kind);
    }
    this.result.symbolTypes[target] = valueType; this.symbolStates[target] = 2; return valueType;
  }
  builtin(name: string): string {
    if (numericType(name)) return "!cast:" + name;
    if (name == "comptime") return "!comptime";
    if (name == "match") return "!match";
    if (["when","whenType","otherwise"].includes(name)) return "!matchCase";
    if (name == "print" || name == "printError" || name == "write" || name == "writeError") return "!print";
    if (name == "numberToString") return "(number)=>string";
    if (name == "argument") return "(number)=>string";
    if (name == "argumentCount") return "()=>number";
    if (name == "sleep") return "(number)=>Promise<void>";
    if (["all","race","promiseAll","promiseRace"].includes(name)) return "!tasks:" + name;
    if (name == "spawn") return "(Promise<void>)=>void";
    if (name == "exitProcess") return "(number)=>void";
    if (name == "move" || name == "ref" || name == "constRef") return "!" + name;
    if (name == "length") return "!length";
    if (["Math","JSON","Date"].includes(name)) return "!" + name;
    if (name == "console") return "Console";
    if (name == "charAt" || name == "lineAt") return "(string,number)=>string";
    if (name == "substring") return "(string,number,number)=>string";
    if (name == "indexOf") return "(string,string,number)=>number";
    if (name == "startsWith") return "(string,string)=>boolean";
    if (name == "trim" || name == "jsonEscape") return "(string)=>string";
    if (name == "lineCount") return "(string)=>number";
    if (name == "readFile") return "(string)=>Result<string,string>";
    if (["writeFile","appendFile","copyFile","moveFile"].includes(name)) return "(string,string)=>Result<boolean,string>";
    if (name == "removeFile") return "(string)=>Result<boolean,string>";
    if (name == "fileExists") return "(string)=>boolean";
    if (["jsonIsString","jsonIsNumber","jsonIsBool","jsonIsArray","jsonIsObject","jsonIsNull"].includes(name)) return "(JsonValue)=>boolean";
    if (name == "jsonAsString") return "(JsonValue)=>string";
    if (name == "jsonAsNumber" || name == "jsonArrayLength") return "(JsonValue)=>number";
    if (name == "jsonAsBool") return "(JsonValue)=>boolean";
    if (name == "jsonArrayGet") return "(JsonValue,number)=>JsonValue";
    if (name == "jsonObjectGet") return "(JsonValue,string)=>JsonValue";
    if (["optionalSome","optionalNone","optionalIsPresent","optionalValueOr","optionalOrElse","resultOk","resultErr","resultIsOk","resultValueOr","ok","err"].includes(name)) return "!container:" + name;
    return "!error";
  }
  memberSymbol(valueType: string, name: string): number {
    let receiver: string = memoryValue(valueType); if (receiver.startsWith("class:")) receiver = receiver.slice(6,receiver.length);
    const parts: string[] = splitTypes(receiver,"&");
    if (parts.length > 1) { for (const part of parts) { const found: number = this.memberSymbol(part,name); if (found >= 0) return found; } return -1; }
    const owner: number = this.nominalSymbol(receiver); if (owner < 0) return -1;
    const s: BindingSymbol = this.binding.symbols[owner];
    for (let i: number = 0; i < this.binding.symbols.length; i = i + 1) {
      const item: BindingSymbol = this.binding.symbols[i];
      if (item.name == name && item.module == s.module && item.scope >= 0 && this.binding.scopes[item.scope].node == s.node) return i;
    } return -1;
  }
  member(module: number, id: number, input: string, name: string, query: boolean = false): string {
    const boundType: string = this.parameterBound(memoryValue(input));
    const valueType: string = boundType == "" ? memoryValue(input) : boundType;
    const bound: number = query ? -1 : this.reference(module,id); if (bound >= 0) { this.result.files[module].members[id] = bound; return this.symbolType(bound,module,id); }
    if (valueType == "!error") return valueType;
    if (valueType == "!never") return "!error";
    const alternatives: string[] = splitTypes(valueType,"|");
    if (alternatives.length > 1) {
      let values: string[] = []; for (const alternative of alternatives) { const found: string = this.member(module,id,alternative,name,query); if (!values.includes(found)) values.push(found); } return values.join("|");
    }
    if (valueType.startsWith("class:")) {
      const receiver: string = valueType.slice(6,valueType.length); const owner: number = this.nominalSymbol(receiver);
      if (owner >= 0 && this.binding.symbols[owner].kind == "UnionDeclaration") {
        const declaration = this.binding.symbols[owner];
        for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == "variants" && this.node(declaration.module,edge.node).get("name") == name) {
          const sid: number = this.binding.files[declaration.module].declarations[edge.node]; if (!query) this.result.files[module].members[id] = sid;
          return this.instantiateMember(receiver,this.symbolType(sid,module,id));
        }
        this.report(module,id,"La unión no declara la variante '" + name + "'"); return "!error";
      }
    }
    const unionOwner: number = this.nominalSymbol(valueType);
    if (unionOwner >= 0 && this.binding.symbols[unionOwner].kind == "UnionDeclaration") {
      const declaration = this.binding.symbols[unionOwner]; const refinement: string[] = genericBase(valueType) == "variant" ? genericArguments(valueType) : [];
      const base: string = refinement.length > 0 ? refinement[0] : valueType; let values: string[] = []; let selectedMember: number = -1;
      for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == "variants" && (refinement.length == 0 || refinement[1] == numberToString(edge.node))) {
        const variant: AstNode = this.node(declaration.module,edge.node); let found: string = "";
        const discriminator: number = bindingChild(variant,"discriminator");
        if (name == "kind") found = "string";
        if (discriminator >= 0 && this.node(declaration.module,discriminator).get("field") == name) found = this.node(declaration.module,discriminator).get("literalType");
        let bindings: number = 0;
        for (const field of variant.edges) if (field.role == "bindings") {
          bindings = bindings + 1;
          if (this.node(declaration.module,field.node).get("name") == name) { selectedMember = this.binding.files[declaration.module].declarations[field.node]; found = this.instantiateMember(base,this.symbolType(selectedMember,module,id)); }
        }
        if (name == "value" && bindings == 0 && variant.get("payload") != "") found = this.instantiateMember(base,this.annotation(declaration.module,edge.node,variant.get("payload")));
        if (found == "") { this.report(module,id,"El miembro '" + name + "' requiere narrowing a una variante que lo declare"); return "!error"; }
        if (!values.includes(found)) values.push(found);
      }
      if (refinement.length > 0 && !query) this.result.files[module].members[id] = selectedMember;
      return values.length == 0 ? "!error" : values.join("|");
    }
    if (valueType == "!Math") {
      if (["PI","E"].includes(name)) return "number";
      if (["floor","ceil","round","abs","sqrt"].includes(name)) return "(number)=>number";
      if (["pow","min","max"].includes(name)) return "(number,number)=>number";
      if (name == "random") return "()=>number";
    }
    if (valueType == "!JSON") {
      if (name == "parse" || name == "stringify") return "(string)=>string";
      if (name == "parseValue") return "(string)=>JsonValue";
      if (name == "stringifyNumber") return "(number)=>string";
      if (name == "stringifyBool") return "(boolean)=>string";
      if (name == "stringifyValue") return "(JsonValue)=>string";
    }
    if (valueType == "!Date") { if (name == "now") return "()=>number"; if (name == "utc") return "(number,number,number)=>number"; }
    if (valueType == "Console" && ["log","info","debug","trace","warn","error"].includes(name)) return "!consoleLog";
    if (name == "length" && (valueType == "string" || valueType.endsWith("[]") || fixedArraySize(valueType) >= 0)) return "number";
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
      if (["map","filter","reduce","forEach","find","some","every","flatMap","sort","concat"].includes(name)) return "!array." + name;
      if (name == "push") return "(" + element + ")=>void";
      if (name == "pop") return "()=>void";
      if (name == "includes") return "(" + element + ")=>boolean";
      if (name == "join" && element == "string") return "(string)=>string";
      if (name == "slice") return "(number,number)=>" + valueType;
    }
    const container: string = genericBase(valueType); const parts: string[] = genericArguments(valueType);
    if (container == "Map" || container == "Set") {
      if (name == "size") return "number";
      if (name == "forEach") return "!array.forEach";
      if (name == "has" || name == "delete") return "(" + parts[0] + ")=>boolean";
      if (name == "clear") return "()=>void";
      if (container == "Map" && name == "get") return "(" + parts[0] + ")=>" + parts[1] + "|void";
      if (container == "Map" && name == "set") return "(" + parts[0] + "," + parts[1] + ")=>void";
      if (container == "Set" && name == "add") return "(" + parts[0] + ")=>boolean";
    }
    if (container == "Optional" || container == "Result") {
      if (name == "value") return "()=>" + parts[0];
      if (name == "valueOr") return "(" + parts[0] + ")=>" + parts[0];
      if ((container == "Optional" && ["isPresent","isEmpty"].includes(name)) || (container == "Result" && name == "isOk")) return "()=>boolean";
      if (container == "Result" && name == "error") return "()=>" + parts[1];
    }
    const sid: number = this.memberSymbol(valueType,name);
    if (sid < 0) { this.report(module,id,"El tipo '" + valueType + "' no declara el miembro '" + name + "'"); return "!error"; }
    if (!query) this.result.files[module].members[id] = sid;
    const s: BindingSymbol = this.binding.symbols[sid]; const n: AstNode = this.node(s.module,(s.node) < 0 ? this.graph.modules[s.module].cached.result.ast.root : s.node);
    if (((n.get("isStatic") == "true") || s.kind == "EnumMember") != valueType.startsWith("class:")) this.report(module,id,"Receptor estático/de instancia incorrecto para '" + name + "'");
    if (n.get("access") == "private" || n.get("access") == "protected") {
      const owner: number = this.binding.scopes[s.scope].node; let scope: number = this.binding.files[module].nodeScopes[id]; let allowed: boolean = false;
      while (scope >= 0) { if (this.binding.scopes[scope].module == s.module && this.binding.scopes[scope].node == owner) allowed = true; scope = this.binding.scopes[scope].parent; }
      if (!allowed) this.report(module,id,"Miembro privado '" + name + "'");
    }
    return this.instantiateMember(valueType,this.symbolType(sid,module,id));
  }
  methodMutates(sid: number): boolean {
    const s: BindingSymbol = this.binding.symbols[sid]; if ((s.module) < 0 || s.kind != "ClassMethod") return false;
    let work: number[] = []; for (const declaration of s.declarations) work.push(declaration);
    while (work.length > 0) {
      const nodeId: number = work[work.length-1]; const n: AstNode = this.node(s.module,nodeId); work.pop();
      let target: number = -1;
      if (n.kind == "AssignmentExpression" || n.kind == "CompoundAssignmentExpression") target = bindingChild(n,"target");
      else if (n.kind == "MemberCallExpression") target = bindingChild(n,"object");
      else if (n.kind == "CallExpression") { const helper: number = this.reference(s.module,nodeId); if (helper >= 0 && this.binding.symbols[helper].name == "move" && (this.binding.symbols[helper].module) < 0) target = bindingChild(n,"args"); }
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
  constructorInitialization(module: number, id: number, sid: number): boolean {
    const n: AstNode = this.node(module,id); if (n.kind != "MemberExpression") return false;
    const object: number = bindingChild(n,"object"); if (this.node(module,object).kind != "IdentifierExpression" || this.node(module,object).get("name") != "this") return false;
    let scope: number = this.binding.files[module].nodeScopes[id];
    while (scope >= 0) {
      const current = this.binding.scopes[scope];
      if (current.kind == "function" || current.kind == "arrow") return this.node(current.module,current.node).kind == "ClassMethod" && this.node(current.module,current.node).get("name") == "constructor" && current.parent == this.binding.symbols[sid].scope;
      scope = current.parent;
    } return false;
  }
  writableTarget(module: number, id: number, through: boolean): void {
    const n: AstNode = this.node(module,id); let sid: number = this.reference(module,id);
    if (n.get("optional") == "true") this.report(module,id,"El acceso opcional no es un destino asignable");
    if (readonlyType(this.result.files[module].types[id])) this.report(module,id,"E4300: destino readonly");
    if (n.kind == "MemberExpression") {
      sid = this.result.files[module].members[id];
      const object: number = bindingChild(n,"object");
      const receiver: string = memoryValue(this.result.files[module].types[object]);
      const owner: number = this.nominalSymbol(receiver);
      if (owner >= 0 && this.binding.symbols[owner].kind == "UnionDeclaration") {
        const declaration = this.binding.symbols[owner];
        if (n.get("member") == "kind") this.report(module,id,"El discriminador de una unión es inmutable");
        for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == "variants") {
          const discriminator: number = bindingChild(this.node(declaration.module,edge.node),"discriminator");
          if (discriminator >= 0 && this.node(declaration.module,discriminator).get("field") == n.get("member")) this.report(module,id,"El discriminador de una unión es inmutable");
        }
      }
      if ((n.get("member") == "size" && ["Map","Set"].includes(genericBase(receiver))) || (n.get("member") == "length" && (receiver == "string" || receiver.endsWith("[]") || fixedArraySize(receiver) >= 0))) this.report(module,id,"Propiedad de colección readonly");
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
      const variable: boolean = ["VariableDeclaration","ArrayBinding","ObjectBinding","UsingDeclaration"].includes(s.kind);
      const declaration: AstNode = this.node(s.module,s.kind == "ArrayBinding" || s.kind == "ObjectBinding" ? this.binding.files[s.module].parents[s.node] : s.node);
      const initialization: boolean = !through && this.constructorInitialization(module,id,sid);
      if ((variable && declaration.get("mutable") != "true") || (declaration.get("readonly") == "true" && !initialization) || (!variable && s.kind != "ClassField" && s.kind != "Parameter")) this.report(module,id,"Destino inmutable '" + s.name + "'");
      for (const ref of this.binding.references) if (ref.module == module && ref.node == id && ref.symbol >= 0 && this.binding.symbols[ref.symbol].kind == "import") this.report(module,id,"No se puede reasignar un import");
    }
  }
  containerCall(module: number, id: number, helper: string, expected: string): string {
    const n: AstNode = this.node(module,id); let args: number[] = []; let explicitTypes: string[] = [];
    for (const e of n.edges) if (e.role == "args") args.push(e.node);
    for (const a of n.attributes) if (a.name == "typeArgument") explicitTypes.push(this.annotation(module,id,a.value));
    const optional: boolean = helper.startsWith("optional"); const container: string = optional ? "Optional" : "Result";
    const context: string[] = genericBase(expected) == container ? genericArguments(expected) : [];
    let element: string = explicitTypes.length > 0 ? explicitTypes[0] : context.length > 0 ? context[0] : "";
    let errorType: string = explicitTypes.length > 1 ? explicitTypes[1] : context.length > 1 ? context[1] : "string";
    if (explicitTypes.length > (optional ? 1 : 2)) this.report(module,id,"Demasiados argumentos de tipo para helper de contenedor");
    const none: boolean = helper == "optionalNone"; const some: boolean = ["optionalSome","resultOk","ok"].includes(helper); const failure: boolean = ["resultErr","err"].includes(helper);
    const fallback: boolean = ["optionalValueOr","resultValueOr","optionalOrElse"].includes(helper);
    const count: number = none ? 0 : fallback ? 2 : 1;
    if (args.length != count) { this.report(module,id,"Aridad incorrecta para helper de contenedor"); return "!error"; }
    let parameters: string[] = []; let result: string = "!error";
    if (some) {
      const actual: string = this.expression(module,args[0],element); if (element == "") element = actual;
      this.requireType(module,args[0],actual,element); parameters.push(element);
    } else if (failure) {
      this.requireType(module,args[0],this.expression(module,args[0],errorType),errorType); parameters.push(errorType);
      if (element == "") element = "void";
    } else if (!none) {
      const actual: string = this.expression(module,args[0],element == "" ? "" : container + "<" + element + (optional ? "" : "," + errorType) + ">");
      const parts: string[] = genericArguments(actual);
      if (genericBase(actual) != container || parts.length == 0) { this.report(module,args[0],"El helper requiere " + container); return "!error"; }
      if (element != "") this.requireType(module,args[0],parts[0],element); else element = parts[0];
      if (!optional) errorType = parts[1]; parameters.push(actual);
      if (fallback) {
        const target: string = helper == "optionalOrElse" ? actual : element;
        this.requireType(module,args[1],this.expression(module,args[1],target),target); parameters.push(target);
      }
    }
    if (element == "") { this.report(module,id,"No se puede inferir el tipo del contenedor"); return "!error"; }
    if (optional && element == "void") this.report(module,id,"Optional no puede contener void");
    const wrapped: string = container + "<" + element + (optional ? "" : "," + errorType) + ">";
    if (none || some || failure || helper == "optionalOrElse") result = wrapped;
    else if (fallback) result = element; else result = "boolean";
    this.result.files[module].signatures[id] = "(" + parameters.join(",") + ")=>" + result; return result;
  }
  arrayCall(module: number, id: number, method: string, receiver: string): string {
    const n: AstNode = this.node(module,id); const array: string = memoryValue(receiver);
    if (["Map","Set"].includes(genericBase(array)) && method == "forEach") {
      const parts: string[] = genericArguments(array); const parameters: string[] = genericBase(array) == "Map" ? [parts[1],parts[0]] : [parts[0]];
      let count: number = 0; let callbackType: string = "";
      for (const edge of n.edges) if (edge.role == "args") { callbackType = this.expression(module,edge.node,""); this.requireType(module,edge.node,callbackType,"(" + parameters.join(",") + ")=>void"); count = count + 1; }
      if (count != 1) this.report(module,id,"forEach requiere un callback");
      this.result.files[module].signatures[id] = "(" + callbackType + ")=>void"; return "void";
    }
    if (!array.endsWith("[]")) { this.report(module,id,"El método de array requiere un receptor"); return "!error"; }
    const element: string = semanticElement(array); let args: number[] = []; let explicitTypes: string[] = [];
    for (const attr of n.attributes) if (attr.name == "typeArgument") explicitTypes.push(this.annotation(module,id,attr.value));
    if (explicitTypes.length > 1 || (explicitTypes.length > 0 && !["map","flatMap","reduce"].includes(method))) this.report(module,id,"Argumentos de tipo no admitidos para este método de array");
    for (const edge of n.edges) if (edge.role == "args") args.push(edge.node);
    if (method == "concat") {
      let parameters: string[] = [];
      for (const arg of args) { const actual: string = this.expression(module,arg,array); this.requireType(module,arg,actual,array); parameters.push(array); }
      this.result.files[module].signatures[id] = "(" + parameters.join(",") + ")=>" + array; return array;
    }
    const reduce: boolean = method == "reduce"; const sort: boolean = method == "sort";
    if (sort && args.length == 0) { if (!numericType(element) && element != "string") this.report(module,id,"sort sin comparador requiere números o strings"); this.result.files[module].signatures[id] = "()=>" + array; return array; }
    if (args.length != (reduce ? 2 : 1)) {
      for (const arg of args) this.expression(module,arg,""); this.report(module,id,"Aridad incorrecta del método de array"); return "!error";
    }
    let accumulator: string = ""; if (reduce) {
      accumulator = this.expression(module,args[0],explicitTypes.length == 0 ? "" : explicitTypes[0]);
      if (explicitTypes.length > 0) { this.requireType(module,args[0],accumulator,explicitTypes[0]); accumulator = explicitTypes[0]; }
    }
    const callback: number = reduce ? args[1] : args[0];
    const signature: string = this.expression(module,callback,"");
    if (functionClose(signature) < 0) { this.report(module,callback,"El método de array requiere un callback"); return "!error"; }
    const returns: string = functionReturn(signature); let parameters: string[] = [element];
    if (reduce) { parameters = [accumulator,element]; }
    if (sort) parameters = [element,element];
    let expectedReturn: string = returns; if (reduce) expectedReturn = accumulator;
    if (explicitTypes.length > 0 && (method == "map" || method == "flatMap")) expectedReturn = (method == "map" ? explicitTypes[0] : semanticArray(explicitTypes[0]));
    if (["filter","find","some","every"].includes(method)) expectedReturn = "boolean";
    if (method == "forEach") expectedReturn = "void";
    if (sort) expectedReturn = "number";
    const inputs: string[] = functionParams(signature);
    if (inputs.length != parameters.length) this.report(module,callback,"Aridad incorrecta del callback de array");
    for (let at: number = 0; at < inputs.length && at < parameters.length; at = at+1) {
      if (!this.compatible(parameters[at],inputs[at])) this.report(module,callback,"Parámetro de callback incompatible con el elemento de array");
      if (this.transferType(parameters[at]) && !borrowedType(inputs[at]) && !(reduce && at == 0)) this.report(module,callback,"E4101: el callback debe prestar el elemento con ownership");
    }
    if (!this.compatible(returns,expectedReturn)) this.report(module,callback,"Retorno del callback incompatible con el método de array");
    const adapted: string = "(" + parameters.join(",") + ")=>" + expectedReturn;
    if (signature != adapted) this.result.files[module].conversions[callback] = adapted;
    if (["filter","find","sort"].includes(method) && this.transferType(array)) {
      const object: number = bindingChild(n,"object"); const call: AstNode = this.node(module,object); const target: number = this.reference(module,object);
      if (call.kind != "CallExpression" || target < 0 || this.binding.symbols[target].name != "move" || this.binding.symbols[target].module >= 0) this.report(module,id,"E4101: una operación que copia owners requiere consumir el array con move");
    }
    let result: string = array;
    if (method == "map") { if (returns == "void") this.report(module,callback,"map no admite un resultado void"); result = semanticArray(expectedReturn); }
    if (method == "flatMap") { if (!returns.endsWith("[]") || functionClose(returns) >= 0) this.report(module,callback,"flatMap requiere un callback que devuelva un array"); result = expectedReturn; }
    if (method == "find") result = "Optional<" + element + ">";
    if (method == "some" || method == "every") result = "boolean";
    if (method == "forEach") result = "void";
    if (reduce) result = accumulator;
    this.result.files[module].signatures[id] = "(" + (reduce ? accumulator + "," : "") + adapted + ")=>" + result;
    return result;
  }
  matchCall(module: number, id: number): string {
    const n: AstNode = this.node(module,id); let args: number[] = [];
    for (const edge of n.edges) if (edge.role == "args") args.push(edge.node);
    if (args.length != 2 && args.length != 3) { this.report(module,id,"match requiere un subject, discriminador opcional y array de casos"); return "!error"; }
    const subject: string = this.expression(module,args[0],""); let patternType: string = subject;
    if (args.length == 3) {
      const discriminator: AstNode = this.node(module,args[1]);
      if (discriminator.kind != "LiteralExpression" || discriminator.get("literalType") != "string") { this.report(module,args[1],"El discriminador de match debe ser un string literal"); return "!error"; }
      this.expression(module,args[1],"string"); patternType = this.member(module,args[1],subject,discriminator.get("value"));
    }
    const list: number = args[args.length-1]; const cases: AstNode = this.node(module,list);
    if (cases.kind != "ArrayLiteralExpression") { this.report(module,list,"match requiere un array literal de casos"); return "!error"; }
    let results: string[] = []; let patterns: string[] = []; let fallback: boolean = false; let count: number = 0;
    for (const edge of cases.edges) if (edge.role == "elements") {
      const item: AstNode = this.node(module,edge.node); const sid: number = this.reference(module,edge.node); let helper: string = "";
      if (sid >= 0 && (this.binding.symbols[sid].module) < 0) helper = this.binding.symbols[sid].name;
      if (item.kind != "CallExpression" || !["when","whenType","otherwise"].includes(helper)) { this.report(module,edge.node,"Un caso de match requiere when, whenType u otherwise"); continue; }
      let values: number[] = []; for (const value of item.edges) if (value.role == "args") values.push(value.node);
      if (values.length != (helper == "when" ? 2 : 1)) { this.report(module,edge.node,"Aridad incorrecta del caso de match"); continue; }
      if (fallback) this.report(module,edge.node,"otherwise debe ser el último caso de match");
      let input: string = subject; let key: string = "";
      if (helper == "when") {
        this.requireType(module,values[0],this.expression(module,values[0],patternType),patternType); key = this.caseKey(module,values[0],[]);
      } else if (helper == "whenType") {
        let types: string[] = []; for (const attr of item.attributes) if (attr.name == "typeArgument") types.push(this.annotation(module,edge.node,attr.value));
        if (types.length != 1) { this.report(module,edge.node,"whenType requiere exactamente un argumento de tipo"); continue; }
        input = types[0]; key = "type:" + input;
        if (!splitTypes(subject,"|").includes(input)) this.report(module,edge.node,"whenType requiere una alternativa del subject");
      } else fallback = true;
      if (key != "") { if (patterns.includes(key)) this.report(module,edge.node,"Caso de match duplicado"); patterns.push(key); }
      const callback: number = values[values.length-1]; const signature: string = this.expression(module,callback,""); const parameters: string[] = functionParams(signature);
      if (functionClose(signature) < 0 || parameters.length > 1) { this.report(module,callback,"El callback de match requiere cero o un parámetro"); continue; }
      if (parameters.length == 1) this.requireType(module,callback,input,parameters[0]);
      const result: string = functionReturn(signature); if (!results.includes(result)) results.push(result);
      this.result.files[module].types[edge.node] = "!matchCase"; this.result.files[module].signatures[edge.node] = "(" + signature + ")=>!matchCase"; count = count + 1;
    }
    if (count == 0) this.report(module,list,"match requiere al menos un caso");
    this.result.files[module].types[list] = "!matchCase[]"; const result: string = results.length == 0 ? "void" : results.join("|");
    this.result.files[module].signatures[id] = "(" + subject + (args.length == 3 ? ",string" : "") + ",!matchCase[])=>" + result; return result;
  }
  unionCall(module: number, id: number, sid: number, receiver: string, expected: string): string {
    const symbol = this.binding.symbols[sid]; const n: AstNode = this.node(module,id); let args: number[] = [];
    for (const edge of n.edges) if (edge.role == "args") args.push(edge.node);
    const declaration: number = this.binding.files[symbol.module].parents[symbol.node]; const owner: number = this.binding.files[symbol.module].declarations[declaration];
    let base: string = receiver.startsWith("class:") ? receiver.slice(6,receiver.length) : "";
    if (this.nominalSymbol(expected) == owner) { if (genericBase(expected) == "variant") base = genericArguments(expected)[0]; else base = expected; }
    const parameters: number[] = this.genericParameters(owner);
    if (base == "" || (parameters.length > 0 && genericBase(base) == "")) {
      let values: string[] = []; for (const attr of n.attributes) if (attr.name == "typeArgument") values.push(this.annotation(module,id,attr.value));
      if (values.length == 0 && parameters.length > 0 && args.length == 1) {
        const payload: string = this.annotation(symbol.module,symbol.node,this.node(symbol.module,symbol.node).get("payload"));
        for (const parameter of parameters) {
          const token: string = "@" + numberToString(this.binding.files[symbol.module].declarations[parameter]);
          values.push(payload == token ? this.expression(module,args[0],"") : "");
        }
      }
      base = this.instantiateType(module,id,owner,values);
    }
    const signature: string = this.instantiateMember(base,this.symbolType(sid,module,id)); const params: string[] = functionParams(signature);
    if (args.length != params.length) this.report(module,id,"Aridad incorrecta de variante de unión");
    for (let at: number = 0; at < args.length; at = at + 1) {
      const context: string = at < params.length ? params[at] : ""; const actual: string = this.expression(module,args[at],context);
      if (context != "") this.requireType(module,args[at],actual,context);
    }
    this.result.files[module].selected[id] = symbol.node; this.result.files[module].selectedModules[id] = symbol.module; this.result.files[module].signatures[id] = signature;
    return functionReturn(signature);
  }
  unionObject(module: number, id: number, expected: string, owner: number): string {
    const declaration = this.binding.symbols[owner]; const n: AstNode = this.node(module,id); let selected: number = -1;
    const base: string = genericBase(expected) == "variant" ? genericArguments(expected)[0] : expected;
    for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == "variants") {
      const discriminator: number = bindingChild(this.node(declaration.module,edge.node),"discriminator"); if (discriminator < 0) continue;
      const d: AstNode = this.node(declaration.module,discriminator); const key: string = d.get("literalType") + ":" + d.get("value");
      for (const property of n.edges) if (property.role == "properties" && this.node(module,property.node).get("key") == d.get("field") && this.caseKey(module,bindingChild(this.node(module,property.node),"value"),[]) == key) selected = edge.node;
    }
    if (selected < 0) { this.report(module,id,"El objeto no selecciona una variante por un discriminador literal válido"); return "!error"; }
    const result: string = "variant<" + base + "," + numberToString(selected) + ">"; let provided: string[] = [];
    for (const edge of n.edges) if (edge.role == "properties") {
      const p: AstNode = this.node(module,edge.node); const name: string = p.get("key"); const value: number = bindingChild(p,"value");
      if (provided.includes(name)) this.report(module,edge.node,"Campo duplicado '" + name + "'"); provided.push(name);
      const field: string = this.member(module,edge.node,result,name); this.requireType(module,value,this.expression(module,value,field),field);
    }
    for (const field of this.node(declaration.module,selected).edges) if (field.role == "bindings" && !provided.includes(this.node(declaration.module,field.node).get("name"))) this.report(module,id,"Falta el campo requerido '" + this.node(declaration.module,field.node).get("name") + "'");
    return result;
  }
  taskCollectionCall(module: number, id: number, name: string): string {
    this.suspensionContext(module,id);
    const n: AstNode = this.node(module,id); let args: number[] = []; let explicitTypes: string[] = [];
    for (const edge of n.edges) if (edge.role == "args") args.push(edge.node);
    for (const attr of n.attributes) if (attr.name == "typeArgument") explicitTypes.push(this.annotation(module,id,attr.value));
    if (args.length != 1 || explicitTypes.length > 1) { this.report(module,id,"Un combinador de tareas requiere un array y a lo sumo un tipo explícito"); return "!error"; }
    const context: string = explicitTypes.length == 0 ? "" : "Promise<" + explicitTypes[0] + ">[]";
    const input: string = this.expression(module,args[0],context);
    if (!input.endsWith("[]") || genericBase(semanticElement(input)) != "Promise" || borrowedType(input)) { this.report(module,args[0],"Un combinador requiere Promise<T>[] por transferencia"); return "!error"; }
    const element: string = genericArguments(semanticElement(input))[0];
    if (explicitTypes.length > 0) this.requireType(module,args[0],element,explicitTypes[0]);
    const result: string = name == "all" || name == "promiseAll" ? semanticArray(element) : element;
    this.result.files[module].signatures[id] = "(" + input + ")=>" + result; this.result.files[module].argumentParameters[args[0]] = 0; return result;
  }
  call(module: number, id: number, callable: string, sid: number, receiver: string = "", expected: string = ""): string {
    if (callable.startsWith("!cast:")) {
      const target: string = callable.slice(6,callable.length); const n: AstNode = this.node(module,id); let args: number[] = [];
      for (const edge of n.edges) if (edge.role == "args") args.push(edge.node);
      if (args.length != 1) { this.report(module,id,"Un cast numérico requiere un argumento"); return "!error"; }
      const operand: AstNode = this.node(module,args[0]); let context: string = "";
      if (operand.kind == "NamedArgumentExpression" || operand.kind == "SpreadElement") this.report(module,args[0],"Un cast numérico requiere un argumento posicional simple");
      for (const attr of n.attributes) if (attr.name == "typeArgument") this.report(module,id,"Un cast numérico no admite argumentos de tipo");
      if (target == "i64" || target == "u64") {
        const literal: AstNode = operand.kind == "UnaryExpression" ? this.node(module,bindingChild(operand,"operand")) : operand;
        if (literal.kind == "LiteralExpression" && nativeIntegerText(literal.get("raw")) != "") context = target;
      }
      const actual: string = this.expression(module,args[0],context);
      if (!numericType(memoryValue(actual))) this.report(module,args[0],"Un cast numérico requiere un valor numérico");
      this.result.files[module].argumentParameters[args[0]] = 0; this.result.files[module].signatures[id] = "(" + actual + ")=>" + target; this.result.files[module].conversions[id] = target; return target;
    }
    if (callable == "!comptime") {
      const n: AstNode = this.node(module,id); let args: number[] = []; for (const edge of n.edges) if (edge.role == "args") args.push(edge.node);
      if (args.length != 1) { this.report(module,id,"comptime requiere un único callback sin parámetros"); return "!error"; }
      const callback: string = this.expression(module,args[0],"");
      if (functionClose(callback) < 0 || functionParams(callback).length != 0) { this.report(module,args[0],"comptime requiere un callback invocable sin parámetros"); return "!error"; }
      const result: string = functionReturn(callback); if (result == "void" || this.transferType(result) || containsMemory(result)) this.report(module,id,"COMPTIME_NON_LITERAL: resultado void o contrato de memoria no materializable");
      this.result.files[module].argumentParameters[args[0]] = 0; this.result.files[module].signatures[id] = "(" + callback + ")=>" + result; return result;
    }
    if (callable.startsWith("!tasks:")) return this.taskCollectionCall(module,id,callable.slice(7,callable.length));
    if (callable == "!match") return this.matchCall(module,id);
    if (callable == "!matchCase") { this.report(module,id,"Un caso sólo puede aparecer en el array literal de match"); return "!error"; }
    if (sid >= 0 && this.binding.symbols[sid].kind == "UnionVariant") return this.unionCall(module,id,sid,receiver,expected);
    if (callable.startsWith("!array.")) return this.arrayCall(module,id,callable.slice(7,callable.length),receiver);
    if (callable.startsWith("!container:")) return this.containerCall(module,id,callable.slice(11,callable.length),expected);
    const n: AstNode = this.node(module,id); let args: number[] = []; let actual: string[] = [];
    let contexts: string[] = functionParams(callable);
    if (sid >= 0 && (this.binding.symbols[sid].module) >= 0 && this.binding.symbols[sid].declarations.length > 1) {
      for (const declaration of this.binding.symbols[sid].declarations) {
        const other: string[] = functionParams(this.signature(this.binding.symbols[sid].module,declaration));
        for (let p: number = 0; p < contexts.length; p = p + 1) if (p >= other.length || contexts[p] != other[p]) contexts[p] = "";
      }
    }
    let named: boolean = false;
    for (const edge of n.edges) if (edge.role == "args") {
      const argument: AstNode = this.node(module,edge.node);
      if (argument.kind == "NamedArgumentExpression") named = true;
      else if (named) this.report(module,edge.node,"Un argumento posicional no puede seguir a uno nombrado");
      let position: number = args.length;
      if (sid >= 0 && this.binding.symbols[sid].module >= 0 && callableBinding(this.binding.symbols[sid].kind)) position = this.argumentPosition(this.binding.symbols[sid].module,this.binding.symbols[sid].node,module,edge.node,args.length);
      else if (argument.kind == "NamedArgumentExpression") this.report(module,edge.node,"Un argumento nombrado requiere una declaración con nombres de parámetros");
      if (sid < 0 || (this.binding.symbols[sid].module) < 0 || !callableBinding(this.binding.symbols[sid].kind)) { const rest: number = restPosition(callable); if (rest >= 0 && position >= rest) position = rest; }
      let context: string = position >= 0 && position < contexts.length && contexts[position].indexOf("@",0) < 0 ? contexts[position] : "";
      context = argumentType(context,argument.kind == "SpreadElement");
      if (sid >= 0 && this.binding.symbols[sid].module >= 0 && callableBinding(this.binding.symbols[sid].kind) && genericBase(context) == "Optional") {
        const source = this.binding.symbols[sid]; let allOptional: boolean = true; for (const declaration of source.declarations) if (!this.optionalParameter(source.module,declaration,position)) allOptional = false;
        if (allOptional) context = genericArguments(context)[0];
      }
      args.push(edge.node); actual.push(this.expression(module,edge.node,context));
    }
    if (callable == "!move" || callable == "!ref" || callable == "!constRef") {
      if (args.length != 1) { this.report(module,id,"El helper de memoria necesita un argumento"); return "!error"; }
      const arg: AstNode = this.node(module,args[0]);
      if (callable == "!move") {
        if (!["IdentifierExpression","MemberExpression","IndexExpression"].includes(arg.kind) || (!this.transferType(actual[0]) && !actual[0].startsWith("@"))) this.report(module,id,"E4100: move requiere un lvalue con ownership");
        if (arg.kind != "IdentifierExpression") this.writable(module,args[0]);
        return actual[0];
      }
      if (arg.kind != "IdentifierExpression" && arg.kind != "MemberExpression" && arg.kind != "IndexExpression") this.report(module,id,"E4208: un préstamo necesita un lvalue");
      if (callable == "!ref") this.writable(module,args[0]);
      return callable.slice(1,callable.length) + "<" + memoryValue(actual[0]) + ">";
    }
    if (callable == "!length") {
      if (args.length != 1) this.report(module,id,"length requiere un argumento");
      else if (actual[0] != "string" && !actual[0].endsWith("[]") && fixedArraySize(actual[0]) < 0) this.report(module,id,"length requiere string o array");
      this.result.files[module].signatures[id] = "(" + actual.join(",") + ")=>number"; return "number";
    }
    if (callable == "!print" || callable == "!consoleLog") {

      for (const valueType of actual) if (valueType == "void") this.report(module,id,"No se puede imprimir void");
      this.result.files[module].signatures[id] = "(" + actual.join(",") + ")=>void"; return "void";
    }
    if (callable == "!error") return callable;
    let candidates: number[] = [];
    if (sid >= 0 && (this.binding.symbols[sid].module) >= 0 && callableBinding(this.binding.symbols[sid].kind)) candidates = this.binding.symbols[sid].declarations;
    if (candidates.length == 0) {
      for (const attr of n.attributes) if (attr.name == "typeArgument") this.unsupported(module,id,"argumentos de tipo sobre un valor callable");
      if (functionClose(callable) < 0) { this.report(module,id,"El valor no es invocable: " + callable); return "!error"; }
      const parameters: string[] = functionParams(callable);
      const rest: number = restPosition(callable);
      if ((rest < 0 && args.length != parameters.length) || (rest >= 0 && (args.length) < rest)) this.report(module,id,"Aridad incorrecta: esperaba " + numberToString(parameters.length));
      for (let i: number = 0; i < args.length; i = i + 1) {
        const p: number = rest >= 0 && i >= rest ? rest : i; if (p >= parameters.length) continue;
        const spread: boolean = this.node(module,args[i]).kind == "SpreadElement";
        if (spread && p != rest) this.report(module,args[i],"El spread dinámico requiere un parámetro rest");
        this.result.files[module].argumentParameters[args[i]] = p;
        this.requireType(module,this.argumentValue(module,args[i]),actual[i],argumentType(parameters[p],spread));
      }
      this.result.files[module].signatures[id] = callable; return functionReturn(callable);
    }
    const ownerModule: number = this.binding.symbols[sid].module; let selected: number = -1; let selectedType: string = "!error"; let selectedPositions: number[] = [];
    for (const candidate of candidates) {
      const declaration: AstNode = this.node(ownerModule,candidate); const signature: string = this.instantiateMember(receiver,this.signature(ownerModule,candidate));
      let parameters: string[] = functionParams(signature); let returns: string = functionReturn(signature);
      let positions: number[] = [];
      for (let at: number = 0; at < args.length; at = at + 1) positions.push(this.argumentPosition(ownerModule,candidate,module,args[at],at));
      let pack: boolean = false; for (const edge of declaration.edges) if (edge.role == "typeParameters" && this.node(ownerModule,edge.node).get("variadic") == "true") pack = true;
      if (pack) {
        const instantiated: string = this.packSignature(module,id,ownerModule,candidate,args,actual,positions,expected);
        if (instantiated != "") {
          if (selected >= 0) { this.report(module,id,"Llamada ambigua entre sobrecargas"); return "!error"; }
          selected = candidate; selectedType = functionReturn(instantiated); selectedPositions = positions; this.result.files[module].signatures[id] = instantiated;
        }
        continue;
      }
      let genericNames: string[] = []; let genericValues: string[] = []; let genericNodes: number[] = [];
      for (const edge of declaration.edges) if (edge.role == "typeParameters") { genericNames.push("@" + numberToString(this.binding.files[ownerModule].declarations[edge.node])); genericValues.push(""); genericNodes.push(edge.node); }
      let explicitTypes: string[] = []; for (const attr of n.attributes) if (attr.name == "typeArgument") explicitTypes.push(this.annotation(module,id,attr.value));
      let matches: boolean = explicitTypes.length <= genericNames.length;
      for (let g: number = 0; g < genericNames.length; g = g + 1) {
        if (g < explicitTypes.length) genericValues[g] = explicitTypes[g];
        else for (let a: number = 0; a < actual.length; a = a + 1) {
          const p: number = positions[a]; if (p < 0 || p >= parameters.length) continue;
          const pattern: string = argumentType(parameters[p],this.node(module,args[a]).kind == "SpreadElement");
          let inferred: string = "";
          if (pattern == genericNames[g]) inferred = actual[a];
          else if (pattern == genericNames[g] + "[]" && actual[a].endsWith("[]")) inferred = semanticElement(actual[a]);
          else if (genericBase(pattern) == "Optional" && genericArguments(pattern)[0] == genericNames[g]) {
            if (genericBase(actual[a]) == "Optional") inferred = genericArguments(actual[a])[0]; else if (this.optionalParameter(ownerModule,candidate,p)) inferred = actual[a];
          }
          if (inferred != "") { if (genericValues[g] != "" && genericValues[g] != inferred) matches = false; genericValues[g] = inferred; }
        }
        const parameter: AstNode = this.node(ownerModule,genericNodes[g]);
        if (genericValues[g] == "" && parameter.get("default") != "") {
          let value: string = this.annotation(ownerModule,genericNodes[g],parameter.get("default"));
          for (let p: number = 0; p < g; p = p + 1) value = replaceType(value,genericNames[p],genericValues[p]);
          genericValues[g] = value;
        }
        if (genericValues[g] == "") matches = false;
        if (parameter.get("constraint") != "" && genericValues[g] != "") {
          let constraint: string = this.annotation(ownerModule,genericNodes[g],parameter.get("constraint"));
          for (let p: number = 0; p <= g; p = p + 1) constraint = replaceType(constraint,genericNames[p],genericValues[p]);
          if (!this.compatible(genericValues[g],constraint)) matches = false;
        }
        if (containsMemory(genericValues[g])) this.unsupported(module,id,"instanciación genérica con contrato de memoria");
        for (let p: number = 0; p < parameters.length; p = p + 1) parameters[p] = replaceType(parameters[p],genericNames[g],genericValues[g]);
        returns = replaceType(returns,genericNames[g],genericValues[g]);
      }
      let required: number = 0; let count: number = 0;
      for (const edge of declaration.edges) if (edge.role == "params") {
        const param: AstNode = this.node(ownerModule,edge.node);
        if (param.get("variadic") != "true" && param.get("optional") != "true" && bindingChild(param,"defaultValue") < 0 && !positions.includes(count)) matches = false;
        if (param.get("out") == "true") matches = false;
        count = count + 1;
      }
      const rest: number = restPosition(signature);
      if (rest < 0 && args.length > parameters.length) matches = false;
      let used: number[] = [];
      for (let a: number = 0; a < actual.length; a = a + 1) {
        const p: number = positions[a]; if (p < 0 || p >= parameters.length || (used.includes(p) && p != rest)) { matches = false; continue; } used.push(p);
        const spread: boolean = this.node(module,args[a]).kind == "SpreadElement";
        if ((spread && p != rest) || (p == rest && this.node(module,args[a]).kind == "NamedArgumentExpression")) matches = false;
        const parameter: string = argumentType(parameters[p],spread);
        const target: string = this.optionalParameter(ownerModule,candidate,p) && genericBase(parameter) == "Optional" && genericBase(actual[a]) != "Optional" ? genericArguments(parameter)[0] : parameter;
        if (!this.compatible(actual[a],target) && !(ownedType(target) && actual[a] == memoryInner(target) && this.node(module,this.argumentValue(module,args[a])).kind == "NewExpression")) matches = false;
      }
      if (matches) { if (selected >= 0) { this.report(module,id,"Llamada ambigua entre sobrecargas"); return "!error"; } selected = candidate; selectedType = returns; selectedPositions = positions; this.result.files[module].signatures[id] = "(" + parameters.join(",") + ")=>" + returns; }
    }
    if (selected < 0) this.report(module,id,"Ninguna firma compatible con los argumentos");
    this.result.files[module].selected[id] = selected;
    if (selected >= 0) {
      this.result.files[module].selectedModules[id] = ownerModule;
      const parameters: string[] = functionParams(this.result.files[module].signatures[id]);
      for (let a: number = 0; a < args.length; a = a + 1) {
        const p: number = selectedPositions[a]; this.result.files[module].argumentParameters[args[a]] = p;
        const value: number = this.argumentValue(module,args[a]);
        const wrap: boolean = this.optionalParameter(ownerModule,selected,p) && genericBase(parameters[p]) == "Optional" && genericBase(actual[a]) != "Optional";
        const rest: number = restPosition(this.result.files[module].signatures[id]);
        if (p == rest && genericBase(parameters[p].slice(3,parameters[p].length)) == "pack") {
          const wanted: string[] = genericArguments(parameters[p].slice(3,parameters[p].length)); let offset: number = 0;
          for (let previous: number = 0; previous < a; previous = previous + 1) if (selectedPositions[previous] == rest) offset = offset + (genericBase(actual[previous]) == "pack" ? genericArguments(actual[previous]).length : semanticTuple(actual[previous]) && this.node(module,args[previous]).kind == "SpreadElement" ? splitTypes(actual[previous].slice(1,actual[previous].length-1),",").length : 1);
          if (genericBase(actual[a]) != "pack" && this.node(module,args[a]).kind != "SpreadElement" && offset < wanted.length) this.requireType(module,value,actual[a],wanted[offset]);
        } else this.requireType(module,value,actual[a],wrap ? genericArguments(parameters[p])[0] : argumentType(parameters[p],this.node(module,args[a]).kind == "SpreadElement"));
        if (wrap) this.result.files[module].conversions[value] = parameters[p];
      }
    } return selectedType;
  }
  integerLiteral(module: number, id: number): boolean {
    if (id < 0) return false; let n: AstNode = this.node(module,id);
    if (n.kind == "UnaryExpression" && ["-","+"].includes(n.get("operator"))) n = this.node(module,bindingChild(n,"operand"));
    return n.kind == "LiteralExpression" && n.get("literalType") == "number" && nativeIntegerText(n.get("raw")) != "";
  }
  expression(module: number, id: number, expected: string): string {
    if (id < 0) return "void";
    if ((this.depth) > 128) { this.report(module,id,"Límite de inferencia excedido"); return "!error"; }
    if (this.result.files[module].states[id] == 2) {
      if ((expected == "i64" || expected == "u64") && this.integerLiteral(module,id)) { this.literalRange(module,id,expected); this.result.files[module].types[id] = expected; }
      return this.result.files[module].types[id];
    }
    if (this.result.files[module].states[id] == 1) { this.report(module,id,"Inferencia circular; añade una anotación de tipo"); return "!error"; }
    this.result.files[module].states[id] = 1; this.depth = this.depth + 1;
    const valueType: string = this.expressionInner(module,id,expected);
    if (["CallExpression","MemberCallExpression","NewExpression"].includes(this.node(module,id).kind)) { this.narrowedSymbols = []; this.narrowedTypes = []; }
    this.depth = this.depth - 1; this.result.files[module].types[id] = valueType; this.result.files[module].states[id] = 2; return valueType;
  }
  expressionInner(module: number, id: number, expected: string): string {
    const n: AstNode = this.node(module,id); const kind: string = n.kind;
    if (kind == "AwaitExpression") {
      this.awaitContext(module,id);
      const value: number = bindingChild(n,"operand"); const input: string = this.expression(module,value,"");
      if (genericBase(input) != "Promise") { this.report(module,value,"await requiere Promise<T>"); return "!error"; }
      this.narrowedSymbols = []; this.narrowedTypes = [];
      return genericArguments(input)[0];
    }
    if (kind == "NamedArgumentExpression") return this.expression(module,bindingChild(n,"value"),expected);
    if (kind == "SpreadElement") return this.expression(module,bindingChild(n,"expression"),expected);
    if (kind == "LiteralExpression") {
      if (n.get("literalType") == "number") {
        const context: string = expected == "i64" || expected == "u64" ? expected : "number";
        this.literalRange(module,id,context); return context;
      } return n.get("literalType");
    }
    if (kind == "IdentifierExpression") {
      const sid: number = this.reference(module,id);
      if (sid >= 0) {
        const s: BindingSymbol = this.binding.symbols[sid];
        if ((s.module) < 0 && numericType(s.name)) { this.report(module,id,"Un cast numérico requiere una llamada directa"); return "!error"; }
        if (s.declarations.length > 1) {
          if (functionClose(expected) < 0) return this.unsupported(module,id,"sobrecarga como valor sin firma contextual");
          let selected: number = -1; let score: number = 0; let valueType: string = "!error"; let ambiguous: boolean = false;
          for (const candidate of s.declarations) {
            const signature: string = this.signature(s.module,candidate); const candidateScore: number = signature == expected ? 2 : this.compatible(signature,expected) ? 1 : 0;
            if (candidateScore > score) { selected = candidate; score = candidateScore; valueType = signature; ambiguous = false; }
            else if (candidateScore > 0 && candidateScore == score) ambiguous = true;
          }
          if (selected < 0 || ambiguous) { this.report(module,id,ambiguous ? "Sobrecarga como valor ambigua" : "Ninguna sobrecarga compatible con la firma contextual"); return "!error"; }
          this.result.files[module].selected[id] = selected; this.result.files[module].selectedModules[id] = s.module; this.result.files[module].signatures[id] = valueType;
          return valueType;
        }
        if (s.kind == "ClassDeclaration") {
          const parent: number = this.binding.files[module].parents[id]; let staticReceiver: boolean = false;
          if (parent >= 0) { const p: AstNode = this.node(module,parent); staticReceiver = (p.kind == "MemberExpression" || p.kind == "MemberCallExpression") && bindingChild(p,"object") == id; }
          if (!staticReceiver) this.report(module,id,"Una clase requiere new o un miembro estático");
        }
      }
      const valueType: string = this.flowType(sid,module,id);
      if (genericBase(valueType) == "pack") {
        let parent: number = this.binding.files[module].parents[id];
        if (parent >= 0 && this.node(module,parent).kind == "SpreadElement") parent = this.binding.files[module].parents[parent];
        if (parent < 0 || !["CallExpression","MemberCallExpression"].includes(this.node(module,parent).kind)) this.report(module,id,"Un pack sólo puede expandirse como argumento de llamada");
      }
      return valueType;
    }
    if (kind == "CallExpression") { const sid: number = this.reference(module,id); return this.call(module,id,this.symbolType(sid,module,id),sid,"",expected); }
    if (kind == "GenericIdentifierExpression") {
      let args: string[] = []; for (const a of n.attributes) if (a.name == "typeArgument") args.push(a.value);
      const text: string = this.annotation(module,id,n.get("name") + "<" + args.join(",") + ">");
      const sid: number = this.nominalSymbol(text);
      if (sid < 0 || !["ClassDeclaration","UnionDeclaration"].includes(this.binding.symbols[sid].kind)) { this.report(module,id,"El identificador genérico requiere una clase o unión"); return "!error"; }
      return "class:" + text;
    }
    if (kind == "MemberExpression" || kind == "MemberCallExpression") {
      const object: number = bindingChild(n,"object"); const bound: number = this.reference(module,id);
      let receiver: string = "namespace";
      if (bound < 0) receiver = this.expression(module,object,"");
      else { this.result.files[module].types[object] = "namespace"; this.result.files[module].states[object] = 2; }
      if (n.get("optional") == "true") {
        const parts: string[] = genericArguments(receiver);
        if (genericBase(receiver) != "Optional" || parts.length != 1) { this.report(module,id,"El acceso opcional requiere Optional<T>"); return "!error"; }
        if (kind == "MemberCallExpression") return this.unsupported(module,id,"llamada opcional y sus efectos condicionales");
        const value: string = this.member(module,id,parts[0],n.get("member")); return "Optional<" + value + ">";
      }
      const valueType: string = this.member(module,id,receiver,kind == "MemberExpression" ? n.get("member") : n.get("method"));
      if (kind == "MemberExpression") return valueType;
      if (["Optional","Result","Map"].includes(genericBase(memoryValue(receiver))) && ["value","valueOr","get"].includes(n.get("method")) && this.transferType(functionReturn(valueType))) {
        const receiverNode: AstNode = this.node(module,object); let consumed: boolean = receiverNode.kind == "NewExpression" || receiverNode.kind == "ArrayLiteralExpression";
        if (receiverNode.kind == "CallExpression") { const target: number = this.reference(module,object); consumed = target >= 0 && this.binding.symbols[target].name == "move" && (this.binding.symbols[target].module) < 0; }
        if (!consumed) this.report(module,id,"E4101: extraer un payload con ownership requiere consumir el contenedor con move");
      }
      if (memoryValue(receiver).endsWith("[]") && this.transferType(memoryValue(receiver)) && ["slice","concat","filter","find","sort"].includes(n.get("method"))) {
        const receiverNode: AstNode = this.node(module,object);
        if (borrowedType(receiver) || !["CallExpression","MemberCallExpression","NewExpression","ArrayLiteralExpression","TernaryExpression"].includes(receiverNode.kind)) this.report(module,id,"E4101: una operación que copia owners requiere consumir el array con move");
      }
      const memberId: number = this.result.files[module].members[id];
      if ((memberId >= 0 && this.methodMutates(memberId)) || (memoryValue(receiver).endsWith("[]") && ["push","pop","sort"].includes(n.get("method"))) || (["Map","Set"].includes(genericBase(memoryValue(receiver))) && ["set","add","delete","clear"].includes(n.get("method")))) this.writableTarget(module,object,true);
      return this.call(module,id,valueType,this.result.files[module].members[id],receiver,expected);
    }
    if (kind == "NewExpression") {
      const raw: string = n.get("className"); const rawSymbol: number = raw.indexOf("<",0) < 0 ? this.qualifiedType(module,id,raw) : -1;
      let valueType: string = "";
      if (rawSymbol >= 0 && this.binding.symbols[rawSymbol].kind == "ClassDeclaration" && this.genericParameters(rawSymbol).length > 0) {
        if (this.nominalSymbol(memoryValue(expected)) == rawSymbol) valueType = memoryValue(expected);
        else {
          const owner = this.binding.symbols[rawSymbol]; const generic: number[] = this.genericParameters(rawSymbol); let values: string[] = []; for (const p of generic) values.push("");
          const constructor: number = this.memberSymbol(this.nominal(rawSymbol),"constructor");
          if (constructor >= 0) {
            const patterns: string[] = functionParams(this.symbolType(constructor,module,id)); let at: number = 0;
            for (const edge of n.edges) if (edge.role == "args") {
              const actual: string = this.expression(module,edge.node,"");
              if (at < patterns.length) for (let g: number = 0; g < generic.length; g = g + 1) {
                const token: string = "@" + numberToString(this.binding.files[owner.module].declarations[generic[g]]); let inferred: string = "";
                if (patterns[at] == token) inferred = actual; else if (patterns[at] == token + "[]" && actual.endsWith("[]")) inferred = semanticElement(actual);
                if (inferred != "") { if (values[g] != "" && values[g] != inferred) this.report(module,id,"Inferencia de clase genérica incompatible"); values[g] = inferred; }
              }
              at = at + 1;
            }
          }
          valueType = this.instantiateType(module,id,rawSymbol,values);
        }
      } else if (rawSymbol >= 0 && this.binding.symbols[rawSymbol].kind == "builtin-type" && ["Map","Set"].includes(raw) && genericBase(expected) == raw) valueType = expected;
      else valueType = this.annotation(module,id,raw);
      if (["Map","Set"].includes(genericBase(valueType))) {
        for (const edge of n.edges) if (edge.role == "args") { this.expression(module,edge.node,""); this.report(module,edge.node,"El constructor de colección no acepta argumentos"); }
        const key: string = genericArguments(valueType)[0]; const keySymbol: number = this.nominalSymbol(key);
        if ((!primitiveType(key) || key == "void") && !(keySymbol >= 0 && this.binding.symbols[keySymbol].kind == "EnumDeclaration")) this.report(module,id,"Una clave de colección requiere un tipo primitivo comparable o enum");
        this.result.files[module].signatures[id] = "()=>" + valueType; return valueType;
      }
      const sid: number = this.nominalSymbol(valueType);
      if (sid < 0 || this.binding.symbols[sid].kind != "ClassDeclaration") { this.report(module,id,"new requiere una clase"); return "!error"; }
      const constructorId: number = this.memberSymbol(valueType,"constructor");
      if (constructorId >= 0) this.call(module,id,this.instantiateMember(valueType,this.symbolType(constructorId,module,id)),constructorId,valueType);
      else for (const edge of n.edges) if (edge.role == "args") { this.expression(module,edge.node,""); this.report(module,id,"El constructor no admite argumentos"); }
      return valueType;
    }
    if (kind == "BinaryExpression") {
      const leftId: number = bindingChild(n,"left"); const rightId: number = bindingChild(n,"right");
      if (n.get("operator") == "instanceof") {
        const source: string = memoryValue(this.expression(module,leftId,"")); const target: string = this.annotation(module,rightId,this.node(module,rightId).get("name")); const sid: number = this.nominalSymbol(target);
        if (sid < 0 || this.binding.symbols[sid].kind != "ClassDeclaration") this.report(module,rightId,"instanceof requiere una clase como destino");
        for (const part of splitTypes(source,"|")) { const owner: number = this.nominalSymbol(part); if (owner < 0 || this.binding.symbols[owner].kind != "ClassDeclaration") this.report(module,leftId,"instanceof requiere un valor de clase o unión de clases"); }
        this.result.files[module].types[rightId] = "class:" + target; this.result.files[module].states[rightId] = 2; return "boolean";
      }
      if (n.get("operator") == "??") {
        const left: string = this.expression(module,leftId,expected == "" ? "" : "Optional<" + expected + ">"); const parts: string[] = genericArguments(left);
        if (genericBase(left) != "Optional" || parts.length != 1) { this.report(module,leftId,"El operador ?? requiere Optional<T>"); this.expression(module,rightId,""); return "!error"; }
        this.requireType(module,rightId,this.expression(module,rightId,parts[0]),parts[0]); return parts[0];
      }
      if (n.get("operator") == "&&" || n.get("operator") == "||") {
        this.requireType(module,leftId,this.expression(module,leftId,""),"boolean");
        const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes;
        this.narrowCondition(module,leftId,n.get("operator") == "&&");
        this.requireType(module,rightId,this.expression(module,rightId,""),"boolean");
        this.narrowedSymbols = symbols; this.narrowedTypes = types;
        if (this.affectsFacts(module,rightId)) { this.narrowedSymbols = []; this.narrowedTypes = []; }
        return "boolean";
      }
      let left: string = memoryValue(this.expression(module,leftId,expected == "i64" || expected == "u64" ? expected : ""));
      const right: string = memoryValue(this.expression(module,rightId,(left == "i64" || left == "u64") && this.integerLiteral(module,rightId) ? left : "")); const op: string = n.get("operator");
      if ((right == "i64" || right == "u64") && this.integerLiteral(module,leftId)) left = this.expression(module,leftId,right);
      if (op == "+" && (left == "string" || right == "string")) return "string";
      if (["==","!=","===","!==","<",">","<=",">="].includes(op)) {
        if (numericType(left) && numericType(right)) {
          const promoted: string = nativeBinaryPromotion(left,right,op);
          this.requireType(module,leftId,left,promoted); this.requireType(module,rightId,right,promoted);
        } else if (!this.compatible(left,right)) this.report(module,id,"Tipos incompatibles en la comparación");
        return "boolean";
      }
      if (op == "&&" || op == "||") { this.requireType(module,id,left,"boolean"); this.requireType(module,id,right,"boolean"); return "boolean"; }
      if (!numericType(left) && left != "!error") this.report(module,id,"Operador numérico sobre '" + left + "'");
      if (!numericType(right) && right != "!error") this.report(module,id,"Operador numérico sobre '" + right + "'");
      if (op == "??" || op == "instanceof") return this.unsupported(module,id,op);
      if (["&","|","^","<<",">>"].includes(op) && (["f32","f64"].includes(left) || ["f32","f64"].includes(right))) this.report(module,id,"Los operadores bitwise requieren operandos enteros");
      return nativeBinaryPromotion(left,right,op);
    }
    if (kind == "UnaryExpression") {
      if ((expected == "i64" || expected == "u64") && this.integerLiteral(module,id)) {
        this.expression(module,bindingChild(n,"operand"),""); this.literalRange(module,id,expected); return expected;
      }
      const operand: string = memoryValue(this.expression(module,bindingChild(n,"operand"),"")); const op: string = n.get("operator");
      if (op == "typeof") return "string";
      if (op == "!") { this.requireType(module,id,operand,"boolean"); return "boolean"; }
      if (!numericType(operand) && operand != "!error") this.report(module,id,"Operador numérico sobre '" + operand + "'");
      if (op == "~" && ["f32","f64"].includes(operand)) this.report(module,id,"Los operadores bitwise requieren operandos enteros");
      return nativeUnaryPromotion(operand);
    }
    if (kind == "AssignmentExpression" || kind == "CompoundAssignmentExpression") {
      const target: number = bindingChild(n,"target"); let valueType: string = this.expression(module,target,"");
      if (this.node(module,target).kind == "IdentifierExpression") { const sid: number = this.reference(module,target); valueType = this.symbolType(sid,module,target); this.narrowedSymbols.push(sid); this.narrowedTypes.push(valueType); this.result.files[module].types[target] = valueType; }
      const value: string = this.expression(module,bindingChild(n,"value"),valueType); this.requireType(module,bindingChild(n,"value"),value,valueType); this.writable(module,target);
      if (kind == "CompoundAssignmentExpression" && !numericType(memoryValue(valueType)) && !(memoryValue(valueType) == "string" && n.get("operator") == "+=")) this.report(module,id,"Asignación compuesta inválida"); return valueType;
    }
    if (kind == "ArrayLiteralExpression") {
      const fixed: number = fixedArraySize(expected);
      const element: string = expected.endsWith("[]") ? semanticElement(expected) : fixed >= 0 ? fixedArrayElement(expected) : "";
      const tuple: string[] = semanticTuple(expected) ? splitTypes(expected.slice(1,expected.length-1),",") : [];
      let items: string[] = []; let length: number = 0; let knownLength: boolean = true;
      for (const edge of n.edges) if (edge.role == "elements") {
        const spread: boolean = this.node(module,edge.node).kind == "SpreadElement";
        if (spread) {
          const source: string = memoryValue(this.expression(module,edge.node,element == "" ? "" : semanticArray(element)));
          let additions: string[] = []; let extent: number = 1;
          if (source.endsWith("[]")) { additions.push(semanticElement(source)); knownLength = false; }
          else if (fixedArraySize(source) >= 0) {
            extent = fixedArraySize(source);
            if (extent > 65536) { this.report(module,edge.node,"La expansión de posiciones supera el límite de 65536 elementos"); continue; }
            for (let position: number = 0; position < extent; position = position + 1) additions.push(fixedArrayElement(source));
          } else if (semanticTuple(source)) additions = splitTypes(source.slice(1,source.length-1),",");
          else { this.report(module,edge.node,"Spread de array requiere un array o tupla"); continue; }
          if (!knownLength && tuple.length > 0) this.report(module,edge.node,"Spread de tupla requiere una longitud conocida");
          for (const item of additions) {
            if (element != "") this.requireType(module,edge.node,item,element);
            if (tuple.length > 0 && length < tuple.length) this.requireType(module,edge.node,item,tuple[length]);
            items.push(item); length = length + 1;
          }
        } else {
          const context: string = element != "" ? element : length < tuple.length ? tuple[length] : "";
          const actual: string = this.expression(module,edge.node,context); if (context != "") this.requireType(module,edge.node,actual,context); items.push(actual); length = length + 1;
        }
      }
      if (element != "") { if (fixed >= 0 && (!knownLength || fixed != length)) this.report(module,id,"Tamaño de array fijo incorrecto o no demostrable"); return expected; }
      if (tuple.length > 0) { if (!knownLength || tuple.length != length) this.report(module,id,"Tamaño de tupla incorrecto"); return expected; }
      if (items.length == 0) { this.report(module,id,"Un array vacío requiere anotación"); return "!error"; }
      let same: boolean = true; for (const item of items) if (item != items[0]) same = false;
      if (same) return semanticArray(items[0]);
      if (!knownLength) { this.report(module,id,"Un spread heterogéneo requiere anotación del array"); return "!error"; }
      return "[" + items.join(",") + "]";
    }
    if (kind == "IndexExpression") {
      const object: string = memoryValue(this.expression(module,bindingChild(n,"object"),""));
      const indexId: number = bindingChild(n,"index"); this.requireType(module,indexId,this.expression(module,indexId,""),"number");
      if (object == "string") return "string";
      if (object.endsWith("[]")) return semanticElement(object);
      if (fixedArraySize(object) >= 0) {
        let index: AstNode = this.node(module,indexId); let sign: number = 1;
        if (index.kind == "UnaryExpression" && ["-","+"].includes(index.get("operator"))) { if (index.get("operator") == "-") sign = -1; index = this.node(module,bindingChild(index,"operand")); }
        if (index.kind == "LiteralExpression" && index.get("literalType") == "number") {
          const value = nativeNumericLiteral(index.get("raw"));
          if (value.valid && (value.value % 1 != 0 || value.value * sign < 0 || value.value * sign >= fixedArraySize(object))) this.report(module,indexId,"Índice de array fijo fuera de rango");
        } return fixedArrayElement(object);
      }
      if (semanticTuple(object)) {
        const index: AstNode = this.node(module,indexId); const items: string[] = splitTypes(object.slice(1,object.length-1),",");
        for (let i: number = 0; i < items.length; i = i + 1) if (index.kind == "LiteralExpression" && index.get("raw") == numberToString(i)) return items[i];
        this.report(module,id,"Índice de tupla fuera de rango o no constante"); return "!error";
      }
      if (object != "!error") this.report(module,id,"El tipo no admite índices: " + object); return "!error";
    }
    if (kind == "ObjectLiteralExpression") {
      const unionOwner: number = this.nominalSymbol(expected); if (unionOwner >= 0 && this.binding.symbols[unionOwner].kind == "UnionDeclaration") return this.unionObject(module,id,expected,unionOwner);
      const contracts: string[] = splitTypes(expected,"&");
      if (contracts.length == 0) return this.unsupported(module,id,"literal de objeto sin contexto de interfaz");
      for (const contract of contracts) { const sid: number = this.nominalSymbol(contract); if (sid < 0 || this.binding.symbols[sid].kind != "InterfaceDeclaration") return this.unsupported(module,id,"literal de objeto sin contexto de interfaz"); }
      let provided: string[] = [];
      for (const edge of n.edges) if (edge.role == "properties") {
        const prop: AstNode = this.node(module,edge.node); const name: string = prop.get("key");
        if (provided.includes(name)) this.report(module,edge.node,"Campo duplicado '" + name + "'"); provided.push(name);
        const field: number = this.memberSymbol(expected,name); const value: number = bindingChild(prop,"value");
        if (field < 0) { this.report(module,edge.node,"Campo desconocido '" + name + "'"); this.expression(module,value,""); }
        else {
          const valueType: string = this.symbolType(field,module,id); const actual: string = this.expression(module,value,valueType);
          for (const contract of contracts) { const requirement: number = this.memberSymbol(contract,name); if (requirement >= 0) this.requireType(module,value,actual,this.symbolType(requirement,module,id)); }
        }
      }
      for (const contract of contracts) {
        const sid: number = this.nominalSymbol(contract); const owner = this.binding.symbols[sid]; const declaration: AstNode = this.node(owner.module,owner.node);
        for (const edge of declaration.edges) if (edge.role == "fields" || edge.role == "methods") {
          const field: AstNode = this.node(owner.module,edge.node);
          if (!provided.includes(field.get("name")) && field.get("optional") != "true") this.report(module,id,"Falta el campo '" + field.get("name") + "'");
        }
      } return expected;
    }
    if (kind == "ArrowFunctionExpression") return this.signature(module,id);
    if (kind == "TemplateLiteralExpression") { for (const edge of n.edges) if (edge.role == "expressions") this.expression(module,edge.node,""); return "string"; }
    if (kind == "AsExpression" || kind == "SatisfiesExpression") {
      const valueType: string = this.annotation(module,id,n.get(kind == "AsExpression" ? "targetType" : "declaredType"));
      const actual: string = this.expression(module,bindingChild(n,kind == "AsExpression" ? "expression" : "operand"),valueType);
      if (kind == "AsExpression" && (this.transferType(actual) || this.transferType(valueType)) && !this.compatible(actual,valueType)) this.report(module,id,"E4101: un cast no puede borrar ni fabricar ownership");
      if (kind == "SatisfiesExpression") {
        this.literalRange(module,bindingChild(n,"operand"),valueType);
        if (!this.compatible(actual,valueType)) this.report(module,id,"Tipo incompatible en satisfies");
      }
      else if (containsMemory(actual) || containsMemory(valueType)) this.report(module,id,"E4301: un cast no puede cambiar un contrato de memoria");
      return kind == "SatisfiesExpression" ? actual : valueType;
    }
    if (kind == "TernaryExpression") {
      const condition: number = bindingChild(n,"condition"); this.requireType(module,condition,this.expression(module,condition,""),"boolean");
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes;
      const yesNode: number = bindingChild(n,"thenBranch"); const noNode: number = bindingChild(n,"elseBranch");
      this.narrowCondition(module,condition,true); const yes: string = this.expression(module,yesNode,expected);
      this.narrowedSymbols = symbols; this.narrowedTypes = types; this.narrowCondition(module,condition,false); const no: string = this.expression(module,noNode,expected);
      this.narrowedSymbols = symbols; this.narrowedTypes = types;
      if (this.affectsFacts(module,yesNode) || this.affectsFacts(module,noNode)) { this.narrowedSymbols = []; this.narrowedTypes = []; }
      this.requireType(module,id,no,yes); return yes;
    }
    return this.unsupported(module,id,kind);
  }
  caseKey(module: number, id: number, seen: number[]): string {
    if (id < 0) return "";
    if (this.result.files[module].exactIntegers[id] != "") return "number:" + this.result.files[module].exactIntegers[id];
    const n: AstNode = this.node(module,id);
    if (n.kind == "LiteralExpression") {
      if (n.get("literalType") == "boolean") return "boolean:" + n.get("value");
      if (n.get("literalType") == "string") return "string:" + n.get("value");
      if (n.get("literalType") == "number") {
        const raw: string = n.get("raw") == "" ? n.get("value") : n.get("raw");
        if (["i64","u64"].includes(this.result.files[module].types[id])) return "number:" + this.result.files[module].exactIntegers[id];
        const value = nativeNumericLiteral(raw); if (value.valid) return "number:" + numberToString(value.value);
      }
    }
    if (n.kind == "UnaryExpression" && ["-","+"].includes(n.get("operator"))) {
      const key: string = this.caseKey(module,bindingChild(n,"operand"),seen);
      if (key.startsWith("number:")) {
        if (n.get("operator") == "-" && key != "number:0") { if (key.startsWith("number:-")) return "number:" + key.slice(8,key.length); return "number:-" + key.slice(7,key.length); }
        return key;
      }
    }
    let sid: number = this.reference(module,id); if (n.kind == "MemberExpression") sid = this.result.files[module].members[id];
    if (sid >= 0) {
      sid = this.origin(sid); if (seen.includes(sid)) return "";
      const s = this.binding.symbols[sid]; if ((s.module) < 0) return ""; let next: number[] = seen; next.push(sid);
      if (s.kind == "EnumMember") return this.caseKey(s.module,bindingChild(this.node(s.module,s.node),"value"),next);
      if (s.kind == "VariableDeclaration" && this.node(s.module,s.node).get("mutable") != "true") return this.caseKey(s.module,bindingChild(this.node(s.module,s.node),"initializer"),next);
    } return "";
  }
  destructure(module: number, id: number): void {
    const n: AstNode = this.node(module,id); const init: number = bindingChild(n,"initializer");
    let context: string = this.annotation(module,id,n.get("declaredType"));
    if (context == "" && n.get("pattern") == "array" && this.node(module,init).kind == "ArrayLiteralExpression" && this.node(module,init).edges.length == 0) {
      let element: string = ""; let same: boolean = true;
      for (const e of n.edges) if (e.role == "arrayBindings") {
        const b: AstNode = this.node(module,e.node); let text: string = this.annotation(module,e.node,b.get("declaredType"));
        const fallback: number = bindingChild(b,"defaultValue"); if (text == "" && fallback >= 0) text = this.expression(module,fallback,"");
        if (element == "") element = text; else if (text != element) same = false;
      }
      if (same && element != "") context = semanticArray(element);
    }
    const source: string = memoryValue(this.expression(module,init,context));
    if (context != "") this.requireType(module,init,source,context);
    this.result.files[module].types[id] = source;
    let position: number = 0;
    for (const e of n.edges) if (e.role == "arrayBindings" || e.role == "objectBindings") {
      const b: AstNode = this.node(module,e.node); const sid: number = this.binding.files[module].declarations[e.node];
      const fallback: number = bindingChild(b,"defaultValue"); let actual: string = "!error";
      if (e.role == "arrayBindings") {
        if (source.endsWith("[]")) actual = semanticElement(source);
        else if (fixedArraySize(source) >= 0) { actual = fixedArrayElement(source); if (position >= fixedArraySize(source) && fallback < 0) this.report(module,e.node,"Binding fuera del tamaño del array fijo"); }
        else if (semanticTuple(source)) {
          const items: string[] = splitTypes(source.slice(1,source.length-1),",");
          if (position < items.length) actual = items[position];
          else if (fallback >= 0) actual = this.expression(module,fallback,"");
          else this.report(module,e.node,"Binding fuera del tamaño de la tupla");
        } else this.report(module,e.node,"Destructuring de array requiere un array o tupla");
      } else actual = this.member(module,e.node,source,b.get("property"));
      const declared: string = this.annotation(module,e.node,b.get("declaredType"));
      if (declared != "") this.requireType(module,e.node,actual,declared);
      const target: string = declared == "" ? actual : declared;
      if (target == "void") this.report(module,e.node,"Un binding no puede ser void");
      if (fallback >= 0) this.requireType(module,fallback,this.expression(module,fallback,target),target);
      this.result.files[module].types[e.node] = target;
      if (sid >= 0) { this.result.symbolTypes[sid] = target; this.symbolStates[sid] = 2; }
      position = position + 1;
    }
  }
  statement(module: number, id: number, returns: string, loop: number): void {
    const n: AstNode = this.node(module,id); const kind: string = n.kind;
    if (kind == "ModuleHeaderDeclaration") return;
    if (kind == "Program" || kind == "BlockStatement") {
      for (const e of n.edges) if (e.role == "statements") this.statement(module,e.node,returns,loop);
      return;
    }
    if (kind == "VariableDeclaration" || kind == "UsingDeclaration") {
      if (n.get("pattern") != "") { this.destructure(module,id); return; }
      const sid: number = this.binding.files[module].declarations[id]; const valueType: string = this.symbolType(sid,module,id);
      if (valueType == "void") this.report(module,id,"Una variable no puede ser void");
      const init: number = bindingChild(n,"initializer"); this.requireType(module,init,this.expression(module,init,valueType),valueType); this.result.files[module].types[id] = valueType; return;
    }
    if (callableBinding(kind)) {
      const outerSwitches: number = this.switches; this.switches = 0;
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes; this.narrowedSymbols = []; this.narrowedTypes = [];
      const valueType: string = this.signature(module,id); this.result.files[module].types[id] = valueType;
      const declared: number = this.binding.files[module].declarations[id];
      if (declared >= 0) this.symbolType(declared,module,id);
      for (const edge of n.edges) {
        if (edge.role == "params") {
          const param: AstNode = this.node(module,edge.node); const pt: string = this.parameterType(module,edge.node); if (pt == "void" || pt == "Optional<void>") this.report(module,edge.node,"Un parámetro no puede ser void"); this.result.files[module].types[edge.node] = pt;
          if (param.get("out") == "true") this.unsupported(module,edge.node,"parámetro out");
          if (param.get("variadic") == "true") {
            let last: number = -1; for (const item of n.edges) if (item.role == "params") last = item.node;
            if (last != edge.node || functionClose(pt) >= 0 || (!pt.endsWith("[]") && genericBase(pt) != "pack") || param.get("optional") == "true" || bindingChild(param,"defaultValue") >= 0) this.report(module,edge.node,"Un parámetro rest requiere un array, debe ser el último y no admite default ni optional");
          }
          const value: number = bindingChild(param,"defaultValue"); if (value >= 0) this.requireType(module,value,this.expression(module,value,pt),pt);
        }
        if (edge.role == "typeParameters") {
          const parameter: AstNode = this.node(module,edge.node);
          if (parameter.get("variadic") == "true") {
            const token: string = "@" + numberToString(this.binding.files[module].declarations[edge.node]); let count: number = 0; let last: number = -1;
            for (const item of n.edges) {
              if (item.role == "typeParameters") last = item.node;
              if (item.role == "params") {
                const param: AstNode = this.node(module,item.node); const input: string = this.annotation(module,item.node,param.get("type"));
                if (input == token && param.get("variadic") == "true") count = count + 1;
                else if (replaceType(input,token,"!pack") != input) this.report(module,item.node,"Un pack sólo puede usarse como tipo de su parámetro rest");
              }
            }
            if (last != edge.node || count != 1 || parameter.get("constraint") != "" || parameter.get("default") != "") this.report(module,edge.node,"Un pack debe ser el último parámetro de tipo y necesita un único rest correspondiente, sin constraint ni default");
            if (replaceType(functionReturn(valueType),token,"!pack") != functionReturn(valueType)) this.report(module,id,"Un pack no puede usarse como tipo de retorno");
          }
          if (parameter.get("constraint") != "") this.annotation(module,edge.node,parameter.get("constraint"));
          if (parameter.get("default") != "") this.annotation(module,edge.node,parameter.get("default"));
        }
      }
      if (this.asynchronous(module,id)) for (const edge of n.edges) if (edge.role == "params" && borrowedType(this.parameterType(module,edge.node))) this.report(module,edge.node,"E4204: una tarea async no puede almacenar un parámetro prestado sin duración demostrada");
      const bodyReturns: string = this.asynchronous(module,id) && genericBase(functionReturn(valueType)) == "Promise" ? genericArguments(functionReturn(valueType))[0] : functionReturn(valueType);
      const body: number = bindingChild(n,"body");
      if (body >= 0) {
        if (this.node(module,body).kind == "BlockStatement") {
          this.statement(module,body,bodyReturns,0);

        } else this.requireType(module,body,this.expression(module,body,bodyReturns),bodyReturns);
      } this.switches = outerSwitches; this.narrowedSymbols = symbols; this.narrowedTypes = types; return;
    }
    if (kind == "ReturnStatement") {
      if (returns == "") this.report(module,id,"return fuera de una función");
      const value: number = bindingChild(n,"value"); this.requireType(module,value < 0 ? id : value,this.expression(module,value,returns),returns); return;
    }
    if (kind == "DeleteStatement") {
      const target: number = bindingChild(n,"target"); const index: AstNode = this.node(module,target);
      const object: number = bindingChild(index,"object"); const key: number = bindingChild(index,"index");
      const container: string = memoryValue(this.expression(module,object,""));
      let keyType: string = "!error";
      if (["Map","Set"].includes(genericBase(container))) keyType = genericArguments(container)[0];
      else if (container.endsWith("[]")) keyType = "number";
      else this.report(module,id,"delete requiere Map, Set o array dinámico");
      this.requireType(module,key,this.expression(module,key,keyType),keyType); this.writableTarget(module,object,true); return;
    }
    if (kind == "ExpressionStatement") { this.expression(module,bindingChild(n,"expression"),""); return; }
    if (kind == "ForOfStatement" || kind == "ForInStatement") {
      const source: number = bindingChild(n,kind == "ForOfStatement" ? "iterable" : "target");
      const container: string = memoryValue(this.expression(module,source,"")); let element: string = "!error";
      if (container.endsWith("[]")) element = semanticElement(container);
      else if (fixedArraySize(container) >= 0) element = fixedArrayElement(container);
      else if (container == "string" && kind == "ForOfStatement") element = "string";
      else if (genericBase(container) == "Map") element = "[" + genericArguments(container).join(",") + "]";
      else if (genericBase(container) == "Set" && kind == "ForOfStatement") element = genericArguments(container)[0];
      else this.report(module,source,"El tipo no es iterable en " + kind);
      if (kind == "ForInStatement") { if (genericBase(container) == "Map") element = genericArguments(container)[0]; else element = "number"; }
      if (n.get("await") == "true") {
        this.awaitContext(module,id);
        if (genericBase(element) != "Promise") this.report(module,source,"for await requiere elementos Promise<T>");
        else element = genericArguments(element)[0];
      }
      const binding: number = bindingChild(n,"binding"); const sid: number = this.binding.files[module].declarations[binding];
      const declared: string = this.annotation(module,binding,this.node(module,binding).get("declaredType"));
      if (declared != "") this.requireType(module,binding,element,declared);
      if (this.transferType(element) && memoryMode(declared) != "constRef") this.report(module,binding,"E4101: iterar un elemento con ownership requiere constRef");
      const valueType: string = declared == "" ? element : declared;
      this.result.files[module].types[binding] = valueType; if (sid >= 0) { this.result.symbolTypes[sid] = valueType; this.symbolStates[sid] = 2; }
      this.statement(module,bindingChild(n,"body"),returns,loop+1); return;
    }
    if (kind == "IfStatement") {
      const condition: number = bindingChild(n,"condition"); this.requireType(module,condition,this.expression(module,condition,""),"boolean");
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes;
      const yes: number = bindingChild(n,"thenBranch"); const no: number = bindingChild(n,"elseBranch");
      this.narrowCondition(module,condition,true); if (yes >= 0) this.statement(module,yes,returns,loop);
      this.narrowedSymbols = symbols; this.narrowedTypes = types; this.narrowCondition(module,condition,false); if (no >= 0) this.statement(module,no,returns,loop);
      this.narrowedSymbols = symbols; this.narrowedTypes = types;
      this.afterIf(module,condition,yes,no);
      return;
    }
    if (kind == "WhileStatement" || kind == "ForStatement") {
      const condition: number = bindingChild(n,"condition"); if (condition >= 0) this.requireType(module,condition,this.expression(module,condition,""),"boolean");
      const init: number = bindingChild(n,"initializer"); if (init >= 0) this.statement(module,init,returns,loop);
      const update: number = bindingChild(n,"increment"); if (update >= 0) this.expression(module,update,"");
      for (const e of n.edges) if (e.role == "body" || e.role == "thenBranch" || e.role == "elseBranch") this.statement(module,e.node,returns,kind == "IfStatement" ? loop : loop + 1); return;
    }
    if (kind == "SwitchStatement") {
      const value: number = bindingChild(n,"discriminant"); const valueType: string = this.expression(module,value,"");
      const nominal: number = this.nominalSymbol(valueType); const enumType: boolean = nominal >= 0 && this.binding.symbols[nominal].kind == "EnumDeclaration";
      if (!numericType(valueType) && valueType != "string" && !enumType) this.report(module,value,"switch requiere un número, string o enum");
      let labels: string[] = []; this.switches = this.switches + 1;
      for (const edge of n.edges) if (edge.role == "clauses") {
        const clause: AstNode = this.node(module,edge.node);
        for (const item of clause.edges) if (item.role == "labels") {
          this.requireType(module,item.node,this.expression(module,item.node,valueType),valueType);
          const key: string = this.caseKey(module,item.node,[]);
          this.result.files[module].caseValues[item.node] = key;
          if (key == "") this.report(module,item.node,"Una etiqueta case requiere una constante conocida");
          else if (labels.includes(key)) this.report(module,item.node,"Etiqueta case duplicada"); else labels.push(key);
        }
        for (const item of clause.edges) if (item.role == "body") this.statement(module,item.node,returns,loop);
      }
      this.switches = this.switches - 1; return;
    }
    if (kind == "BreakStatement" || kind == "ContinueStatement") { if (loop == 0 && (kind == "ContinueStatement" || this.switches == 0)) this.report(module,id,kind + " fuera de su contexto de bucle/switch"); return; }
    if (kind == "ClassDeclaration" || kind == "InterfaceDeclaration") {
      for (const edge of n.edges) {
        if (edge.role == "typeParameters") { const p: AstNode = this.node(module,edge.node); if (p.get("variadic") == "true") this.unsupported(module,id,"pack de clase genérica"); }
        if (edge.role == "fields") {
          const field: AstNode = this.node(module,edge.node); const valueType: string = this.annotation(module,edge.node,field.get("type")); if (valueType == "void") this.report(module,edge.node,"Un campo no puede ser void"); this.result.files[module].types[edge.node] = valueType;
          const value: number = bindingChild(field,"defaultValue"); if (value >= 0) this.requireType(module,value,this.expression(module,value,valueType),valueType);
        }
        if (edge.role == "methods") this.statement(module,edge.node,returns,0);
      } return;
    }
    if (kind == "TypeAliasDeclaration") { this.symbolType(this.binding.files[module].declarations[id],module,id); return; }
    if (kind == "UnionDeclaration") {
      for (const edge of n.edges) if (edge.role == "variants") {
        const sid: number = this.binding.files[module].declarations[edge.node]; this.result.files[module].types[edge.node] = this.symbolType(sid,module,edge.node);
        for (const field of this.node(module,edge.node).edges) if (field.role == "bindings") {
          const binding: number = this.binding.files[module].declarations[field.node]; if (binding >= 0) this.result.files[module].types[field.node] = this.symbolType(binding,module,field.node);
        }
      } return;
    }
    if (kind == "EnumDeclaration") {
      const sid: number = this.binding.files[module].declarations[id]; this.symbolType(sid,module,id);
      for (const edge of n.edges) if (edge.role == "members") {
        const member: number = this.binding.files[module].declarations[edge.node]; const value: number = bindingChild(this.node(module,edge.node),"value");
        this.result.files[module].types[edge.node] = this.symbolType(member,module,edge.node);
        if (value >= 0) { this.expression(module,value,""); if (n.get("underlying") == "number") this.literalRange(module,value,"i32"); }
      } return;
    }
    if (kind == "ExportDefaultDeclaration") {
      const declaration: number = bindingChild(n,"declaration");
      if (this.node(module,declaration).kind.endsWith("Expression")) this.expression(module,declaration,""); else this.statement(module,declaration,returns,loop); return;
    }
    if (["ImportDeclaration","ExportAllDeclaration","ExportNamedDeclaration"].includes(kind)) return;
    this.unsupported(module,id,kind);
  }
  decorator(module: number, id: number): void {
    const n: AstNode = this.node(module,id); const name: string = n.get("name"); const target: number = this.binding.files[module].parents[id]; const owner: AstNode = this.node(module,target);
    if (["cppgen","etsgen"].includes(name)) { this.unsupported(module,id,"expansión nativa @" + name); return; }
    if (!["comptime","deprecated","sealed","include","link"].includes(name)) { this.report(module,id,"Decorador desconocido o sin contrato nativo: @" + name); return; }
    let item: NativeDecorator = new NativeDecorator(module,id,target,name); let valid: boolean = true;
    for (const edge of n.edges) if (edge.role == "args") {
      const argument: AstNode = this.node(module,edge.node); this.expression(module,edge.node,"");
      if (argument.kind != "LiteralExpression" || argument.get("literalType") != "string") { this.report(module,edge.node,"Un argumento de decorador debe ser un literal string"); valid = false; }
      else item.arguments.push(argument.get("value"));
    }
    if (name == "comptime") {
      if (owner.kind != "FunctionDeclaration" || this.asynchronous(module,target) || item.arguments.length != 0) { this.report(module,id,"@comptime requiere una función síncrona sin argumentos de decorador"); valid = false; }
    } else if (name == "sealed") { if (owner.kind != "ClassDeclaration" || item.arguments.length != 0) { this.report(module,id,"@sealed requiere una clase y no admite argumentos"); valid = false; } }
    else if (name == "include" || name == "link") { if (owner.kind != "ModuleHeaderDeclaration" || item.arguments.length != 1) { this.report(module,id,"@" + name + " requiere un único string en la cabecera del módulo"); valid = false; } }
    else if (item.arguments.length > 1) { this.report(module,id,"@deprecated admite a lo sumo un mensaje"); valid = false; }
    for (const previous of this.result.decorators) if (previous.module == module && previous.target == target && previous.name == name && name != "include" && name != "link") { this.report(module,id,"Decorador duplicado @" + name); valid = false; }
    if (valid) this.result.decorators.push(item);
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
      if (this.binding.files[m].nodeScopes[id] >= 0 && this.node(m,id).kind == "Decorator") this.decorator(m,id);
    }
    // Safety checks also need the types of unused fields/parameters/receivers.
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
      const symbol: BindingSymbol = this.binding.symbols[sid];
      if (symbol.module >= 0 && ["Parameter","ClassField","InterfaceField","UnionVariantBinding","receiver"].includes(symbol.kind)) this.symbolType(sid,symbol.module,(symbol.node) < 0 ? this.graph.modules[symbol.module].cached.result.ast.root : symbol.node);
    }
    // Resolve all public signatures, including declarations not used at runtime.
    for (const item of this.binding.exports) {
      const sid: number = this.origin(item.symbol); const symbol: BindingSymbol = this.binding.symbols[sid];
      if (symbol.module >= 0 && (symbol.namespaceModule) < 0) this.symbolType(sid,symbol.module,symbol.node);
    }
    if (this.result.diagnostics.length == 0) { let checked: CheckResult = this.result; validateSafety(this.graph,this.binding,checked); this.result = checked; }
    if (this.result.diagnostics.length == 0) this.result = evaluateNativeComptime(this.graph,this.binding,this.result);
    this.result.success = this.result.diagnostics.length == 0; return this.result;
  }
}
export function checkProject(graph: ModuleGraph, binding: BindingResult): CheckResult { let checker: NativeChecker = new NativeChecker(graph,binding); return checker.check(); }
