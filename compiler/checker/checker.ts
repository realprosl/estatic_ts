import { catalogArg, catalogVariant, closestName, diagnosticAt, SourceDiagnostic } from "../diag/index";
import {progressDetail} from "../platform/index";
import {profileBegin,profileEnd} from "../analysis/index";
import { AttributeKind, EdgeRole, NodeKind, isCallableNodeKind, isExpressionNodeKind, nodeKindName, AstNode } from "../parser/index";
import { nativeBuiltinSignatures, BindingResult, BindingSymbol, bindingChild, callableBinding } from "../binder/index";
import { ModuleGraph } from "../modules/index";
import { joinTypes, ungroupElement, splitTypes, functionClose, functionParams, functionReturn, restPosition, argumentType, numericType, primitiveType, typeCompatible, replaceType, memoryMode, memoryInner, memoryValue, ownedType, borrowedType, readonlyType, semanticArray, semanticTuple, semanticElement, containsMemory, fixedArraySize, fixedArrayElement, semanticFixedArray, genericBase, genericArguments, canonicalSymbol, literalType, literalKind, literalValue, literalTypeText, literalTypePrefix } from "./types";

import { TypedFile, CheckResult, NativeDecorator, NativeTypeQuery } from "./model";
export { TypedFile, CheckResult } from "./model";
import { attachModuleRecords } from "./module-records";
import { evaluateNativeComptime } from "./comptime";
import { validateSafety } from "./safety";
import { resourceType, resourceSubstitution, resourceFields, ResourceFields } from "./ownership";
import { nativeNumericLiteral, nativeUnaryPromotion, nativeBinaryPromotion, nativeIntegerText, nativeInteger64 } from "./numeric";

export class NativeChecker {
  graph: ModuleGraph; binding: BindingResult; result: CheckResult; symbolStates: number[]; depth: number; switches: number; compatibilityDepth: number;
  narrowedSymbols: number[]; narrowedTypes: string[]; trace: boolean;
  // #213: rutas de acceso estrechadas (x.cause, this.a.b). Cada ruta tiene un id
  // negativo en narrowedSymbols: -(posición en narrowedPaths) - 2.
  narrowedPaths: string[];
  // Memoiza que metodo muta su receptor. Los arrays se copian al pasarlos,
  // asi que la cache vive en la clase y no en un argumento recursivo.
  // 0 = no muta, 1 = muta, 2 = en curso (ciclo).
  mutationCache: Map<string,number>;
  // #223: literales sin tipo con la misma forma comparten tipo (el primero).
  literalShapeKeys: string[]; literalShapeTypes: string[];
  // #273: comprobación en compilación de JSON.parse<T>("texto constante").
  jsonText: string; jsonAt: number;
  // Índices para no recorrer todos los símbolos/referencias en cada consulta:
  // miembros por ámbito ("módulo:nodo" → símbolos en orden de sid), referencias
  // por nodo (vértice = offset del módulo + nodo) y campos aún sin tipo.
  indexed: boolean; memberGroups: Map<string,number>; memberStart: number[]; memberList: number[];
  offsets: number[]; referenceStart: number[]; referenceList: number[]; pendingFields: number[]; transferMemo: Map<string,boolean>; resourceIndex: ResourceFields;
  constructor(graph: ModuleGraph, binding: BindingResult) {
    this.graph = graph; this.binding = binding; this.result = new CheckResult(); this.symbolStates = []; this.depth = 0; this.switches = 0; this.compatibilityDepth = 0;
    this.narrowedSymbols = []; this.narrowedTypes = []; this.trace = false; this.narrowedPaths = [];
    this.mutationCache = new Map<string,number>(); this.literalShapeKeys = []; this.literalShapeTypes = []; this.jsonText = ""; this.jsonAt = 0;
    this.indexed = false; this.memberGroups = new Map<string,number>(); this.memberStart = []; this.memberList = [];
    this.offsets = []; this.referenceStart = []; this.referenceList = []; this.pendingFields = []; this.transferMemo = new Map<string,boolean>(); this.resourceIndex = new ResourceFields();
  }
  index(): void {
    if (this.indexed) return; this.indexed = true;
    // Miembros: grupos por ámbito, en orden de sid.
    let groups: number[] = []; let counts: number[] = [];
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
      const scope: number = this.binding.symbols[sid].scope; let group: number = -1;
      if (scope >= 0) {
        const key: string = numberToString(this.binding.symbols[sid].module) + ":" + numberToString(this.binding.scopes[scope].node);
        const found: Optional<number> = this.memberGroups.get(key);
        if (found.isPresent()) group = found.value(); else { group = counts.length; this.memberGroups.set(key,group); counts.push(0); }
        counts[group] = counts[group] + 1;
      }
      groups.push(group);
      const kind: string = this.binding.symbols[sid].kind;
      if (kind == "ClassField" || kind == "InterfaceField" || kind == "UnionVariant") this.pendingFields.push(sid);
    }
    this.memberStart.push(0); for (let g: number = 0; g < counts.length; g = g + 1) this.memberStart.push(this.memberStart[g] + counts[g]);
    let cursor: number[] = []; for (let g: number = 0; g < counts.length; g = g + 1) cursor.push(this.memberStart[g]);
    for (let sid: number = 0; sid < groups.length; sid = sid + 1) this.memberList.push(-1);
    for (let sid: number = 0; sid < groups.length; sid = sid + 1) if (groups[sid] >= 0) { this.memberList[cursor[groups[sid]]] = sid; cursor[groups[sid]] = cursor[groups[sid]] + 1; }
    // Referencias por nodo.
    let total: number = 0; for (const m of this.graph.modules) { this.offsets.push(total); total = total + m.cached.result.ast.nodes.length; }
    for (let v: number = 0; v <= total; v = v + 1) this.referenceStart.push(0);
    let vertices: number[] = [];
    for (const ref of this.binding.references) {
      let v: number = -1; if (ref.module >= 0 && ref.module < this.offsets.length && ref.node >= 0) { v = this.offsets[ref.module] + ref.node; if (v >= total) v = -1; }
      vertices.push(v); if (v >= 0) this.referenceStart[v + 1] = this.referenceStart[v + 1] + 1;
    }
    for (let v: number = 0; v < total; v = v + 1) this.referenceStart[v + 1] = this.referenceStart[v + 1] + this.referenceStart[v];
    let at: number[] = []; for (let v: number = 0; v < total; v = v + 1) at.push(this.referenceStart[v]);
    for (let r: number = 0; r < vertices.length; r = r + 1) this.referenceList.push(-1);
    for (let r: number = 0; r < vertices.length; r = r + 1) if (vertices[r] >= 0) { this.referenceList[at[vertices[r]]] = r; at[vertices[r]] = at[vertices[r]] + 1; }
  }
  // Símbolos declarados en el ámbito del nodo (module, node), en orden de sid.
  scopeMembers(module: number, node: number): number[] {
    this.index(); const found: Optional<number> = this.memberGroups.get(numberToString(module) + ":" + numberToString(node)); let result: number[] = [];
    if (found.isPresent()) { const g: number = found.value(); for (let at: number = this.memberStart[g]; at < this.memberStart[g + 1]; at = at + 1) result.push(this.memberList[at]); }
    return result;
  }
  // Índices (en binding.references) de las referencias del nodo, en orden.
  nodeReferences(module: number, node: number): number[] {
    this.index(); let result: number[] = []; if (module < 0 || module >= this.offsets.length || node < 0) return result;
    const v: number = this.offsets[module] + node; if (v + 1 >= this.referenceStart.length) return result;
    for (let at: number = this.referenceStart[v]; at < this.referenceStart[v + 1]; at = at + 1) result.push(this.referenceList[at]);
    return result;
  }
  // JSON.parse<T>("...") de estatic:json con texto constante: el texto se
  // comprueba contra T al compilar y no encajar es un error de compilación.
  jsonConstant(module: number, id: number, owner: number): void {
    const n: AstNode = this.node(module,id);
    const name: string = n.kind == NodeKind.MemberCallExpression ? n.get(AttributeKind.Method) : n.get(AttributeKind.Callee);
    if (name != "parse" || owner < 0 || owner >= this.graph.modules.length) return;
    if (!this.graph.modules[owner].file.endsWith("runtime/lib/json.ts")) return;
    let typeText: string = ""; for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument && typeText == "") typeText = attr.value;
    let args: number[] = []; for (const edge of n.edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    if (typeText == "" || args.length != 1) return;
    const argument: AstNode = this.node(module,args[0]);
    if (argument.kind != NodeKind.LiteralExpression || argument.get(AttributeKind.LiteralType) != "string") return;
    const wanted: string = this.annotation(module,id,typeText);
    this.jsonText = argument.get(AttributeKind.Value); this.jsonAt = 0;
    let error: string = this.jsonMatch(wanted,"$");
    this.jsonSpace(); if (error == "" && this.jsonAt != this.jsonText.length) error = "texto de más en la posición " + numberToString(this.jsonAt);
    if (error != "") this.report(module,args[0],"E3010: El texto JSON no encaja con '" + this.displayType(wanted) + "': " + error);
    // Encaja: el valor se construye al compilar (lower).
    else this.result.files[module].constantStates[id] = "json";
  }
  jsonSpace(): void { while (this.jsonAt < this.jsonText.length && " \t\n\r".includes(this.jsonText.charAt(this.jsonAt), 0)) this.jsonAt = this.jsonAt + 1; }
  jsonKind(): string {
    this.jsonSpace(); if (this.jsonAt >= this.jsonText.length) return "";
    const c: string = this.jsonText.charAt(this.jsonAt);
    if (c == "{") return "object"; if (c == "[") return "array"; if (c == "\"") return "string";
    if (c == "t" || c == "f") return "boolean"; if (c == "n") return "null";
    if (c == "-" || "0123456789".includes(c, 0)) return "number";
    return "";
  }
  // Lee un string JSON (sin las comillas, con los escapes simples resueltos).
  jsonString(): string {
    let value: string = ""; this.jsonAt = this.jsonAt + 1;
    while (this.jsonAt < this.jsonText.length && this.jsonText.charAt(this.jsonAt) != "\"") {
      if (this.jsonText.charAt(this.jsonAt) == "\\") { this.jsonAt = this.jsonAt + 1; const e: string = this.jsonText.charAt(this.jsonAt); value = value + (e == "n" ? "\n" : e == "t" ? "\t" : e); }
      else value = value + this.jsonText.charAt(this.jsonAt);
      this.jsonAt = this.jsonAt + 1;
    }
    this.jsonAt = this.jsonAt + 1; return value;
  }
  // Salta un valor JSON; "" si es válido.
  jsonSkip(where: string): string {
    const kind: string = this.jsonKind();
    if (kind == "") return "JSON no válido en " + where;
    if (kind == "string") { this.jsonString(); return ""; }
    if (kind == "number") { this.jsonAt = this.jsonAt + 1; while (this.jsonAt < this.jsonText.length && "0123456789.eE+-".includes(this.jsonText.charAt(this.jsonAt), 0)) this.jsonAt = this.jsonAt + 1; return ""; }
    if (kind == "boolean" || kind == "null") {
      const word: string = this.jsonText.charAt(this.jsonAt) == "t" ? "true" : this.jsonText.charAt(this.jsonAt) == "f" ? "false" : "null";
      if (this.jsonText.slice(this.jsonAt, this.jsonAt + word.length) != word) return "JSON no válido en " + where;
      this.jsonAt = this.jsonAt + word.length; return "";
    }
    const close: string = kind == "object" ? "}" : "]"; this.jsonAt = this.jsonAt + 1; let first: boolean = true;
    while (true) {
      this.jsonSpace();
      if (first && this.jsonText.charAt(this.jsonAt) == close) { this.jsonAt = this.jsonAt + 1; return ""; }
      first = false;
      if (kind == "object") { if (this.jsonKind() != "string") return "JSON no válido en " + where; this.jsonString(); this.jsonSpace(); if (this.jsonText.charAt(this.jsonAt) != ":") return "JSON no válido en " + where; this.jsonAt = this.jsonAt + 1; }
      const inner: string = this.jsonSkip(where); if (inner != "") return inner;
      this.jsonSpace();
      if (this.jsonText.charAt(this.jsonAt) == ",") { this.jsonAt = this.jsonAt + 1; continue; }
      if (this.jsonText.charAt(this.jsonAt) == close) { this.jsonAt = this.jsonAt + 1; return ""; }
      return "JSON no válido en " + where;
    }
    return "";
  }
  // Comprueba el valor JSON que empieza en jsonAt contra el tipo; "" si encaja.
  jsonMatch(wanted: string, where: string): string {
    const jtype: string = memoryValue(wanted); const kind: string = this.jsonKind();
    if (kind == "") return "JSON no válido en " + where;
    if (jtype == "JsonValue") return this.jsonSkip(where);
    if (genericBase(jtype) == "Optional") { if (kind == "null") return this.jsonSkip(where); return this.jsonMatch(genericArguments(jtype)[0],where); }
    const alternatives: string[] = splitTypes(jtype,"|");
    if (alternatives.length > 1) {
      const start: number = this.jsonAt; let first: string = "";
      for (const alternative of alternatives) { this.jsonAt = start; const error: string = this.jsonMatch(ungroupElement(alternative),where); if (error == "") return ""; if (first == "") first = error; }
      return first;
    }
    if (numericType(jtype) || jtype == "string" || jtype == "boolean") {
      const expectedKind: string = numericType(jtype) ? "number" : jtype;
      if (kind != expectedKind) return "se esperaba " + expectedKind + " en " + where + " y hay " + kind;
      return this.jsonSkip(where);
    }
    if ((jtype.endsWith("[]") && functionClose(jtype) < 0) || semanticTuple(jtype)) {
      if (kind != "array") return "se esperaba array en " + where + " y hay " + kind;
      const tuple: boolean = semanticTuple(jtype); const items: string[] = tuple ? splitTypes(jtype.slice(1,jtype.length-1),",") : [];
      this.jsonAt = this.jsonAt + 1; let index: number = 0;
      this.jsonSpace();
      if (this.jsonText.charAt(this.jsonAt) == "]") { this.jsonAt = this.jsonAt + 1; return tuple && items.length != 0 ? "se esperaban " + numberToString(items.length) + " elementos en " + where + " y hay 0" : ""; }
      while (true) {
        if (tuple && index >= items.length) return "se esperaban " + numberToString(items.length) + " elementos en " + where;
        const error: string = this.jsonMatch(tuple ? items[index] : semanticElement(jtype), where + "[" + numberToString(index) + "]"); if (error != "") return error;
        index = index + 1; this.jsonSpace();
        if (this.jsonText.charAt(this.jsonAt) == ",") { this.jsonAt = this.jsonAt + 1; continue; }
        if (this.jsonText.charAt(this.jsonAt) == "]") { this.jsonAt = this.jsonAt + 1; break; }
        return "JSON no válido en " + where;
      }
      if (tuple && index != items.length) return "se esperaban " + numberToString(items.length) + " elementos en " + where + " y hay " + numberToString(index);
      return "";
    }
    let fieldNames: string[] = []; let fieldTypes: string[] = []; let valueType: string = "";
    if (genericBase(jtype) == "Map" && genericArguments(jtype)[0] == "string") valueType = genericArguments(jtype)[1];
    else {
      const sid: number = this.nominalSymbol(jtype);
      if (sid < 0 || !["InterfaceDeclaration","ClassDeclaration"].includes(this.binding.symbols[sid].kind)) return "el tipo '" + this.displayType(jtype) + "' no se puede leer de JSON (" + where + ")";
      const owner = this.binding.symbols[sid];
      for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == EdgeRole.Fields && this.attributeOf(owner.module,edge.node,AttributeKind.IsStatic) != "true") {
        const field: number = this.binding.files[owner.module].declarations[edge.node];
        fieldNames.push(this.attributeOf(owner.module,edge.node,AttributeKind.Name)); fieldTypes.push(this.instantiateMember(jtype,this.symbolType(field,owner.module,edge.node)));
      }
    }
    if (kind != "object") return "se esperaba object en " + where + " y hay " + kind;
    let seen: string[] = []; this.jsonAt = this.jsonAt + 1; this.jsonSpace();
    if (this.jsonText.charAt(this.jsonAt) == "}") this.jsonAt = this.jsonAt + 1;
    else while (true) {
      this.jsonSpace(); if (this.jsonKind() != "string") return "JSON no válido en " + where;
      const key: string = this.jsonString(); this.jsonSpace();
      if (this.jsonText.charAt(this.jsonAt) != ":") return "JSON no válido en " + where; this.jsonAt = this.jsonAt + 1;
      let at: number = -1; for (let k: number = 0; k < fieldNames.length; k = k + 1) if (fieldNames[k] == key) at = k;
      const error: string = valueType != "" ? this.jsonMatch(valueType, where + "." + key) : at >= 0 ? this.jsonMatch(fieldTypes[at], where + "." + key) : this.jsonSkip(where + "." + key);
      if (error != "") return error; seen.push(key); this.jsonSpace();
      if (this.jsonText.charAt(this.jsonAt) == ",") { this.jsonAt = this.jsonAt + 1; continue; }
      if (this.jsonText.charAt(this.jsonAt) == "}") { this.jsonAt = this.jsonAt + 1; break; }
      return "JSON no válido en " + where;
    }
    for (let k: number = 0; k < fieldNames.length; k = k + 1) if (!seen.includes(fieldNames[k]) && genericBase(fieldTypes[k]) != "Optional") return "falta el campo '" + fieldNames[k] + "' en " + where;
    return "";
  }
  literalShape(typeText: string): string {
    const sid: number = this.nominalSymbol(typeText); if (sid < 0) return typeText;
    const owner = this.binding.symbols[sid]; let entries: string[] = [];
    for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == EdgeRole.Fields) {
      const field: number = this.binding.files[owner.module].declarations[edge.node];
      entries.push(this.attributeOf(owner.module,edge.node,AttributeKind.Name) + ":" + this.symbolType(field,owner.module,edge.node));
    }
    // La forma no depende del orden de los campos.
    for (let at: number = 1; at < entries.length; at = at + 1) for (let back: number = at; back > 0 && entries[back - 1].localeCompare(entries[back]) > 0; back = back - 1) { const swap: string = entries[back]; entries[back] = entries[back - 1]; entries[back - 1] = swap; }
    const key: string = entries.join(";");
    for (let at: number = 0; at < this.literalShapeKeys.length; at = at + 1) if (this.literalShapeKeys[at] == key) return this.literalShapeTypes[at];
    this.literalShapeKeys.push(key); this.literalShapeTypes.push(typeText); return typeText;
  }
  node(module: number, id: number): AstNode { return this.graph.modules[module].cached.result.ast.nodes[id]; }
  // Lecturas de un nodo sin copiarlo: node() devuelve una copia del AstNode
  // (atributos, aristas y tokens) en cada llamada.
  kindOf(module: number, id: number): NodeKind { return this.graph.modules[module].cached.result.ast.nodes[id].kind; }
  attributeOf(module: number, id: number, name: AttributeKind): string { return this.graph.modules[module].cached.result.ast.nodes[id].get(name); }
  childOf(module: number, id: number, role: EdgeRole): number { for (const edge of this.graph.modules[module].cached.result.ast.nodes[id].edges) if (edge.role == role) return edge.node; return -1; }
  report(module: number, id: number, message: string): void {
    // Suppress cascades with the exact same owner/message, not independent errors.
    const token = this.node(module, id).start;
    const candidate = diagnosticAt("checker",message,this.graph.modules[module].file,this.node(module,id));
    for (const d of this.result.diagnostics) if (d.file == this.graph.modules[module].file && d.token.offset == token.offset && d.code == candidate.code && d.message == candidate.message && d.generatedId == this.node(module,id).generatedId && d.generatedToken.offset == this.node(module,id).generatedStart.offset) return;
    this.result.diagnostics.push(candidate);
  }
  unsupported(module: number, id: number, feature: string): string { this.report(module, id, "Comprobación nativa pendiente: " + feature); return "!error"; }
  compatible(actual: string, expected: string): boolean {
    if (this.compatibilityDepth > 128) return false;
    this.compatibilityDepth = this.compatibilityDepth + 1; const result: boolean = this.compatibleInner(actual,expected); this.compatibilityDepth = this.compatibilityDepth - 1; return result;
  }
  parameterBound(text: string): string {
    const sid: number = parameterToken(text,this.binding.symbols.length); if (sid < 0) return "";
    const s = this.binding.symbols[sid]; const n: AstNode = this.node(s.module,s.node);
    if (n.get(AttributeKind.Constraint) != "") return this.annotation(s.module,s.node,n.get(AttributeKind.Constraint));
    return "";
  }
  compatibleInner(actual: string, expected: string): boolean {
    if (actual == "!never") return true;
    // T | undefined (Optional<T>) admite undefined y cualquier T, como en TypeScript.
    if (genericBase(expected) == "Optional" && actual == "undefined") return true;
    if (genericBase(expected) == "Optional" && genericBase(actual) != "Optional" && this.compatible(actual,genericArguments(expected)[0])) return true;
    if (typeCompatible(actual,expected)) return true;
    // Un literal de tipo se ensancha a su primitivo: `"Hola"` es un string.
    if (literalType(actual) && primitiveType(expected)) return literalKind(actual) == expected;
    // El primitivo ensancha a un literal solo si el tipo literal es el primitivo
    // sin restringir: un `string` no es un `"Hola"`, eso lo comprueba el valor.
    if (literalType(expected) && primitiveType(actual)) return literalKind(expected) == actual;
    if (borrowedType(actual) && !borrowedType(expected)) return this.compatible(memoryInner(actual),expected);
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
      for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == EdgeRole.Fields || edge.role == EdgeRole.Methods) {
        const field: AstNode = this.node(owner.module,edge.node); const member: number = this.memberSymbol(actual,field.get(AttributeKind.Name));
        if (member < 0) { if (field.get(AttributeKind.Optional) != "true") return false; }
        else {
          const source = this.binding.symbols[member]; const declaration: AstNode = this.node(source.module,source.node);
          if (declaration.get(AttributeKind.Access) == "private" || declaration.get(AttributeKind.Access) == "protected" || declaration.get(AttributeKind.IsStatic) == "true") return false;
          const required: number = this.binding.files[owner.module].declarations[edge.node];
          let supplied: string = this.instantiateMember(actual,this.symbolType(member,source.module,source.node));
          const wanted: string = this.instantiateMember(expected,this.symbolType(required,owner.module,edge.node));
          let sourceParameters: number[] = []; let targetParameters: number[] = [];
          for (const parameter of declaration.edges) if (parameter.role == EdgeRole.TypeParameters) sourceParameters.push(parameter.node);
          for (const parameter of field.edges) if (parameter.role == EdgeRole.TypeParameters) targetParameters.push(parameter.node);
          if (sourceParameters.length != targetParameters.length) return false;
          // Generic method parameters are alpha-equivalent, not symbol-identical.
          for (let at: number = 0; at < sourceParameters.length; at = at+1) {
            const from: string = "@"+numberToString(this.binding.files[source.module].declarations[sourceParameters[at]]);
            const to: string = "@"+numberToString(this.binding.files[owner.module].declarations[targetParameters[at]]);
            const sourceBound: string = this.attributeOf(source.module,sourceParameters[at],AttributeKind.Constraint);
            const targetBound: string = this.attributeOf(owner.module,targetParameters[at],AttributeKind.Constraint);
            if (sourceBound != targetBound) return false;
            supplied = replaceType(supplied,from,to);
          }
          if (!this.compatible(supplied,wanted)) return false;
        }
      } return true;
    }
    const sid: number = this.nominalSymbol(actual);
    if (sid >= 0 && this.binding.symbols[sid].kind == "EnumDeclaration") {
      const s = this.binding.symbols[sid]; return this.attributeOf(s.module,s.node,AttributeKind.Underlying) == expected;
    } return false;
  }
  requireType(module: number, id: number, actual: string, expected: string): void {
    if (borrowedType(actual) && this.transferType(expected)) this.report(module,id,"E4101: una vista prestada no puede copiarse como owner");
    this.literalRange(module,id,expected);
    if (this.literalMismatch(module,id,actual,expected)) return;
    if (ownedType(expected) && actual == memoryInner(expected) && id >= 0 && this.kindOf(module,id) == NodeKind.NewExpression) return;
    if (id >= 0 && actual != expected && actual != "!error" && expected != "!error" && expected != "" && this.compatible(actual,expected)) this.result.files[module].conversions[id] = expected;
    if (!this.compatible(actual, expected)) this.report(module, id, "E3001: Tipos incompatibles: se esperaba '" + this.displayType(expected) + "' y se encontró '" + this.displayType(actual) + "'" + catalogArg("esperado", this.displayType(expected)) + catalogArg("encontrado", this.displayType(actual)));
  }
  // Comprueba si el valor de la posicion coincide con un tipo literal. Un
  // literal de tipo solo acepta el valor exacto: `"Hola"` no satisface
  // `"Adios"`. Devuelve true cuando ya se emitio un diagnostico.
  literalMismatch(module: number, id: number, actual: string, expected: string): boolean {
    const targets: string[] = splitTypes(expected,"|");
    let hasLiteral: boolean = false;
    for (const target of targets) if (literalType(target)) hasLiteral = true;
    if (!hasLiteral) return false;
    if (id < 0) return false;
    const value: string = this.nodeLiteralValue(module,id);
    if (value == "") return false;
    const kind: string = this.nodeLiteralKind(module,id);
    if (kind == "") return false;
    for (const target of targets) {
      if (!literalType(target)) continue;
      if (literalKind(target) != kind) continue;
      if (literalValue(target) == value) return false;
    }
    this.report(module,id,"El valor '" + value + "' no pertenece a '" + this.displayType(expected) + "'");
    return true;
  }
  // Tipo primitivo del literal de la posicion: string, number o boolean.
  nodeLiteralKind(module: number, id: number): string {
    const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.UnaryExpression && (n.get(AttributeKind.Operator) == "-" || n.get(AttributeKind.Operator) == "+")) return this.nodeLiteralKind(module,bindingChild(n,EdgeRole.Operand));
    if (n.kind != NodeKind.LiteralExpression) return "";
    return n.get(AttributeKind.LiteralType);
  }
  // Valor canonico de un literal de expresion: el texto ya viene decodificado
  // por el lexer, y los numeros se canonicalizan con la misma regla que el
  // parser. Devuelve "" si la posicion no es un literal simple.
  nodeLiteralValue(module: number, id: number): string {
    const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.UnaryExpression && (n.get(AttributeKind.Operator) == "-" || n.get(AttributeKind.Operator) == "+")) {
      const operand: number = bindingChild(n,EdgeRole.Operand); const inner: string = this.nodeLiteralValue(module,operand);
      if (inner == "") return "";
      if (n.get(AttributeKind.Operator) == "-") return "-" + inner;
      return inner;
    }
    if (n.kind != NodeKind.LiteralExpression) return "";
    const kind: string = n.get(AttributeKind.LiteralType);
    if (kind == "string" || kind == "boolean") return n.get(AttributeKind.Value);
    if (kind == "number") { const raw: string = n.get(AttributeKind.Raw) == "" ? n.get(AttributeKind.Value) : n.get(AttributeKind.Raw); const exact: string = nativeIntegerText(raw); return exact == "" ? "" : exact; }
    return "";
  }
  literalRange(module: number, id: number, expected: string): void {
    if (!numericType(expected) || id < 0) return;
    let n: AstNode = this.node(module,id); let sign: number = 1;
    if (n.kind == NodeKind.UnaryExpression && (n.get(AttributeKind.Operator) == "-" || n.get(AttributeKind.Operator) == "+")) { if (n.get(AttributeKind.Operator) == "-") sign = -1; n = this.node(module,bindingChild(n,EdgeRole.Operand)); }
    if (n.kind != NodeKind.LiteralExpression || n.get(AttributeKind.LiteralType) != "number") return;
    if (expected == "i64" || expected == "u64") {
      const exact: string = nativeInteger64(n.get(AttributeKind.Raw),sign < 0,expected);
      if (exact == "") this.report(module,id,"Literal fuera de rango para " + expected);
      else this.result.files[module].exactIntegers[id] = exact;
      return;
    }
    const parsed = nativeNumericLiteral(n.get(AttributeKind.Raw) == "" ? n.get(AttributeKind.Value) : n.get(AttributeKind.Raw));
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
  // `new Error(…)`: Error es la interfaz del prelude; se construye su BaseError.
  constructorName(module: number, id: number, name: string): string {
    if (name != "Error") return name;
    const scope: number = this.binding.files[module].nodeScopes[id];
    const target: number = this.origin(this.lookup(scope,"Error",true)); const base: number = this.origin(this.lookup(scope,"BaseError",false));
    if (target >= 0 && this.binding.symbols[target].kind == "InterfaceDeclaration" && base >= 0 && this.binding.symbols[base].kind == "ClassDeclaration") return "BaseError";
    return name;
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
    for (const r of this.nodeReferences(module,id)) { const ref = this.binding.references[r]; if (ref.name == names[0] && ref.space == "query" && !ref.deferred) { sid = ref.target; break; } }
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
    return id < 0 ? -1 : this.binding.files[module].valueTargets[id];
  }
  nominal(sid: number): string { return "#" + numberToString(sid); }
  displayType(text: string): string {
    // Los tipos nominales ("#<symbolId>") y los parametros de tipo ("@<symbolId>")
    // se codifican con ids internos. En los mensajes del usuario se sustituyen
    // por el nombre del simbolo: "#218" -> "Point", "@219" -> "T".
    // Un literal de tipo ("$lit:string=Hola") se muestra como el literal fuente.
    let result: string = undefinedDisplay(text);
    if (result.indexOf(literalTypePrefix(),0) >= 0) {
      for (const part of splitTypes(result,"|")) {
        if (!literalType(part)) continue;
        const kind: string = literalKind(part); const value: string = literalValue(part);
        const shown: string = kind == "string" ? "\"" + value + "\"" : kind == "boolean" ? value : value;
        result = replaceType(result, part, shown);
      }
    }
    if (result.indexOf("#",0) < 0 && result.indexOf("@",0) < 0) return result;
    for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid + 1) {
      const symbol: BindingSymbol = this.binding.symbols[sid];
      if (symbol.name == "") continue;
      if (["ClassDeclaration","InterfaceDeclaration","EnumDeclaration","UnionDeclaration"].includes(symbol.kind)) result = replaceType(result, this.nominal(sid), symbol.name);
      if (symbol.kind == "TypeParameter") result = replaceType(result, "@" + numberToString(sid), symbol.name);
    }
    return result;
  }
  // Ruta estrechable de un acceso: s<símbolo>.campo.campo o this.campo; "" si no lo es.
  accessPath(module: number, id: number): string {
    if (id < 0) return ""; const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.IdentifierExpression) {
      const sid: number = this.reference(module,id);
      if (sid >= 0) return "s" + numberToString(sid);
      if (n.get(AttributeKind.Name) == "this") return "this";
      return "";
    }
    if (n.kind != NodeKind.MemberExpression || n.get(AttributeKind.Optional) == "true") return "";
    const base: string = this.accessPath(module,bindingChild(n,EdgeRole.Object));
    return base == "" ? "" : base + "." + n.get(AttributeKind.Member);
  }
  pathSymbol(route: string): number {
    for (let at: number = 0; at < this.narrowedPaths.length; at = at + 1) if (this.narrowedPaths[at] == route) return -at - 2;
    this.narrowedPaths.push(route); return -this.narrowedPaths.length - 1;
  }
  narrowedPath(module: number, id: number): string {
    const route: string = this.accessPath(module,id); if (route.indexOf(".",0) < 0) return "";
    const sid: number = this.pathSymbol(route);
    for (let at: number = this.narrowedSymbols.length - 1; at >= 0; at = at - 1) if (this.narrowedSymbols[at] == sid) return this.narrowedTypes[at];
    return "";
  }
  // Una asignación puede cambiar cualquier ruta: se olvidan todas.
  forgetPaths(): void {
    let symbols: number[] = []; let types: string[] = [];
    for (let at: number = 0; at < this.narrowedSymbols.length; at = at + 1) if (this.narrowedSymbols[at] >= -1) { symbols.push(this.narrowedSymbols[at]); types.push(this.narrowedTypes[at]); }
    this.narrowedSymbols = symbols; this.narrowedTypes = types;
  }
  flowType(sid: number, module: number, id: number): string {
    for (let at: number = this.narrowedSymbols.length - 1; at >= 0; at = at - 1) if (this.narrowedSymbols[at] == sid) return this.narrowedTypes[at];
    const declared: string = this.symbolType(sid,module,id);
    if (sid >= 0) { const s = this.binding.symbols[sid]; if (s.kind == "VariableDeclaration" && this.attributeOf(s.module,s.node,AttributeKind.Mutable) != "true") { const init: number = this.childOf(s.module,s.node,EdgeRole.Initializer); if (init >= 0 && genericBase(this.result.files[s.module].types[init]) == "variant") return this.result.files[s.module].types[init]; } }
    return declared;
  }
  alwaysReturns(module: number, id: number): boolean {
    if (id < 0) return false; const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.ReturnStatement) return true;
    if (n.kind == NodeKind.BlockStatement) { for (const edge of n.edges) if (edge.role == EdgeRole.Statements && this.alwaysReturns(module,edge.node)) return true; }
    if (n.kind == NodeKind.IfStatement) return this.alwaysReturns(module,bindingChild(n,EdgeRole.ThenBranch)) && this.alwaysReturns(module,bindingChild(n,EdgeRole.ElseBranch));
    return false;
  }
  affectsFacts(module: number, id: number): boolean {
    if (id < 0) return false; const n: AstNode = this.node(module,id);
    if (isCallableNodeKind(n.kind) || n.kind == NodeKind.ClassDeclaration) return false;
    if ([NodeKind.CallExpression,NodeKind.MemberCallExpression,NodeKind.NewExpression,NodeKind.AssignmentExpression,NodeKind.CompoundAssignmentExpression,NodeKind.UpdateExpression].includes(n.kind)) return true;
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
  undefinedLiteral(module: number, id: number): boolean {
    if (id < 0) return false; const n: AstNode = this.node(module,id);
    if (n.kind != NodeKind.IdentifierExpression || n.get(AttributeKind.Name) != "undefined") return false;
    const sid: number = this.reference(module,id); return sid >= 0 && (this.binding.symbols[sid].module) < 0;
  }
  narrowCondition(module: number, id: number, truth: boolean): void {
    if (id < 0) return; const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.UnaryExpression && n.get(AttributeKind.Operator) == "!") { this.narrowCondition(module,bindingChild(n,EdgeRole.Operand),!truth); return; }
    if (n.kind == NodeKind.BinaryExpression && ((n.get(AttributeKind.Operator) == "&&" && truth) || (n.get(AttributeKind.Operator) == "||" && !truth))) { this.narrowCondition(module,bindingChild(n,EdgeRole.Left),truth); this.narrowCondition(module,bindingChild(n,EdgeRole.Right),truth); return; }
    if (n.kind == NodeKind.BinaryExpression && n.get(AttributeKind.Operator) == "instanceof") {
      const source: number = bindingChild(n,EdgeRole.Left); if (this.kindOf(module,source) != NodeKind.IdentifierExpression) return;
      const sid: number = this.reference(module,source); const receiver: string = this.result.files[module].types[bindingChild(n,EdgeRole.Right)]; const target: string = receiver.slice(6,receiver.length); const nominal: number = this.nominalSymbol(target);
      let parts: string[] = [];
      for (const part of splitTypes(this.flowType(sid,module,id),"|")) { const value: string = memoryValue(part); const matches: boolean = value == target || (target == "number" && numericType(value)) || (nominal >= 0 && this.nominalSymbol(value) == nominal); if (matches == truth) parts.push(part); }
      this.narrowedSymbols.push(sid); this.narrowedTypes.push(parts.length == 0 ? "!never" : joinTypes(parts,"|")); return;
    }
    if (n.kind == NodeKind.BinaryExpression && ["==","!=","===","!=="].includes(n.get(AttributeKind.Operator))) {
      // x != undefined: dentro de la rama, x es T (no Optional<T>).
      const left: number = bindingChild(n,EdgeRole.Left); const right: number = bindingChild(n,EdgeRole.Right);
      const leftUndefined: boolean = this.undefinedLiteral(module,left); const rightUndefined: boolean = this.undefinedLiteral(module,right);
      if (leftUndefined != rightUndefined) {
        const subject: number = leftUndefined ? right : left;
        if (this.kindOf(module,subject) == NodeKind.MemberExpression) {
          // #213: x.cause !== undefined estrecha la ruta completa x.cause.
          const route: string = this.accessPath(module,subject); if (route.indexOf(".",0) < 0) return;
          let currentPath: string = this.narrowedPath(module,subject); if (currentPath == "") currentPath = this.result.files[module].types[subject];
          if (genericBase(memoryValue(currentPath)) != "Optional") return;
          const presentPath: boolean = (n.get(AttributeKind.Operator) == "!=" || n.get(AttributeKind.Operator) == "!==") == truth;
          if (presentPath) { this.narrowedSymbols.push(this.pathSymbol(route)); this.narrowedTypes.push(genericArguments(memoryValue(currentPath))[0]); }
          return;
        }
        if (this.kindOf(module,subject) != NodeKind.IdentifierExpression) return;
        const sid: number = this.reference(module,subject); const current: string = this.flowType(sid,module,id);
        if (genericBase(memoryValue(current)) != "Optional") return;
        const present: boolean = (n.get(AttributeKind.Operator) == "!=" || n.get(AttributeKind.Operator) == "!==") == truth;
        if (present) { this.narrowedSymbols.push(sid); this.narrowedTypes.push(genericArguments(memoryValue(current))[0]); }
        return;
      }
      let query: number = bindingChild(n,EdgeRole.Left); let literal: number = bindingChild(n,EdgeRole.Right);
      if (this.kindOf(module,query) != NodeKind.UnaryExpression) { query = bindingChild(n,EdgeRole.Right); literal = bindingChild(n,EdgeRole.Left); }
      const op: AstNode = this.node(module,query); const tag: AstNode = this.node(module,literal);
      if (op.kind == NodeKind.UnaryExpression && op.get(AttributeKind.Operator) == "typeof" && tag.kind == NodeKind.LiteralExpression && tag.get(AttributeKind.LiteralType) == "string") {
        const operand: number = bindingChild(op,EdgeRole.Operand);
        if (this.kindOf(module,operand) == NodeKind.IdentifierExpression) {
          const sid: number = this.reference(module,operand); let parts: string[] = [];
          const match: boolean = n.get(AttributeKind.Operator) == "!=" || n.get(AttributeKind.Operator) == "!==" ? !truth : truth;
          for (const alternative of splitTypes(this.flowType(sid,module,id),"|")) {
            const value: string = memoryValue(alternative); const kind: string = functionClose(value) >= 0 ? "function" : numericType(value) ? "number" : ["string","boolean","void"].includes(value) ? (value == "void" ? "undefined" : value) : "object";
            if ((kind == tag.get(AttributeKind.Value)) == match) parts.push(alternative);
          }
          this.narrowedSymbols.push(sid); this.narrowedTypes.push(parts.length == 0 ? "!never" : joinTypes(parts,"|")); return;
        }
      }
    }
    let member: number = id; let key: string = "boolean:true";
    if (n.kind == NodeKind.BinaryExpression && ["==","!=","===","!=="].includes(n.get(AttributeKind.Operator))) {
      member = bindingChild(n,EdgeRole.Left); let literal: number = bindingChild(n,EdgeRole.Right);
      if (this.kindOf(module,member) != NodeKind.MemberExpression) { member = bindingChild(n,EdgeRole.Right); literal = bindingChild(n,EdgeRole.Left); }
      key = this.caseKey(module,literal,[]);
      if (n.get(AttributeKind.Operator) == "!=" || n.get(AttributeKind.Operator) == "!==") truth = !truth;
    }
    const access: AstNode = this.node(module,member); if (access.kind != NodeKind.MemberExpression || key == "") return;
    const object: number = bindingChild(access,EdgeRole.Object); if (this.kindOf(module,object) != NodeKind.IdentifierExpression) return;
    const sid: number = this.reference(module,object); const valueType: string = this.flowType(sid,module,id); let parts: string[] = [];
    for (const alternative of splitTypes(valueType,"|")) {
    const owner: number = this.nominalSymbol(alternative);
    if (owner < 0 || this.binding.symbols[owner].kind != "UnionDeclaration") { parts.push(alternative); continue; }
    const declaration = this.binding.symbols[owner]; const base: string = genericBase(alternative) == "variant" ? genericArguments(alternative)[0] : alternative;
    const current: string = genericBase(alternative) == "variant" ? genericArguments(alternative)[1] : "";
    for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == EdgeRole.Variants && (current == "" || current == numberToString(edge.node))) {
      const variant: AstNode = this.node(declaration.module,edge.node); const discriminator: number = bindingChild(variant,EdgeRole.Discriminator); let value: string = "";
      if (access.get(AttributeKind.Member) == "kind") value = "string:" + variant.get(AttributeKind.Name);
      if (discriminator >= 0) { const d: AstNode = this.node(declaration.module,discriminator); if (d.get(AttributeKind.Field) == access.get(AttributeKind.Member)) value = d.get(AttributeKind.LiteralType) + ":" + d.get(AttributeKind.Value); }
      if (value == "") { parts.push(alternative); break; }
      if ((value == key) == truth) parts.push("variant<" + base + "," + numberToString(edge.node) + ">");
    }
    }
    this.narrowedSymbols.push(sid); this.narrowedTypes.push(parts.length == 0 ? "!never" : joinTypes(parts,"|"));
  }
  nominalSymbol(text: string): number {
    if (genericBase(text) == "variant") return this.nominalSymbol(genericArguments(text)[0]);
    const sid: number = canonicalSymbol(text); return sid < this.binding.symbols.length ? sid : -1;
  }
  genericParameters(sid: number): number[] {
    let result: number[] = []; const s = this.binding.symbols[sid]; if ((s.module) < 0) return result;
    for (const e of this.node(s.module,s.node).edges) if (e.role == EdgeRole.TypeParameters) result.push(e.node); return result;
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
      if (parameter.get(AttributeKind.Variadic) == "true") { this.report(module,id,"Los packs de tipos sólo se admiten en funciones"); return "!error"; }
      if (i >= values.length || values[i] == "") {
        if (parameter.get(AttributeKind.Default) == "") { this.report(module,id,"Falta un argumento de tipo para '" + parameter.get(AttributeKind.Name) + "'"); return "!error"; }
        let value: string = this.annotation(s.module,parameters[i],parameter.get(AttributeKind.Default));
        for (let p: number = 0; p < i; p = p + 1) value = replaceType(value,"@" + numberToString(this.binding.files[s.module].declarations[parameters[p]]),values[p]);
        if (i >= values.length) values.push(value); else values[i] = value;
      }
      if (parameter.get(AttributeKind.Constraint) != "") {
        let constraint: string = this.annotation(s.module,parameters[i],parameter.get(AttributeKind.Constraint));
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
    const grouped: string = ungroupElement(text); if (grouped != text) return this.annotation(module,id,grouped);
    if (literalType(text)) {
      const kind: string = literalKind(text); const value: string = literalValue(text);
      if (kind != "string" && kind != "number" && kind != "boolean") { this.report(module,id,"Un literal de tipo debe ser de tipo string, number o boolean"); return "!error"; }
      if (value == "") { this.report(module,id,"Un literal de tipo necesita un valor"); return "!error"; }
      return text;
    }
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
    if (text == "undefined") { this.report(module,id,"'undefined' solo como parte de un tipo: T | undefined\nayuda: escribe por ejemplo 'number | undefined'"); return "!error"; }
    const unions: string[] = splitTypes(text,"|");
    if (unions.length > 1) {
      // T | undefined es Optional<T> (std::optional en C++): sin valor especial.
      let present: string[] = []; let absent: boolean = false;
      for (const p of unions) { if (p.trim() == "undefined" || p.trim() == "null") absent = true; else present.push(p); }
      if (absent) { if (present.length == 0) { this.report(module,id,"Un tipo no puede ser solo undefined"); return "!error"; } return "Optional<" + this.annotation(module,id,joinTypes(present,"|")) + ">"; }
      let parts: string[] = [];
      for (const p of unions) parts.push(this.annotation(module,id,p));
      return joinTypes(parts,"|");
    }
    const intersection: string[] = splitTypes(text,"&");
    if (intersection.length > 1) {
      let parts: string[] = []; for (const p of intersection) {
        const part: string = this.annotation(module,id,p); const sid: number = this.nominalSymbol(part);
        if (sid < 0 || !["ClassDeclaration","InterfaceDeclaration"].includes(this.binding.symbols[sid].kind)) this.report(module,id,"Una intersección requiere contratos de clase o interfaz");
        parts.push(part);
      } return joinTypes(parts,"&");
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
          const declaration: AstNode = this.node(s.module,s.node); if (declaration.get(AttributeKind.Mutable) == "true") break;
          const init: number = bindingChild(declaration,EdgeRole.Initializer); if (init < 0) break;
          const value: AstNode = this.node(s.module,init);
          if (value.kind == NodeKind.LiteralExpression && value.get(AttributeKind.LiteralType) == "number") { extent = nativeIntegerText(value.get(AttributeKind.Raw)); break; }
          if (value.kind == NodeKind.IdentifierExpression) sid = this.origin(this.reference(s.module,init)); else sid = -1;
        }
      }
      const size = nativeNumericLiteral(extent);
      if (extent == "" || !size.valid || size.value <= 0 || size.value > 2147483647) { this.report(module,id,"Tamaño de array fijo fuera de rango; requiere constante entera positiva hasta 2147483647"); return "!error"; }
      const element: string = this.annotation(module,id,text.slice(0,open));
      if (element == "void") this.report(module,id,"Un array fijo no puede contener void");
      return semanticFixedArray(element,size.value);
    }
    if (text.startsWith("$typeof$")) return this.queryType(module,id,text.slice(8,text.length));
    // Campo de Partial/Pick/Omit/Required<X> ($fieldof$campo$X): el tipo del campo en X.
    if (text.startsWith("$fieldof$") || text.startsWith("$fieldreq$")) {
      const required: boolean = text.startsWith("$fieldreq$"); const tail: string = text.slice(required ? 10 : 9,text.length); const split: number = tail.indexOf("$",0);
      const base: string = this.annotation(module,id,tail.slice(split+1,tail.length)); if (base.startsWith("!")) return base;
      const member: number = this.memberSymbol(base,tail.slice(0,split));
      if (member < 0) { this.report(module,id,"El tipo '" + this.displayType(base) + "' no tiene el campo '" + tail.slice(0,split) + "'"); return "!error"; }
      const fieldType: string = this.instantiateMember(base,this.symbolType(member,this.binding.symbols[member].module,this.binding.symbols[member].node));
      if (required && genericBase(fieldType) == "Optional") return genericArguments(fieldType)[0];
      return fieldType;
    }
    // #223: campo de la interfaz sintética de un literal sin tipo: el tipo de su valor.
    if (text.startsWith("$valueof$")) { let node: number = 0; for (let at: number = 9; at < text.length; at = at + 1) node = node * 10 + text.charCodeAt(at) - 48;
      // Un literal de objeto anidado no se comprueba aquí: lo hará su propio literal,
      // quizá con contexto (o se quedaría tipado sin él y en caché).
      if (this.kindOf(module,node) == NodeKind.ObjectLiteralExpression && this.attributeOf(module,node,AttributeKind.DeclaredType) != "") return this.annotation(module,node,this.attributeOf(module,node,AttributeKind.DeclaredType));
      const valueType: string = this.expression(module,node,""); return literalType(valueType) ? literalKind(valueType) : valueType; }
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
    if (s.kind == "builtin-type" && ["JsonValue","FileReader","TcpListener","TcpConnection","TlsContext","TlsConnection","CancellationSource","CancellationToken","Request","Response","Server","HttpClientResponse","Timer","FsWatcher","FsEvent","Console","ProcessReadable","ProcessWritable","ChildProcess"].includes(s.name)) return s.name;
    return this.unsupported(module,id,"tipo " + text);
  }
  asynchronous(module: number, id: number): boolean {
    const n: AstNode = this.node(module,id); return n.get(AttributeKind.Async) == "true" || n.get(AttributeKind.IsAsync) == "true";
  }
  suspensionContext(module: number, id: number): void {
    let at: number = this.binding.files[module].parents[id];
    while (at >= 0) {
      const n: AstNode = this.node(module,at); if (isCallableNodeKind(n.kind)) return;
      if (n.kind == NodeKind.ClassField) { this.report(module,id,"E4204: suspender en un inicializador de campo requiere un contrato de duración del constructor"); return; }
      at = this.binding.files[module].parents[at];
    }
  }
  awaitContext(module: number, id: number): void {
    this.suspensionContext(module,id);
    let at: number = this.binding.files[module].parents[id];
    while (at >= 0) {
      const n: AstNode = this.node(module,at);
      if (n.kind == NodeKind.Parameter) { this.report(module,id,"await no es válido en un default de parámetro"); return; }
      if (isCallableNodeKind(n.kind)) { if (!this.asynchronous(module,at)) this.report(module,id,"await sólo es válido dentro de async o en el nivel superior"); return; }
      at = this.binding.files[module].parents[at];
    }
  }
  signature(module: number, id: number): string {
    const n: AstNode = this.node(module,id); let params: string[] = [];
    for (const e of n.edges) if (e.role == EdgeRole.Params) {
      let value: string = this.parameterType(module,e.node); const rest: boolean = this.attributeOf(module,e.node,AttributeKind.Variadic) == "true";
      if (rest && genericBase(value) == "pack") value = genericArguments(value)[0];
      params.push((rest ? "..." : "") + value);
    }
    let returns: string = this.annotation(module,id,n.get(AttributeKind.ReturnType));
    if (returns == "") {
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes; this.narrowedSymbols = []; this.narrowedTypes = [];
      const body: number = bindingChild(n,EdgeRole.Body);
      if (body >= 0 && this.kindOf(module,body) == NodeKind.BlockStatement) {
        let values: string[] = []; this.inferReturns(module,body,values);
        if (values.length == 0) returns = "void"; else returns = joinTypes(values,"|");
      } else returns = this.expression(module,body,"");
      this.narrowedSymbols = symbols; this.narrowedTypes = types;
    }
    if (this.asynchronous(module,id)) {
      if (n.get(AttributeKind.ReturnType) == "") returns = "Promise<" + returns + ">";
      else if (genericBase(returns) != "Promise") this.report(module,id,"Una función async debe retornar Promise<T>");
    }
    return "(" + params.join(",") + ")=>" + returns;
  }
  inferReturns(module: number, id: number, values: ref<string[]>): void {
    const n: AstNode = this.node(module,id);
    // Nested callables own their returns; they cannot determine this signature.
    if (isCallableNodeKind(n.kind) || n.kind == NodeKind.ClassDeclaration) return;
    if ([NodeKind.CallExpression,NodeKind.MemberCallExpression,NodeKind.NewExpression,NodeKind.AssignmentExpression,NodeKind.CompoundAssignmentExpression,NodeKind.UpdateExpression].includes(n.kind)) { this.narrowedSymbols = []; this.narrowedTypes = []; return; }
    if (n.kind == NodeKind.IfStatement) {
      const condition: number = bindingChild(n,EdgeRole.Condition); this.expression(module,condition,"");
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes;
      this.narrowCondition(module,condition,true); const yes: number = bindingChild(n,EdgeRole.ThenBranch); if (yes >= 0) this.inferReturns(module,yes,values);
      this.narrowedSymbols = symbols; this.narrowedTypes = types; this.narrowCondition(module,condition,false);
      const no: number = bindingChild(n,EdgeRole.ElseBranch); if (no >= 0) this.inferReturns(module,no,values);
      this.narrowedSymbols = symbols; this.narrowedTypes = types;
      this.afterIf(module,condition,yes,no);
      return;
    }
    if (n.kind == NodeKind.ReturnStatement) {
      const value: string = this.expression(module,bindingChild(n,EdgeRole.Value),"");
      if (!values.includes(value)) values.push(value);
      return;
    }
    for (const edge of n.edges) this.inferReturns(module,edge.node,values);
  }
  parameterType(module: number, id: number): string {
    const n: AstNode = this.node(module,id); const text: string = this.annotation(module,id,n.get(AttributeKind.Type));
    if (n.get(AttributeKind.Variadic) == "true" && this.packToken(text)) return "pack<" + text + ">";
    return n.get(AttributeKind.Optional) == "true" && genericBase(text) != "Optional" ? "Optional<" + text + ">" : text;
  }
  transferType(text: string): boolean {
    // Mismo recorrido que antes sobre todos los símbolos, pero solo por los
    // campos que siguen sin tipo (los demás ya no cambian).
    this.index(); const pending: number[] = this.pendingFields; let rest: number[] = [];
    for (const sid of pending) {
      const field = this.binding.symbols[sid];
      if (this.result.symbolTypes[sid] == "" && this.symbolStates[sid] != 1) this.symbolType(sid,field.module,field.node);
      if (this.result.symbolTypes[sid] == "") rest.push(sid);
    }
    this.pendingFields = rest;
    // Con todos los campos ya tipados el resultado no cambia: se memoriza. Cada
    // consulta de una clase recorría todos los símbolos buscando sus campos (#344).
    if (!this.resourceIndex.built) this.resourceIndex = resourceFields(this.graph,this.binding);
    if (rest.length > 0) return resourceType(this.graph,this.binding,this.result,this.resourceIndex,text,[]);
    const found: Optional<boolean> = this.transferMemo.get(text); if (found.isPresent()) return found.value();
    const result: boolean = resourceType(this.graph,this.binding,this.result,this.resourceIndex,text,[]); this.transferMemo.set(text,result); return result;
  }
  packToken(text: string): boolean {
    const sid: number = parameterToken(text,this.binding.symbols.length); if (sid < 0) return false;
    const symbol = this.binding.symbols[sid]; return symbol.kind == "TypeParameter" && this.attributeOf(symbol.module,symbol.node,AttributeKind.Variadic) == "true";
  }
  packActuals(module: number, args: number[], actual: string[], positions: number[], rest: number): string[] {
    let values: string[] = [];
    for (let at: number = 0; at < args.length; at = at + 1) if (positions[at] == rest) {
      if (genericBase(actual[at]) == "pack") { for (const item of genericArguments(actual[at])) values.push(item); }
      else if (this.kindOf(module,args[at]) == NodeKind.SpreadElement) {
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
    for (const edge of declaration.edges) if (edge.role == EdgeRole.TypeParameters) genericNodes.push(edge.node);
    for (const attr of this.node(module,id).attributes) if (attr.name == AttributeKind.TypeArgument) explicitTypes.push(this.annotation(module,id,attr.value));
    const values: string[] = this.packActuals(module,args,actual,positions,rest);
    if (values.includes("!invalid-pack-spread")) return "";
    const normal: number = genericNodes.length-1;
    if (explicitTypes.length > 0 && (explicitTypes.length) < normal) return "";
    for (let g: number = 0; g < genericNodes.length; g = g + 1) {
      const parameter: AstNode = this.node(ownerModule,genericNodes[g]); const token: string = "@" + numberToString(this.binding.files[ownerModule].declarations[genericNodes[g]]); let value: string = "";
      if (parameter.get(AttributeKind.Variadic) == "true") {
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
        if (value == "" && parameter.get(AttributeKind.Default) != "") value = this.annotation(ownerModule,genericNodes[g],parameter.get(AttributeKind.Default));
        if (value == "") return "";
        if (parameter.get(AttributeKind.Constraint) != "" && !this.compatible(value,this.annotation(ownerModule,genericNodes[g],parameter.get(AttributeKind.Constraint)))) return "";
      }
      signature = replaceType(signature,token,value);
    }
    const instantiated: string[] = functionParams(signature); let at: number = 0;
    for (const edge of declaration.edges) if (edge.role == EdgeRole.Params) {
      const parameter: AstNode = this.node(ownerModule,edge.node);
      if (at != rest && parameter.get(AttributeKind.Optional) != "true" && bindingChild(parameter,EdgeRole.DefaultValue) < 0 && !positions.includes(at)) return "";
      at = at + 1;
    }
    let used: number[] = [];
    for (let a: number = 0; a < args.length; a = a + 1) {
      const position: number = positions[a]; if (position < 0 || position > rest) return "";
      if (position == rest) { if (this.kindOf(module,args[a]) == NodeKind.NamedArgumentExpression) return ""; continue; }
      if (used.includes(position) || this.kindOf(module,args[a]) == NodeKind.SpreadElement) return ""; used.push(position);
      let target: string = instantiated[position];
      if (this.optionalParameter(ownerModule,candidate,position) && genericBase(target) == "Optional" && genericBase(actual[a]) != "Optional" && actual[a] != "undefined") target = genericArguments(target)[0];
      if (!this.compatible(actual[a],target)) return "";
    }
    return signature;
  }
  optionalParameter(module: number, id: number, position: number): boolean {
    let at: number = 0; for (const e of this.node(module,id).edges) if (e.role == EdgeRole.Params) { if (at == position) return this.attributeOf(module,e.node,AttributeKind.Optional) == "true"; at = at + 1; } return false;
  }
  argumentPosition(module: number, declaration: number, sourceModule: number, argument: number, position: number): number {
    const n: AstNode = this.node(sourceModule,argument);
    if (n.kind != NodeKind.NamedArgumentExpression) {
      const rest: number = restPosition(this.signature(module,declaration));
      return rest >= 0 && position >= rest ? rest : position;
    }
    let at: number = 0;
    for (const edge of this.node(module,declaration).edges) if (edge.role == EdgeRole.Params) {
      if (this.attributeOf(module,edge.node,AttributeKind.Name) == n.get(AttributeKind.Name)) return at;
      at = at + 1;
    } return -1;
  }
  argumentValue(module: number, id: number): number {
    const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.NamedArgumentExpression) return bindingChild(n,EdgeRole.Value);
    if (n.kind == NodeKind.SpreadElement) return bindingChild(n,EdgeRole.Expression);
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
        const payload: string = this.annotation(s.module,s.node,n.get(AttributeKind.Payload));
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
      } else if (s.kind == "TypeAliasDeclaration") valueType = this.annotation(s.module,s.node,n.get(AttributeKind.Type));
      else if (s.kind == "VariableDeclaration" || s.kind == "UsingDeclaration") {
        valueType = this.annotation(s.module,s.node,n.get(AttributeKind.DeclaredType));
        if (valueType == "") valueType = this.expression(s.module,bindingChild(n,EdgeRole.Initializer),"");
        if (genericBase(valueType) == "variant") valueType = genericArguments(valueType)[0];
      } else if (s.kind == "Parameter" || s.kind == "ClassField" || s.kind == "InterfaceField" || s.kind == "UnionVariantBinding") { if (n.kind == NodeKind.Parameter) valueType = this.parameterType(s.module,s.node); else valueType = this.annotation(s.module,s.node,n.get(AttributeKind.Type));
        // #223: un campo opcional (b?: T) es T | undefined, como en TypeScript.
        if (s.kind == "InterfaceField" && n.get(AttributeKind.Optional) == "true" && genericBase(valueType) != "Optional") valueType = "Optional<" + valueType + ">"; }
      else if (s.namespaceModule >= 0) valueType = "namespace";
      else if (s.kind.endsWith("Expression")) valueType = this.expression(s.module,s.node,"");
      else valueType = this.unsupported(useModule,useNode,"símbolo " + s.kind);
    }
    this.result.symbolTypes[target] = valueType; this.symbolStates[target] = 2; return valueType;
  }
  builtin(name: string): string {
    if (numericType(name)) return "!cast:" + name;
    if (name == "undefined") return "undefined";
    if (name == "comptime") return "!comptime";
    if (name == "match") return "!match";
    if (name == "optionalMap" || name == "optionalAndThen") return "!optionalGlobal:"+(name == "optionalMap" ? "map" : "andThen");
    if (["when","whenType","otherwise"].includes(name)) return "!matchCase";
    if (name == "print" || name == "printError" || name == "write" || name == "writeError") return "!print";
    if (name == "numberToString") return "(number)=>string";
    if (name == "sleep") return "(number)=>Promise<void>";
    if (["all","race","promiseAll","promiseRace"].includes(name)) return "!tasks:" + name;
    if (name == "spawn") return "(Promise<void>)=>void";
    if (name == "move" || name == "ref" || name == "constRef") return "!" + name;
    if (["Math","JSON","Date","String","Array","Object","Promise"].includes(name)) return "!" + name;
    if (name == "console") return "Console";
    if (nativeBuiltinSignatures(name).length > 0) return "!builtin:"+name;

    if (name == "jsonAsNumber" || name == "jsonArrayLength") return "(JsonValue)=>number";
    if (["optionalSome","optionalNone","optionalIsPresent","optionalValueOr","optionalOrElse","resultOk","resultErr","resultIsOk","resultValueOr","ok","err"].includes(name)) return "!container:" + name;
    return "!error";
  }
  // Nombres de los miembros declarados de un tipo nominal (para sugerencias).
  // Array.isArray(x), Array.of(...items) y Array.from(fuente, mapFn?) con la firma de TypeScript.
  // Promise.all/race/any/allSettled/resolve. Sin excepciones una promesa no se
  // rechaza: any es race y allSettled da Result<T, Error>[] (todos correctos).
  promiseStaticCall(module: number, id: number, method: string, expected: string): string {
    let args: number[] = []; for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    if (method == "resolve") {
      if (args.length != 1) { this.report(module,id,"Promise.resolve requiere un argumento"); return "!error"; }
      const inner: string = genericBase(expected) == "Promise" ? genericArguments(expected)[0] : "";
      let value: string = memoryValue(this.expression(module,args[0],inner)); if (literalType(value)) value = literalKind(value);
      if (inner != "") { this.requireType(module,args[0],value,inner); value = inner; }
      this.result.files[module].signatures[id] = "(" + value + ")=>Promise<" + value + ">"; return "Promise<" + value + ">";
    }
    if (args.length != 1) { this.report(module,id,"Promise." + method + " requiere un array de Promise<T>"); return "!error"; }
    let context: string = "";
    if (genericBase(expected) == "Promise") {
      const awaited: string = genericArguments(expected)[0];
      if (method == "all" && awaited.endsWith("[]")) context = "Promise<" + semanticElement(awaited) + ">[]";
      if (method == "race" || method == "any") context = "Promise<" + awaited + ">[]";
    }
    const input: string = memoryValue(this.expression(module,args[0],context));
    if (!input.endsWith("[]") || genericBase(semanticElement(input)) != "Promise") { this.report(module,args[0],"Promise." + method + " requiere Promise<T>[]"); return "!error"; }
    const element: string = genericArguments(semanticElement(input))[0];
    let result: string = element;
    if (method == "all") result = semanticArray(element);
    if (method == "allSettled") result = semanticArray("Result<" + element + "," + this.annotation(module,id,"Error") + ">");
    this.result.files[module].signatures[id] = "(" + input + ")=>Promise<" + result + ">"; this.result.files[module].argumentParameters[args[0]] = 0;
    return "Promise<" + result + ">";
  }
  // Object.keys/values/entries de un Record (Map, en orden de inserción) o de un
  // objeto con campos (en orden de declaración); values y entries piden que todos
  // los campos tengan el mismo tipo.
  objectStaticCall(module: number, id: number, method: string): string {
    let args: number[] = []; for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    if (args.length != 1) { for (const arg of args) this.expression(module,arg,""); this.report(module,id,"Object." + method + " requiere un argumento"); return "!error"; }
    const source: string = memoryValue(this.expression(module,args[0],"")); if (source.startsWith("!")) return "!error";
    let keyType: string = "string"; let valueType: string = "";
    if (genericBase(source) == "Map") { keyType = genericArguments(source)[0]; valueType = genericArguments(source)[1]; }
    else {
      const sid: number = this.nominalSymbol(source);
      if (sid < 0 || !["InterfaceDeclaration","ClassDeclaration"].includes(this.binding.symbols[sid].kind)) { this.report(module,args[0],"Object." + method + " acepta un Record o un objeto con campos, no " + this.displayType(source)); return "!error"; }
      const owner = this.binding.symbols[sid];
      for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == EdgeRole.Fields && this.attributeOf(owner.module,edge.node,AttributeKind.IsStatic) != "true") {
        const field: string = memoryValue(this.instantiateMember(source,this.symbolType(this.binding.files[owner.module].declarations[edge.node],owner.module,edge.node)));
        if (valueType == "") valueType = field;
        else if (valueType != field && method != "keys") { this.report(module,id,"Object." + method + " necesita que todos los campos de " + this.displayType(source) + " tengan el mismo tipo"); return "!error"; }
      }
      if (valueType == "") valueType = "never";
    }
    let result: string = keyType + "[]"; if (method == "values") result = valueType + "[]"; if (method == "entries") result = "[" + keyType + "," + valueType + "][]";
    if (method != "keys" && valueType == "never") { this.report(module,id,"Object." + method + " de un objeto sin campos"); return "!error"; }
    this.result.files[module].signatures[id] = "(" + source + ")=>" + result; return result;
  }
  arrayStaticCall(module: number, id: number, method: string, expected: string): string {
    let args: number[] = []; for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    if (method == "isArray") {
      if (args.length != 1) { this.report(module,id,"Array.isArray requiere un argumento"); return "!error"; }
      const value: string = this.expression(module,args[0],"");
      this.result.files[module].signatures[id] = "(" + value + ")=>boolean"; return "boolean";
    }
    if (method == "of") {
      let element: string = semanticElement(expected) != "" && expected.endsWith("[]") ? semanticElement(expected) : "";
      let actual: string[] = [];
      for (const arg of args) {
        let value: string = memoryValue(this.expression(module,arg,element)); if (literalType(value)) value = literalKind(value);
        if (element == "") element = value;
        this.requireType(module,arg,value,element); actual.push(element);
      }
      if (element == "") { this.report(module,id,"Array.of() sin elementos necesita un tipo de destino"); return "!error"; }
      this.result.files[module].signatures[id] = "(" + actual.join(",") + ")=>" + element + "[]"; return element + "[]";
    }
    // Array.from(fuente, mapFn?): fuente array, Set, Map o string.
    if (args.length < 1 || args.length > 2) { for (const arg of args) this.expression(module,arg,""); this.report(module,id,"Aridad incorrecta de Array.from"); return "!error"; }
    const source: string = memoryValue(this.expression(module,args[0],""));
    let element: string = "";
    if (source.endsWith("[]")) element = semanticElement(source);
    else if (genericBase(source) == "Set") element = genericArguments(source)[0];
    else if (genericBase(source) == "Map") element = "[" + genericArguments(source)[0] + "," + genericArguments(source)[1] + "]";
    else if (source == "string") element = "string";
    else { this.report(module,args[0],"Array.from acepta un array, Set, Map o string, no " + this.displayType(source)); return "!error"; }
    if (args.length == 1) { this.result.files[module].signatures[id] = "(" + source + ")=>" + element + "[]"; return element + "[]"; }
    const callback: string = this.expression(module,args[1],"");
    if (functionClose(callback) < 0) { this.report(module,args[1],"Array.from requiere un callback como segundo argumento"); return "!error"; }
    const inputs: string[] = functionParams(callback);
    if (inputs.length < 1 || inputs.length > 2) { this.report(module,args[1],"El callback de Array.from recibe (valor) o (valor, índice)"); return "!error"; }
    this.requireType(module,args[1],memoryValue(inputs[0]),element);
    if (inputs.length == 2) this.requireType(module,args[1],memoryValue(inputs[1]),"number");
    const result: string = functionReturn(callback);
    this.result.files[module].signatures[id] = "(" + source + "," + callback + ")=>" + result + "[]"; return result + "[]";
  }

  // Número de argumentos de la llamada id (0 si no es una llamada).
  // Tipo del primer argumento si es el RegExp de estatic:regexp ("" si no).
  regexpArgument(module: number, id: number): string {
    let first: number = -1; for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Args && first < 0) first = edge.node;
    if (first < 0) return "";
    const argument: string = memoryValue(this.expression(module,first,""));
    const sid: number = this.nominalSymbol(argument); if (sid < 0 || this.binding.symbols[sid].kind != "ClassDeclaration" || this.binding.symbols[sid].module < 0) return "";
    return this.graph.modules[this.binding.symbols[sid].module].file.endsWith("runtime/lib/regexp.ts") ? argument : "";
  }
  callArity(module: number, id: number): number {
    let count: number = 0; for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Args) count = count + 1;
    return count;
  }
  memberNames(valueType: string): string[] {
    let names: string[] = []; let receiver: string = memoryValue(valueType); if (receiver.startsWith("class:")) receiver = receiver.slice(6,receiver.length);
    for (const part of splitTypes(receiver,"&")) {
      const owner: number = this.nominalSymbol(part); if (owner < 0) continue;
      const s: BindingSymbol = this.binding.symbols[owner];
      for (const i of this.scopeMembers(s.module,s.node)) { const item = this.binding.symbols[i]; if (item.name != "constructor" && !names.includes(item.name)) names.push(item.name); }
    }
    return names;
  }
  unknownMember(valueType: string, name: string): string {
    const display: string = this.displayType(valueType);
    const message: string = "E3002: El tipo '" + display + "' no declara el miembro '" + name + "'";
    const args: string = catalogArg("tipo", display) + catalogArg("miembro", name);
    if (display == "ProcessReadable") return message + "\nayuda: un stream de lectura (process.stdin, child.stdout) solo tiene .on(\"data\" | \"end\", ...)\nnota: para dejar de leer antes de que acabe la entrada, usa process.exit(código)" + args + catalogVariant("lectura");
    if (display == "ProcessWritable") return message + "\nayuda: un stream de escritura (process.stdout, child.stdin) tiene .write(texto) y .end()" + args + catalogVariant("escritura");
    const names: string[] = this.memberNames(valueType);
    const suggestion: string = closestName(name, names);
    if (suggestion != "") return message + "\nayuda: ¿querías decir '" + suggestion + "'?" + args + catalogArg("sugerencia", suggestion) + catalogVariant("sugerencia");
    if (names.length > 0 && names.length <= 10) return message + "\nnota: miembros de '" + display + "': " + names.join(", ") + args + catalogArg("miembros", names.join(", ")) + catalogVariant("lista");
    return message + args;
  }
  memberSymbol(valueType: string, name: string): number {
    let receiver: string = memoryValue(valueType); if (receiver.startsWith("class:")) receiver = receiver.slice(6,receiver.length);
    const parts: string[] = splitTypes(receiver,"&");
    if (parts.length > 1) { for (const part of parts) { const found: number = this.memberSymbol(part,name); if (found >= 0) return found; } return -1; }
    const owner: number = this.nominalSymbol(receiver); if (owner < 0) return -1;
    const s: BindingSymbol = this.binding.symbols[owner];
    for (const i of this.scopeMembers(s.module,s.node)) if (this.binding.symbols[i].name == name) return i;
    return -1;
  }
  member(module: number, id: number, input: string, name: string, query: boolean = false): string {
    const boundType: string = this.parameterBound(memoryValue(input));
    const valueType: string = boundType == "" ? memoryValue(input) : boundType;
    const bound: number = query ? -1 : this.reference(module,id); if (bound >= 0) { this.result.files[module].members[id] = bound; return this.symbolType(bound,module,id); }
    if (valueType == "!error") return valueType;
    if (valueType == "!never") return "!error";
    const alternatives: string[] = splitTypes(valueType,"|");
    if (alternatives.length > 1) {
      let values: string[] = []; for (const alternative of alternatives) { const found: string = this.member(module,id,alternative,name,query); if (!values.includes(found)) values.push(found); } return joinTypes(values,"|");
    }
    if (valueType.startsWith("class:")) {
      const receiver: string = valueType.slice(6,valueType.length); const owner: number = this.nominalSymbol(receiver);
      if (owner >= 0 && this.binding.symbols[owner].kind == "UnionDeclaration") {
        const declaration = this.binding.symbols[owner];
        for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == EdgeRole.Variants && this.attributeOf(declaration.module,edge.node,AttributeKind.Name) == name) {
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
      for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == EdgeRole.Variants && (refinement.length == 0 || refinement[1] == numberToString(edge.node))) {
        const variant: AstNode = this.node(declaration.module,edge.node); let found: string = "";
        const discriminator: number = bindingChild(variant,EdgeRole.Discriminator);
        if (name == "kind") found = "string";
        if (discriminator >= 0 && this.attributeOf(declaration.module,discriminator,AttributeKind.Field) == name) found = this.attributeOf(declaration.module,discriminator,AttributeKind.LiteralType);
        let bindings: number = 0;
        for (const field of variant.edges) if (field.role == EdgeRole.Bindings) {
          bindings = bindings + 1;
          if (this.attributeOf(declaration.module,field.node,AttributeKind.Name) == name) { selectedMember = this.binding.files[declaration.module].declarations[field.node]; found = this.instantiateMember(base,this.symbolType(selectedMember,module,id)); }
        }
        if (name == "value" && bindings == 0 && variant.get(AttributeKind.Payload) != "") found = this.instantiateMember(base,this.annotation(declaration.module,edge.node,variant.get(AttributeKind.Payload)));
        if (found == "") { this.report(module,id,"El miembro '" + name + "' requiere narrowing a una variante que lo declare"); return "!error"; }
        if (!values.includes(found)) values.push(found);
      }
      if (refinement.length > 0 && !query) this.result.files[module].members[id] = selectedMember;
      return values.length == 0 ? "!error" : joinTypes(values,"|");
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
      // Firmas de TypeScript: los argumentos opcionales se resuelven por la
      // aridad de la llamada (el runtime C++ tiene los mismos valores por defecto).
      const count: number = this.callArity(module,id);
      // Con un RegExp de estatic:regexp: las firmas de TypeScript (match da
      // undefined si no hay match, matchAll un array de matches).
      if (["replace","replaceAll","match","matchAll","search","split"].includes(name)) {
        const pattern: string = this.regexpArgument(module,id);
        if (pattern != "") {
          if (name == "replace" || name == "replaceAll") return "(" + pattern + ",string)=>string";
          if (name == "match") return "(" + pattern + ")=>Optional<string[]>";
          if (name == "matchAll") return "(" + pattern + ")=>string[][]";
          if (name == "search") return "(" + pattern + ")=>number";
          return "(" + pattern + ")=>string[]";
        }
      }
      if (name == "charAt") return count == 0 ? "()=>string" : "(number)=>string";
      if (name == "charCodeAt") return count == 0 ? "()=>number" : "(number)=>number";
      if (name == "at") return "(number)=>Optional<string>";
      if (name == "codePointAt") return "(number)=>Optional<number>";
      if (name == "includes") return "!builtin:string.includes";
      if (["startsWith","endsWith"].includes(name)) return count == 2 ? "(string,number)=>boolean" : "(string)=>boolean";
      if (name == "indexOf" || name == "lastIndexOf") return count == 2 ? "(string,number)=>number" : "(string)=>number";
      if (name == "localeCompare") return "(string)=>number";
      if (["trim","trimStart","trimEnd","trimLeft","trimRight","toUpperCase","toLowerCase","toString"].includes(name)) return "()=>string";
      if (name == "slice") return count == 0 ? "()=>string" : count == 1 ? "(number)=>string" : "(number,number)=>string";
      if (name == "substring" || name == "substr") return count == 1 ? "(number)=>string" : "(number,number)=>string";
      if (name == "split") return count == 2 ? "(string,number)=>string[]" : "(string)=>string[]";
      if (name == "concat") return "(...string[])=>string";
      if (name == "repeat") return "(number)=>string";
      if (name == "padStart" || name == "padEnd") return count == 1 ? "(number)=>string" : "(number,string)=>string";
      if (name == "replace" || name == "replaceAll") return "(string,string)=>string";
    }
    if (valueType == "!String" && (name == "fromCharCode" || name == "fromCodePoint")) return "(...number[])=>string";
    if (valueType == "!Array" && ["isArray","from","of"].includes(name)) return "!arrayStatic." + name;
    if (valueType == "!Object" && ["keys","values","entries"].includes(name)) return "!objectStatic." + name;
    if (valueType == "!Promise" && ["all","race","any","allSettled","resolve"].includes(name)) return "!promiseStatic." + name;
    if (valueType.endsWith("[]")) {
      const element: string = semanticElement(valueType);
      if (["map","filter","reduce","reduceRight","forEach","find","findIndex","findLast","findLastIndex","some","every","flatMap","sort","toSorted","concat"].includes(name)) return "!array." + name;
      // Firmas de TypeScript; los argumentos opcionales se resuelven por aridad.
      const count: number = this.callArity(module,id);
      // Con un solo valor la firma es fija para que el valor conserve su conversión (move).
      if (name == "push" || name == "unshift") return count == 1 ? "(" + element + ")=>number" : "(..." + valueType + ")=>number";
      if (name == "pop" || name == "shift") return "()=>Optional<" + element + ">";
      if (name == "at") return "(number)=>Optional<" + element + ">";
      if (name == "includes") return count == 2 ? "(" + element + ",number)=>boolean" : "(" + element + ")=>boolean";
      if (name == "indexOf" || name == "lastIndexOf") return count == 2 ? "(" + element + ",number)=>number" : "(" + element + ")=>number";
      if (name == "join") return count == 0 ? "()=>string" : "(string)=>string";
      if (name == "reverse" || name == "toReversed") return "()=>" + valueType;
      if (name == "fill") return "(" + element + (count > 1 ? ",number" : "") + (count > 2 ? ",number" : "") + ")=>" + valueType;
      if (name == "with") return "(number," + element + ")=>" + valueType;
      if (name == "keys") return "()=>number[]";
      if (name == "values") return "()=>" + valueType;
      if (name == "entries") return "()=>[number," + element + "][]";
      if (name == "splice" || name == "toSpliced") {
        // splice(start, deleteCount?, ...items): splice devuelve lo quitado, toSpliced la copia.
        let params: string = "number"; if (count > 1) params = params + ",number"; for (let k: number = 2; k < count; k = k+1) params = params + "," + element;
        return "(" + params + ")=>" + valueType;
      }
      if (name == "flat") {
        // flat(profundidad = 1): la profundidad debe ser un literal para conocer el tipo.
        let depth: number = 1;
        if (count > 0) {
          let argument: number = -1; for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Args && argument < 0) argument = edge.node;
          const literal: AstNode = this.node(module,argument);
          const digits: string = literal.get(AttributeKind.Raw) == "" ? literal.get(AttributeKind.Value) : literal.get(AttributeKind.Raw);
          let integer: boolean = digits.length > 0; for (let at: number = 0; at < digits.length; at = at+1) if (digits.charCodeAt(at) < 48 || digits.charCodeAt(at) > 57) integer = false;
          if (literal.kind != NodeKind.LiteralExpression || literal.get(AttributeKind.LiteralType) != "number" || !integer) { this.report(module,argument,"flat requiere una profundidad entera literal"); return "!error"; }
          depth = 0;
          for (let at: number = 0; at < digits.length; at = at+1) depth = depth * 10 + (digits.charCodeAt(at) - 48);
        }
        let result: string = valueType;
        for (let level: number = 0; level < depth && semanticElement(result).endsWith("[]"); level = level+1) result = semanticElement(result);
        return (count > 0 ? "(number)=>" : "()=>") + result;
      }
      if (name == "slice") {
        // Como en JavaScript, slice(start) llega hasta el final: process.argv.slice(2).
        return (this.callArity(module,id) == 1 ? "(number)=>" : "(number,number)=>") + valueType;
      }
    }
    const container: string = genericBase(valueType); const parts: string[] = genericArguments(valueType);
    if (container == "Map" || container == "Set") {
      if (name == "size") return this.kindOf(module,id) == NodeKind.MemberCallExpression ? "()=>number" : "number";
      if (name == "forEach") return "!array.forEach";
      if (name == "has" || name == "delete") return "(" + parts[0] + ")=>boolean";
      if (name == "clear") return "()=>void";
      if (container == "Map" && name == "get") return "(" + parts[0] + ")=>Optional<" + parts[1] + ">";
      if (container == "Map" && name == "set") return "(" + parts[0] + "," + parts[1] + ")=>Map<" + parts[0] + "," + parts[1] + ">";
      if (container == "Set" && name == "add") return "(" + parts[0] + ")=>Set<" + parts[0] + ">";
      // keys/values/entries devuelven arrays (en JavaScript son iteradores).
      if (name == "keys") return "()=>" + parts[0] + "[]";
      if (name == "values") return "()=>" + (container == "Map" ? parts[1] : parts[0]) + "[]";
      if (name == "entries") return "()=>[" + parts[0] + "," + (container == "Map" ? parts[1] : parts[0]) + "][]";
    }
    if (container == "Optional" || container == "Result") {
      if (container == "Result" && name == "kind") return "string";
      if (container == "Result" && name == "ok") return "boolean";
      if (container == "Optional" && ["map","andThen"].includes(name)) return "!optional." + name;
      if (container == "Optional" && name == "orElse") return "(" + valueType + ")=>" + valueType;
      if (name == "value") return "()=>" + parts[0];
      if (name == "valueOr") return "(" + parts[0] + ")=>" + parts[0];
      if ((container == "Optional" && ["isPresent","isEmpty"].includes(name)) || (container == "Result" && name == "isOk")) return "()=>boolean";
      if (container == "Result" && name == "error") return "()=>" + parts[1];
    }
    // process.argv y process.argc son propiedades, como en Node (process.argv es
    // string[]). argc es una extensión del dialecto: process.argv.length.
    if (valueType == "!process" && ["argv","argc"].includes(name)) {
      if (this.kindOf(module,id) == NodeKind.MemberCallExpression) { this.report(module,id,"process."+name+" es una propiedad, no una función (como en Node)\nayuda: escribe process."+name+" sin paréntesis"); return "!error"; }
      return name == "argv" ? "string[]" : "number";
    }
    if (valueType == "!process" && ["stdin"].includes(name)) return "ProcessReadable";
    if (valueType == "!process" && ["stdout","stderr"].includes(name)) return "ProcessWritable";
    if (valueType == "ChildProcess" && name == "stdin") return "ProcessWritable";
    if (valueType == "ChildProcess" && ["stdout","stderr"].includes(name)) return "ProcessReadable";
    if (valueType == "Request" && this.kindOf(module,id) == NodeKind.MemberExpression && ["method","path","rawQuery","body"].includes(name)) return "string";
    const catalog: string = valueType+"."+name;
    if (nativeBuiltinSignatures(catalog).length > 0) return "!builtin:"+catalog;
    const sid: number = this.memberSymbol(valueType,name);
    if (sid < 0) { this.report(module,id,this.unknownMember(valueType,name)); return "!error"; }
    if (!query) this.result.files[module].members[id] = sid;
    const s: BindingSymbol = this.binding.symbols[sid]; const n: AstNode = this.node(s.module,(s.node) < 0 ? this.graph.modules[s.module].cached.result.ast.root : s.node);
    if (((n.get(AttributeKind.IsStatic) == "true") || s.kind == "EnumMember") != valueType.startsWith("class:")) this.report(module,id,"Receptor estático/de instancia incorrecto para '" + name + "'");
    if (n.get(AttributeKind.Access) == "private" || n.get(AttributeKind.Access) == "protected") {
      const owner: number = this.binding.scopes[s.scope].node; let scope: number = this.binding.files[module].nodeScopes[id]; let allowed: boolean = false;
      while (scope >= 0) { if (this.binding.scopes[scope].module == s.module && this.binding.scopes[scope].node == owner) allowed = true; scope = this.binding.scopes[scope].parent; }
      if (!allowed) this.report(module,id,"Miembro privado '" + name + "'");
    }
    return this.instantiateMember(valueType,this.symbolType(sid,module,id));
  }
  // Un método de la misma clase al que se llama sobre `this` solo muta si
  // ese método muta: un getter encadenado no invalida al receptor.
  siblingMethod(s: BindingSymbol, name: string): number {
    if (name == "") return -1;
    for (let at: number = 0; at < this.binding.symbols.length; at = at+1) {
      const candidate: BindingSymbol = this.binding.symbols[at];
      if (candidate.kind == "ClassMethod" && candidate.module == s.module && candidate.scope == s.scope && candidate.name == name) return at;
    }
    return -1;
  }
  methodMutates(sid: number): boolean {
    const s: BindingSymbol = this.binding.symbols[sid]; if ((s.module) < 0 || s.kind != "ClassMethod") return false;
    const key: string = numberToString(s.module) + ":" + numberToString(s.node);
    const cached: Optional<number> = this.mutationCache.get(key);
    if (cached.isPresent()) {
      const state: number = cached.value();
      if (state == 2) return false;
      return state == 1;
    }
    this.mutationCache.set(key,2);
    const result: boolean = this.methodMutatesBody(s);
    this.mutationCache.set(key,result ? 1 : 0);
    return result;
  }
  methodMutatesBody(s: BindingSymbol): boolean {
    let work: number[] = []; for (const declaration of s.declarations) work.push(declaration);
    while (work.length > 0) {
      const nodeId: number = work[work.length-1]; const n: AstNode = this.node(s.module,nodeId); work.pop();
      let target: number = -1;
      if (n.kind == NodeKind.AssignmentExpression || n.kind == NodeKind.CompoundAssignmentExpression || n.kind == NodeKind.UpdateExpression) target = bindingChild(n,EdgeRole.Target);
      else if (n.kind == NodeKind.MemberCallExpression) {
        const object: number = bindingChild(n,EdgeRole.Object);
        const receiver: AstNode = this.node(s.module,object);
        const name: string = n.get(AttributeKind.Method);
        if (receiver.kind == NodeKind.IdentifierExpression && receiver.get(AttributeKind.Name) == "this") {
          const sibling: number = this.siblingMethod(s,name);
          if (sibling >= 0 && this.methodMutates(sibling)) return true;
        } else if (receiver.kind == NodeKind.MemberExpression) {
          // Un builtin que muta un campo de `this` cambia su estado observable.
          const base: number = bindingChild(receiver,EdgeRole.Object);
          const baseNode: AstNode = this.node(s.module,base);
          if (baseNode.kind == NodeKind.IdentifierExpression && baseNode.get(AttributeKind.Name) == "this" && ["push","pop","sort","shift","unshift","reverse","fill","splice","set","add","delete","clear"].includes(name)) return true;
        }
        for (const edge of n.edges) work.push(edge.node);
        continue;
      }
      else if (n.kind == NodeKind.CallExpression) { const helper: number = this.reference(s.module,nodeId); if (helper >= 0 && this.binding.symbols[helper].name == "move" && (this.binding.symbols[helper].module) < 0) target = bindingChild(n,EdgeRole.Args); }
      while (target >= 0) {
        const receiver: AstNode = this.node(s.module,target);
        if (receiver.kind == NodeKind.IdentifierExpression && receiver.get(AttributeKind.Name) == "this") return true;
        if (receiver.kind != NodeKind.MemberExpression && receiver.kind != NodeKind.IndexExpression) break;
        target = bindingChild(receiver,EdgeRole.Object);
      }
      for (const edge of n.edges) work.push(edge.node);
    } return false;
  }
  writable(module: number, id: number): void { this.writableTarget(module,id,false); }
  mutableArgument(module: number, id: number, actual: string): void {
    if (borrowedType(actual)) return;
    if (![NodeKind.IdentifierExpression,NodeKind.MemberExpression,NodeKind.IndexExpression].includes(this.kindOf(module,id))) { this.report(module,id,"E4208: un préstamo mutable necesita un lvalue"); return; }
    const before: number = this.result.diagnostics.length; this.writableTarget(module,id,false);
    if (this.result.diagnostics.length > before) this.report(module,id,"E4208: el argumento no admite un préstamo mutable");
  }
  compositionFields(sid: number): number[] {
    let fields: number[] = []; const owner = this.binding.symbols[sid];
    for (const edge of this.node(owner.module,owner.node).edges) if (edge.role == EdgeRole.Fields && this.attributeOf(owner.module,edge.node,AttributeKind.IsStatic) != "true") fields.push(this.binding.files[owner.module].declarations[edge.node]);
    return fields;
  }
  compositionConstructor(module: number, id: number, valueType: string, sid: number): void {
    const fields: number[] = this.compositionFields(sid); let defaults: boolean = false; let parameters: string[] = [];
    for (const field of fields) { const s = this.binding.symbols[field]; if (this.childOf(s.module,s.node,EdgeRole.DefaultValue) >= 0) defaults = true; parameters.push(this.instantiateMember(valueType,this.symbolType(field,module,id))); }
    this.result.files[module].constructionFields[id] = fields;
    let seen: number[] = []; let count: number = 0; let named: boolean = false;
    for (const edge of this.node(module,id).edges) if (edge.role == EdgeRole.Args) {
      const argument: AstNode = this.node(module,edge.node); let position: number = count;
      if (argument.kind == NodeKind.NamedArgumentExpression) {
        named = true; position = -1;
        for (let at: number = 0; at < fields.length; at = at+1) if (this.binding.symbols[fields[at]].name == argument.get(AttributeKind.Name)) position = at;
      } else if (named) this.report(module,edge.node,"Un argumento posicional no puede seguir a uno nombrado");
      if (argument.kind == NodeKind.SpreadElement) this.report(module,edge.node,"El constructor de composición requiere argumentos de campo individuales");
      if (position < 0 || position >= fields.length) this.report(module,edge.node,"Campo de constructor desconocido o argumento sobrante");
      else { if (seen.includes(position)) this.report(module,edge.node,"Argumento de constructor duplicado"); seen.push(position); this.result.files[module].argumentParameters[edge.node] = position; }
      const expected: string = position >= 0 && position < parameters.length ? parameters[position] : "";
      const actual: string = this.expression(module,edge.node,expected); if (expected != "") this.requireType(module,this.argumentValue(module,edge.node),actual,expected);
      count = count+1;
    }
    if ((defaults && count != 0) || (!defaults && seen.length != fields.length)) this.report(module,id,defaults ? "El constructor con inicializadores de campo no admite argumentos" : "Aridad incorrecta del constructor de composición");
    if (defaults) for (let at: number = 0; at < fields.length; at = at+1) {
      const field = this.binding.symbols[fields[at]];
      if (this.transferType(parameters[at]) && this.childOf(field.module,field.node,EdgeRole.DefaultValue) < 0) this.report(module,id,"E4100: un campo con ownership necesita inicialización en el constructor");
    }
    this.result.files[module].signatures[id] = "(" + (defaults ? "" : parameters.join(",")) + ")=>" + valueType;
  }
  constructorInitialization(module: number, id: number, sid: number): boolean {
    const n: AstNode = this.node(module,id); if (n.kind != NodeKind.MemberExpression) return false;
    const object: number = bindingChild(n,EdgeRole.Object); if (this.kindOf(module,object) != NodeKind.IdentifierExpression || this.attributeOf(module,object,AttributeKind.Name) != "this") return false;
    let scope: number = this.binding.files[module].nodeScopes[id];
    while (scope >= 0) {
      const current = this.binding.scopes[scope];
      if (current.kind == "function" || current.kind == "arrow") return this.kindOf(current.module,current.node) == NodeKind.ClassMethod && this.attributeOf(current.module,current.node,AttributeKind.Name) == "constructor" && current.parent == this.binding.symbols[sid].scope;
      scope = current.parent;
    } return false;
  }
  writableTarget(module: number, id: number, through: boolean): void {
    const n: AstNode = this.node(module,id);
    // Un valor temporal (new Set().add(1), m.set(a, 1).set(b, 2)) se puede modificar.
    if (through && [NodeKind.NewExpression,NodeKind.CallExpression,NodeKind.MemberCallExpression].includes(n.kind)) return;
    let sid: number = this.reference(module,id);
    if (n.get(AttributeKind.Optional) == "true") this.report(module,id,"El acceso opcional no es un destino asignable");
    if (readonlyType(this.result.files[module].types[id])) this.report(module,id,"E4300: destino readonly");
    if (n.kind == NodeKind.MemberExpression) {
      sid = this.result.files[module].members[id];
      const object: number = bindingChild(n,EdgeRole.Object);
      const receiver: string = memoryValue(this.result.files[module].types[object]);
      if (genericBase(receiver) == "Result" && ["kind","ok"].includes(n.get(AttributeKind.Member))) this.report(module,id,"El discriminador de Result es inmutable");
      const owner: number = this.nominalSymbol(receiver);
      if (owner >= 0 && this.binding.symbols[owner].kind == "UnionDeclaration") {
        const declaration = this.binding.symbols[owner];
        if (n.get(AttributeKind.Member) == "kind") this.report(module,id,"El discriminador de una unión es inmutable");
        for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == EdgeRole.Variants) {
          const discriminator: number = this.childOf(declaration.module,edge.node,EdgeRole.Discriminator);
          if (discriminator >= 0 && this.attributeOf(declaration.module,discriminator,AttributeKind.Field) == n.get(AttributeKind.Member)) this.report(module,id,"El discriminador de una unión es inmutable");
        }
      }
      if (receiver == "Request" && ["method","path","rawQuery","body"].includes(n.get(AttributeKind.Member))) this.report(module,id,"E4300: campo readonly de Request");
      if ((n.get(AttributeKind.Member) == "size" && ["Map","Set"].includes(genericBase(receiver))) || (n.get(AttributeKind.Member) == "length" && (receiver == "string" || receiver.endsWith("[]") || fixedArraySize(receiver) >= 0))) this.report(module,id,"Propiedad de colección readonly");
      if (!this.result.files[module].types[object].startsWith("class:")) this.writableTarget(module,object,true);
    }
    if (n.kind == NodeKind.IndexExpression) {
      const object: number = bindingChild(n,EdgeRole.Object);
      if (this.result.files[module].types[object] == "string") this.report(module,id,"No se puede modificar un string por índice");
      this.writableTarget(module,object,true); return;
    }
    if (sid >= 0) {
      const s: BindingSymbol = this.binding.symbols[sid];
      if ((s.module) < 0) { this.report(module,id,"E3005: No se puede modificar un builtin"); return; }
      if (s.kind == "receiver" || memoryMode(this.result.files[module].types[id]) == "ref") return;
      const variable: boolean = ["VariableDeclaration","ArrayBinding","ObjectBinding","UsingDeclaration"].includes(s.kind);
      const declaration: AstNode = this.node(s.module,s.kind == "ArrayBinding" || s.kind == "ObjectBinding" ? this.binding.files[s.module].parents[s.node] : s.node);
      const initialization: boolean = !through && this.constructorInitialization(module,id,sid);
      // #212: como en TypeScript, const y readonly solo impiden reasignar; el
      // contenido (campos, push, set...) se modifica a través de ellos (through).
      // La inmutabilidad en profundidad se pide con el tipo: readonly<T>, constRef<T>.
      if ((variable && declaration.get(AttributeKind.Mutable) != "true" && !through) || (declaration.get(AttributeKind.Readonly) == "true" && !initialization && !through) || (!variable && s.kind != "ClassField" && s.kind != "InterfaceField" && s.kind != "Parameter")) this.report(module,id,variable && declaration.get(AttributeKind.Mutable) != "true" ? "E3003: No se puede modificar '" + s.name + "': es inmutable porque se declaró con 'const'\nayuda: declárala con 'let' si tiene que cambiar" + catalogArg("nombre", s.name) : "E3003: No se puede modificar '" + s.name + "': es inmutable (readonly)" + catalogArg("nombre", s.name) + catalogVariant("readonly"));
      for (const r of this.nodeReferences(module,id)) if (this.binding.references[r].symbol >= 0 && this.binding.symbols[this.binding.references[r].symbol].kind == "import") this.report(module,id,"E3006: No se puede reasignar un import\nayuda: copia el valor a una variable local con 'let' si necesitas cambiarlo");
    }
  }
  containerCall(module: number, id: number, helper: string, expected: string): string {
    const n: AstNode = this.node(module,id); let args: number[] = []; let explicitTypes: string[] = [];
    for (const e of n.edges) if (e.role == EdgeRole.Args) args.push(e.node);
    for (const a of n.attributes) if (a.name == AttributeKind.TypeArgument) explicitTypes.push(this.annotation(module,id,a.value));
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
      for (const edge of n.edges) if (edge.role == EdgeRole.Args) {
        callbackType = this.expression(module,edge.node,"(" + parameters.join(",") + ")=>void");
        // Como en TypeScript, el callback puede declarar menos parámetros (forEach(v => ...)).
        const declared: number = functionParams(callbackType).length; let accepted: string[] = [];
        for (let at: number = 0; at < declared && at < parameters.length; at = at+1) accepted.push(parameters[at]);
        this.requireType(module,edge.node,callbackType,"(" + accepted.join(",") + ")=>void"); count = count + 1;
      }
      if (count != 1) this.report(module,id,"forEach requiere un callback");
      this.result.files[module].signatures[id] = "(" + callbackType + ")=>void"; return "void";
    }
    if (!array.endsWith("[]")) { this.report(module,id,"El método de array requiere un receptor"); return "!error"; }
    const element: string = semanticElement(array); let args: number[] = []; let explicitTypes: string[] = [];
    for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument) explicitTypes.push(this.annotation(module,id,attr.value));
    if (explicitTypes.length > 1 || (explicitTypes.length > 0 && !["map","flatMap","reduce","reduceRight"].includes(method))) this.report(module,id,"Argumentos de tipo no admitidos para este método de array");
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    if (method == "concat") {
      let parameters: string[] = [];
      for (const arg of args) { const actual: string = this.expression(module,arg,array); this.requireType(module,arg,actual,array); parameters.push(array); }
      this.result.files[module].signatures[id] = "(" + parameters.join(",") + ")=>" + array; return array;
    }
    // reduce(callback, inicial?) y reduceRight como en TypeScript.
    const reduce: boolean = method == "reduce" || method == "reduceRight"; const sort: boolean = method == "sort" || method == "toSorted";
    if (sort && args.length == 0) { if (!numericType(element) && element != "string") this.report(module,id,method + " sin comparador requiere números o strings"); this.result.files[module].signatures[id] = "()=>" + array; return array; }
    if (reduce ? (args.length < 1 || args.length > 2) : args.length != 1) {
      for (const arg of args) this.expression(module,arg,""); this.report(module,id,"Aridad incorrecta del método de array"); return "!error";
    }
    const initial: boolean = reduce && args.length == 2;
    let accumulator: string = ""; if (reduce) {
      if (initial) {
        accumulator = this.expression(module,args[1],explicitTypes.length == 0 ? "" : explicitTypes[0]);
        if (explicitTypes.length > 0) { this.requireType(module,args[1],accumulator,explicitTypes[0]); accumulator = explicitTypes[0]; }
      } else {
        // Sin valor inicial el acumulador es el primer elemento.
        accumulator = element;
        if (explicitTypes.length > 0) this.report(module,id,method + " sin valor inicial no admite argumento de tipo");
        if (this.transferType(element)) this.report(module,id,"E4101: " + method + " sin valor inicial copiaría un elemento con ownership");
      }
    }
    const callback: number = args[0];
    const signature: string = this.expression(module,callback,"");
    if (functionClose(signature) < 0) { this.report(module,callback,"El método de array requiere un callback"); return "!error"; }
    const returns: string = functionReturn(signature); let parameters: string[] = [element];
    if (reduce) { parameters = [accumulator,element]; }
    if (sort) parameters = [element,element];
    let expectedReturn: string = returns; if (reduce) expectedReturn = accumulator;
    if (explicitTypes.length > 0 && (method == "map" || method == "flatMap")) expectedReturn = (method == "map" ? explicitTypes[0] : semanticArray(explicitTypes[0]));
    if (["filter","find","findIndex","findLast","findLastIndex","some","every"].includes(method)) expectedReturn = "boolean";
    if (method == "forEach") expectedReturn = "void";
    if (sort) expectedReturn = "number";
    const inputs: string[] = functionParams(signature);
    // Como en TypeScript, el callback puede recibir también el índice.
    if (!sort && inputs.length == parameters.length + 1) parameters.push("number");
    if (inputs.length != parameters.length) this.report(module,callback,"Aridad incorrecta del callback de array");
    for (let at: number = 0; at < inputs.length && at < parameters.length; at = at+1) {
      if (!this.compatible(parameters[at],inputs[at])) this.report(module,callback,"Parámetro de callback incompatible con el elemento de array");
      if (memoryMode(inputs[at]) == "ref" && !(reduce && at == 0)) this.report(module,callback,"E4300: el callback observa elementos readonly");
      if (this.transferType(parameters[at]) && !borrowedType(inputs[at]) && !(reduce && at == 0)) this.report(module,callback,"E4101: el callback debe prestar el elemento con ownership");
    }
    if (!this.compatible(returns,expectedReturn)) this.report(module,callback,"Retorno del callback incompatible con el método de array");
    let adaptedInputs: string[] = [];
    for (let at: number = 0; at < parameters.length; at = at+1) adaptedInputs.push(at < inputs.length && borrowedType(inputs[at]) ? inputs[at] : parameters[at]);
    const adapted: string = "(" + adaptedInputs.join(",") + ")=>" + expectedReturn;
    if (signature != adapted) this.result.files[module].conversions[callback] = adapted;
    if (["filter","find","findLast","sort","toSorted"].includes(method) && this.transferType(array)) {
      const object: number = bindingChild(n,EdgeRole.Object); const call: AstNode = this.node(module,object); const target: number = this.reference(module,object);
      if (call.kind != NodeKind.CallExpression || target < 0 || this.binding.symbols[target].name != "move" || this.binding.symbols[target].module >= 0) this.report(module,id,"E4101: una operación que copia owners requiere consumir el array con move");
    }
    let result: string = array;
    if (method == "map") { if (returns == "void") this.report(module,callback,"map no admite un resultado void"); result = semanticArray(expectedReturn); }
    if (method == "flatMap") { if (!returns.endsWith("[]") || functionClose(returns) >= 0) this.report(module,callback,"flatMap requiere un callback que devuelva un array"); result = expectedReturn; }
    if (method == "find" || method == "findLast") result = "Optional<" + element + ">";
    if (method == "findIndex" || method == "findLastIndex") result = "number";
    if (method == "some" || method == "every") result = "boolean";
    if (method == "forEach") result = "void";
    if (reduce) result = accumulator;
    this.result.files[module].signatures[id] = "(" + adapted + (initial ? "," + accumulator : "") + ")=>" + result;
    return result;
  }
  optionalCall(module: number, id: number, method: string, receiver: string, expected: string): string {
    const n: AstNode = this.node(module,id); const element: string = genericArguments(memoryValue(receiver))[0];
    let args: number[] = []; let explicitTypes: string[] = [];
    let position: number = 0;
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) { if (n.kind == NodeKind.MemberCallExpression || position > 0) args.push(edge.node); position = position+1; }
    this.result.files[module].receivers[id] = receiver;
    for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument) explicitTypes.push(this.annotation(module,id,attr.value));
    if (explicitTypes.length > 1) this.report(module,id,"El método de Optional admite un argumento de tipo");
    if (args.length != 1) { for (const arg of args) this.expression(module,arg,""); this.report(module,id,"El método de Optional requiere un callback"); return "!error"; }
    const callback: number = args[0]; const signature: string = this.expression(module,callback,"");
    if (functionClose(signature) < 0) { this.report(module,callback,"El método de Optional requiere un callback"); return "!error"; }
    const inputs: string[] = functionParams(signature); const returns: string = functionReturn(signature);
    if (inputs.length != 1) this.report(module,callback,"Aridad incorrecta del callback de Optional");
    if (inputs.length == 1) {
      if (!this.compatible(element,inputs[0])) this.report(module,callback,"Parámetro de callback incompatible con el payload de Optional");
      if (memoryMode(inputs[0]) == "ref") this.report(module,callback,"E4300: el callback observa un payload readonly");
      if (this.transferType(element) && !borrowedType(inputs[0])) this.report(module,callback,"E4101: el callback debe prestar el payload con ownership");
    }
    let output: string = method == "map" ? returns : (genericBase(returns) == "Optional" ? genericArguments(returns)[0] : "!error");
    if (method == "andThen" && genericBase(returns) != "Optional") this.report(module,callback,"andThen requiere un callback que devuelva Optional");
    if (explicitTypes.length > 0) output = explicitTypes[0];
    else if (genericBase(expected) == "Optional") output = genericArguments(expected)[0];
    if (output == "void") this.report(module,callback,"El callback de Optional no admite un resultado void");
    const expectedReturn: string = method == "map" ? output : "Optional<" + output + ">";
    if (!this.compatible(returns,expectedReturn)) this.report(module,callback,"Retorno del callback incompatible con el método de Optional");
    const adapted: string = "(" + inputs.join(",") + ")=>" + expectedReturn;
    if (signature != adapted) this.result.files[module].conversions[callback] = adapted;
    const result: string = "Optional<" + output + ">";
    this.result.files[module].argumentParameters[callback] = (n.kind == NodeKind.MemberCallExpression ? 0 : 1);
    if (n.kind == NodeKind.CallExpression) this.result.files[module].argumentParameters[bindingChild(n,EdgeRole.Args)] = 0;
    this.result.files[module].signatures[id] = "(" + (n.kind == NodeKind.CallExpression ? receiver+"," : "") + adapted + ")=>" + result; return result;
  }
  matchCall(module: number, id: number): string {
    const n: AstNode = this.node(module,id); let args: number[] = [];
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    if (args.length != 2 && args.length != 3) { this.report(module,id,"match requiere un subject, discriminador opcional y array de casos"); return "!error"; }
    const subject: string = this.expression(module,args[0],""); let patternType: string = subject;
    if (args.length == 3) {
      const discriminator: AstNode = this.node(module,args[1]);
      if (discriminator.kind != NodeKind.LiteralExpression || discriminator.get(AttributeKind.LiteralType) != "string") { this.report(module,args[1],"El discriminador de match debe ser un string literal"); return "!error"; }
      this.expression(module,args[1],"string"); patternType = this.member(module,args[1],subject,discriminator.get(AttributeKind.Value));
    }
    const list: number = args[args.length-1]; const cases: AstNode = this.node(module,list);
    if (cases.kind != NodeKind.ArrayLiteralExpression) { this.report(module,list,"match requiere un array literal de casos"); return "!error"; }
    let results: string[] = []; let patterns: string[] = []; let fallback: boolean = false; let count: number = 0; let consumes: boolean = false; let mode: string = "constRef";
    for (const edge of cases.edges) if (edge.role == EdgeRole.Elements) {
      const item: AstNode = this.node(module,edge.node); const sid: number = this.reference(module,edge.node); let helper: string = "";
      if (sid >= 0 && (this.binding.symbols[sid].module) < 0) helper = this.binding.symbols[sid].name;
      if (item.kind != NodeKind.CallExpression || !["when","whenType","otherwise"].includes(helper)) { this.report(module,edge.node,"Un caso de match requiere when, whenType u otherwise"); continue; }
      let values: number[] = []; for (const value of item.edges) if (value.role == EdgeRole.Args) values.push(value.node);
      if (values.length != (helper == "when" ? 2 : 1)) { this.report(module,edge.node,"Aridad incorrecta del caso de match"); continue; }
      if (fallback) this.report(module,edge.node,"otherwise debe ser el último caso de match");
      let input: string = subject; let key: string = "";
      if (helper == "when") {
        this.requireType(module,values[0],this.expression(module,values[0],patternType),patternType); key = this.caseKey(module,values[0],[]);
      } else if (helper == "whenType") {
        let types: string[] = []; for (const attr of item.attributes) if (attr.name == AttributeKind.TypeArgument) types.push(this.annotation(module,edge.node,attr.value));
        if (types.length != 1) { this.report(module,edge.node,"whenType requiere exactamente un argumento de tipo"); continue; }
        input = types[0]; key = "type:" + input;
        if (!splitTypes(subject,"|").includes(input)) this.report(module,edge.node,"whenType requiere una alternativa del subject");
      } else fallback = true;
      if (key != "") { if (patterns.includes(key)) this.report(module,edge.node,"Caso de match duplicado"); patterns.push(key); }
      this.result.files[module].caseValues[edge.node] = key;
      const callback: number = values[values.length-1]; const signature: string = this.expression(module,callback,""); const parameters: string[] = functionParams(signature);
      if (functionClose(signature) < 0 || parameters.length > 1) { this.report(module,callback,"El callback de match requiere cero o un parámetro"); continue; }
      if (parameters.length == 1) {
        this.requireType(module,callback,input,parameters[0]);
        if (memoryMode(parameters[0]) == "ref") mode = "ref";
        if (this.transferType(parameters[0])) consumes = true;
        if (borrowedType(subject) && this.transferType(memoryInner(subject)) && this.transferType(parameters[0])) this.report(module,callback,"E4101: un callback no puede copiar ownership desde un subject prestado");
      }
      const result: string = functionReturn(signature); if (!results.includes(result)) results.push(result);
      this.result.files[module].types[edge.node] = "!matchCase"; this.result.files[module].signatures[edge.node] = "(" + signature + ")=>!matchCase"; count = count + 1;
    }
    if (count == 0) this.report(module,list,"match requiere al menos un caso");
    let domain: string[] = [];
    if (patternType == "boolean") domain = ["boolean:true","boolean:false"];
    if (args.length == 2 && splitTypes(subject,"|").length > 1) for (const part of splitTypes(subject,"|")) domain.push("type:"+part);
    if (args.length == 3) {
      const field: string = this.attributeOf(module,args[1],AttributeKind.Value);
      if (genericBase(subject) == "Result") { if (field == "kind") domain = ["string:Ok","string:Err"]; if (field == "ok") domain = ["boolean:true","boolean:false"]; }
      const owner: number = this.nominalSymbol(subject);
      if (owner >= 0 && this.binding.symbols[owner].kind == "UnionDeclaration") {
        const declaration = this.binding.symbols[owner];
        for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == EdgeRole.Variants) {
          const variant: AstNode = this.node(declaration.module,edge.node);
          if (field == "kind") domain.push("string:"+variant.get(AttributeKind.Name));
          else { const discriminator: number = bindingChild(variant,EdgeRole.Discriminator); if (discriminator >= 0 && this.attributeOf(declaration.module,discriminator,AttributeKind.Field) == field) domain.push(this.attributeOf(declaration.module,discriminator,AttributeKind.LiteralType)+":"+this.attributeOf(declaration.module,discriminator,AttributeKind.Value)); }
        }
      }
    }
    if (args.length == 2 && domain.length == 0) { const key: string = this.caseKey(module,args[0],[]); if (key != "") domain.push(key); }
    let total: boolean = fallback;
    if (!total && domain.length > 0) { total = true; for (const key of domain) if (!patterns.includes(key)) total = false; }
    this.result.files[module].matchCoverage[id] = (total ? "total" : "traps");
    this.result.files[module].types[list] = "!matchCase[]"; const result: string = results.length == 0 ? "void" : joinTypes(results,"|");
    let formal: string = subject;
    if (this.transferType(subject) && !consumes && [NodeKind.IdentifierExpression,NodeKind.MemberExpression,NodeKind.IndexExpression].includes(this.kindOf(module,args[0]))) {
      formal = mode+"<"+subject+">"; if (mode == "ref") this.mutableArgument(module,args[0],subject);
    }
    this.result.files[module].signatures[id] = "(" + formal + (args.length == 3 ? ",string" : "") + ",!matchCase[])=>" + result; return result;
  }
  unionCall(module: number, id: number, sid: number, receiver: string, expected: string): string {
    const symbol = this.binding.symbols[sid]; const n: AstNode = this.node(module,id); let args: number[] = [];
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    const declaration: number = this.binding.files[symbol.module].parents[symbol.node]; const owner: number = this.binding.files[symbol.module].declarations[declaration];
    let base: string = receiver.startsWith("class:") ? receiver.slice(6,receiver.length) : "";
    if (this.nominalSymbol(expected) == owner) { if (genericBase(expected) == "variant") base = genericArguments(expected)[0]; else base = expected; }
    const parameters: number[] = this.genericParameters(owner);
    if (base == "" || (parameters.length > 0 && genericBase(base) == "")) {
      let values: string[] = []; for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument) values.push(this.annotation(module,id,attr.value));
      if (values.length == 0 && parameters.length > 0 && args.length == 1) {
        const payload: string = this.annotation(symbol.module,symbol.node,this.attributeOf(symbol.module,symbol.node,AttributeKind.Payload));
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
    for (const edge of this.node(declaration.module,declaration.node).edges) if (edge.role == EdgeRole.Variants) {
      const discriminator: number = this.childOf(declaration.module,edge.node,EdgeRole.Discriminator); if (discriminator < 0) continue;
      const d: AstNode = this.node(declaration.module,discriminator); const key: string = d.get(AttributeKind.LiteralType) + ":" + d.get(AttributeKind.Value);
      for (const property of n.edges) if (property.role == EdgeRole.Properties && this.attributeOf(module,property.node,AttributeKind.Key) == d.get(AttributeKind.Field) && this.caseKey(module,this.childOf(module,property.node,EdgeRole.Value),[]) == key) selected = edge.node;
    }
    if (selected < 0) { this.report(module,id,"El objeto no selecciona una variante por un discriminador literal válido"); return "!error"; }
    const result: string = "variant<" + base + "," + numberToString(selected) + ">"; let provided: string[] = [];
    for (const edge of n.edges) if (edge.role == EdgeRole.Properties) {
      const p: AstNode = this.node(module,edge.node); const name: string = p.get(AttributeKind.Key); const value: number = bindingChild(p,EdgeRole.Value);
      if (provided.includes(name)) this.report(module,edge.node,"Campo duplicado '" + name + "'"); provided.push(name);
      const field: string = this.member(module,edge.node,result,name); this.requireType(module,value,this.expression(module,value,field),field);
    }
    for (const field of this.node(declaration.module,selected).edges) if (field.role == EdgeRole.Bindings && !provided.includes(this.attributeOf(declaration.module,field.node,AttributeKind.Name))) this.report(module,id,"Falta el campo requerido '" + this.attributeOf(declaration.module,field.node,AttributeKind.Name) + "'");
    return result;
  }
  taskCollectionCall(module: number, id: number, name: string): string {
    this.suspensionContext(module,id);
    const n: AstNode = this.node(module,id); let args: number[] = []; let explicitTypes: string[] = [];
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
    for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument) explicitTypes.push(this.annotation(module,id,attr.value));
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
      for (const edge of n.edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
      if (args.length != 1) { this.report(module,id,"Un cast numérico requiere un argumento"); return "!error"; }
      const operand: AstNode = this.node(module,args[0]); let context: string = "";
      if (operand.kind == NodeKind.NamedArgumentExpression || operand.kind == NodeKind.SpreadElement) this.report(module,args[0],"Un cast numérico requiere un argumento posicional simple");
      for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument) this.report(module,id,"Un cast numérico no admite argumentos de tipo");
      if (target == "i64" || target == "u64") {
        const literal: AstNode = operand.kind == NodeKind.UnaryExpression ? this.node(module,bindingChild(operand,EdgeRole.Operand)) : operand;
        if (literal.kind == NodeKind.LiteralExpression && nativeIntegerText(literal.get(AttributeKind.Raw)) != "") context = target;
      }
      const actual: string = this.expression(module,args[0],context);
      if (!numericType(memoryValue(actual))) this.report(module,args[0],"Un cast numérico requiere un valor numérico");
      this.result.files[module].argumentParameters[args[0]] = 0; this.result.files[module].signatures[id] = "(" + actual + ")=>" + target; this.result.files[module].conversions[id] = target; return target;
    }
    if (callable == "!comptime") {
      const n: AstNode = this.node(module,id); let args: number[] = []; for (const edge of n.edges) if (edge.role == EdgeRole.Args) args.push(edge.node);
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
    if (callable.startsWith("!optionalGlobal:")) {
      const object: number = this.childOf(module,id,EdgeRole.Args);
      if (object < 0) { this.report(module,id,"El helper de Optional requiere un receptor y un callback"); return "!error"; }
      const value: string = this.expression(module,object,"");
      if (genericBase(value) != "Optional") { this.report(module,id,"El helper requiere Optional<T>"); return "!error"; }
      return this.optionalCall(module,id,callable.slice(16,callable.length),value,expected);
    }
    if (callable.startsWith("!optional.")) return this.optionalCall(module,id,callable.slice(10,callable.length),receiver,expected);
    if (callable.startsWith("!array.")) return this.arrayCall(module,id,callable.slice(7,callable.length),receiver);
    if (callable.startsWith("!arrayStatic.")) return this.arrayStaticCall(module,id,callable.slice(13,callable.length),expected);
    if (callable.startsWith("!objectStatic.")) return this.objectStaticCall(module,id,callable.slice(14,callable.length));
    if (callable.startsWith("!promiseStatic.")) return this.promiseStaticCall(module,id,callable.slice(15,callable.length),expected);
    if (callable.startsWith("!container:")) return this.containerCall(module,id,callable.slice(11,callable.length),expected);
    const n: AstNode = this.node(module,id); let args: number[] = []; let actual: string[] = [];
    let contexts: string[] = functionParams(callable);
    if (callable.startsWith("!builtin:")) { const signatures: string[] = nativeBuiltinSignatures(callable.slice(9,callable.length)); if (signatures.length == 1) contexts = functionParams(signatures[0]); }
    if (sid >= 0 && (this.binding.symbols[sid].module) >= 0 && this.binding.symbols[sid].declarations.length > 1) {
      for (const declaration of this.binding.symbols[sid].declarations) {
        const other: string[] = functionParams(this.signature(this.binding.symbols[sid].module,declaration));
        for (let p: number = 0; p < contexts.length; p = p + 1) if (p >= other.length || contexts[p] != other[p]) contexts[p] = "";
      }
    }
    // #272: con argumentos de tipo explícitos, los parámetros genéricos ya se
    // conocen y dan contexto a los argumentos (f<number | string>([1, "x"])).
    if (sid >= 0 && (this.binding.symbols[sid].module) >= 0 && callableBinding(this.binding.symbols[sid].kind) && this.binding.symbols[sid].declarations.length == 1) {
      const owner: number = this.binding.symbols[sid].module; const declarationNode: AstNode = this.node(owner,this.binding.symbols[sid].declarations[0]);
      let explicitTypes: string[] = []; for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument) explicitTypes.push(this.annotation(module,id,attr.value));
      let g: number = 0;
      for (const edge of declarationNode.edges) if (edge.role == EdgeRole.TypeParameters) {
        if (g < explicitTypes.length) for (let p: number = 0; p < contexts.length; p = p + 1) contexts[p] = replaceType(contexts[p],"@" + numberToString(this.binding.files[owner].declarations[edge.node]),explicitTypes[g]);
        g = g + 1;
      }
    }
    let named: boolean = false;
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) {
      const argument: AstNode = this.node(module,edge.node);
      if (argument.kind == NodeKind.NamedArgumentExpression) named = true;
      else if (named) this.report(module,edge.node,"Un argumento posicional no puede seguir a uno nombrado");
      let position: number = args.length;
      if (sid >= 0 && this.binding.symbols[sid].module >= 0 && callableBinding(this.binding.symbols[sid].kind)) position = this.argumentPosition(this.binding.symbols[sid].module,this.binding.symbols[sid].node,module,edge.node,args.length);
      else if (argument.kind == NodeKind.NamedArgumentExpression) this.report(module,edge.node,"Un argumento nombrado requiere una declaración con nombres de parámetros");
      if (sid < 0 || (this.binding.symbols[sid].module) < 0 || !callableBinding(this.binding.symbols[sid].kind)) { const rest: number = restPosition(callable); if (rest >= 0 && position >= rest) position = rest; }
      let context: string = position >= 0 && position < contexts.length && contexts[position].indexOf("@",0) < 0 ? contexts[position] : "";
      context = argumentType(context,argument.kind == NodeKind.SpreadElement);
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
        const owner: boolean = this.transferType(actual[0]) || actual[0].startsWith("@") || genericBase(actual[0]) == "pack";
        if (![NodeKind.IdentifierExpression,NodeKind.MemberExpression,NodeKind.IndexExpression].includes(arg.kind)) { this.report(module,id,"E4100: move requiere un lvalue con ownership"); return actual[0]; }
        if (!owner) {
          // #153: move() de valores sin ownership (string, arrays, Map, Set,
          // clases): evita la copia y deja la variable movida (E4102/E4103).
          const value: string = memoryValue(actual[0]);
          if (actual[0] == "!error") return actual[0];
          if (borrowedType(actual[0])) { this.report(module,id,"E4100: move() no puede sacar el valor de un préstamo (T& / const T&)\nayuda: mueve la variable dueña del valor, no la referencia"); return actual[0]; }
          if (numericType(value) || ["boolean","void","null","undefined"].includes(value)) { this.report(module,id,"E4100: move() no se aplica a '" + value + "': los valores escalares se copian sin coste\nayuda: quita el move()"); return actual[0]; }
          if (arg.kind != NodeKind.IdentifierExpression) { this.report(module,id,"E4100: move() de un valor sin ownership solo admite una variable local o un parámetro\nayuda: guarda el valor en una variable con 'let' y muévela"); return actual[0]; }
          const sid: number = this.reference(module,args[0]);
          if (sid >= 0 && this.binding.symbols[sid].kind == "VariableDeclaration" && this.attributeOf(this.binding.symbols[sid].module,this.binding.symbols[sid].node,AttributeKind.Mutable) != "true") { this.report(module,id,"E4100: move() necesita una variable declarada con 'let': '" + this.binding.symbols[sid].name + "' es 'const'\nayuda: declárala con 'let' para poder transferirla"); return actual[0]; }
          this.writable(module,args[0]);
          return actual[0];
        }
        if (arg.kind != NodeKind.IdentifierExpression) this.writable(module,args[0]);
        return actual[0];
      }
      if (arg.kind != NodeKind.IdentifierExpression && arg.kind != NodeKind.MemberExpression && arg.kind != NodeKind.IndexExpression) this.report(module,id,"E4208: un préstamo necesita un lvalue");
      if (callable == "!ref") this.writable(module,args[0]);
      return callable.slice(1,callable.length) + "<" + memoryValue(actual[0]) + ">";
    }
    if (callable == "!print" || callable == "!consoleLog") {

      for (const valueType of actual) if (valueType == "void") this.report(module,id,"No se puede imprimir void");
      for (const valueType of actual) if (valueType == "undefined") this.report(module,id,"No se puede imprimir undefined: no es un valor\nayuda: imprime un T | undefined con 'x ?? valorPorDefecto'");
      this.result.files[module].signatures[id] = "(" + actual.join(",") + ")=>void"; return "void";
    }
    if (callable == "!error") return callable;
    if (callable == "!String") {
      // String(x): texto de un string, number, entero o boolean, como en JavaScript.
      if (args.length != 1) { this.report(module,id,"String requiere un argumento"); return "!error"; }
      const value: string = memoryValue(actual[0]); const input: string = literalType(value) ? literalKind(value) : value;
      if (input != "string" && input != "boolean" && input != "number" && !numericType(input)) { this.report(module,id,"String(x) acepta string, number o boolean, no " + this.displayType(actual[0])); return "!error"; }
      this.result.files[module].signatures[id] = "(" + input + ")=>string"; return "string";
    }
    if (callable.startsWith("!builtin:")) {
      const signatures: string[] = nativeBuiltinSignatures(callable.slice(9,callable.length)); let selected: string = ""; let score: number = -1; let ambiguous: boolean = false;
      for (const signature of signatures) {
        const params: string[] = functionParams(signature); if (params.length != actual.length) continue;
        let matches: boolean = true; let rank: number = 0;
        for (let a: number = 0; a < actual.length; a = a+1) { if (!this.compatible(actual[a],params[a])) matches = false; if (actual[a] == params[a] || actual[a] == memoryInner(params[a])) rank = rank+1; }
        if (matches && rank > score) { selected = signature; score = rank; ambiguous = false; }
        else if (matches && rank == score) ambiguous = true;
      }
      if (selected == "" || ambiguous) { this.report(module,id,ambiguous ? "Llamada ambigua al builtin" : "Ninguna firma del builtin compatible con los argumentos"); return "!error"; }
      const params: string[] = functionParams(selected);
      for (let a: number = 0; a < args.length; a = a+1) {
        const value: number = this.argumentValue(module,args[a]); this.result.files[module].argumentParameters[args[a]] = a;
        if (memoryMode(params[a]) == "ref") { if (this.kindOf(module,value) != NodeKind.IdentifierExpression) this.report(module,value,"Un argumento ref de builtin debe ser una variable mutable"); this.writableTarget(module,value,false); }
        this.requireType(module,value,actual[a],params[a]);
      }
      this.result.files[module].signatures[id] = selected; return functionReturn(selected);
    }
    let candidates: number[] = [];
    if (sid >= 0 && (this.binding.symbols[sid].module) >= 0 && callableBinding(this.binding.symbols[sid].kind)) candidates = this.binding.symbols[sid].declarations;
    if (candidates.length == 0) {
      for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument) this.report(module,id,"Los argumentos de tipo requieren una función genérica declarada");
      if (functionClose(callable) < 0) { this.report(module,id,"El valor no es invocable: " + callable); return "!error"; }
      const parameters: string[] = functionParams(callable);
      const rest: number = restPosition(callable);
      if ((rest < 0 && args.length != parameters.length) || (rest >= 0 && (args.length) < rest)) this.report(module,id,"Aridad incorrecta: esperaba " + numberToString(parameters.length));
      for (let i: number = 0; i < args.length; i = i + 1) {
        const p: number = rest >= 0 && i >= rest ? rest : i; if (p >= parameters.length) continue;
        const spread: boolean = this.kindOf(module,args[i]) == NodeKind.SpreadElement;
        if (spread && p != rest) this.report(module,args[i],"El spread dinámico requiere un parámetro rest");
        this.result.files[module].argumentParameters[args[i]] = p;
        if (memoryMode(argumentType(parameters[p],spread)) == "ref") this.mutableArgument(module,this.argumentValue(module,args[i]),actual[i]);
        this.requireType(module,this.argumentValue(module,args[i]),actual[i],argumentType(parameters[p],spread));
      }
      this.result.files[module].signatures[id] = callable; return functionReturn(callable);
    }
    const ownerModule: number = this.binding.symbols[sid].module; let selected: number = -1; let selectedType: string = "!error"; let selectedPositions: number[] = []; let selectedScore: number = -100000; let ambiguous: boolean = false;
    for (const candidate of candidates) {
      const declaration: AstNode = this.node(ownerModule,candidate); const signature: string = this.instantiateMember(receiver,this.signature(ownerModule,candidate));
      let parameters: string[] = functionParams(signature); let returns: string = functionReturn(signature);
      let positions: number[] = [];
      for (let at: number = 0; at < args.length; at = at + 1) positions.push(this.argumentPosition(ownerModule,candidate,module,args[at],at));
      let pack: boolean = false; for (const edge of declaration.edges) if (edge.role == EdgeRole.TypeParameters && this.attributeOf(ownerModule,edge.node,AttributeKind.Variadic) == "true") pack = true;
      if (pack) {
        const instantiated: string = this.packSignature(module,id,ownerModule,candidate,args,actual,positions,expected);
        if (instantiated != "") {
          let score: number = -1; const patterns: string[] = functionParams(signature); const rest: number = restPosition(signature); let tokens: string[] = [];
          for (const edge of declaration.edges) if (edge.role == EdgeRole.TypeParameters) tokens.push("@"+numberToString(this.binding.files[ownerModule].declarations[edge.node]));
          for (let a: number = 0; a < args.length; a = a+1) { const p: number = positions[a]; score = score+(p == rest ? 1 : tokens.includes(patterns[p]) ? 2 : 4); }
          if (score > selectedScore) { selected = candidate; selectedScore = score; ambiguous = false; selectedType = functionReturn(instantiated); selectedPositions = positions; this.result.files[module].signatures[id] = instantiated; }
          else if (score == selectedScore) ambiguous = true;
        }
        continue;
      }
      let genericNames: string[] = []; let genericValues: string[] = []; let genericNodes: number[] = [];
      for (const edge of declaration.edges) if (edge.role == EdgeRole.TypeParameters) { genericNames.push("@" + numberToString(this.binding.files[ownerModule].declarations[edge.node])); genericValues.push(""); genericNodes.push(edge.node); }
      let explicitTypes: string[] = []; for (const attr of n.attributes) if (attr.name == AttributeKind.TypeArgument) explicitTypes.push(this.annotation(module,id,attr.value));
      let matches: boolean = explicitTypes.length <= genericNames.length;
      for (let g: number = 0; g < genericNames.length; g = g + 1) {
        if (g < explicitTypes.length) genericValues[g] = explicitTypes[g];
        else for (let a: number = 0; a < actual.length; a = a + 1) {
          const p: number = positions[a]; if (p < 0 || p >= parameters.length) continue;
          const pattern: string = argumentType(parameters[p],this.kindOf(module,args[a]) == NodeKind.SpreadElement);
          let inferred: string = this.inferToken(pattern,actual[a],genericNames[g]);
          if (memoryMode(pattern) == "ref" && memoryMode(actual[a]) != "ref") {
            inferred = this.inferToken(memoryInner(pattern),memoryValue(actual[a]),genericNames[g]);
          }
          if (pattern == genericNames[g]) inferred = actual[a];
          else if (pattern == genericNames[g] + "[]" && actual[a].endsWith("[]")) inferred = semanticElement(actual[a]);
          else if (genericBase(pattern) == "Optional" && genericArguments(pattern)[0] == genericNames[g]) {
            if (genericBase(actual[a]) == "Optional") inferred = genericArguments(actual[a])[0]; else if (this.optionalParameter(ownerModule,candidate,p)) inferred = actual[a];
          }
          if (inferred != "") { if (genericValues[g] != "" && genericValues[g] != inferred) matches = false; genericValues[g] = inferred; }
        }
        if (genericValues[g] == "" && expected != "") genericValues[g] = this.inferToken(returns,expected,genericNames[g]);
        const parameter: AstNode = this.node(ownerModule,genericNodes[g]);
        if (genericValues[g] == "" && parameter.get(AttributeKind.Default) != "") {
          let value: string = this.annotation(ownerModule,genericNodes[g],parameter.get(AttributeKind.Default));
          for (let p: number = 0; p < g; p = p + 1) value = replaceType(value,genericNames[p],genericValues[p]);
          genericValues[g] = value;
        }
        if (genericValues[g] == "") matches = false;
        if (parameter.get(AttributeKind.Constraint) != "" && genericValues[g] != "") {
          let constraint: string = this.annotation(ownerModule,genericNodes[g],parameter.get(AttributeKind.Constraint));
          for (let p: number = 0; p <= g; p = p + 1) constraint = replaceType(constraint,genericNames[p],genericValues[p]);
          if (!this.compatible(genericValues[g],constraint)) matches = false;
        }
        for (let p: number = 0; p < parameters.length; p = p + 1) parameters[p] = replaceType(parameters[p],genericNames[g],genericValues[g]);
        returns = replaceType(returns,genericNames[g],genericValues[g]);
      }
      let required: number = 0; let count: number = 0;
      for (const edge of declaration.edges) if (edge.role == EdgeRole.Params) {
        const param: AstNode = this.node(ownerModule,edge.node);
        if (param.get(AttributeKind.Variadic) != "true" && param.get(AttributeKind.Optional) != "true" && bindingChild(param,EdgeRole.DefaultValue) < 0 && !positions.includes(count)) matches = false;

        count = count + 1;
      }
      const rest: number = restPosition(signature);
      if (rest < 0 && args.length > parameters.length) matches = false;
      let used: number[] = [];
      for (let a: number = 0; a < actual.length; a = a + 1) {
        const p: number = positions[a]; if (p < 0 || p >= parameters.length || (used.includes(p) && p != rest)) { matches = false; continue; } used.push(p);
        const spread: boolean = this.kindOf(module,args[a]) == NodeKind.SpreadElement;
        if ((spread && p != rest) || (p == rest && this.kindOf(module,args[a]) == NodeKind.NamedArgumentExpression)) matches = false;
        const parameter: string = argumentType(parameters[p],spread);
        const target: string = this.optionalParameter(ownerModule,candidate,p) && genericBase(parameter) == "Optional" && genericBase(actual[a]) != "Optional" && actual[a] != "undefined" ? genericArguments(parameter)[0] : parameter;
        if (!this.compatible(actual[a],target) && !(ownedType(target) && actual[a] == memoryInner(target) && this.kindOf(module,this.argumentValue(module,args[a])) == NodeKind.NewExpression)) matches = false;
      }
      if (matches) {
        let score: number = rest >= 0 ? -1 : 0; const patterns: string[] = functionParams(signature);
        for (let a: number = 0; a < args.length; a = a+1) { const p: number = positions[a]; const pattern: string = argumentType(patterns[p],this.kindOf(module,args[a]) == NodeKind.SpreadElement); score = score+(genericNames.includes(pattern) ? 2 : 4); }
        if (score > selectedScore) { selected = candidate; selectedScore = score; ambiguous = false; selectedType = returns; selectedPositions = positions; this.result.files[module].signatures[id] = "(" + parameters.join(",") + ")=>" + returns; }
        else if (score == selectedScore) ambiguous = true;
      }
    }
    if (ambiguous) { this.report(module,id,"Llamada ambigua entre sobrecargas"); return "!error"; }
    if (selected < 0) this.report(module,id,"Ninguna firma compatible con los argumentos");
    this.result.files[module].selected[id] = selected;
    if (selected >= 0 && borrowedType(selectedType)) this.report(module,id,"E4203: una instancia genérica no puede retornar un préstamo sin contrato de lifetime");
    if (selected >= 0) {
      this.result.files[module].selectedModules[id] = ownerModule;
      const parameters: string[] = functionParams(this.result.files[module].signatures[id]);
      for (let a: number = 0; a < args.length; a = a + 1) {
        const p: number = selectedPositions[a]; this.result.files[module].argumentParameters[args[a]] = p;
        const value: number = this.argumentValue(module,args[a]);
        const wrap: boolean = this.optionalParameter(ownerModule,selected,p) && genericBase(parameters[p]) == "Optional" && genericBase(actual[a]) != "Optional" && actual[a] != "undefined";
        const rest: number = restPosition(this.result.files[module].signatures[id]);
        if (p == rest && genericBase(parameters[p].slice(3,parameters[p].length)) == "pack") {
          const wanted: string[] = genericArguments(parameters[p].slice(3,parameters[p].length)); let offset: number = 0;
          for (let previous: number = 0; previous < a; previous = previous + 1) if (selectedPositions[previous] == rest) offset = offset + (genericBase(actual[previous]) == "pack" ? genericArguments(actual[previous]).length : semanticTuple(actual[previous]) && this.kindOf(module,args[previous]) == NodeKind.SpreadElement ? splitTypes(actual[previous].slice(1,actual[previous].length-1),",").length : 1);
          this.result.files[module].argumentElements[args[a]] = offset;
          if (genericBase(actual[a]) != "pack" && this.kindOf(module,args[a]) != NodeKind.SpreadElement && offset < wanted.length) this.requireType(module,value,actual[a],wanted[offset]);
        } else {
          const target: string = wrap ? genericArguments(parameters[p])[0] : argumentType(parameters[p],this.kindOf(module,args[a]) == NodeKind.SpreadElement);
          if (memoryMode(target) == "ref") this.mutableArgument(module,value,actual[a]);
          this.requireType(module,value,actual[a],target);
        }
        if (wrap) this.result.files[module].conversions[value] = parameters[p];
      }
    }
    if (selected >= 0) for (const edge of this.node(ownerModule,selected).edges) if (edge.role == EdgeRole.Decorators && this.attributeOf(ownerModule,edge.node,AttributeKind.Name) == "cppgen") {
      const parent: number = this.binding.files[module].parents[id];
      if (parent < 0 || this.kindOf(module,parent) != NodeKind.ExpressionStatement) this.report(module,id,"Un escape @cppgen requiere una sentencia opaca; no declara un valor runtime");
      const parameters: string[] = functionParams(this.result.files[module].signatures[id]); this.result.files[module].signatures[id] = "("+parameters.join(",")+")=>void"; return "void";
    }
    return selectedType;
  }
  integerLiteral(module: number, id: number): boolean {
    if (id < 0) return false; let n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.UnaryExpression && ["-","+"].includes(n.get(AttributeKind.Operator))) n = this.node(module,bindingChild(n,EdgeRole.Operand));
    return n.kind == NodeKind.LiteralExpression && n.get(AttributeKind.LiteralType) == "number" && nativeIntegerText(n.get(AttributeKind.Raw)) != "";
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
    let valueType: string = this.expressionInner(module,id,expected);
    if (this.kindOf(module,id) == NodeKind.MemberExpression && genericBase(memoryValue(valueType)) == "Optional") { const narrowed: string = this.narrowedPath(module,id); if (narrowed != "") valueType = narrowed; }
    if ([NodeKind.CallExpression,NodeKind.MemberCallExpression,NodeKind.NewExpression].includes(this.kindOf(module,id))) { this.narrowedSymbols = []; this.narrowedTypes = []; }
    this.depth = this.depth - 1; this.result.files[module].types[id] = valueType; this.result.files[module].states[id] = 2; return valueType;
  }
  expressionInner(module: number, id: number, expected: string): string {
    const n: AstNode = this.node(module,id); const kind: NodeKind = n.kind;
    if (kind == NodeKind.AwaitExpression) {
      this.awaitContext(module,id);
      const value: number = bindingChild(n,EdgeRole.Operand); const input: string = this.expression(module,value,"");
      if (genericBase(input) != "Promise") { this.report(module,value,"await requiere Promise<T>"); return "!error"; }
      this.narrowedSymbols = []; this.narrowedTypes = [];
      return genericArguments(input)[0];
    }
    if (kind == NodeKind.NamedArgumentExpression) return this.expression(module,bindingChild(n,EdgeRole.Value),expected);
    if (kind == NodeKind.SpreadElement) return this.expression(module,bindingChild(n,EdgeRole.Expression),expected);
    if (kind == NodeKind.LiteralExpression) {
      if (n.get(AttributeKind.LiteralType) == "number") {
        const context: string = expected == "i64" || expected == "u64" ? expected : "number";
        this.literalRange(module,id,context); return context;
      } return n.get(AttributeKind.LiteralType);
    }
    if (kind == NodeKind.IdentifierExpression) {
      const sid: number = this.reference(module,id);
      if (sid >= 0) {
        const s: BindingSymbol = this.binding.symbols[sid];
        if (s.module >= 0 && s.kind == "FunctionDeclaration" && s.declarations.length == 1 && this.genericParameters(sid).length > 0) { this.report(module,id,"Una función genérica requiere una llamada; usa un arrow para fijar sus argumentos de tipo"); return "!error"; }
        if (s.module >= 0 && s.kind == "FunctionDeclaration") for (const edge of this.node(s.module,s.node).edges) if (edge.role == EdgeRole.Decorators && this.attributeOf(s.module,edge.node,AttributeKind.Name) == "cppgen") this.report(module,id,"Un escape @cppgen requiere una llamada directa como sentencia opaca");
        if ((s.module) < 0 && numericType(s.name)) { this.report(module,id,"Un cast numérico requiere una llamada directa"); return "!error"; }
        if (s.declarations.length > 1) {
          if (functionClose(expected) < 0) { this.report(module,id,"Una sobrecarga como valor requiere una firma contextual"); return "!error"; }
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
          if (parent >= 0) { const p: AstNode = this.node(module,parent); staticReceiver = (p.kind == NodeKind.MemberExpression || p.kind == NodeKind.MemberCallExpression) && bindingChild(p,EdgeRole.Object) == id; }
          if (!staticReceiver) this.report(module,id,"Una clase requiere new o un miembro estático");
        }
      }
      const valueType: string = this.flowType(sid,module,id);
      if (genericBase(valueType) == "pack") {
        let parent: number = this.binding.files[module].parents[id];
        if (parent >= 0 && this.kindOf(module,parent) == NodeKind.SpreadElement) parent = this.binding.files[module].parents[parent];
        if (parent < 0 || ![NodeKind.CallExpression,NodeKind.MemberCallExpression].includes(this.kindOf(module,parent))) this.report(module,id,"Un pack sólo puede expandirse como argumento de llamada");
      }
      return valueType;
    }
    if (kind == NodeKind.CallExpression) { const sid: number = this.reference(module,id); const called: string = this.call(module,id,this.flowType(sid,module,id),sid,"",expected); this.jsonConstant(module,id,this.result.files[module].selectedModules[id]); return called; }
    if (kind == NodeKind.GenericIdentifierExpression) {
      let args: string[] = []; for (const a of n.attributes) if (a.name == AttributeKind.TypeArgument) args.push(a.value);
      const text: string = this.annotation(module,id,n.get(AttributeKind.Name) + "<" + args.join(",") + ">");
      const sid: number = this.nominalSymbol(text);
      if (sid < 0 || !["ClassDeclaration","UnionDeclaration"].includes(this.binding.symbols[sid].kind)) { this.report(module,id,"El identificador genérico requiere una clase o unión"); return "!error"; }
      return "class:" + text;
    }
    if (kind == NodeKind.MemberExpression || kind == NodeKind.MemberCallExpression) {
      const object: number = bindingChild(n,EdgeRole.Object); const bound: number = this.reference(module,id);
      let receiver: string = "namespace";
      if (bound < 0) receiver = this.expression(module,object,"");
      else { this.result.files[module].types[object] = "namespace"; this.result.files[module].states[object] = 2; }
      if (n.get(AttributeKind.Optional) == "true") {
        const parts: string[] = genericArguments(receiver);
        if (genericBase(receiver) != "Optional" || parts.length != 1) { this.report(module,id,"El acceso opcional requiere Optional<T>"); return "!error"; }
        receiver = parts[0];
      }
      this.result.files[module].receivers[id] = receiver;
      const valueType: string = this.member(module,id,receiver,kind == NodeKind.MemberExpression ? n.get(AttributeKind.Member) : n.get(AttributeKind.Method));
      if (kind == NodeKind.MemberExpression) {
        if (n.get(AttributeKind.Optional) == "true") {
          if (this.transferType(valueType)) this.report(module,id,"E4101: el acceso opcional no puede copiar un campo con ownership");
          return "Optional<" + valueType + ">";
        }
        return valueType;
      }
      if (["Optional","Result","Map"].includes(genericBase(memoryValue(receiver))) && ["value","valueOr","get"].includes(n.get(AttributeKind.Method)) && this.transferType(functionReturn(valueType))) {
        const receiverNode: AstNode = this.node(module,object); let consumed: boolean = receiverNode.kind == NodeKind.NewExpression || receiverNode.kind == NodeKind.ArrayLiteralExpression;
        if (receiverNode.kind == NodeKind.CallExpression) { const target: number = this.reference(module,object); consumed = target >= 0 && this.binding.symbols[target].name == "move" && (this.binding.symbols[target].module) < 0; }
        if (!consumed) this.report(module,id,"E4101: extraer un payload con ownership requiere consumir el contenedor con move");
      }
      if (memoryValue(receiver).endsWith("[]") && this.transferType(memoryValue(receiver)) && ["slice","concat","filter","find","sort"].includes(n.get(AttributeKind.Method))) {
        const receiverNode: AstNode = this.node(module,object);
        if (borrowedType(receiver) || ![NodeKind.CallExpression,NodeKind.MemberCallExpression,NodeKind.NewExpression,NodeKind.ArrayLiteralExpression,NodeKind.TernaryExpression].includes(receiverNode.kind)) this.report(module,id,"E4101: una operación que copia owners requiere consumir el array con move");
      }
      const memberId: number = this.result.files[module].members[id];
      if ((memberId >= 0 && this.methodMutates(memberId)) || (memoryValue(receiver).endsWith("[]") && ["push","pop","sort","shift","unshift","reverse","fill","splice"].includes(n.get(AttributeKind.Method))) || (["Map","Set"].includes(genericBase(memoryValue(receiver))) && ["set","add","delete","clear"].includes(n.get(AttributeKind.Method)))) this.writableTarget(module,object,true);
      const optional: boolean = n.get(AttributeKind.Optional) == "true";
      const context: string = optional && genericBase(expected) == "Optional" ? genericArguments(expected)[0] : expected;
      const result: string = this.call(module,id,valueType,this.result.files[module].members[id],receiver,context);
      if (this.result.files[module].members[id] >= 0) this.jsonConstant(module,id,this.binding.symbols[this.result.files[module].members[id]].module);
      return optional && result != "void" && result != "!error" ? "Optional<" + result + ">" : result;
    }
    if (kind == NodeKind.NewExpression) {
      const raw: string = this.constructorName(module,id,n.get(AttributeKind.ClassName)); const rawSymbol: number = raw.indexOf("<",0) < 0 ? this.qualifiedType(module,id,raw) : -1;
      let valueType: string = "";
      if (rawSymbol >= 0 && this.binding.symbols[rawSymbol].kind == "ClassDeclaration" && this.genericParameters(rawSymbol).length > 0) {
        if (this.nominalSymbol(memoryValue(expected)) == rawSymbol) valueType = memoryValue(expected);
        else {
          const owner = this.binding.symbols[rawSymbol]; const generic: number[] = this.genericParameters(rawSymbol); let values: string[] = []; for (const p of generic) values.push("");
          const constructor: number = this.memberSymbol(this.nominal(rawSymbol),"constructor");
          let patterns: string[] = []; let names: string[] = [];
          if (constructor >= 0) patterns = functionParams(this.symbolType(constructor,module,id));
          else for (const field of this.compositionFields(rawSymbol)) { patterns.push(this.symbolType(field,module,id)); names.push(this.binding.symbols[field].name); }
          {
            let at: number = 0;
            for (const edge of n.edges) if (edge.role == EdgeRole.Args) {
              const actual: string = this.expression(module,edge.node,"");
              if (constructor < 0 && this.kindOf(module,edge.node) == NodeKind.NamedArgumentExpression) { at = -1; for (let p: number = 0; p < names.length; p = p+1) if (names[p] == this.attributeOf(module,edge.node,AttributeKind.Name)) at = p; }
              if (at >= 0 && at < patterns.length) for (let g: number = 0; g < generic.length; g = g + 1) {
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
        const collectionArgs: string[] = genericArguments(valueType);
        // new Map(entradas) y new Set(valores), como en JavaScript.
        const source: string = genericBase(valueType) == "Map" ? "[" + collectionArgs[0] + "," + collectionArgs[1] + "][]" : collectionArgs[0] + "[]";
        let sourceCount: number = 0;
        for (const edge of n.edges) if (edge.role == EdgeRole.Args) {
          sourceCount = sourceCount + 1; const actual: string = this.expression(module,edge.node,source);
          if (sourceCount > 1) this.report(module,edge.node,"El constructor de colección acepta como mucho un argumento"); else this.requireType(module,edge.node,memoryValue(actual),source);
        }
        const key: string = genericArguments(valueType)[0]; const keySymbol: number = this.nominalSymbol(key);
        if ((!primitiveType(key) || key == "void") && !(keySymbol >= 0 && this.binding.symbols[keySymbol].kind == "EnumDeclaration")) this.report(module,id,"Una clave de colección requiere un tipo primitivo comparable o enum");
        this.result.files[module].signatures[id] = (sourceCount > 0 ? "(" + source + ")=>" : "()=>") + valueType; return valueType;
      }
      const sid: number = this.nominalSymbol(valueType);
      if (sid < 0 || this.binding.symbols[sid].kind != "ClassDeclaration") { this.report(module,id,"new requiere una clase"); return "!error"; }
      const constructorId: number = this.memberSymbol(valueType,"constructor");
      if (constructorId >= 0) this.call(module,id,this.instantiateMember(valueType,this.symbolType(constructorId,module,id)),constructorId,valueType);
      else this.compositionConstructor(module,id,valueType,sid);
      return valueType;
    }
    if (kind == NodeKind.BinaryExpression) {
      const leftId: number = bindingChild(n,EdgeRole.Left); const rightId: number = bindingChild(n,EdgeRole.Right);
      // k in r: la clave está en el Record (Map).
      if (n.get(AttributeKind.Operator) == "in") {
        const container: string = memoryValue(this.expression(module,rightId,""));
        if (genericBase(container) != "Map") { if (container != "!error") this.report(module,id,"'in' solo se admite sobre un Record<K, V> abierto (Map)"); return "boolean"; }
        const keyType: string = genericArguments(container)[0]; this.requireType(module,leftId,this.expression(module,leftId,keyType),keyType); return "boolean";
      }
      if (n.get(AttributeKind.Operator) == "instanceof") {
        this.expression(module,leftId,""); let name: string = this.attributeOf(module,rightId,AttributeKind.Name); let types: string[] = [];
        for (const attr of this.node(module,rightId).attributes) if (attr.name == AttributeKind.TypeArgument) types.push(attr.value);
        if (types.length > 0) name = name+"<"+types.join(",")+">";
        const target: string = this.annotation(module,rightId,name); const sid: number = this.nominalSymbol(target);
        if ((!primitiveType(target) || target == "void") && (sid < 0 || this.binding.symbols[sid].kind != "ClassDeclaration")) this.report(module,rightId,"instanceof requiere una clase o un tipo primitivo como destino");
        this.result.files[module].types[rightId] = "class:" + target; this.result.files[module].states[rightId] = 2; return "boolean";
      }
      if (n.get(AttributeKind.Operator) == "??") {
        const left: string = this.expression(module,leftId,expected == "" ? "" : "Optional<" + expected + ">"); const parts: string[] = genericArguments(left);
        if (genericBase(left) != "Optional" || parts.length != 1) { this.report(module,leftId,"El operador ?? requiere Optional<T>"); this.expression(module,rightId,""); return "!error"; }
        this.requireType(module,rightId,this.expression(module,rightId,parts[0]),parts[0]); return parts[0];
      }
      if (n.get(AttributeKind.Operator) == "&&" || n.get(AttributeKind.Operator) == "||") {
        this.requireType(module,leftId,this.expression(module,leftId,""),"boolean");
        const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes;
        this.narrowCondition(module,leftId,n.get(AttributeKind.Operator) == "&&");
        this.requireType(module,rightId,this.expression(module,rightId,""),"boolean");
        this.narrowedSymbols = symbols; this.narrowedTypes = types;
        if (this.affectsFacts(module,rightId)) { this.narrowedSymbols = []; this.narrowedTypes = []; }
        return "boolean";
      }
      let left: string = memoryValue(this.expression(module,leftId,expected == "i64" || expected == "u64" ? expected : ""));
      const right: string = memoryValue(this.expression(module,rightId,(left == "i64" || left == "u64") && this.integerLiteral(module,rightId) ? left : "")); const op: string = n.get(AttributeKind.Operator);
      if ((right == "i64" || right == "u64") && this.integerLiteral(module,leftId)) left = this.expression(module,leftId,right);
      if (op == "+" && (left == "string" || right == "string")) {
        // #171: solo se concatenan a un string valores primitivos o enums; el
        // resto (Optional, arrays, colecciones, clases) no tiene conversión.
        const other: string = left == "string" ? right : left; const otherId: number = left == "string" ? rightId : leftId;
        const otherSymbol: number = this.nominalSymbol(other);
        if (other != "!error" && (!primitiveType(other) || other == "void") && !(otherSymbol >= 0 && this.binding.symbols[otherSymbol].kind == "EnumDeclaration"))
          this.report(module,otherId,"E3001: No se puede concatenar un valor de tipo '" + this.displayType(other) + "' con un string" + (genericBase(other) == "Optional" ? "\nayuda: el valor puede no existir: usa 'valor ?? \"por defecto\"' o comprueba antes que existe" + catalogVariant("concatenacion-opcional") : "\nayuda: conviértelo antes a string (por ejemplo, con un método que devuelva su texto)" + catalogVariant("concatenacion")) + catalogArg("tipo", this.displayType(other)));
        return "string";
      }
      if (["==","!=","===","!=="].includes(op) && (left == "undefined" || right == "undefined")) {
        const other: string = memoryValue(left == "undefined" ? right : left);
        if (genericBase(other) != "Optional" && other != "!error") this.report(module,id,"Solo un T | undefined se puede comparar con undefined: '" + this.displayType(other) + "' siempre tiene valor");
        return "boolean";
      }
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
    if (kind == NodeKind.UnaryExpression) {
      if ((expected == "i64" || expected == "u64") && this.integerLiteral(module,id)) {
        this.expression(module,bindingChild(n,EdgeRole.Operand),""); this.literalRange(module,id,expected); return expected;
      }
      const operand: string = memoryValue(this.expression(module,bindingChild(n,EdgeRole.Operand),"")); const op: string = n.get(AttributeKind.Operator);
      if (op == "typeof") return "string";
      if (op == "!") {
        if (!this.compatible(operand,"boolean")) this.report(module,id,"El operador '!' requiere un operando boolean, pero recibió '" + this.displayType(operand) + "'. Compara el valor explícitamente (por ejemplo, texto.length == 0).");
        return "boolean";
      }
      if (!numericType(operand) && operand != "!error") this.report(module,id,"Operador numérico sobre '" + operand + "'");
      if (op == "~" && ["f32","f64"].includes(operand)) this.report(module,id,"Los operadores bitwise requieren operandos enteros");
      return nativeUnaryPromotion(operand);
    }
    if (kind == NodeKind.UpdateExpression) {
      const target: number = bindingChild(n,EdgeRole.Target);
      const actual: string = this.expression(module,target,""); const valueType: string = memoryValue(actual);
      this.writable(module,target);
      if (!numericType(valueType) && valueType != "!error") this.report(module,id,"El operador '"+n.get(AttributeKind.Operator)+"' requiere un destino numérico, no '"+this.displayType(actual)+"'");
      return valueType;
    }
    if (kind == NodeKind.AssignmentExpression || kind == NodeKind.CompoundAssignmentExpression) {
      const target: number = bindingChild(n,EdgeRole.Target); this.forgetPaths(); let valueType: string = this.expression(module,target,"");
      if (this.kindOf(module,target) == NodeKind.IdentifierExpression) { const sid: number = this.reference(module,target); valueType = this.symbolType(sid,module,target); this.narrowedSymbols.push(sid); this.narrowedTypes.push(valueType); this.result.files[module].types[target] = valueType; }
      // Asignar a un ref<T> escribe un T a través de la referencia.
      let assigned: string = memoryMode(valueType) == "ref" ? memoryInner(valueType) : valueType;
      // r[k] = v en un Record (Map) guarda un V; r[k] += 1 no (r[k] es V | undefined).
      if (this.kindOf(module,target) == NodeKind.IndexExpression && genericBase(memoryValue(this.result.files[module].types[this.childOf(module,target,EdgeRole.Object)])) == "Map") {
        if (kind == NodeKind.CompoundAssignmentExpression) { this.report(module,id,"r[k] es V | undefined en un Record: usa r[k] = (r[k] ?? 0) + 1"); return "!error"; }
        assigned = genericArguments(memoryValue(this.result.files[module].types[this.childOf(module,target,EdgeRole.Object)]))[1];
      }
      const value: string = this.expression(module,bindingChild(n,EdgeRole.Value),assigned); this.requireType(module,bindingChild(n,EdgeRole.Value),value,assigned); this.writable(module,target);
      if (kind == NodeKind.CompoundAssignmentExpression && !numericType(memoryValue(valueType)) && !(memoryValue(valueType) == "string" && n.get(AttributeKind.Operator) == "+=")) this.report(module,id,"Asignación compuesta inválida"); return valueType;
    }
    if (kind == NodeKind.ArrayLiteralExpression) {
      const fixed: number = fixedArraySize(expected);
      const element: string = expected.endsWith("[]") ? semanticElement(expected) : fixed >= 0 ? fixedArrayElement(expected) : "";
      const tuple: string[] = semanticTuple(expected) ? splitTypes(expected.slice(1,expected.length-1),",") : [];
      let items: string[] = []; let length: number = 0; let knownLength: boolean = true;
      for (const edge of n.edges) if (edge.role == EdgeRole.Elements) {
        const spread: boolean = this.kindOf(module,edge.node) == NodeKind.SpreadElement;
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
    if (kind == NodeKind.IndexExpression) {
      const object: string = memoryValue(this.expression(module,bindingChild(n,EdgeRole.Object),""));
      const indexId: number = bindingChild(n,EdgeRole.Index);
      // Record<K, V> (un Map ordenado): r[k] es V | undefined.
      if (genericBase(object) == "Map") { const parts: string[] = genericArguments(object); this.requireType(module,indexId,this.expression(module,indexId,parts[0]),parts[0]); return "Optional<" + parts[1] + ">"; }
      this.requireType(module,indexId,this.expression(module,indexId,""),"number");
      if (object == "string") return "string";
      if (object.endsWith("[]")) return semanticElement(object);
      if (fixedArraySize(object) >= 0) {
        let index: AstNode = this.node(module,indexId); let sign: number = 1;
        if (index.kind == NodeKind.UnaryExpression && ["-","+"].includes(index.get(AttributeKind.Operator))) { if (index.get(AttributeKind.Operator) == "-") sign = -1; index = this.node(module,bindingChild(index,EdgeRole.Operand)); }
        if (index.kind == NodeKind.LiteralExpression && index.get(AttributeKind.LiteralType) == "number") {
          const value = nativeNumericLiteral(index.get(AttributeKind.Raw));
          if (value.valid && (value.value % 1 != 0 || value.value * sign < 0 || value.value * sign >= fixedArraySize(object))) this.report(module,indexId,"Índice de array fijo fuera de rango");
        } return fixedArrayElement(object);
      }
      if (semanticTuple(object)) {
        const index: AstNode = this.node(module,indexId); const items: string[] = splitTypes(object.slice(1,object.length-1),",");
        for (let i: number = 0; i < items.length; i = i + 1) if (index.kind == NodeKind.LiteralExpression && index.get(AttributeKind.Raw) == numberToString(i)) return items[i];
        this.report(module,id,"Índice de tupla fuera de rango o no constante"); return "!error";
      }
      if (object != "!error") this.report(module,id,"El tipo no admite índices: " + this.displayType(object)); return "!error";
    }
    // { … } donde se espera T | undefined: el literal es un T (opciones opcionales).
    if (kind == NodeKind.ObjectLiteralExpression && genericBase(memoryValue(expected)) == "Optional") {
      const inner: string = genericArguments(memoryValue(expected))[0];
      const innerOwner: number = this.nominalSymbol(inner);
      if (genericBase(inner) == "Map" || (innerOwner >= 0 && this.binding.symbols[innerOwner].kind == "InterfaceDeclaration")) expected = inner;
    }
    if (kind == NodeKind.ObjectLiteralExpression && genericBase(memoryValue(expected)) == "Map") {
      // { a: 1, b: 2 } como Record<string, V> (Map ordenado): cada valor es un V.
      const parts: string[] = genericArguments(memoryValue(expected));
      if (parts[0] != "string") { this.report(module,id,"Un literal de objeto solo construye un Record con claves string"); return "!error"; }
      for (const edge of n.edges) if (edge.role == EdgeRole.Properties) {
        const property: AstNode = this.node(module,edge.node);
        if (property.kind != NodeKind.ObjectProperty || property.get(AttributeKind.Key) == "") { this.report(module,edge.node,"En un literal de Record solo van propiedades clave: valor"); continue; }
        const valueId: number = bindingChild(property,EdgeRole.Value); this.requireType(module,valueId,this.expression(module,valueId,parts[1]),parts[1]);
      }
      return memoryValue(expected);
    }
    if (kind == NodeKind.ObjectLiteralExpression) {
      const unionOwner: number = this.nominalSymbol(expected); if (unionOwner >= 0 && this.binding.symbols[unionOwner].kind == "UnionDeclaration") return this.unionObject(module,id,expected,unionOwner);
      let contracts: string[] = splitTypes(expected,"&");
      // #223: sin contexto de interfaz, la interfaz sintética del literal.
      let interfaceContext: boolean = contracts.length > 0;
      for (const contract of contracts) { const sid: number = this.nominalSymbol(contract); if (sid < 0 || this.binding.symbols[sid].kind != "InterfaceDeclaration") interfaceContext = false; }
      if (!interfaceContext && n.get(AttributeKind.DeclaredType) != "" && (expected == "" || genericBase(expected) == "Optional" || this.nominalSymbol(expected) < 0)) { expected = this.literalShape(this.annotation(module,id,n.get(AttributeKind.DeclaredType))); contracts = [expected]; }
      if (contracts.length == 0) { this.report(module,id,"Un literal de objeto requiere contexto de interfaz"); return "!error"; }
      for (const contract of contracts) { const sid: number = this.nominalSymbol(contract); if (sid < 0 || this.binding.symbols[sid].kind != "InterfaceDeclaration") { this.report(module,id,"Un literal de objeto requiere contexto de interfaz"); return "!error"; } }
      let provided: string[] = [];
      for (const edge of n.edges) if (edge.role == EdgeRole.Properties) {
        const prop: AstNode = this.node(module,edge.node); const name: string = prop.get(AttributeKind.Key);
        if (provided.includes(name)) this.report(module,edge.node,"Campo duplicado '" + name + "'"); provided.push(name);
        const field: number = this.memberSymbol(expected,name); const value: number = bindingChild(prop,EdgeRole.Value);
        if (field < 0) { this.report(module,edge.node,"Campo desconocido '" + name + "'"); this.expression(module,value,""); }
        else {
          const valueType: string = this.symbolType(field,module,id); const actual: string = this.expression(module,value,valueType);
          for (const contract of contracts) { const requirement: number = this.memberSymbol(contract,name); if (requirement >= 0) this.requireType(module,value,actual,this.symbolType(requirement,module,id)); }
        }
      }
      for (const contract of contracts) {
        const sid: number = this.nominalSymbol(contract); const owner = this.binding.symbols[sid]; const declaration: AstNode = this.node(owner.module,owner.node);
        for (const edge of declaration.edges) if (edge.role == EdgeRole.Fields || edge.role == EdgeRole.Methods) {
          const field: AstNode = this.node(owner.module,edge.node);
          if (!provided.includes(field.get(AttributeKind.Name)) && field.get(AttributeKind.Optional) != "true") this.report(module,id,"Falta el campo '" + field.get(AttributeKind.Name) + "'");
        }
      } return expected;
    }
    if (kind == NodeKind.ArrowFunctionExpression) return this.signature(module,id);
    if (kind == NodeKind.TemplateLiteralExpression) { for (const edge of n.edges) if (edge.role == EdgeRole.Expressions) this.expression(module,edge.node,""); return "string"; }
    if (kind == NodeKind.AsExpression || kind == NodeKind.SatisfiesExpression) {
      const valueType: string = this.annotation(module,id,n.get(kind == NodeKind.AsExpression ? AttributeKind.TargetType : AttributeKind.DeclaredType));
      const actual: string = this.expression(module,bindingChild(n,kind == NodeKind.AsExpression ? EdgeRole.Expression : EdgeRole.Operand),valueType);
      if (kind == NodeKind.AsExpression && (this.transferType(actual) || this.transferType(valueType)) && !this.compatible(actual,valueType)) this.report(module,id,"E4101: un cast no puede borrar ni fabricar ownership");
      if (kind == NodeKind.SatisfiesExpression) {
        this.literalRange(module,bindingChild(n,EdgeRole.Operand),valueType);
        if (!this.compatible(actual,valueType)) this.report(module,id,"Tipo incompatible en satisfies");
      }
      else if (containsMemory(actual) || containsMemory(valueType)) this.report(module,id,"E4301: un cast no puede cambiar un contrato de memoria");
      return kind == NodeKind.SatisfiesExpression ? actual : valueType;
    }
    if (kind == NodeKind.TernaryExpression) {
      const condition: number = bindingChild(n,EdgeRole.Condition); this.requireType(module,condition,this.expression(module,condition,""),"boolean");
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes;
      const yesNode: number = bindingChild(n,EdgeRole.ThenBranch); const noNode: number = bindingChild(n,EdgeRole.ElseBranch);
      this.narrowCondition(module,condition,true); const yes: string = this.expression(module,yesNode,expected);
      this.narrowedSymbols = symbols; this.narrowedTypes = types; this.narrowCondition(module,condition,false); const no: string = this.expression(module,noNode,expected);
      this.narrowedSymbols = symbols; this.narrowedTypes = types;
      if (this.affectsFacts(module,yesNode) || this.affectsFacts(module,noNode)) { this.narrowedSymbols = []; this.narrowedTypes = []; }
      if (expected != "") { this.requireType(module,yesNode,yes,expected); this.requireType(module,noNode,no,expected); return expected; }
      if (yes == no) return yes;
      if (numericType(yes) && numericType(no)) { const promoted: string = nativeBinaryPromotion(yes,no,"+"); this.requireType(module,yesNode,yes,promoted); this.requireType(module,noNode,no,promoted); return promoted; }
      return joinTypes([yes,no],"|");
    }
    return this.unsupported(module,id,nodeKindName(kind));
  }
  caseKey(module: number, id: number, seen: number[]): string {
    if (id < 0) return "";
    if (this.result.files[module].exactIntegers[id] != "") return "number:" + this.result.files[module].exactIntegers[id];
    const n: AstNode = this.node(module,id);
    if (n.kind == NodeKind.LiteralExpression) {
      if (n.get(AttributeKind.LiteralType) == "boolean") return "boolean:" + n.get(AttributeKind.Value);
      if (n.get(AttributeKind.LiteralType) == "string") return "string:" + n.get(AttributeKind.Value);
      if (n.get(AttributeKind.LiteralType) == "number") {
        const raw: string = n.get(AttributeKind.Raw) == "" ? n.get(AttributeKind.Value) : n.get(AttributeKind.Raw);
        if (["i64","u64"].includes(this.result.files[module].types[id])) return "number:" + this.result.files[module].exactIntegers[id];
        const value = nativeNumericLiteral(raw); if (value.valid) return "number:" + numberToString(value.value);
      }
    }
    if (n.kind == NodeKind.UnaryExpression && ["-","+"].includes(n.get(AttributeKind.Operator))) {
      const key: string = this.caseKey(module,bindingChild(n,EdgeRole.Operand),seen);
      if (key.startsWith("number:")) {
        if (n.get(AttributeKind.Operator) == "-" && key != "number:0") { if (key.startsWith("number:-")) return "number:" + key.slice(8,key.length); return "number:-" + key.slice(7,key.length); }
        return key;
      }
    }
    let sid: number = this.reference(module,id); if (n.kind == NodeKind.MemberExpression) sid = this.result.files[module].members[id];
    if (sid >= 0) {
      sid = this.origin(sid); if (seen.includes(sid)) return "";
      const s = this.binding.symbols[sid]; if ((s.module) < 0) return ""; let next: number[] = seen; next.push(sid);
      if (s.kind == "EnumMember") return this.caseKey(s.module,this.childOf(s.module,s.node,EdgeRole.Value),next);
      if (s.kind == "VariableDeclaration" && this.attributeOf(s.module,s.node,AttributeKind.Mutable) != "true") return this.caseKey(s.module,this.childOf(s.module,s.node,EdgeRole.Initializer),next);
    } return "";
  }
  destructure(module: number, id: number): void {
    const n: AstNode = this.node(module,id); const init: number = bindingChild(n,EdgeRole.Initializer);
    let context: string = this.annotation(module,id,n.get(AttributeKind.DeclaredType));
    if (context == "" && n.get(AttributeKind.Pattern) == "array" && this.kindOf(module,init) == NodeKind.ArrayLiteralExpression && this.node(module,init).edges.length == 0) {
      let element: string = ""; let same: boolean = true;
      for (const e of n.edges) if (e.role == EdgeRole.ArrayBindings) {
        const b: AstNode = this.node(module,e.node); let text: string = this.annotation(module,e.node,b.get(AttributeKind.DeclaredType));
        const fallback: number = bindingChild(b,EdgeRole.DefaultValue); if (text == "" && fallback >= 0) text = this.expression(module,fallback,"");
        if (element == "") element = text; else if (text != element) same = false;
      }
      if (same && element != "") context = semanticArray(element);
    }
    const source: string = memoryValue(this.expression(module,init,context));
    if (context != "") this.requireType(module,init,source,context);
    this.result.files[module].types[id] = source;
    let position: number = 0;
    for (const e of n.edges) if (e.role == EdgeRole.ArrayBindings || e.role == EdgeRole.ObjectBindings) {
      const b: AstNode = this.node(module,e.node); const sid: number = this.binding.files[module].declarations[e.node];
      const fallback: number = bindingChild(b,EdgeRole.DefaultValue); let actual: string = "!error";
      if (e.role == EdgeRole.ArrayBindings) {
        if (source.endsWith("[]")) actual = semanticElement(source);
        else if (fixedArraySize(source) >= 0) { actual = fixedArrayElement(source); if (position >= fixedArraySize(source) && fallback < 0) this.report(module,e.node,"Binding fuera del tamaño del array fijo"); }
        else if (semanticTuple(source)) {
          const items: string[] = splitTypes(source.slice(1,source.length-1),",");
          if (position < items.length) actual = items[position];
          else if (fallback >= 0) actual = this.expression(module,fallback,"");
          else this.report(module,e.node,"Binding fuera del tamaño de la tupla");
        } else this.report(module,e.node,"Destructuring de array requiere un array o tupla");
      } else {
        actual = this.member(module,e.node,source,b.get(AttributeKind.Property));
        // #223: { b = 1 } sobre un campo b?: T: el valor por defecto cubre el undefined.
        if (fallback >= 0 && genericBase(actual) == "Optional") actual = genericArguments(actual)[0];
      }
      const declared: string = this.annotation(module,e.node,b.get(AttributeKind.DeclaredType));
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
    const n: AstNode = this.node(module,id); const kind: NodeKind = n.kind;
    if (kind == NodeKind.ModuleHeaderDeclaration) return;
    if (kind == NodeKind.Program || kind == NodeKind.BlockStatement) {
      for (const e of n.edges) if (e.role == EdgeRole.Statements) this.statement(module,e.node,returns,loop);
      return;
    }
    if (kind == NodeKind.VariableDeclaration || kind == NodeKind.UsingDeclaration) {
      if (n.get(AttributeKind.Pattern) != "") { this.destructure(module,id); return; }
      const sid: number = this.binding.files[module].declarations[id]; const valueType: string = this.symbolType(sid,module,id);
      if (valueType == "void") this.report(module,id,"Una variable no puede ser void");
      const init: number = bindingChild(n,EdgeRole.Initializer);
      if (init < 0) { if (genericBase(valueType) != "Optional") this.report(module,id,"La variable necesita un valor inicial: solo un T | undefined puede empezar sin valor"); this.result.files[module].types[id] = valueType; return; }
      this.requireType(module,init,this.expression(module,init,valueType),valueType); this.result.files[module].types[id] = valueType; return;
    }
    if (isCallableNodeKind(kind)) {
      const outerSwitches: number = this.switches; this.switches = 0;
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes; this.narrowedSymbols = []; this.narrowedTypes = [];
      const valueType: string = this.signature(module,id); this.result.files[module].types[id] = valueType;
      const declared: number = this.binding.files[module].declarations[id];
      if (declared >= 0) this.symbolType(declared,module,id);
      for (const edge of n.edges) {
        if (edge.role == EdgeRole.Params) {
          const param: AstNode = this.node(module,edge.node); const pt: string = this.parameterType(module,edge.node); if (pt == "void" || pt == "Optional<void>") this.report(module,edge.node,"Un parámetro no puede ser void"); this.result.files[module].types[edge.node] = pt;
          if (param.get(AttributeKind.Variadic) == "true") {
            let last: number = -1; for (const item of n.edges) if (item.role == EdgeRole.Params) last = item.node;
            if (last != edge.node || functionClose(pt) >= 0 || (!pt.endsWith("[]") && genericBase(pt) != "pack") || param.get(AttributeKind.Optional) == "true" || bindingChild(param,EdgeRole.DefaultValue) >= 0) this.report(module,edge.node,"Un parámetro rest requiere un array, debe ser el último y no admite default ni optional");
          }
          const value: number = bindingChild(param,EdgeRole.DefaultValue); if (value >= 0) this.requireType(module,value,this.expression(module,value,pt),pt);
        }
        if (edge.role == EdgeRole.TypeParameters) {
          const parameter: AstNode = this.node(module,edge.node);
          if (parameter.get(AttributeKind.Variadic) == "true") {
            const token: string = "@" + numberToString(this.binding.files[module].declarations[edge.node]); let count: number = 0; let last: number = -1;
            for (const item of n.edges) {
              if (item.role == EdgeRole.TypeParameters) last = item.node;
              if (item.role == EdgeRole.Params) {
                const param: AstNode = this.node(module,item.node); const input: string = this.annotation(module,item.node,param.get(AttributeKind.Type));
                if (input == token && param.get(AttributeKind.Variadic) == "true") count = count + 1;
                else if (replaceType(input,token,"!pack") != input) this.report(module,item.node,"Un pack sólo puede usarse como tipo de su parámetro rest");
              }
            }
            if (last != edge.node || count != 1 || parameter.get(AttributeKind.Constraint) != "" || parameter.get(AttributeKind.Default) != "") this.report(module,edge.node,"Un pack debe ser el último parámetro de tipo y necesita un único rest correspondiente, sin constraint ni default");
            if (replaceType(functionReturn(valueType),token,"!pack") != functionReturn(valueType)) this.report(module,id,"Un pack no puede usarse como tipo de retorno");
          }
          if (parameter.get(AttributeKind.Constraint) != "") this.annotation(module,edge.node,parameter.get(AttributeKind.Constraint));
          if (parameter.get(AttributeKind.Default) != "") this.annotation(module,edge.node,parameter.get(AttributeKind.Default));
        }
      }
      if (this.asynchronous(module,id)) for (const edge of n.edges) if (edge.role == EdgeRole.Params && borrowedType(this.parameterType(module,edge.node))) this.report(module,edge.node,"E4204: una tarea async no puede almacenar un parámetro prestado sin duración demostrada");
      const bodyReturns: string = this.asynchronous(module,id) && genericBase(functionReturn(valueType)) == "Promise" ? genericArguments(functionReturn(valueType))[0] : functionReturn(valueType);
      const body: number = bindingChild(n,EdgeRole.Body);
      if (body >= 0) {
        if (this.kindOf(module,body) == NodeKind.BlockStatement) {
          this.statement(module,body,bodyReturns,0);

        } else this.requireType(module,body,this.expression(module,body,bodyReturns),bodyReturns);
      } this.switches = outerSwitches; this.narrowedSymbols = symbols; this.narrowedTypes = types; return;
    }
    if (kind == NodeKind.ReturnStatement) {
      if (returns == "") this.report(module,id,"return fuera de una función");
      const value: number = bindingChild(n,EdgeRole.Value); this.requireType(module,value < 0 ? id : value,this.expression(module,value,returns),returns); return;
    }
    if (kind == NodeKind.DeleteStatement) {
      const target: number = bindingChild(n,EdgeRole.Target); const index: AstNode = this.node(module,target);
      const object: number = bindingChild(index,EdgeRole.Object); const key: number = bindingChild(index,EdgeRole.Index);
      const container: string = memoryValue(this.expression(module,object,""));
      let keyType: string = "!error";
      if (["Map","Set"].includes(genericBase(container))) keyType = genericArguments(container)[0];
      else if (container.endsWith("[]")) keyType = "number";
      else this.report(module,id,"delete requiere Map, Set o array dinámico");
      this.requireType(module,key,this.expression(module,key,keyType),keyType); this.writableTarget(module,object,true); return;
    }
    if (kind == NodeKind.ExpressionStatement) { this.expression(module,bindingChild(n,EdgeRole.Expression),""); return; }
    if (kind == NodeKind.ForOfStatement || kind == NodeKind.ForInStatement) {
      const source: number = bindingChild(n,kind == NodeKind.ForOfStatement ? EdgeRole.Iterable : EdgeRole.Target);
      const container: string = memoryValue(this.expression(module,source,"")); let element: string = "!error";
      if (container.endsWith("[]")) element = semanticElement(container);
      else if (fixedArraySize(container) >= 0) element = fixedArrayElement(container);
      else if (container == "string" && kind == NodeKind.ForOfStatement) element = "string";
      else if (genericBase(container) == "Map") element = "[" + genericArguments(container).join(",") + "]";
      else if (genericBase(container) == "Set" && kind == NodeKind.ForOfStatement) element = genericArguments(container)[0];
      else this.report(module,source,"El tipo no es iterable en " + nodeKindName(kind));
      if (kind == NodeKind.ForInStatement) { if (genericBase(container) == "Map") element = genericArguments(container)[0]; else element = "number"; }
      if (n.get(AttributeKind.Await) == "true") {
        this.awaitContext(module,id);
        if (genericBase(element) != "Promise") this.report(module,source,"for await requiere elementos Promise<T>");
        else element = genericArguments(element)[0];
      }
      const binding: number = bindingChild(n,EdgeRole.Binding); const sid: number = this.binding.files[module].declarations[binding];
      const declared: string = this.annotation(module,binding,this.attributeOf(module,binding,AttributeKind.DeclaredType));
      if (declared != "") this.requireType(module,binding,element,declared);
      if (n.get(AttributeKind.Await) == "true" && borrowedType(declared)) this.report(module,binding,"E4203: el resultado de for await necesita almacenamiento local por valor");
      if (n.get(AttributeKind.Await) != "true" && this.transferType(element) && memoryMode(declared) != "constRef") this.report(module,binding,"E4101: iterar un elemento con ownership requiere constRef");
      const valueType: string = declared == "" ? element : declared;
      this.result.files[module].types[binding] = valueType; if (sid >= 0) { this.result.symbolTypes[sid] = valueType; this.symbolStates[sid] = 2; }
      this.statement(module,bindingChild(n,EdgeRole.Body),returns,loop+1); return;
    }
    if (kind == NodeKind.IfStatement) {
      const condition: number = bindingChild(n,EdgeRole.Condition); this.requireType(module,condition,this.expression(module,condition,""),"boolean");
      const symbols: number[] = this.narrowedSymbols; const types: string[] = this.narrowedTypes;
      const yes: number = bindingChild(n,EdgeRole.ThenBranch); const no: number = bindingChild(n,EdgeRole.ElseBranch);
      this.narrowCondition(module,condition,true); if (yes >= 0) this.statement(module,yes,returns,loop);
      this.narrowedSymbols = symbols; this.narrowedTypes = types; this.narrowCondition(module,condition,false); if (no >= 0) this.statement(module,no,returns,loop);
      this.narrowedSymbols = symbols; this.narrowedTypes = types;
      this.afterIf(module,condition,yes,no);
      return;
    }
    if (kind == NodeKind.WhileStatement || kind == NodeKind.ForStatement) {
      const condition: number = bindingChild(n,EdgeRole.Condition); if (condition >= 0) this.requireType(module,condition,this.expression(module,condition,""),"boolean");
      const init: number = bindingChild(n,EdgeRole.Initializer); if (init >= 0) this.statement(module,init,returns,loop);
      const update: number = bindingChild(n,EdgeRole.Increment); if (update >= 0) this.expression(module,update,"");
      for (const e of n.edges) if (e.role == EdgeRole.Body || e.role == EdgeRole.ThenBranch || e.role == EdgeRole.ElseBranch) this.statement(module,e.node,returns,kind == NodeKind.IfStatement ? loop : loop + 1); return;
    }
    if (kind == NodeKind.SwitchStatement) {
      const value: number = bindingChild(n,EdgeRole.Discriminant); const valueType: string = this.expression(module,value,"");
      const nominal: number = this.nominalSymbol(valueType); const enumType: boolean = nominal >= 0 && this.binding.symbols[nominal].kind == "EnumDeclaration";
      if (!numericType(valueType) && valueType != "string" && !enumType) this.report(module,value,"switch requiere un número, string o enum");
      let labels: string[] = []; this.switches = this.switches + 1;
      for (const edge of n.edges) if (edge.role == EdgeRole.Clauses) {
        const clause: AstNode = this.node(module,edge.node);
        for (const item of clause.edges) if (item.role == EdgeRole.Labels) {
          this.requireType(module,item.node,this.expression(module,item.node,valueType),valueType);
          const key: string = this.caseKey(module,item.node,[]);
          this.result.files[module].caseValues[item.node] = key;
          if (key == "") this.report(module,item.node,"Una etiqueta case requiere una constante conocida");
          else if (labels.includes(key)) this.report(module,item.node,"Etiqueta case duplicada"); else labels.push(key);
        }
        for (const item of clause.edges) if (item.role == EdgeRole.Body) this.statement(module,item.node,returns,loop);
      }
      this.switches = this.switches - 1; return;
    }
    if (kind == NodeKind.BreakStatement || kind == NodeKind.ContinueStatement) { if (loop == 0 && (kind == NodeKind.ContinueStatement || this.switches == 0)) this.report(module,id,nodeKindName(kind) + " fuera de su contexto de bucle/switch"); return; }
    if (kind == NodeKind.ClassDeclaration || kind == NodeKind.InterfaceDeclaration) {
      for (const edge of n.edges) {
        if (edge.role == EdgeRole.TypeParameters) { const p: AstNode = this.node(module,edge.node); if (p.get(AttributeKind.Variadic) == "true") this.report(module,id,"Los packs de tipos sólo se admiten en funciones"); }
        if (edge.role == EdgeRole.Fields) {
          const field: AstNode = this.node(module,edge.node); const valueType: string = this.annotation(module,edge.node,field.get(AttributeKind.Type)); if (valueType == "void") this.report(module,edge.node,"Un campo no puede ser void"); this.result.files[module].types[edge.node] = valueType;
          const value: number = bindingChild(field,EdgeRole.DefaultValue); if (value >= 0) this.requireType(module,value,this.expression(module,value,valueType),valueType);
        }
        if (edge.role == EdgeRole.Methods) this.statement(module,edge.node,returns,0);
      } return;
    }
    if (kind == NodeKind.TypeAliasDeclaration) { this.symbolType(this.binding.files[module].declarations[id],module,id); return; }
    if (kind == NodeKind.UnionDeclaration) {
      for (const edge of n.edges) if (edge.role == EdgeRole.Variants) {
        const sid: number = this.binding.files[module].declarations[edge.node]; this.result.files[module].types[edge.node] = this.symbolType(sid,module,edge.node);
        for (const field of this.node(module,edge.node).edges) if (field.role == EdgeRole.Bindings) {
          const binding: number = this.binding.files[module].declarations[field.node]; if (binding >= 0) this.result.files[module].types[field.node] = this.symbolType(binding,module,field.node);
        }
      } return;
    }
    if (kind == NodeKind.EnumDeclaration) {
      const sid: number = this.binding.files[module].declarations[id]; this.symbolType(sid,module,id);
      for (const edge of n.edges) if (edge.role == EdgeRole.Members) {
        const member: number = this.binding.files[module].declarations[edge.node]; const value: number = this.childOf(module,edge.node,EdgeRole.Value);
        this.result.files[module].types[edge.node] = this.symbolType(member,module,edge.node);
        if (value >= 0) { this.expression(module,value,""); if (n.get(AttributeKind.Underlying) == "number") this.literalRange(module,value,"i32"); }
      } return;
    }
    if (kind == NodeKind.ExportDefaultDeclaration) {
      const declaration: number = bindingChild(n,EdgeRole.Declaration);
      if (isExpressionNodeKind(this.kindOf(module,declaration))) this.expression(module,declaration,""); else this.statement(module,declaration,returns,loop); return;
    }
    if ([NodeKind.ImportDeclaration,NodeKind.ExportAllDeclaration,NodeKind.ExportNamedDeclaration].includes(kind)) return;
    this.unsupported(module,id,nodeKindName(kind));
  }
  decorator(module: number, id: number): void {
    const n: AstNode = this.node(module,id); const name: string = n.get(AttributeKind.Name); const target: number = this.binding.files[module].parents[id]; const owner: AstNode = this.node(module,target);
    if (!["cpp_native","cpp_name","cpp_type","cpp_drogon","cppgen","etsgen","comptime","deprecated","sealed","include","link"].includes(name)) { this.report(module,id,"Decorador desconocido o sin contrato nativo: @" + name); return; }
    let item: NativeDecorator = new NativeDecorator(module,id,target,name); let valid: boolean = true;
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) {
      const argument: AstNode = this.node(module,edge.node); this.expression(module,edge.node,"");
      if (argument.kind != NodeKind.LiteralExpression || argument.get(AttributeKind.LiteralType) != "string") { this.report(module,edge.node,"Un argumento de decorador debe ser un literal string"); valid = false; }
      else item.arguments.push(argument.get(AttributeKind.Value));
    }
    if (name == "etsgen" || name == "cppgen") {
      if (owner.kind != NodeKind.FunctionDeclaration || this.asynchronous(module,target) || item.arguments.length != 0 || functionReturn(this.signature(module,target)) != "string") { this.report(module,id,"@"+name+" requiere una función síncrona que devuelva string, sin argumentos de decorador"); valid = false; }
    } else if (name == "cpp_native") {
      const symbol: string = item.arguments.length == 1 ? item.arguments[0] : "";
      const parts: string[] = symbol.split("::");
      let validSymbol: boolean = parts.length > 0;
      for (const part of parts) {
        if (part.length == 0) { validSymbol = false; continue; }
        const allowedFirst: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
        const allowedRest: string = allowedFirst + "0123456789";
        if (!allowedFirst.includes(part.charAt(0))) validSymbol = false;
        for (let k: number = 1; k < part.length; k = k + 1) {
          if (!allowedRest.includes(part.charAt(k))) validSymbol = false;
        }
      }
      if (owner.kind != NodeKind.FunctionDeclaration || this.asynchronous(module,target) || item.arguments.length != 1 || !validSymbol) { this.report(module,id,"@cpp_native requiere una función síncrona y un símbolo C++ literal válido"); valid = false; }
    } else if (name == "cpp_name" || name == "cpp_type") {
      const allowed: boolean = name == "cpp_type" ? owner.kind == NodeKind.InterfaceDeclaration : [NodeKind.FunctionDeclaration,NodeKind.InterfaceMethod,NodeKind.ClassMethod].includes(owner.kind);
      if (!allowed || item.arguments.length != 1 || item.arguments[0] == "") { this.report(module,id,"@"+name+" requiere un nombre externo literal y una declaración compatible"); valid = false; }
    } else if (name == "cpp_drogon") {
      const sid: number = this.binding.files[module].declarations[target];
      if (owner.kind != NodeKind.VariableDeclaration || item.arguments.length != 0 || sid < 0 || this.symbolType(sid,module,target) != "Server") { this.report(module,id,"@cpp_drogon requiere una variable Server y no recibe argumentos"); valid = false; }
    } else if (name == "comptime") {
      if (owner.kind != NodeKind.FunctionDeclaration || this.asynchronous(module,target) || item.arguments.length != 0) { this.report(module,id,"@comptime requiere una función síncrona sin argumentos de decorador"); valid = false; }
    } else if (name == "sealed") { if (owner.kind != NodeKind.ClassDeclaration || item.arguments.length != 0) { this.report(module,id,"@sealed requiere una clase y no admite argumentos"); valid = false; } }
    else if (name == "include" || name == "link") { if (owner.kind != NodeKind.ModuleHeaderDeclaration || item.arguments.length != 1) { this.report(module,id,"@" + name + " requiere un único string en la cabecera del módulo"); valid = false; } }
    else if (item.arguments.length > 1) { this.report(module,id,"@deprecated admite a lo sumo un mensaje"); valid = false; }
    for (const previous of this.result.decorators) if (previous.module == module && previous.target == target && previous.name == name && name != "include" && name != "link") { this.report(module,id,"Decorador duplicado @" + name); valid = false; }
    if (valid) this.result.decorators.push(item);
  }
  check(): CheckResult {
    if (this.trace) progressDetail("frontend: types");
    for (const diagnostic of this.binding.diagnostics) this.result.diagnostics.push(diagnostic);
    if (!this.binding.success) return this.result;
    for (const s of this.binding.symbols) { this.result.symbolTypes.push(""); this.symbolStates.push(0); }
    for (const m of this.graph.modules) this.result.files.push(new TypedFile(m.cached.result.ast.nodes.length));
    const statementsProfile = profileBegin();
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) {
      if (this.trace) progressDetail("frontend: checking ["+numberToString(m+1)+"/"+numberToString(this.graph.modules.length)+"] "+this.graph.modules[m].file);
      this.statement(m,this.graph.modules[m].cached.result.ast.root,"",0);
    }
    profileEnd("types-statements",statementsProfile); const arrowsProfile = profileBegin();
    // Arrows may be reached only as values, not statements. Validate their bodies too.
    for (let m: number = 0; m < this.graph.modules.length; m = m + 1) for (let id: number = 0; id < this.result.files[m].types.length; id = id + 1) {
      if (this.binding.files[m].nodeScopes[id] >= 0 && this.kindOf(m,id) == NodeKind.ArrowFunctionExpression) this.statement(m,id,"",0);
      if (this.binding.files[m].nodeScopes[id] >= 0 && this.kindOf(m,id) == NodeKind.Decorator) this.decorator(m,id);
    }
    profileEnd("types-arrows",arrowsProfile); const signaturesProfile = profileBegin();
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
    profileEnd("types-signatures",signaturesProfile); const safetyProfile = profileBegin();
    if (this.result.diagnostics.length == 0) { let checked: CheckResult = this.result; validateSafety(this.graph,this.binding,checked,this.trace); this.result = checked; }
    profileEnd("safety",safetyProfile); const comptimeProfile = profileBegin();
    if (this.result.diagnostics.length == 0) { if (this.trace) progressDetail("frontend: comptime"); this.result = evaluateNativeComptime(this.graph,this.binding,this.result); }
    profileEnd("comptime",comptimeProfile);
    this.result.success = this.result.diagnostics.length == 0; return this.result;
  }
}
// "@12" → 12 si es exactamente "@" + numberToString(sid) con sid < count; si no, -1.
function parameterToken(text: string, count: number): number {
  if (text.length < 2 || text.charCodeAt(0) != 64) return -1; if (text.length > 2 && text.charCodeAt(1) == 48) return -1;
  let value: number = 0;
  for (let at: number = 1; at < text.length; at = at + 1) { const digit: number = text.charCodeAt(at) - 48; if (digit < 0 || digit > 9) return -1; value = value * 10 + digit; if (value >= count) return -1; }
  return value;
}
// Optional<X> se muestra como en TypeScript: "X | undefined".
function undefinedDisplay(text: string): string {
  let result: string = text; let at: number = result.indexOf("Optional<",0);
  while (at >= 0) {
    let depth: number = 0; let end: number = -1;
    for (let k: number = at + 8; k < result.length; k = k + 1) { const c: string = result.charAt(k); if (c == "<") depth = depth + 1; if (c == ">") { depth = depth - 1; if (depth == 0) { end = k; break; } } }
    if (end < 0) break;
    const inner: string = result.slice(at + 9, end); const shown: string = inner.indexOf("|",0) >= 0 || inner.indexOf("=>",0) >= 0 ? "(" + inner + ")" : inner;
    result = result.slice(0, at) + shown + " | undefined" + result.slice(end + 1, result.length);
    at = result.indexOf("Optional<",0);
  }
  return result;
}
export function checkProject(graph: ModuleGraph, binding: BindingResult, trace: boolean = false): CheckResult { let checker: NativeChecker = new NativeChecker(graph,binding); checker.trace = trace; let checked: CheckResult = checker.check(); if (trace) progressDetail("frontend: module records"); attachModuleRecords(graph,binding,checked); return checked; }
