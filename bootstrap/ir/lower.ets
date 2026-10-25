import { IrCleanupScope, IrRuntimeContract, IrType, IrSource, IrPlace, IrInstruction, IrBlock, IrFunction, IrModule, IrIssue, IrProject } from "./model";
import { ModuleGraph } from "../modules/loader";
import { BindingResult, bindingChild } from "../binder/binder";
import { CheckResult } from "../checker/model";
import { functionParams, functionReturn, primitiveType, functionClose, numericType, semanticElement, semanticTuple, splitTypes, joinTypes, fixedArraySize, fixedArrayElement, canonicalSymbol, genericBase, genericArguments, replaceType } from "../checker/types";
import { AstNode } from "../parser/parser";
import { NodeKind, EdgeRole, AttributeKind, nodeKindName } from "../parser/ast-schema";
import { nativeNumericLiteral, nativeBinaryPromotion, nativeUnaryPromotion } from "../checker/numeric";
import { NativeComptime } from "../checker/comptime";
import { constantIntegerText } from "../checker/constant";
import { resourceType, resourceSubstitution } from "../checker/ownership";
import { irNumericWidth, irNumericKind, irNumericSigned } from "./type-traits";
import { finishBorrows } from "./borrows";
import { preserveContracts } from "./contracts";
import { verifyIr } from "./verify";

function irIndex(values: number[], value: number): number { for (let i: number = 0; i < values.length; i = i+1) if (values[i] == value) return i; return -1; }

function memoryMode(text: string): string { const base: string = genericBase(text); return ["ptr","constPtr","ref","constRef","readonly"].includes(base) ? base : ""; }
function memoryInner(text: string): string { return memoryMode(text) == "" ? text : genericArguments(text)[0]; }
function memoryValue(text: string): string { let value: string = text; while (memoryMode(value) != "") value = memoryInner(value); return value; }
function irSameNumbers(left: number[], right: number[]): boolean { if (left.length != right.length) return false; for (let i: number = 0; i < left.length; i = i+1) if (left[i] != right[i]) return false; return true; }

export class IrLowering {
  contextFrom: string[]; contextTo: string[];
  graph: ModuleGraph; binding: BindingResult; checked: CheckResult; result: IrProject;
  module: number; currentFunction: number; block: number; symbols: number[]; breakTargets: number[]; continueTargets: number[];
  overrideNodes: number[]; overridePlaces: number[]; optionalActive: number[];
  cleanupScopes: IrCleanupScope[]; breakDepths: number[]; continueDepths: number[];
  receiverOverride: number; preparedArguments: number[]; preparedCall: number;
  argumentSymbols: number[]; argumentValues: number[];
  functionModules: number[]; functionNodes: number[]; globalSymbols: number[]; orderState: number[];
  constructor(graph: ModuleGraph, binding: BindingResult, checked: CheckResult) {
    this.contextFrom = []; this.contextTo = [];
    this.graph = graph; this.binding = binding; this.checked = checked; this.result = new IrProject();
    this.module = 0; this.currentFunction = -1; this.block = 0; this.symbols = []; this.breakTargets = []; this.continueTargets = [];
    this.overrideNodes = []; this.overridePlaces = []; this.optionalActive = [];
    this.cleanupScopes = []; this.breakDepths = []; this.continueDepths = [];
    this.receiverOverride = -1; this.preparedArguments = []; this.preparedCall = -1;
    this.argumentSymbols = []; this.argumentValues = [];
    this.functionModules = []; this.functionNodes = []; this.globalSymbols = []; this.orderState = [];
  }
  node(id: number): AstNode { return this.graph.modules[this.module].cached.result.ast.nodes[id]; }
  source(id: number): IrSource {
    const n = this.node(id); const record = this.checked.moduleRecords[this.module];
    let source = new IrSource(record.id,record.sourceHash,this.graph.modules[this.module].file,id,n.start.offset,n.end.endOffset);
    if (n.generatedId != "") { source.generatedId = n.generatedId; source.generatedStart = n.generatedStart.offset; source.generatedEnd = n.generatedEnd.endOffset; } return source;
  }
  fail(id: number, message: string): void { this.result.diagnostics.push(new IrIssue("IR_UNSUPPORTED",message,this.source(id))); }
  resolved(text: string): string {
    for (let at: number = this.contextFrom.length-1; at >= 0; at = at-1) text = replaceType(text,this.contextFrom[at],this.contextTo[at]);
    if (this.currentFunction >= 0) for (let at: number = 0; at < this.result.functions[this.currentFunction].substitutionFrom.length; at = at+1) text = replaceType(text,this.result.functions[this.currentFunction].substitutionFrom[at],this.result.functions[this.currentFunction].substitutionTo[at]);
    return text;
  }
  typeId(input: string, id: number): number {
    let text: string = this.resolved(input);
    while (genericBase(text) == "pack" && genericArguments(text).length == 1 && genericBase(genericArguments(text)[0]) == "pack") text = genericArguments(text)[0];
    for (let i: number = 0; i < this.result.types.length; i = i+1) if (this.result.types[i] == text) return i;
    const index: number = this.result.types.length; this.result.types.push(text); this.result.typeDefinitions.push(new IrType("pending"));
    if (text == "" || text == "!error" || text.startsWith("!")) { this.fail(id,"Tipo incompleto: "+text); this.result.typeDefinitions[index].kind = "invalid"; return index; }
    let kind: string = ""; let arguments: string[] = [];
    const mode: string = memoryMode(text); const nominal: number = canonicalSymbol(text);
    if (primitiveType(text)) kind = "scalar";
    else if (mode != "") { kind = mode; arguments.push(memoryInner(text)); }
    else if (functionClose(text) >= 0) { kind = "function"; arguments = functionParams(text); arguments.push(functionReturn(text)); }
    else if (text.endsWith("[]")) { kind = "array"; arguments.push(semanticElement(text)); }
    else if (fixedArraySize(text) >= 0) { kind = "fixedArray"; arguments.push(fixedArrayElement(text)); this.result.typeDefinitions[index].length = fixedArraySize(text); }
    else if (semanticTuple(text)) { kind = "tuple"; arguments = splitTypes(text.slice(1,text.length-1),","); }
    else if (splitTypes(text,"|").length > 1) { kind = "sum"; arguments = splitTypes(text,"|"); }
    else if (splitTypes(text,"&").length > 1) { kind = "intersection"; arguments = splitTypes(text,"&"); }
    else if (genericBase(text) == "variant") { kind = "variant"; this.variantShape(index,text,id); }
    else if (nominal >= 0 && nominal < this.binding.symbols.length) {
      const owner = this.binding.symbols[nominal]; kind = (owner.kind == "EnumDeclaration" ? "enum" : owner.kind == "UnionDeclaration" ? "union" : owner.kind == "InterfaceDeclaration" ? "interface" : "record");
      this.result.typeDefinitions[index].symbolId = this.checked.symbolIds[nominal];
      arguments = genericArguments(text); const declaration = this.graph.modules[owner.module].cached.result.ast.nodes[owner.node]; let tokens: string[] = [];
      for (const e of declaration.edges) if (e.role == EdgeRole.TypeParameters) tokens.push("@"+numberToString(this.binding.files[owner.module].declarations[e.node]));
      if (kind == "enum") arguments.push(declaration.get(AttributeKind.Underlying));
      if (kind == "union") {
        for (const e of declaration.edges) if (e.role == EdgeRole.Variants) this.result.typeDefinitions[index].variants.push(this.typeId("variant<"+text+","+numberToString(e.node)+">",id));
        if (this.result.typeDefinitions[index].variants.length > 0) {
          const first: number = this.result.typeDefinitions[index].variants[0];
          for (let field: number = 0; field < this.result.typeDefinitions[first].names.length; field = field+1) {
            const name: string = this.result.typeDefinitions[first].names[field]; let fields: string[] = []; let common: boolean = true;
            for (const variant of this.result.typeDefinitions[index].variants) { let found: boolean = false; for (let at: number = 0; at < this.result.typeDefinitions[variant].names.length; at = at+1) if (this.result.typeDefinitions[variant].names[at] == name) { found = true; const text: string = this.result.types[this.result.typeDefinitions[variant].fields[at]]; if (!fields.includes(text)) fields.push(text); } if (!found) common = false; }
            if (common) { this.result.typeDefinitions[index].names.push(name); this.result.typeDefinitions[index].fields.push(this.typeId(joinTypes(fields,"|"),id)); }
          }
        }
      }
      for (let field: number = 0; field < this.binding.symbols.length; field = field+1) {
        const member = this.binding.symbols[field];
        if (member.module != owner.module || (member.scope) < 0 || this.binding.scopes[member.scope].node != owner.node || !["ClassField","InterfaceField"].includes(member.kind)) continue;
        const fieldNode = this.graph.modules[member.module].cached.result.ast.nodes[member.node]; if (fieldNode.get(AttributeKind.IsStatic) == "true") continue;
        let value: string = this.checked.symbolTypes[field];
        for (let at: number = 0; at < tokens.length && at < arguments.length; at = at+1) value = replaceType(value,tokens[at],arguments[at]);
        const fieldType: number = this.typeId(value,id); this.result.typeDefinitions[index].fields.push(fieldType); this.result.typeDefinitions[index].names.push(member.name);
      }
    } else if (["Optional","Result","Map","Set","Promise","pack","variant","iterator"].includes(genericBase(text))) { kind = genericBase(text); arguments = genericArguments(text); }
    else if (text.startsWith("@")) kind = "parameter";
    else {
      for (const symbol of this.binding.symbols) if (symbol.kind == "builtin-type" && symbol.name == text) kind = "runtime";
      if (kind == "") { this.fail(id,"Tipo sin contrato IR: "+text); kind = "invalid"; }
    }
    this.result.typeDefinitions[index].kind = kind;
    this.result.typeDefinitions[index].numericKind = irNumericKind(text); this.result.typeDefinitions[index].bits = irNumericWidth(text); this.result.typeDefinitions[index].isSigned = irNumericSigned(text);
    for (let at: number = 0; at < arguments.length; at = at+1) { let argument: string = arguments[at]; if (argument.startsWith("...")) argument = argument.slice(3,argument.length); this.result.typeDefinitions[index].arguments.push(this.typeId(argument,id)); }
    this.result.typeDefinitions[index].resource = !["ref","constRef","readonly"].includes(kind) && resourceType(this.graph,this.binding,this.checked,text,[]);
    return index;
  }
  valueType(value: number): number { return value >= 0 ? this.result.functions[this.currentFunction].values[value] : -1; }
  unwrappedPlace(id: number, expected: number): number {
    let place: number = this.materialize(id); let count: number = 0;
    while (place >= 0 && this.result.functions[this.currentFunction].places[place].typeId != expected && count < 8) {
      const shape = this.result.typeDefinitions[this.result.functions[this.currentFunction].places[place].typeId]; if (!["ref","constRef","ptr","constPtr","readonly"].includes(shape.kind)) break;
      place = this.projection(place,"deref",shape.arguments[0],-1,-1,id); count = count+1;
    }
    return place;
  }
  argumentValue(id: number, formal: string): number {
    const expected: number = this.typeId(formal,id); const actual: number = this.typeId(this.checked.files[this.module].types[id],id);
    if (["ref","constRef"].includes(this.result.typeDefinitions[expected].kind) && actual != expected) {
      const n = this.node(id); const value: number = n.kind == NodeKind.NamedArgumentExpression ? bindingChild(n,EdgeRole.Value) : id;
      const p: number = this.unwrappedPlace(value,this.result.typeDefinitions[expected].arguments[0]);
      return this.emit("borrow",expected,[],p,-1,this.result.typeDefinitions[expected].kind,id);
    }
    return this.expression(id);
  }
  rootPlace(id: number): number {
    for (let at: number = this.overrideNodes.length-1; at >= 0; at = at-1) if (this.overrideNodes[at] == id) return this.overridePlaces[at];
    const n = this.node(id);
    if (n.kind == NodeKind.IdentifierExpression) {
      let p: number = this.place(this.reference(id),id); if (p < 0) return p;
      const actual: number = this.result.functions[this.currentFunction].places[p].typeId; const expected: number = this.typeId(this.checked.files[this.module].types[id],id);
      if (actual != expected && ["union","sum"].includes(this.result.typeDefinitions[actual].kind)) p = this.projection(p,"checkedView",expected,-1,-1,id); return p;
    }
    if (n.kind == NodeKind.MemberExpression || n.kind == NodeKind.IndexExpression) {
      const bound: number = this.checked.files[this.module].members[id];
      if (bound >= 0 && this.globalSymbols.includes(bound)) return this.place(bound,id);
      const object: number = bindingChild(n,EdgeRole.Object); let base: number = this.materialize(object);
      if (base >= 0) { const actual: number = this.result.functions[this.currentFunction].places[base].typeId; const expected: number = this.overrideNodes.includes(object) ? actual : this.typeId(this.checked.files[this.module].types[object],object); if (actual != expected && ["union","sum"].includes(this.result.typeDefinitions[actual].kind)) base = this.projection(base,"checkedView",expected,-1,-1,id); }
      const baseType: number = this.result.functions[this.currentFunction].places[base].typeId;
      const mode: string = this.result.typeDefinitions[baseType].kind;
      if (["ptr","constPtr","ref","constRef","readonly"].includes(mode)) base = this.projection(base,"deref",this.result.typeDefinitions[baseType].arguments[0],-1,-1,id);
      const rawType: string = this.resolved(this.checked.files[this.module].types[id]);
      const typeId: number = this.typeId(this.optionalActive.includes(id) ? genericArguments(rawType)[0] : rawType,id);
      if (n.kind == NodeKind.IndexExpression) return this.projection(base,"index",typeId,this.expression(bindingChild(n,EdgeRole.Index)),-1,id);
      const name: string = n.get(AttributeKind.Member); const parentType: number = this.result.functions[this.currentFunction].places[base].typeId;
      let field: number = -1; for (let at: number = 0; at < this.result.typeDefinitions[parentType].names.length; at = at+1) if (this.result.typeDefinitions[parentType].names[at] == name) field = at;
      if (field < 0) { this.fail(id,"Campo sin identidad de IR: "+name); return -1; }
      return this.projection(base,"field",typeId,-1,field,id);
    }
    this.fail(id,"La operación requiere un place"); return -1;
  }
  materialize(id: number): number {
    const n = this.node(id);
    if (n.kind == NodeKind.AssignmentExpression || n.kind == NodeKind.CompoundAssignmentExpression) return this.assignmentPlace(id);
    if (n.kind == NodeKind.IdentifierExpression || n.kind == NodeKind.IndexExpression || n.kind == NodeKind.MemberExpression) {
      const bound: number = this.reference(id);
      if (!(bound >= 0 && ["FunctionDeclaration","ClassDeclaration","UnionDeclaration","EnumDeclaration","builtin","builtin-type"].includes(this.binding.symbols[bound].kind))) return this.rootPlace(id);
    }
    const value: number = this.expression(id); const p: number = this.local(-1,this.valueType(value),false,id); this.emit("store",-1,[value],p,-1,"",id); this.track(p); return p;
  }
  projection(base: number, kind: string, typeId: number, index: number, field: number, id: number): number {
    if (base < 0) return -1;
    const p: number = this.local(-1,typeId,false,id);
    this.result.functions[this.currentFunction].places[p].kind = kind; this.result.functions[this.currentFunction].places[p].base = base;
    this.result.functions[this.currentFunction].places[p].index = index; this.result.functions[this.currentFunction].places[p].field = field; return p;
  }
  shapeConstruct(id: number, typeId: number): number {
    const n = this.node(id); let values: number[] = []; let names: string[] = [];
    if (n.kind == NodeKind.ArrayLiteralExpression) {
      let position: number = 0;
      for (const e of n.edges) if (e.role == EdgeRole.Elements) { const spread: boolean = this.node(e.node).kind == NodeKind.SpreadElement; let value: number = this.expression(e.node); const shape = this.result.typeDefinitions[typeId]; if (!spread && shape.arguments.length > 0) value = this.convert(value,shape.arguments[["tuple","pack"].includes(shape.kind) ? position : 0],e.node); values.push(value); names.push(spread ? "spread" : "value"); position = position+1; }
      const result: number = this.emit("aggregate",typeId,values,-1,-1,"",id); this.setNames(names); return result;
    }
    for (const e of n.edges) if (e.role == EdgeRole.Properties) { const name: string = this.node(e.node).get(AttributeKind.Key); names.push(name); let value: number = this.expression(bindingChild(this.node(e.node),EdgeRole.Value)); for (let field: number = 0; field < this.result.typeDefinitions[typeId].names.length; field = field+1) if (this.result.typeDefinitions[typeId].names[field] == name) value = this.convert(value,this.result.typeDefinitions[typeId].fields[field],e.node); values.push(value); }
    const result: number = this.emit(this.result.typeDefinitions[typeId].kind == "variant" ? "variant" : "record",typeId,values,-1,-1,this.result.typeDefinitions[typeId].tag,id); this.setNames(names); return result;
  }
  lastInstruction(): IrInstruction { const instructions = this.result.functions[this.currentFunction].blocks[this.block].instructions; return instructions[instructions.length-1]; }
  setNames(names: string[]): void { this.result.functions[this.currentFunction].blocks[this.block].instructions[this.result.functions[this.currentFunction].blocks[this.block].instructions.length-1].names = names; }
  variantShape(index: number, text: string, id: number): void {
    const parts: string[] = genericArguments(text); const parent: number = this.typeId(parts[0],id); const ownerId: number = canonicalSymbol(parts[0]);
    if (ownerId < 0 || parts.length != 2) { this.fail(id,"Variante sin unión de origen"); return; }
    const owner = this.binding.symbols[ownerId]; const nodeId: number = nativeNumericLiteral(parts[1]).value; const arena = this.graph.modules[owner.module].cached.result.ast.nodes;
    if (nodeId < 0 || nodeId >= arena.length || arena[nodeId].kind != NodeKind.UnionVariant) { this.fail(id,"Identidad de variante inválida"); return; }
    const node = arena[nodeId]; this.result.typeDefinitions[index].arguments = [parent]; this.result.typeDefinitions[index].tag = node.get(AttributeKind.Name);
    const symbol: number = this.binding.files[owner.module].declarations[nodeId]; this.result.typeDefinitions[index].symbolId = this.checked.symbolIds[symbol];
    let from: string[] = []; let to: string[] = genericArguments(parts[0]);
    for (const e of arena[owner.node].edges) if (e.role == EdgeRole.TypeParameters) from.push("@"+numberToString(this.binding.files[owner.module].declarations[e.node]));
    this.result.typeDefinitions[index].names.push("kind"); this.result.typeDefinitions[index].fields.push(this.typeId("string",id));
    const discriminator: number = bindingChild(node,EdgeRole.Discriminator);
    if (discriminator >= 0) {
      const name: string = arena[discriminator].get(AttributeKind.Field); this.result.typeDefinitions[index].discriminator = name; this.result.typeDefinitions[index].discriminatorValue = arena[discriminator].get(AttributeKind.Value); this.result.typeDefinitions[index].discriminatorType = this.typeId(arena[discriminator].get(AttributeKind.LiteralType),id);
      if (name != "kind") { this.result.typeDefinitions[index].names.push(name); this.result.typeDefinitions[index].fields.push(this.result.typeDefinitions[index].discriminatorType); }
    }
    let count: number = 0;
    for (const e of node.edges) if (e.role == EdgeRole.Bindings) {
      const field: number = this.binding.files[owner.module].declarations[e.node]; let input: string = this.checked.symbolTypes[field]; for (let at: number = 0; at < from.length && at < to.length; at = at+1) input = replaceType(input,from[at],to[at]);
      this.result.typeDefinitions[index].names.push(arena[e.node].get(AttributeKind.Name)); this.result.typeDefinitions[index].fields.push(this.typeId(input,id)); count = count+1;
    }
    if (count == 0 && node.get(AttributeKind.Payload) != "") {
      let payload: string = functionParams(this.checked.symbolTypes[symbol])[0]; for (let at: number = 0; at < from.length && at < to.length; at = at+1) payload = replaceType(payload,from[at],to[at]);
      this.result.typeDefinitions[index].names.push("value"); this.result.typeDefinitions[index].fields.push(this.typeId(payload,id));
    }
  }
  unionConstructor(id: number, typeId: number): number {
    const n = this.node(id); let values: number[] = []; const signature: string = this.resolved(this.checked.files[this.module].signatures[id]); const parameters: string[] = functionParams(signature); let at: number = 0;
    for (const e of n.edges) if (e.role == EdgeRole.Args) { values.push(this.convert(this.expression(e.node),this.typeId(parameters[at],id),id)); at = at+1; }
    let names: string[] = []; const shape = this.result.typeDefinitions[typeId];
    for (const name of shape.names) if (name != "kind" && name != shape.discriminator) names.push(name);
    if (names.length > 1 && values.length == 1) {
      const input: number = values[0]; const p: number = this.local(-1,this.valueType(input),false,id); this.emit("store",-1,[input],p,-1,"",id); this.track(p); values = [];
      for (let field: number = 0; field < names.length; field = field+1) { const key: number = this.emit("constant",this.typeId("number",id),[],-1,-1,numberToString(field),id); const tuple = this.result.typeDefinitions[this.result.functions[this.currentFunction].places[p].typeId]; const valueType: number = tuple.arguments[field]; const place: number = this.projection(p,"index",valueType,key,-1,id); values.push(this.emit(this.result.typeDefinitions[valueType].resource ? "move" : "load",valueType,[],place,-1,"",id)); }
    }
    const result: number = this.emit("variant",typeId,values,-1,-1,shape.tag,id); this.setNames(names); return result;
  }
  newBlock(id: number): number { this.result.functions[this.currentFunction].blocks.push(new IrBlock(this.source(id))); return this.result.functions[this.currentFunction].blocks.length-1; }
  open(): boolean { return this.result.functions[this.currentFunction].blocks[this.block].terminator == ""; }
  terminate(op: string, value: number, targets: number[], id: number): void {
    this.result.functions[this.currentFunction].blocks[this.block].terminator = op;
    this.result.functions[this.currentFunction].blocks[this.block].value = value;
    this.result.functions[this.currentFunction].blocks[this.block].targets = targets;
    this.result.functions[this.currentFunction].blocks[this.block].source = this.source(id);
  }
  emit(op: string, typeId: number, operands: number[], place: number, callee: number, text: string, id: number): number {
    let value: number = -1;
    if (typeId >= 0 && this.result.types[typeId] != "void") { value = this.result.functions[this.currentFunction].values.length; this.result.functions[this.currentFunction].values.push(typeId); }
    let instruction = new IrInstruction(op,value,typeId,this.source(id));
    if (op == "load") instruction.effects = ["read"];
    if (op == "store") instruction.effects = ["write","drop-previous"];
    if (op == "move") instruction.effects = ["transfer"];
    if (op == "own") instruction.effects = ["allocate"];
    if (["dropValue","dropRemaining","dropFrame"].includes(op)) instruction.effects = ["destroy"];
    if (["borrow","address"].includes(op)) instruction.effects = ["borrow"];
    if (["call","callIndirect"].includes(op)) instruction.effects = ["invoke"];
    if (op == "taskCreate") instruction.effects = ["allocate","defer"];
    if (op == "backendEscape") instruction.effects = ["opaque","backend:cpp"];
    if (op == "runtimeCall") instruction.effects = ["runtime"];
    if (["typeTest","unwrap"].includes(op)) instruction.effects = ["inspect"];
    instruction.operands = operands; instruction.place = place; instruction.callee = callee; instruction.text = text;
    this.result.functions[this.currentFunction].blocks[this.block].instructions.push(instruction); return value;
  }
  reference(id: number): number {
    let target: number = this.binding.files[this.module].valueTargets[id];
    if (target < 0) for (const r of this.binding.references) if (r.module == this.module && r.node == id && r.space == "value") target = r.target;
    return target;
  }
  place(symbol: number, id: number): number {
    if (symbol >= 0 && this.binding.symbols[symbol].kind == "receiver" && this.receiverOverride >= 0) return this.receiverOverride;
    const local: number = irIndex(this.symbols,symbol); if (local >= 0) return local;
    const global: number = irIndex(this.globalSymbols,symbol);
    if (global >= 0) {
      const p = this.result.globals[global]; this.symbols.push(symbol);
      this.result.functions[this.currentFunction].places.push(new IrPlace(p.symbolId,p.typeId,global,false,this.source(id))); return this.symbols.length-1;
    }
    this.fail(id,"Símbolo sin place local/global (captura o valor de función)"); return -1;
  }
  local(symbol: number, typeId: number, parameter: boolean, id: number): number {
    const place: number = this.symbols.length; this.symbols.push(symbol);
    const identity: string = symbol >= 0 ? this.checked.symbolIds[symbol] : "";
    this.result.functions[this.currentFunction].places.push(new IrPlace(identity,typeId,-1,parameter,this.source(id))); return place;
  }
  convert(value: number, typeId: number, id: number): number {
    if (value < 0) return value;
    if (this.result.functions[this.currentFunction].values[value] == typeId) return value;
    const shape = this.result.typeDefinitions[typeId];
    if (shape.kind == "Optional" && (shape.arguments[0] == this.valueType(value) || this.result.typeDefinitions[this.valueType(value)].kind != "Optional")) return this.emit("some",typeId,[this.convert(value,shape.arguments[0],id)],-1,-1,"",id);
    if (["ptr","constPtr"].includes(shape.kind) && shape.arguments[0] == this.valueType(value)) return this.emit("own",typeId,[value],-1,-1,"",id);
    return this.emit("convert",typeId,[value],-1,-1,"",id);
  }
  expression(id: number): number {
    if (id < 0) return -1;
    for (let at: number = this.overrideNodes.length-1; at >= 0; at = at-1) if (this.overrideNodes[at] == id) return this.emit("load",this.result.functions[this.currentFunction].places[this.overridePlaces[at]].typeId,[],this.overridePlaces[at],-1,"",id);
    if (this.checked.files[this.module].constantStates[id] == "evaluated") return this.evaluatedConstant(id);
    let value: number = this.expressionInner(id); const conversion: string = this.checked.files[this.module].conversions[id];
    if (conversion != "" && !["ref","constRef"].includes(memoryMode(conversion))) value = this.convert(value,this.typeId(conversion,id),id); return value;
  }
  materializeConstant(evaluator: constRef<NativeComptime>, value: number, id: number): number {
    const item = evaluator.values[value]; const typeId: number = this.typeId(item.typeName,id);
    if (["number","integer","boolean","string"].includes(item.kind)) return this.emit("constant",typeId,[],-1,-1,item.kind == "integer" ? constantIntegerText(item) : item.kind == "number" ? numberToString(item.scalar) : item.kind == "boolean" ? item.scalar == 1 ? "true" : "false" : item.text,id);
    let values: number[] = []; for (const entry of item.entries) values.push(this.materializeConstant(evaluator,entry,id));
    if (item.kind == "optional") return values.length == 0 ? this.emit("none",typeId,[],-1,-1,"",id) : this.emit("some",typeId,values,-1,-1,"",id);
    if (item.kind == "result") return this.emit("result",typeId,values,-1,-1,item.text == "error" ? "Err" : "Ok",id);
    if (item.kind == "array") { const result: number = this.emit("aggregate",typeId,values,-1,-1,"",id); let names: string[] = []; for (const entry of values) names.push("value"); this.setNames(names); return result; }
    if (item.kind == "object") { const result: number = this.emit("record",typeId,values,-1,-1,"",id); this.setNames(item.keys); return result; }
    this.fail(id,"Constante sin representación materializable: "+item.kind); return -1;
  }
  evaluatedConstant(id: number): number {
    let evaluator = new NativeComptime(this.graph,this.binding,this.checked); evaluator.evaluate(this.module,id,true);
    if (evaluator.failure != "") { this.fail(id,"No se pudo materializar constante comprobada: "+evaluator.failureCode); return -1; }
    return this.materializeConstant(evaluator,evaluator.lastValue,id);
  }
  binary(op: string, left: number, right: number, expected: number, id: number): number {
    left = this.readValue(left,id); right = this.readValue(right,id);
    if (left < 0 || right < 0) return -1;
    if (this.result.typeDefinitions[this.valueType(left)].kind == "enum") left = this.convert(left,this.result.typeDefinitions[this.valueType(left)].arguments[0],id);
    if (this.result.typeDefinitions[this.valueType(right)].kind == "enum") right = this.convert(right,this.result.typeDefinitions[this.valueType(right)].arguments[0],id);
    const a: string = this.result.types[this.valueType(left)]; const b: string = this.result.types[this.valueType(right)];
    let resultType: number = expected;
    if (numericType(a) && numericType(b)) {
      const promoted: number = this.typeId(nativeBinaryPromotion(a,b,op),id);
      left = this.convert(left,promoted,id); right = this.convert(right,this.typeId(op == "<<" || op == ">>" ? nativeUnaryPromotion(b) : this.result.types[promoted],id),id);
      if (!["==","!=","<",">","<=",">="].includes(op)) resultType = promoted;
    }
    if (op == "+" && (a == "string" || b == "string")) { const stringType: number = this.typeId("string",id); left = this.convert(left,stringType,id); right = this.convert(right,stringType,id); resultType = stringType; }
    return this.emit("binary",resultType,[left,right],-1,-1,op,id);
  }
  readValue(value: number, id: number): number {
    if (value < 0) return value; const shape = this.result.typeDefinitions[this.valueType(value)];
    if (["ref","constRef","readonly"].includes(shape.kind)) return this.convert(value,shape.arguments[0],id); return value;
  }
  expressionInner(id: number): number {
    const n = this.node(id); const kind: NodeKind = n.kind;
    const exact: string = this.checked.files[this.module].exactIntegers[id];
    const converted: string = this.checked.files[this.module].conversions[id];
    const valueType: string = exact != "" && (converted == "i64" || converted == "u64") ? converted : this.checked.files[this.module].types[id];
    const typeId: number = this.typeId(valueType,id);
    // Signed minimums and exact u64 values must never pass through a double
    // or through an out-of-range positive signed intermediate.
    if (exact != "" && (kind == NodeKind.LiteralExpression || kind == NodeKind.UnaryExpression)) return this.emit("constant",typeId,[],-1,-1,exact,id);
    if (kind == NodeKind.LiteralExpression) {
      let text: string = n.get(AttributeKind.LiteralType) == "number" ? n.get(AttributeKind.Raw) : n.get(AttributeKind.Value);
      const exact: string = this.checked.files[this.module].exactIntegers[id]; if (exact != "") text = exact;
      return this.emit("constant",typeId,[],-1,-1,text,id);
    }
    if (kind == NodeKind.SpreadElement) return this.expression(bindingChild(n,EdgeRole.Expression));
    if (kind == NodeKind.ArrayLiteralExpression || kind == NodeKind.ObjectLiteralExpression) return this.shapeConstruct(id,typeId);
    if (kind == NodeKind.AwaitExpression) return this.awaitValue(id,bindingChild(n,EdgeRole.Operand),typeId);
    if ((kind == NodeKind.MemberExpression || kind == NodeKind.MemberCallExpression) && n.get(AttributeKind.Optional) == "true" && !this.optionalActive.includes(id)) return this.optionalAccess(id,typeId);
    if (kind == NodeKind.NewExpression) return this.classConstruct(id,typeId);
    if (kind == NodeKind.MemberCallExpression) return this.methodCall(id,typeId);
    if (kind == NodeKind.IndexExpression) return this.emit("load",typeId,[],this.rootPlace(id),-1,"",id);
    if (kind == NodeKind.MemberExpression) return this.memberValue(id,typeId);
    if (kind == NodeKind.TemplateLiteralExpression) {
      let values: number[] = []; for (const e of n.edges) if (e.role == EdgeRole.Parts) values.push(this.emit("constant",this.typeId("string",id),[],-1,-1,this.node(e.node).get(AttributeKind.Value),e.node)); else if (e.role == EdgeRole.Expressions) values.push(this.convert(this.expression(e.node),this.typeId("string",id),e.node));
      let result: number = values[0]; for (let at: number = 1; at < values.length; at = at+1) result = this.emit("binary",typeId,[result,values[at]],-1,-1,"+",id); return result;
    }
    if (kind == NodeKind.IdentifierExpression) return this.functionIdentifier(id,typeId);
    if (kind == NodeKind.ArrowFunctionExpression) return this.closureValue(this.module,id,this.result.types[typeId],id);
    if (kind == NodeKind.NamedArgumentExpression) return this.expression(bindingChild(n,EdgeRole.Value));
    if (kind == NodeKind.SatisfiesExpression) return this.expression(bindingChild(n,EdgeRole.Operand));
    if (kind == NodeKind.AsExpression) return this.convert(this.expression(bindingChild(n,EdgeRole.Expression)),typeId,id);
    if (kind == NodeKind.UnaryExpression && n.get(AttributeKind.Operator) == "typeof") {
      const result: number = this.emit("typeTag",typeId,[],-1,-1,"",id); const operand: number = bindingChild(n,EdgeRole.Operand); this.result.functions[this.currentFunction].blocks[this.block].instructions[this.result.functions[this.currentFunction].blocks[this.block].instructions.length-1].signature = this.typeId(this.checked.files[this.module].types[operand],operand); return result;
    }
    if (kind == NodeKind.UnaryExpression) return this.emit("unary",typeId,[this.readValue(this.expression(bindingChild(n,EdgeRole.Operand)),id)],-1,-1,n.get(AttributeKind.Operator),id);
    if (kind == NodeKind.TernaryExpression) return this.conditional(id,bindingChild(n,EdgeRole.Condition),bindingChild(n,EdgeRole.ThenBranch),bindingChild(n,EdgeRole.ElseBranch),typeId,"");
    if (kind == NodeKind.BinaryExpression) {
      const op: string = n.get(AttributeKind.Operator); const left: number = bindingChild(n,EdgeRole.Left); const right: number = bindingChild(n,EdgeRole.Right);
      if (op == "&&" || op == "||") return this.conditional(id,left,right,-1,typeId,op);
      if (op == "??") return this.coalesce(id,left,right,typeId);
      if (op == "instanceof") { const value: number = this.expression(left); const target: string = this.resolved(this.checked.files[this.module].types[right]); const result: number = this.emit("typeTest",typeId,[value],-1,-1,"",id); this.result.functions[this.currentFunction].blocks[this.block].instructions[this.result.functions[this.currentFunction].blocks[this.block].instructions.length-1].signature = this.typeId(target.slice(6,target.length),id); return result; }
      const a: number = this.readValue(this.expression(left),left); const b: number = this.readValue(this.expression(right),right);
      return this.binary(op,a,b,typeId,id);
    }
    if (kind == NodeKind.AssignmentExpression || kind == NodeKind.CompoundAssignmentExpression) {
      const p: number = this.assignmentPlace(id); if (p < 0) return -1;
      return this.result.typeDefinitions[typeId].kind == "ref" ? this.emit("borrow",typeId,[],p,-1,"ref",id) : this.emit("load",typeId,[],p,-1,"",id);
    }
    if (kind == NodeKind.CallExpression) return this.call(id,typeId);
    this.fail(id,"Operación sin contrato de lowering: "+nodeKindName(kind)); return -1;
  }
  // A destination (including every receiver/index expression) is evaluated once.
  // materialize() also uses this path when an assignment is itself a receiver.
  assignmentPlace(id: number): number {
    const n = this.node(id); const target: number = bindingChild(n,EdgeRole.Target);
    let p: number = this.rootPlace(target); if (p < 0) return -1;
    const originalType: number = this.result.functions[this.currentFunction].places[p].typeId;
    if (this.result.typeDefinitions[originalType].kind == "ref") p = this.projection(p,"deref",this.result.typeDefinitions[originalType].arguments[0],-1,-1,target);
    const pt: number = this.result.functions[this.currentFunction].places[p].typeId; let previous: number = -1;
    if (n.kind == NodeKind.CompoundAssignmentExpression) previous = this.emit("load",pt,[],p,-1,"",target);
    let value: number = this.readValue(this.expression(bindingChild(n,EdgeRole.Value)),id);
    if (n.kind == NodeKind.CompoundAssignmentExpression) { const op: string = n.get(AttributeKind.Operator); value = this.binary(op.slice(0,op.length-1),previous,value,pt,id); }
    value = this.convert(value,pt,id); this.emit("store",-1,[value],p,-1,"",id); return p;
  }
  conditional(id: number, condition: number, yes: number, no: number, typeId: number, logical: string): number {
    const value: number = this.expression(condition); const p: number = this.local(-1,typeId,false,id);
    const a: number = this.newBlock(id); const b: number = this.newBlock(id); const join: number = this.newBlock(id);
    this.terminate("branch",value,[a,b],id);
    this.block = a;
    const left: number = logical == "||" ? value : this.expression(yes);
    this.emit("store",-1,[this.convert(left,typeId,id)],p,-1,"",id); this.terminate("jump",-1,[join],id);
    this.block = b;
    const right: number = logical == "&&" ? value : this.expression(logical == "||" ? yes : no);
    this.emit("store",-1,[this.convert(right,typeId,id)],p,-1,"",id); this.terminate("jump",-1,[join],id);
    this.block = join; this.track(p); return this.emit(this.result.typeDefinitions[typeId].resource ? "move" : "load",typeId,[],p,-1,"",id);
  }
  ensureFunction(owner: number, id: number, wanted: string, receiver: string = ""): number {
    const previousModule: number = this.module; const previousFunction: number = this.currentFunction;
    let signature: string = this.resolved(wanted); this.module = owner;
    const n = this.node(id); const pattern: string = this.checked.files[owner].types[id];
    let from: string[] = []; let to: string[] = [];
    if (previousFunction >= 0) { from = this.result.functions[previousFunction].substitutionFrom; to = this.result.functions[previousFunction].substitutionTo; }
    for (let context: number = 0; context < this.contextFrom.length; context = context+1) {
      let found: number = -1; for (let at: number = 0; at < from.length; at = at+1) if (from[at] == this.contextFrom[context]) found = at;
      if (found >= 0) to[found] = this.contextTo[context]; else { from.push(this.contextFrom[context]); to.push(this.contextTo[context]); }
    }
    if (receiver != "") {
      const classId: number = canonicalSymbol(memoryValue(receiver));
      if (classId >= 0) {
        const classSymbol = this.binding.symbols[classId]; const declaration = this.graph.modules[classSymbol.module].cached.result.ast.nodes[classSymbol.node]; const actuals: string[] = genericArguments(memoryValue(receiver)); let at: number = 0;
        for (const e of declaration.edges) if (e.role == EdgeRole.TypeParameters && at < actuals.length) { from.push("@"+numberToString(this.binding.files[classSymbol.module].declarations[e.node])); to.push(actuals[at]); at = at+1; }
      }
    }
    for (const e of n.edges) if (e.role == EdgeRole.TypeParameters) {
      const token: string = "@"+numberToString(this.binding.files[owner].declarations[e.node]); const inferred: string = resourceSubstitution(pattern,signature,token);
      if (inferred == "" || inferred == "!conflicting-inference") { this.fail(id,"Instancia genérica sin sustitución concreta: "+token); }
      else { let at: number = -1; for (let p: number = 0; p < from.length; p = p+1) if (from[p] == token) at = p; if (at < 0) { from.push(token); to.push(inferred); } else to[at] = inferred; }
    }
    for (let f: number = 0; f < this.functionNodes.length; f = f+1) if (this.functionNodes[f] == id && this.functionModules[f] == owner && this.result.functions[f].signature == signature && this.result.functions[f].substitutionFrom.join(",") == from.join(",") && this.result.functions[f].substitutionTo.join(",") == to.join(",") && (receiver == "" ? this.result.functions[f].receiverType == -1 : this.result.functions[f].receiverType >= 0 && this.result.types[this.result.functions[f].receiverType] == "ref<"+memoryValue(receiver)+">")) { this.module = previousModule; return f; }
    const symbol: number = this.binding.files[owner].declarations[id];
    let f = new IrFunction(n.get(AttributeKind.Name),symbol >= 0 ? this.checked.symbolIds[symbol] : this.checked.moduleRecords[owner].id+":closure:"+numberToString(id),-1,this.source(id));
    f.signature = signature; f.substitutionFrom = from; f.substitutionTo = to;
    const index: number = this.result.functions.length; this.result.functions.push(f); this.functionModules.push(owner); this.functionNodes.push(id); this.currentFunction = index;
    this.result.functions[index].returns = this.typeId(functionReturn(signature),id); this.result.functions[index].bodyReturns = this.result.functions[index].returns;
    this.result.functions[index].asynchronous = n.get(AttributeKind.Async) == "true" || n.get(AttributeKind.IsAsync) == "true";
    if (this.result.functions[index].asynchronous && genericBase(functionReturn(signature)) == "Promise") this.result.functions[index].bodyReturns = this.typeId(genericArguments(functionReturn(signature))[0],id);
    for (let p: number = 0; p < functionParams(signature).length; p = p+1) { let parameter: string = functionParams(signature)[p]; if (parameter.startsWith("...")) parameter = parameter.slice(3,parameter.length); this.result.functions[index].parameterTypes.push(this.typeId(parameter,id)); }
    if (receiver != "") { this.result.functions[index].receiverType = this.typeId("ref<"+memoryValue(receiver)+">",id); this.result.functions[index].parameterTypes = [this.result.functions[index].receiverType].concat(this.result.functions[index].parameterTypes); }
    for (const capture of this.checked.captures) if (capture.module == owner && capture.closure == id && !this.globalSymbols.includes(capture.symbol)) {
      const captured = this.binding.symbols[capture.symbol]; if (captured.kind == "FunctionDeclaration") continue;
      this.result.functions[index].captureSymbols.push(this.checked.symbolIds[capture.symbol]);
      this.result.functions[index].captureTypes.push(this.typeId(this.checked.symbolTypes[capture.symbol],id));
      this.result.functions[index].captureModes.push(capture.mode);
    }
    this.module = previousModule; this.currentFunction = previousFunction; return index;
  }
  closureValue(owner: number, id: number, signature: string, source: number): number {
    const callee: number = this.ensureFunction(owner,id,signature); let captures: number[] = [];
    for (let at: number = 0; at < this.result.functions[callee].captureSymbols.length; at = at+1) {
      let symbol: number = -1; for (let s: number = 0; s < this.checked.symbolIds.length; s = s+1) if (this.checked.symbolIds[s] == this.result.functions[callee].captureSymbols[at]) symbol = s;
      const typeId: number = this.result.functions[callee].captureTypes[at]; let argument: number = -1;
      if (this.result.functions[callee].captureModes[at] == "value") for (let a: number = this.argumentSymbols.length-1; a >= 0; a = a-1) if (this.argumentSymbols[a] == symbol && argument < 0) argument = this.argumentValues[a];
      if (argument >= 0) { captures.push(this.convert(argument,typeId,source)); continue; }
      let p: number = this.place(symbol,source);
      if (p >= 0 && this.result.functions[this.currentFunction].places[p].typeId != typeId) { const shape = this.result.typeDefinitions[this.result.functions[this.currentFunction].places[p].typeId]; if (["ptr","constPtr","ref","constRef","readonly"].includes(shape.kind) && shape.arguments[0] == typeId) p = this.projection(p,"deref",typeId,-1,-1,source); }
      captures.push(this.result.functions[callee].captureModes[at] == "reference" ? this.emit("address",this.typeId("ref<"+this.result.types[typeId]+">",source),[],p,-1,"",source) : this.emit("load",typeId,[],p,-1,"",source));
    }
    return this.emit("closure",this.typeId(signature,source),captures,-1,callee,"",source);
  }
  functionIdentifier(id: number, typeId: number): number {
    const symbol: number = this.reference(id);
    for (let at: number = this.argumentSymbols.length-1; at >= 0; at = at-1) if (this.argumentSymbols[at] == symbol) return this.argumentValues[at];
    if (symbol >= 0 && this.binding.symbols[symbol].kind == "FunctionDeclaration") {
      const item = this.binding.symbols[symbol]; const selected: number = this.checked.files[this.module].selected[id];
      return this.closureValue(item.module,selected >= 0 ? selected : item.node,this.result.types[typeId],id);
    }
    let p: number = this.place(symbol,id);
    if (p >= 0 && this.result.functions[this.currentFunction].places[p].typeId != typeId && this.result.typeDefinitions[this.result.functions[this.currentFunction].places[p].typeId].kind == "ref") p = this.projection(p,"deref",typeId,-1,-1,id);
    const stored: number = this.result.functions[this.currentFunction].places[p].typeId; return this.convert(this.emit("load",stored,[],p,-1,"",id),typeId,id);
  }
  call(id: number, typeId: number, receiver: number = -1, indirect: number = -1): number {
    const n = this.node(id); const file = this.checked.files[this.module]; const selected: number = file.selected[id]; const owner: number = file.selectedModules[id];
    const symbol: number = this.reference(id);
    if (symbol >= 0 && (this.binding.symbols[symbol].module) < 0 && this.binding.symbols[symbol].name == "match") return this.matchExpression(id,typeId);
    if (symbol >= 0 && (this.binding.symbols[symbol].module) < 0 && ["move","ref","constRef"].includes(this.binding.symbols[symbol].name)) return this.memoryBuiltin(id,this.binding.symbols[symbol].name,typeId);
    let intrinsic: string = ""; let callable: number = -1; let callee: number = -1;
    const signature: string = this.resolved(file.signatures[id]);
    let escape: boolean = false;
    if (selected >= 0) for (const e of this.graph.modules[owner].cached.result.ast.nodes[selected].edges) if (e.role == EdgeRole.Decorators && this.graph.modules[owner].cached.result.ast.nodes[e.node].get(AttributeKind.Name) == "cppgen") escape = true;
    if (indirect >= 0) callable = indirect;
    else if (selected >= 0) callee = this.ensureFunction(owner,selected,escape ? "("+functionParams(signature).join(",")+")=>string" : signature,receiver >= 0 ? this.result.types[this.result.functions[this.currentFunction].places[receiver].typeId] : "");
    else if (symbol >= 0 && this.binding.symbols[symbol].module >= 0) {
      const p: number = this.place(symbol,id); callable = this.emit("load",this.typeId(this.checked.symbolTypes[symbol],id),[],p,-1,"",id);
    } else if (symbol >= 0 && ["print","write","printError","writeError"].includes(this.binding.symbols[symbol].name)) intrinsic = this.binding.symbols[symbol].name;
    else if (symbol >= 0) {
      const name: string = this.binding.symbols[symbol].name; let values: number[] = [];
      const parameters: string[] = functionParams(signature); let at: number = 0;
      for (const e of n.edges) if (e.role == EdgeRole.Args) {
        let value: number = at < parameters.length ? this.argumentValue(e.node,parameters[at]) : this.expression(e.node);
        if (at < parameters.length) value = this.convert(value,this.typeId(parameters[at],e.node),e.node);
        values.push(value); at = at+1;
      }
      if (numericType(name) && values.length == 1) return this.convert(values[0],typeId,id);
      return this.runtime("builtin."+name,typeId,values,id,["runtime","opaque"]);
    } else { this.fail(id,"Llamada sin destino de frontend"); return -1; }
    let operands: number[] = []; let positions: number[] = []; let spread: boolean[] = [];
    const formals: string[] = functionParams(signature);
    for (const e of n.edges) if (e.role == EdgeRole.Args) {
      const position: number = file.argumentParameters[e.node] >= 0 ? file.argumentParameters[e.node] : positions.length; positions.push(position);
      let value: number = -1;
      if (this.preparedCall == id) value = this.preparedArguments[operands.length];
      else if (intrinsic != "" && this.result.typeDefinitions[this.typeId(file.types[e.node],e.node)].resource && [NodeKind.IdentifierExpression,NodeKind.MemberExpression,NodeKind.IndexExpression].includes(this.node(e.node).kind)) value = this.emit("borrow",this.typeId("constRef<"+this.resolved(file.types[e.node])+">",e.node),[],this.rootPlace(e.node),-1,"constRef",e.node);
      else if (position < formals.length && !formals[position].startsWith("...")) value = this.argumentValue(e.node,formals[position]);
      else value = this.expression(e.node);
      operands.push(value); spread.push(this.node(e.node).kind == NodeKind.SpreadElement);
    }
    if (callee >= 0 || callable >= 0) {
      const parameters: string[] = functionParams(signature); let ordered: number[] = []; let nodes: number[] = [];
      if (callee >= 0) for (const e of this.graph.modules[owner].cached.result.ast.nodes[selected].edges) if (e.role == EdgeRole.Params) nodes.push(e.node);
      const saved: number = this.argumentSymbols.length;
      for (let p: number = 0; p < parameters.length; p = p+1) {
        const formal: string = parameters[p]; let value: number = -1;
        if (formal.startsWith("...")) {
          const arrayType: number = this.typeId(formal.slice(3,formal.length),id); let items: number[] = []; let names: string[] = [];
          for (let a: number = 0; a < operands.length; a = a+1) if (positions[a] == p) { items.push(operands[a]); names.push(spread[a] ? "spread" : "value"); }
          value = this.emit("aggregate",arrayType,items,-1,-1,"",id); this.setNames(names);
        } else {
          const at: number = irIndex(positions,p); const expected: number = this.typeId(formal,id);
          if (at >= 0) value = this.convert(operands[at],expected,id);
          else if (callee >= 0 && p < nodes.length && bindingChild(this.graph.modules[owner].cached.result.ast.nodes[nodes[p]],EdgeRole.DefaultValue) >= 0) {
            const previousModule: number = this.module; this.module = owner;
            const context: number = this.contextFrom.length;
            for (let at: number = 0; at < this.result.functions[callee].substitutionFrom.length; at = at+1) { this.contextFrom.push(this.result.functions[callee].substitutionFrom[at]); this.contextTo.push(this.result.functions[callee].substitutionTo[at]); }
            value = this.expression(bindingChild(this.node(nodes[p]),EdgeRole.DefaultValue));
            while (this.contextFrom.length > context) { this.contextFrom.pop(); this.contextTo.pop(); }
            this.module = previousModule; value = this.convert(value,expected,id);
          } else if (genericBase(formal) == "Optional") value = this.emit("none",expected,[],-1,-1,"",id);
          else this.fail(id,"Argumento requerido ausente");
        }
        ordered.push(value);
        if (callee >= 0 && p < nodes.length) { this.argumentSymbols.push(this.binding.files[owner].declarations[nodes[p]]); this.argumentValues.push(value); }
      }
      while (this.argumentSymbols.length > saved) { this.argumentSymbols.pop(); this.argumentValues.pop(); }
      operands = ordered;
    }
    if (callee >= 0 && this.result.functions[callee].receiverType >= 0) operands = [this.emit("address",this.result.functions[callee].receiverType,[],receiver,-1,"",id)].concat(operands);
    if (callee >= 0 && this.result.functions[callee].captureTypes.length > 0) { callable = this.closureValue(owner,selected,signature,id); callee = -1; }
    if (callable >= 0) operands = [callable].concat(operands);
    const result: number = this.emit(escape ? "backendEscape" : intrinsic != "" ? "intrinsic" : callable >= 0 ? "callIndirect" : callee >= 0 && this.result.functions[callee].asynchronous ? "taskCreate" : "call",typeId,operands,-1,callee,intrinsic,id);
    if (callable >= 0) this.result.functions[this.currentFunction].blocks[this.block].instructions[this.result.functions[this.currentFunction].blocks[this.block].instructions.length-1].signature = this.typeId(signature,id);
    return result;
  }
  classConstruct(id: number, typeId: number): number {
    const valueType: string = memoryValue(this.result.types[typeId]); const valueId: number = this.typeId(valueType,id); const nominal: number = canonicalSymbol(valueType);
    if (["Map","Set"].includes(genericBase(valueType))) return this.emit("collection",valueId,[],-1,-1,"",id);
    if (nominal < 0) { this.fail(id,"Construcción sin tipo nominal"); return -1; }
    const owner = this.binding.symbols[nominal]; const declaration = this.graph.modules[owner.module].cached.result.ast.nodes[owner.node];
    let actuals: number[] = []; let positions: number[] = [];
    const formals: string[] = functionParams(this.resolved(this.checked.files[this.module].signatures[id]));
    for (const e of this.node(id).edges) if (e.role == EdgeRole.Args) {
      const position: number = this.checked.files[this.module].argumentParameters[e.node] >= 0 ? this.checked.files[this.module].argumentParameters[e.node] : positions.length;
      actuals.push(position < formals.length && !formals[position].startsWith("...") ? this.argumentValue(e.node,formals[position]) : this.expression(e.node)); positions.push(position);
    }
    const empty: number = this.emit("emptyRecord",valueId,[],-1,-1,"",id); const p: number = this.local(-1,valueId,false,id); this.track(p); this.emit("store",-1,[empty],p,-1,"",id);
    let fields: number[] = [];
    for (const e of declaration.edges) if (e.role == EdgeRole.Fields && this.graph.modules[owner.module].cached.result.ast.nodes[e.node].get(AttributeKind.IsStatic) != "true") fields.push(e.node);
    const previousModule: number = this.module; const previousReceiver: number = this.receiverOverride; this.receiverOverride = p;
    const constructor: number = this.checked.files[this.module].selected[id];
    const context: number = this.contextFrom.length; const arguments: string[] = genericArguments(valueType); let parameter: number = 0;
    for (const e of declaration.edges) if (e.role == EdgeRole.TypeParameters && parameter < arguments.length) { this.contextFrom.push("@"+numberToString(this.binding.files[owner.module].declarations[e.node])); this.contextTo.push(arguments[parameter]); parameter = parameter+1; }
    for (let at: number = 0; at < fields.length; at = at+1) {
      const fieldNode = this.graph.modules[owner.module].cached.result.ast.nodes[fields[at]]; const name: string = fieldNode.get(AttributeKind.Name); let field: number = -1;
      for (let f: number = 0; f < this.result.typeDefinitions[valueId].names.length; f = f+1) if (this.result.typeDefinitions[valueId].names[f] == name) field = f;
      if (field < 0) continue;
      const fieldType: number = this.result.typeDefinitions[valueId].fields[field]; let value: number = -1;
      const position: number = irIndex(positions,at);
      if (constructor < 0 && position >= 0) value = this.convert(actuals[position],fieldType,id);
      else {
        const fallback: number = bindingChild(fieldNode,EdgeRole.DefaultValue);
        if (fallback >= 0) { this.module = owner.module; value = this.expression(fallback); this.module = previousModule; value = this.convert(value,fieldType,id); }
      }
      if (value >= 0) this.emit("store",-1,[value],this.projection(p,"field",fieldType,-1,field,id),-1,"",id);
    }
    this.module = previousModule; this.receiverOverride = previousReceiver;
    while (this.contextFrom.length > context) { this.contextFrom.pop(); this.contextTo.pop(); }
    if (constructor >= 0) {
      // Actuals are already evaluated: call() reuses them instead of repeating effects.
      const savedArguments: number[] = this.preparedArguments; const savedCall: number = this.preparedCall;
      this.preparedArguments = actuals; this.preparedCall = id; this.call(id,this.typeId("void",id),p);
      this.preparedArguments = savedArguments; this.preparedCall = savedCall;
    }
    return this.emit(this.result.typeDefinitions[valueId].resource ? "move" : "load",valueId,[],p,-1,"",id);
  }
  matchExpression(id: number, typeId: number): number {
    let args: number[] = []; for (const e of this.node(id).edges) if (e.role == EdgeRole.Args) args.push(e.node);
    const subject: number = this.unwrappedPlace(args[0],this.typeId(memoryValue(this.resolved(this.checked.files[this.module].types[args[0]])),id));
    const subjectType: number = this.result.functions[this.currentFunction].places[subject].typeId;
    let discriminator: number = subject;
    if (args.length == 3) {
      const name: string = this.node(args[1]).get(AttributeKind.Value); let field: number = -1; for (let at: number = 0; at < this.result.typeDefinitions[subjectType].names.length; at = at+1) if (this.result.typeDefinitions[subjectType].names[at] == name) field = at;
      if (field >= 0) discriminator = this.projection(subject,"field",this.result.typeDefinitions[subjectType].fields[field],-1,field,id);
      else if (!["Optional","Result"].includes(this.result.typeDefinitions[subjectType].kind)) { this.fail(id,"Discriminador sin campo IR"); return -1; }
    }
    const result: number = this.result.types[typeId] == "void" ? -1 : this.local(-1,typeId,false,id); if (result >= 0) this.track(result);
    const join: number = this.newBlock(id); let fallback: boolean = false;
    for (const e of this.node(args[args.length-1]).edges) if (e.role == EdgeRole.Elements) {
      const item = this.node(e.node); const symbol: number = this.reference(e.node); const name: string = symbol >= 0 ? this.binding.symbols[symbol].name : ""; let values: number[] = []; for (const value of item.edges) if (value.role == EdgeRole.Args) values.push(value.node);
      const key: string = this.resolved(this.checked.files[this.module].caseValues[e.node]); let narrowed: number = subject;
      if (name != "otherwise") {
        let condition: number = -1;
        if (name == "whenType") {
          const tested: number = this.typeId(key.slice(5,key.length),e.node); const view: number = this.emit("borrow",this.typeId("constRef<"+this.result.types[subjectType]+">",id),[],subject,-1,"constRef",id);
          condition = this.emit("typeTest",this.typeId("boolean",id),[view],-1,-1,"",e.node); this.result.functions[this.currentFunction].blocks[this.block].instructions[this.result.functions[this.currentFunction].blocks[this.block].instructions.length-1].signature = tested;
        } else {
          let input: number = -1;
          if (args.length == 3 && ["Optional","Result"].includes(this.result.typeDefinitions[subjectType].kind)) { const name: string = this.node(args[1]).get(AttributeKind.Value); const source: number = this.emit("load",subjectType,[],subject,-1,"",id); input = this.emit("property",this.typeId(name == "ok" ? "boolean" : "string",id),[source],-1,-1,name,id); }
          else input = this.emit("load",this.result.functions[this.currentFunction].places[discriminator].typeId,[],discriminator,-1,"",e.node);
          const candidate: number = this.expression(values[0]); condition = this.binary("==",input,candidate,this.typeId("boolean",id),e.node);
        }
        const yes: number = this.newBlock(e.node); const no: number = this.newBlock(e.node); this.terminate("branch",condition,[yes,no],e.node); this.block = yes;
        if (name == "whenType") narrowed = this.projection(subject,"checkedView",this.typeId(key.slice(5,key.length),e.node),-1,-1,e.node);
        this.matchCallback(values[values.length-1],narrowed,result,typeId,id); this.terminate("jump",-1,[join],id); this.block = no;
      } else { this.matchCallback(values[values.length-1],subject,result,typeId,id); this.terminate("jump",-1,[join],id); fallback = true; break; }
    }
    if (!fallback && this.open()) { this.cleanup(0,id); this.terminate("trap",-1,[],id); }
    this.block = join; return result < 0 ? -1 : this.emit(this.result.typeDefinitions[typeId].resource ? "move" : "load",typeId,[],result,-1,"",id);
  }
  matchCallback(callback: number, subject: number, result: number, resultType: number, id: number): void {
    const callable: number = this.expression(callback); const signature: number = this.valueType(callable); const parts = this.result.typeDefinitions[signature].arguments; let operands: number[] = [callable];
    if (parts.length > 1) {
      const formal: number = parts[0]; const mode: string = this.result.typeDefinitions[formal].kind; let p: number = subject;
      if (["ref","constRef"].includes(mode)) {
        const expected: number = this.result.typeDefinitions[formal].arguments[0]; if (expected != this.result.functions[this.currentFunction].places[p].typeId) p = this.projection(p,"checkedView",expected,-1,-1,id);
        operands.push(this.emit("borrow",formal,[],p,-1,mode,id));
      } else { const actual: number = this.result.functions[this.currentFunction].places[p].typeId; operands.push(this.convert(this.emit(this.result.typeDefinitions[actual].resource ? "move" : "load",actual,[],p,-1,"",id),formal,id)); }
    }
    const value: number = this.emit("callIndirect",parts[parts.length-1],operands,-1,-1,"",id); this.result.functions[this.currentFunction].blocks[this.block].instructions[this.result.functions[this.currentFunction].blocks[this.block].instructions.length-1].signature = signature;
    if (result >= 0) this.emit("store",-1,[this.convert(value,resultType,id)],result,-1,"",id);
  }
  optionalInput(input: number, id: number): number {
    const value: number = this.expression(input); const p: number = this.local(-1,this.valueType(value),false,id); this.emit("store",-1,[value],p,-1,"",id); this.track(p); return p;
  }
  optionalPresent(p: number, id: number): number {
    const typeId: number = this.result.functions[this.currentFunction].places[p].typeId;
    const view: number = this.emit("borrow",this.typeId("constRef<"+this.result.types[typeId]+">",id),[],p,-1,"constRef",id);
    return this.emit("isPresent",this.typeId("boolean",id),[view],-1,-1,"",id);
  }
  optionalPayload(p: number, id: number): number {
    const typeId: number = this.result.functions[this.currentFunction].places[p].typeId;
    const input: number = this.emit(this.result.typeDefinitions[typeId].resource ? "move" : "load",typeId,[],p,-1,"",id);
    return this.emit("unwrap",this.result.typeDefinitions[typeId].arguments[0],[input],-1,-1,"",id);
  }
  coalesce(id: number, left: number, right: number, typeId: number): number {
    const input: number = this.optionalInput(left,id); const condition: number = this.optionalPresent(input,id); const result: number = this.local(-1,typeId,false,id); this.track(result);
    const yes: number = this.newBlock(id); const no: number = this.newBlock(id); const join: number = this.newBlock(id); this.terminate("branch",condition,[yes,no],id);
    this.block = yes; const payload: number = this.convert(this.optionalPayload(input,id),typeId,id); this.emit("store",-1,[payload],result,-1,"",id); this.terminate("jump",-1,[join],id);
    this.block = no; const fallback: number = this.convert(this.expression(right),typeId,id); this.emit("store",-1,[fallback],result,-1,"",id); this.terminate("jump",-1,[join],id);
    this.block = join; return this.emit(this.result.typeDefinitions[typeId].resource ? "move" : "load",typeId,[],result,-1,"",id);
  }
  optionalAccess(id: number, typeId: number): number {
    const n = this.node(id); const object: number = bindingChild(n,EdgeRole.Object); const input: number = this.optionalInput(object,id); const condition: number = this.optionalPresent(input,id);
    const returnsVoid: boolean = this.result.types[typeId] == "void"; const output: number = returnsVoid ? -1 : this.result.typeDefinitions[typeId].arguments[0];
    const result: number = returnsVoid ? -1 : this.local(-1,typeId,false,id); if (result >= 0) this.track(result);
    const yes: number = this.newBlock(id); const no: number = this.newBlock(id); const join: number = this.newBlock(id); this.terminate("branch",condition,[yes,no],id);
    this.block = yes; const payload: number = this.optionalPayload(input,id); const p: number = this.local(-1,this.valueType(payload),false,id); this.emit("store",-1,[payload],p,-1,"",id); this.track(p);
    this.overrideNodes.push(object); this.overridePlaces.push(p); this.optionalActive.push(id);
    const value: number = n.kind == NodeKind.MemberCallExpression ? this.methodCall(id,output < 0 ? typeId : output) : this.memberValue(id,output);
    this.overrideNodes.pop(); this.overridePlaces.pop(); this.optionalActive.pop();
    if (!returnsVoid) this.emit("store",-1,[this.convert(value,typeId,id)],result,-1,"",id); this.terminate("jump",-1,[join],id);
    this.block = no; if (!returnsVoid) this.emit("store",-1,[this.emit("none",typeId,[],-1,-1,"",id)],result,-1,"",id); this.terminate("jump",-1,[join],id);
    this.block = join; return returnsVoid ? -1 : this.emit(this.result.typeDefinitions[typeId].resource ? "move" : "load",typeId,[],result,-1,"",id);
  }
  destructuring(id: number): void {
    const n = this.node(id); const input: number = this.materialize(bindingChild(n,EdgeRole.Initializer)); const sourceType: number = this.result.functions[this.currentFunction].places[input].typeId; let position: number = 0;
    for (const e of n.edges) if (e.role == EdgeRole.ArrayBindings || e.role == EdgeRole.ObjectBindings) {
      const item = this.node(e.node); const symbol: number = this.binding.files[this.module].declarations[e.node]; const expected: number = this.typeId(this.checked.files[this.module].types[e.node],e.node); const target: number = this.globalSymbols.includes(symbol) ? this.place(symbol,e.node) : this.local(symbol,expected,false,e.node);
      const fallback: number = bindingChild(item,EdgeRole.DefaultValue); let projected: number = -1; let condition: number = -1;
      if (e.role == EdgeRole.ArrayBindings) {
        const index: number = this.emit("constant",this.typeId("number",id),[],-1,-1,numberToString(position),e.node);
        if (this.result.typeDefinitions[sourceType].kind == "tuple") { if (position < this.result.typeDefinitions[sourceType].arguments.length) projected = this.projection(input,"index",this.result.typeDefinitions[sourceType].arguments[position],index,-1,e.node); }
        else { projected = this.projection(input,"index",this.result.typeDefinitions[sourceType].arguments[0],index,-1,e.node); if (fallback >= 0) { const source: number = this.emit("load",sourceType,[],input,-1,"",id); const length: number = this.emit("property",this.typeId("number",id),[source],-1,-1,"length",id); condition = this.emit("binary",this.typeId("boolean",id),[index,length],-1,-1,"<",id); } }
      } else {
        const name: string = item.get(AttributeKind.Property); for (let at: number = 0; at < this.result.typeDefinitions[sourceType].names.length; at = at+1) if (this.result.typeDefinitions[sourceType].names[at] == name) projected = this.projection(input,"field",this.result.typeDefinitions[sourceType].fields[at],-1,at,e.node);
      }
      if (condition >= 0) {
        const yes: number = this.newBlock(e.node); const no: number = this.newBlock(e.node); const join: number = this.newBlock(e.node); this.terminate("branch",condition,[yes,no],e.node);
        this.block = yes; const value: number = this.emit("load",this.result.functions[this.currentFunction].places[projected].typeId,[],projected,-1,"",e.node); this.emit("store",-1,[this.convert(value,expected,e.node)],target,-1,"",e.node); this.terminate("jump",-1,[join],e.node);
        this.block = no; this.emit("store",-1,[this.convert(this.expression(fallback),expected,e.node)],target,-1,"",e.node); this.terminate("jump",-1,[join],e.node); this.block = join;
      } else {
        const value: number = projected >= 0 ? this.emit("load",this.result.functions[this.currentFunction].places[projected].typeId,[],projected,-1,"",e.node) : this.expression(fallback);
        this.emit("store",-1,[this.convert(value,expected,e.node)],target,-1,"",e.node);
      }
      if (!this.globalSymbols.includes(symbol)) this.track(target); position = position+1;
    }
  }
  awaitValue(id: number, input: number, typeId: number): number {
    let task: number = -1;
    if ([NodeKind.IdentifierExpression,NodeKind.MemberExpression,NodeKind.IndexExpression].includes(this.node(input).kind)) task = this.emit("move",this.typeId(this.checked.files[this.module].types[input],input),[],this.rootPlace(input),-1,"",input);
    else task = this.expression(input);
    return this.suspendTask(id,task,typeId);
  }
  suspendTask(id: number, task: number, typeId: number): number {
    const suspend: number = this.block; const resume: number = this.newBlock(id); const cancel: number = this.newBlock(id);
    this.result.functions[this.currentFunction].asynchronous = true; this.terminate("suspend",task,[resume,cancel],id);
    this.block = cancel; this.emit("dropFrame",-1,[],-1,-1,"",id); this.terminate("cancel",-1,[],id);
    this.block = resume; const value: number = this.emit("resume",typeId,[],-1,-1,"",id);
    this.result.functions[this.currentFunction].blocks[this.block].instructions[this.result.functions[this.currentFunction].blocks[this.block].instructions.length-1].continuation = suspend; return value;
  }
  track(place: number): void {
    if (place >= 0 && this.result.typeDefinitions[this.result.functions[this.currentFunction].places[place].typeId].resource && this.cleanupScopes.length > 0) this.cleanupScopes[this.cleanupScopes.length-1].places.push(place);
  }
  cleanup(depth: number, id: number): void {
    for (let s: number = this.cleanupScopes.length-1; s >= depth; s = s-1) for (let p: number = this.cleanupScopes[s].places.length-1; p >= 0; p = p-1) this.emit("dropRemaining",-1,[],this.cleanupScopes[s].places[p],-1,"",id);
  }
  memoryBuiltin(id: number, name: string, typeId: number): number {
    const input: number = bindingChild(this.node(id),EdgeRole.Args); const p: number = name == "move" ? this.rootPlace(input) : this.unwrappedPlace(input,this.result.typeDefinitions[typeId].arguments[0]);
    return this.emit(name == "move" ? "move" : "borrow",typeId,[],p,-1,name,id);
  }
  runtime(name: string, typeId: number, operands: number[], id: number, effects: string[]): number {
    let parameters: number[] = []; for (const value of operands) parameters.push(this.valueType(value));
    let contract: number = -1;
    for (let at: number = 0; at < this.result.runtimeContracts.length; at = at+1) if (this.result.runtimeContracts[at].name == name && this.result.runtimeContracts[at].returns == typeId && irSameNumbers(this.result.runtimeContracts[at].parameters,parameters)) contract = at;
    if (contract < 0) { contract = this.result.runtimeContracts.length; this.result.runtimeContracts.push(new IrRuntimeContract(name,parameters,typeId,effects,"runtime:"+name)); }
    const result: number = this.emit("runtimeCall",typeId,operands,-1,-1,"",id);
    this.result.functions[this.currentFunction].blocks[this.block].instructions[this.result.functions[this.currentFunction].blocks[this.block].instructions.length-1].contract = contract; return result;
  }
  methodCall(id: number, typeId: number): number {
    const n = this.node(id); const receiver: number = bindingChild(n,EdgeRole.Object); const member: number = this.checked.files[this.module].members[id];
    if (member >= 0 && this.binding.symbols[member].kind == "UnionVariant") return this.unionConstructor(id,typeId);
    // Namespace member calls retain their resolved source function identity.
    if (member >= 0 && this.binding.symbols[member].kind == "FunctionDeclaration" && this.checked.files[this.module].selected[id] >= 0) return this.call(id,typeId);
    if (member >= 0 && ["ClassField","InterfaceField"].includes(this.binding.symbols[member].kind)) {
      const signature: string = this.resolved(this.checked.files[this.module].signatures[id]);
      let p: number = -1;
      if (this.globalSymbols.includes(member)) p = this.place(member,id);
      else {
        const base: number = this.unwrappedPlace(receiver,this.typeId(memoryValue(this.resolved(this.checked.files[this.module].receivers[id])),id));
        const shape = this.result.typeDefinitions[this.result.functions[this.currentFunction].places[base].typeId];
        for (let field: number = 0; field < shape.names.length; field = field+1) if (shape.names[field] == this.binding.symbols[member].name) p = this.projection(base,"field",shape.fields[field],-1,field,id);
      }
      if (p < 0) { this.fail(id,"Campo callable sin place"); return -1; }
      const callable: number = this.emit("load",this.typeId(signature,id),[],p,-1,"",id);
      return this.call(id,typeId,-1,callable);
    }
    if (member >= 0 && this.binding.symbols[member].kind == "ClassMethod") {
      const method = this.binding.symbols[member]; const declaration = this.graph.modules[method.module].cached.result.ast.nodes[method.node];
      return this.call(id,typeId,declaration.get(AttributeKind.IsStatic) == "true" ? -1 : this.unwrappedPlace(receiver,this.typeId(memoryValue(this.resolved(this.checked.files[this.module].receivers[id])),id)));
    }
    const name: string = n.get(AttributeKind.Method); const receiverType: string = this.resolved(this.checked.files[this.module].receivers[id]);
    let operands: number[] = []; let effects: string[] = ["runtime"];
    const receiverSymbol: number = this.reference(receiver);
    if (!(receiverSymbol >= 0 && (this.binding.symbols[receiverSymbol].module) < 0 && this.node(receiver).kind == NodeKind.IdentifierExpression) && receiverType != "namespace" && !receiverType.startsWith("class:") && !receiverType.startsWith("!")) {
      if (["push","pop","sort","set","add","delete","clear"].includes(name)) {
        const p: number = this.materialize(receiver); operands.push(this.emit("address",this.typeId("ref<"+receiverType+">",id),[],p,-1,"",id)); effects.push("mutate");
      } else {
        const actual: number = this.typeId(this.checked.files[this.module].types[receiver],receiver);
        if (this.result.typeDefinitions[actual].resource && [NodeKind.IdentifierExpression,NodeKind.MemberExpression,NodeKind.IndexExpression].includes(this.node(receiver).kind)) operands.push(this.emit("borrow",this.typeId("constRef<"+this.result.types[actual]+">",id),[],this.rootPlace(receiver),-1,"constRef",id));
        else operands.push(this.expression(receiver));
      }
    }
    const formals: string[] = functionParams(this.resolved(this.checked.files[this.module].signatures[id])); let at: number = 0;
    for (const e of n.edges) if (e.role == EdgeRole.Args) { let value: number = this.expression(e.node); if (at < formals.length && !formals[at].startsWith("...")) value = this.convert(value,this.typeId(formals[at],id),id); operands.push(value); if (functionClose(this.result.types[this.valueType(value)]) >= 0) effects.push("invoke"); at = at+1; }
    const base: string = receiverType.startsWith("!") ? receiverType : genericBase(memoryValue(receiverType)) != "" ? genericBase(memoryValue(receiverType)) : receiverType.endsWith("[]") ? "array" : receiverType;
    return this.runtime(base+"."+name,typeId,operands,id,effects);
  }
  memberValue(id: number, typeId: number): number {
    const n = this.node(id); const symbol: number = this.checked.files[this.module].members[id];
    if (symbol >= 0 && this.binding.symbols[symbol].kind == "EnumMember") {
      const member = this.binding.symbols[symbol]; const declaration = this.graph.modules[member.module].cached.result.ast.nodes[member.node];
      const value = this.graph.modules[member.module].cached.result.ast.nodes[bindingChild(declaration,EdgeRole.Value)];
      return this.emit("constant",typeId,[],-1,-1,value.get(AttributeKind.LiteralType) == "string" ? value.get(AttributeKind.Value) : value.get(AttributeKind.Raw) != "" ? value.get(AttributeKind.Raw) : value.get(AttributeKind.Value),id);
    }
    if (symbol >= 0 && this.globalSymbols.includes(symbol)) return this.emit("load",typeId,[],this.place(symbol,id),-1,"",id);
    const name: string = n.get(AttributeKind.Member); const receiver: string = this.resolved(this.checked.files[this.module].receivers[id]);
    if (receiver == "Request" && ["method","path","rawQuery","body"].includes(name)) return this.runtime("Request.property."+name,typeId,[this.expression(bindingChild(n,EdgeRole.Object))],id,["runtime","read"]);
    if (["length","size","kind","ok"].includes(name) && (receiver == "string" || receiver.endsWith("[]") || fixedArraySize(receiver) >= 0 || semanticTuple(receiver) || ["Map","Set","Optional","Result"].includes(genericBase(receiver)))) { const input: number = bindingChild(n,EdgeRole.Object); const actual: number = this.typeId(this.checked.files[this.module].types[input],input); let value: number = -1; if (this.result.typeDefinitions[actual].resource) value = this.emit("borrow",this.typeId("constRef<"+this.result.types[actual]+">",id),[],this.rootPlace(input),-1,"constRef",id); else value = this.expression(input); return this.emit("property",typeId,[value],-1,-1,name,id); }
    return this.emit("load",typeId,[],this.rootPlace(id),-1,"",id);
  }
  switchStatement(id: number): void {
    const n = this.node(id); const value: number = this.expression(bindingChild(n,EdgeRole.Discriminant));
    const end: number = this.newBlock(id); let clauses: number[] = []; let blocks: number[] = []; let fallback: number = end;
    for (const e of n.edges) if (e.role == EdgeRole.Clauses) { clauses.push(e.node); const b: number = this.newBlock(e.node); blocks.push(b); if (this.node(e.node).kind == NodeKind.DefaultClause) fallback = b; }
    for (let c: number = 0; c < clauses.length; c = c+1) for (const e of this.node(clauses[c]).edges) if (e.role == EdgeRole.Labels) {
      const key: string = this.checked.files[this.module].caseValues[e.node]; const split: number = key.indexOf(":",0);
      const label: number = this.emit("constant",this.valueType(value),[],-1,-1,key.slice(split+1,key.length),e.node);
      const comparison: number = this.emit("binary",this.typeId("boolean",id),[value,label],-1,-1,"==",e.node);
      const next: number = this.newBlock(id); this.terminate("branch",comparison,[blocks[c],next],id); this.block = next;
    }
    this.terminate("jump",-1,[fallback],id); this.breakTargets.push(end); this.breakDepths.push(this.cleanupScopes.length);
    for (let c: number = 0; c < clauses.length; c = c+1) { this.block = blocks[c]; for (const e of this.node(clauses[c]).edges) if (e.role == EdgeRole.Body) this.statement(e.node); if (this.open()) this.terminate("jump",-1,[c+1 < blocks.length ? blocks[c+1] : end],clauses[c]); }
    this.breakTargets.pop(); this.breakDepths.pop(); this.block = end;
  }
  iteration(id: number): void {
    const n = this.node(id); const binding: number = bindingChild(n,EdgeRole.Binding); const source: number = bindingChild(n,n.kind == NodeKind.ForOfStatement ? EdgeRole.Iterable : EdgeRole.Target);
    const container: number = this.materialize(source); const containerType: number = this.result.functions[this.currentFunction].places[container].typeId;
    const bindingType: number = this.typeId(this.checked.files[this.module].types[binding],binding); const awaited: boolean = n.get(AttributeKind.Await) == "true";
    const yielded: number = awaited ? this.typeId("Promise<"+this.result.types[bindingType]+">",id) : bindingType;
    const iteratorType: number = this.typeId("iterator<"+this.result.types[containerType]+","+this.result.types[yielded]+">",id);
    const cursor: number = this.emit("iterator",iteratorType,[],container,-1,n.kind == NodeKind.ForInStatement ? "keys" : awaited ? "await-values" : "values",id);
    const target: number = this.local(this.binding.files[this.module].declarations[binding],bindingType,false,binding);
    const test: number = this.newBlock(id); const body: number = this.newBlock(id); const end: number = this.newBlock(id); this.terminate("jump",-1,[test],id); this.block = test;
    const condition: number = this.emit("iterHasNext",this.typeId("boolean",id),[cursor],-1,-1,"",id); this.terminate("branch",condition,[body,end],id);
    this.block = body; let value: number = this.emit("iterNext",yielded,[cursor],-1,-1,awaited ? "take" : "read",id); if (awaited) value = this.suspendTask(id,value,bindingType);
    this.emit("store",-1,[value],target,-1,"",id); this.cleanupScopes.push(new IrCleanupScope()); this.track(target);
    this.breakTargets.push(end); this.continueTargets.push(test); this.breakDepths.push(this.cleanupScopes.length-1); this.continueDepths.push(this.cleanupScopes.length-1);
    this.statement(bindingChild(n,EdgeRole.Body)); if (this.open()) { this.cleanup(this.cleanupScopes.length-1,id); this.terminate("jump",-1,[test],id); }
    this.cleanupScopes.pop(); this.breakTargets.pop(); this.continueTargets.pop(); this.breakDepths.pop(); this.continueDepths.pop(); this.block = end;
  }
  staticFields(id: number, collect: boolean): void {
    for (const e of this.node(id).edges) if (e.role == EdgeRole.Fields && this.node(e.node).get(AttributeKind.IsStatic) == "true") {
      const symbol: number = this.binding.files[this.module].declarations[e.node]; const typeId: number = this.typeId(this.checked.symbolTypes[symbol],e.node);
      if (collect) { this.globalSymbols.push(symbol); this.result.globals.push(new IrPlace(this.checked.symbolIds[symbol],typeId,-1,false,this.source(e.node))); }
      else { const initializer: number = bindingChild(this.node(e.node),EdgeRole.DefaultValue); if (initializer < 0) { this.fail(e.node,"Campo estático sin inicializador explícito"); continue; } const p: number = this.place(symbol,e.node); this.emit("store",-1,[this.convert(this.expression(initializer),typeId,e.node)],p,-1,"",e.node); }
    }
  }
  statement(id: number): void {
    if (id < 0 || !this.open()) return;
    const n = this.node(id); const kind: NodeKind = n.kind;
    if (kind == NodeKind.Program || kind == NodeKind.BlockStatement) { this.cleanupScopes.push(new IrCleanupScope()); for (const e of n.edges) if (e.role == EdgeRole.Statements) this.statement(e.node); if (this.open()) this.cleanup(this.cleanupScopes.length-1,id); this.cleanupScopes.pop(); return; }
    if (kind == NodeKind.FunctionDeclaration) {
      return;
    }
    if ([NodeKind.ImportDeclaration,NodeKind.ExportNamedDeclaration,NodeKind.ExportAllDeclaration,NodeKind.ModuleHeaderDeclaration,NodeKind.TypeAliasDeclaration,NodeKind.InterfaceDeclaration].includes(kind)) return;
    if (kind == NodeKind.DeleteStatement) { const index = this.node(bindingChild(n,EdgeRole.Target)); const source: number = bindingChild(index,EdgeRole.Object); const p: number = this.materialize(source); const inputType: number = this.result.functions[this.currentFunction].places[p].typeId; const view: number = this.emit("borrow",this.typeId("ref<"+this.result.types[inputType]+">",id),[],p,-1,"ref",id); const key: number = this.expression(bindingChild(index,EdgeRole.Index)); this.runtime(this.result.typeDefinitions[inputType].kind+".delete",this.typeId("void",id),[view,key],id,["runtime","mutate"]); return; }
    if (kind == NodeKind.SwitchStatement) { this.switchStatement(id); return; }
    if (kind == NodeKind.ForOfStatement || kind == NodeKind.ForInStatement) { this.iteration(id); return; }
    if (kind == NodeKind.ClassDeclaration) { this.staticFields(id,false); return; }
    if (kind == NodeKind.EnumDeclaration || kind == NodeKind.UnionDeclaration) return;
    if (kind == NodeKind.ExportDefaultDeclaration) { const declaration: number = bindingChild(n,EdgeRole.Declaration); if (declaration >= 0 && [NodeKind.FunctionDeclaration,NodeKind.ClassDeclaration].includes(this.node(declaration).kind)) this.statement(declaration); else if (declaration >= 0) { const symbol: number = this.binding.files[this.module].declarations[declaration]; const p: number = this.place(symbol,declaration); this.emit("store",-1,[this.convert(this.expression(declaration),this.result.functions[this.currentFunction].places[p].typeId,id)],p,-1,"",id); } return; }
    if (kind == NodeKind.VariableDeclaration || kind == NodeKind.UsingDeclaration) {
      if (n.get(AttributeKind.Pattern) != "") { this.destructuring(id); return; }
      const symbol: number = this.binding.files[this.module].declarations[id]; const typeId: number = this.typeId(this.checked.files[this.module].types[id],id);
      const p: number = this.globalSymbols.includes(symbol) ? this.place(symbol,id) : this.local(symbol,typeId,false,id);
      const initializer: number = bindingChild(n,EdgeRole.Initializer); if (initializer < 0) { this.fail(id,"Variable sin inicializador"); return; }
      const value: number = this.convert(["ref","constRef"].includes(this.result.typeDefinitions[typeId].kind) ? this.argumentValue(initializer,this.result.types[typeId]) : this.expression(initializer),typeId,id); this.emit("store",-1,[value],p,-1,"",id); if (!this.globalSymbols.includes(symbol)) this.track(p); return;
    }
    if (kind == NodeKind.ExpressionStatement && [NodeKind.AssignmentExpression,NodeKind.CompoundAssignmentExpression].includes(this.node(bindingChild(n,EdgeRole.Expression)).kind)) { this.assignmentPlace(bindingChild(n,EdgeRole.Expression)); return; }
    if (kind == NodeKind.ExpressionStatement) { const value: number = this.expression(bindingChild(n,EdgeRole.Expression)); if (value >= 0 && this.result.typeDefinitions[this.valueType(value)].resource && ![NodeKind.AssignmentExpression,NodeKind.CompoundAssignmentExpression].includes(this.node(bindingChild(n,EdgeRole.Expression)).kind)) this.emit("dropValue",-1,[value],-1,-1,"",id); return; }
    if (kind == NodeKind.ReturnStatement) {
      const value: number = this.expression(bindingChild(n,EdgeRole.Value));
      const converted: number = this.convert(value,this.result.functions[this.currentFunction].bodyReturns,id); this.cleanup(0,id); this.terminate("return",converted,[],id); return;
    }
    if (kind == NodeKind.IfStatement) {
      const value: number = this.expression(bindingChild(n,EdgeRole.Condition));
      const yes: number = this.newBlock(id); const no: number = this.newBlock(id); const join: number = this.newBlock(id);
      this.terminate("branch",value,[yes,no],id);
      this.block = yes; this.statement(bindingChild(n,EdgeRole.ThenBranch)); const yesOpen: boolean = this.open(); if (yesOpen) this.terminate("jump",-1,[join],id);
      this.block = no; this.statement(bindingChild(n,EdgeRole.ElseBranch)); const noOpen: boolean = this.open(); if (noOpen) this.terminate("jump",-1,[join],id);
      this.block = join; if (!yesOpen && !noOpen) this.terminate("unreachable",-1,[],id); return;
    }
    if (kind == NodeKind.WhileStatement || kind == NodeKind.ForStatement) {
      this.cleanupScopes.push(new IrCleanupScope());
      this.statement(bindingChild(n,EdgeRole.Initializer));
      const test: number = this.newBlock(id); const body: number = this.newBlock(id); const increment: number = this.newBlock(id); const end: number = this.newBlock(id);
      this.terminate("jump",-1,[test],id); this.block = test;
      const condition: number = bindingChild(n,EdgeRole.Condition);
      if (condition >= 0) this.terminate("branch",this.expression(condition),[body,end],id); else this.terminate("jump",-1,[body],id);
      this.breakTargets.push(end); this.continueTargets.push(increment); this.breakDepths.push(this.cleanupScopes.length); this.continueDepths.push(this.cleanupScopes.length); this.block = body; this.statement(bindingChild(n,EdgeRole.Body));
      if (this.open()) this.terminate("jump",-1,[increment],id);
      this.block = increment; this.expression(bindingChild(n,EdgeRole.Increment)); this.terminate("jump",-1,[test],id);
      this.breakTargets.pop(); this.continueTargets.pop(); this.breakDepths.pop(); this.continueDepths.pop(); this.block = end; this.cleanup(this.cleanupScopes.length-1,id); this.cleanupScopes.pop(); return;
    }
    if (kind == NodeKind.BreakStatement || kind == NodeKind.ContinueStatement) {
      const targets: number[] = kind == NodeKind.BreakStatement ? this.breakTargets : this.continueTargets;
      if (targets.length == 0) { this.fail(id,"Salida sin destino"); return; }
      const depths: number[] = kind == NodeKind.BreakStatement ? this.breakDepths : this.continueDepths; this.cleanup(depths[depths.length-1],id); this.terminate("jump",-1,[targets[targets.length-1]],id); return;
    }
    this.fail(id,"Sentencia sin contrato de lowering: "+nodeKindName(kind));
  }
  registerFunction(id: number): void {
    for (const e of this.node(id).edges) if (e.role == EdgeRole.TypeParameters) return;
    this.ensureFunction(this.module,id,this.checked.files[this.module].types[id]);
  }
  order(module: number): void {
    if (this.orderState[module] == 2) return;
    if (this.orderState[module] == 1) { this.module = module; this.fail(this.graph.modules[module].cached.result.ast.root,"Ciclo de inicialización de módulos"); return; }
    this.orderState[module] = 1;
    for (const request of this.graph.modules[module].requests) if (!request.typeOnly) {
      for (let m: number = 0; m < this.graph.modules.length; m = m+1) if (this.graph.modules[m].file == request.dependency) this.order(m);
    }
    this.orderState[module] = 2; this.result.initializationOrder.push(this.result.modules[module].initializer);
  }
  run(): IrProject {
    // Require complete tables from a successful native analysis of this graph.
    if (!this.graph.success || !this.binding.success || !this.checked.success || this.graph.diagnostics.length > 0 || this.binding.diagnostics.length > 0 || this.checked.diagnostics.length > 0 || this.checked.files.length != this.graph.modules.length || this.binding.files.length != this.graph.modules.length || this.checked.moduleRecords.length != this.graph.modules.length || this.checked.symbolIds.length != this.binding.symbols.length || this.checked.symbolTypes.length != this.binding.symbols.length) {
      const source = new IrSource("","",this.graph.entry,-1,0,0); this.result.diagnostics.push(new IrIssue("IR_INPUT","Se requiere un proyecto comprobado sin diagnósticos de una misma carga",source)); return this.result;
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m+1) {
      this.module = m; const ast = this.graph.modules[m].cached.result.ast;
      if (this.checked.moduleRecords[m].file != this.graph.modules[m].file || this.checked.moduleRecords[m].sourceHash != this.graph.modules[m].cached.record.hash ||
          this.checked.files[m].types.length != ast.nodes.length || this.binding.files[m].declarations.length != ast.nodes.length ||
          this.binding.files[m].valueTargets.length != ast.nodes.length || this.checked.files[m].conversions.length != ast.nodes.length ||
          this.checked.files[m].selected.length != ast.nodes.length || this.checked.files[m].selectedModules.length != ast.nodes.length ||
          this.checked.files[m].exactIntegers.length != ast.nodes.length || this.checked.files[m].argumentParameters.length != ast.nodes.length ||
          this.checked.files[m].members.length != ast.nodes.length || this.checked.files[m].receivers.length != ast.nodes.length ||
          this.checked.files[m].signatures.length != ast.nodes.length || this.checked.files[m].constantStates.length != ast.nodes.length ||
          this.checked.files[m].caseValues.length != ast.nodes.length || this.checked.files[m].matchCoverage.length != ast.nodes.length ||
          this.binding.files[m].parents.length != ast.nodes.length) {
        this.result.diagnostics.push(new IrIssue("IR_INPUT","Tablas incompatibles con el AST",this.source(ast.root))); return this.result;
      }
      for (let id: number = 0; id < ast.nodes.length; id = id+1) {
        const target: number = this.binding.files[m].valueTargets[id]; const declaration: number = this.binding.files[m].declarations[id];
        const selected: number = this.checked.files[m].selected[id]; const owner: number = this.checked.files[m].selectedModules[id];
        const member: number = this.checked.files[m].members[id];
        let valid: boolean = member >= -1 && member < this.binding.symbols.length && target >= -1 && target < this.binding.symbols.length && declaration >= -1 && declaration < this.binding.symbols.length;
        if (selected >= 0) { if (owner < 0 || owner >= this.graph.modules.length) valid = false; else if (selected >= this.graph.modules[owner].cached.result.ast.nodes.length) valid = false; }
        for (const e of ast.nodes[id].edges) if ((e.node) < 0 || e.node >= ast.nodes.length) valid = false;
        if (!valid) { this.result.diagnostics.push(new IrIssue("IR_INPUT","Identidad de entrada inválida",this.source(id))); return this.result; }
      }
      this.orderState.push(0);
      for (const edge of this.node(ast.root).edges) if (edge.role == EdgeRole.Statements) {
        if (this.node(edge.node).kind == NodeKind.ClassDeclaration) this.staticFields(edge.node,true);
        if (this.node(edge.node).kind == NodeKind.ExportDefaultDeclaration) {
          const expression: number = bindingChild(this.node(edge.node),EdgeRole.Declaration); if (this.node(expression).kind == NodeKind.ClassDeclaration) this.staticFields(expression,true); const symbol: number = this.binding.files[m].declarations[expression];
          if (symbol >= 0 && ![NodeKind.FunctionDeclaration,NodeKind.ClassDeclaration].includes(this.node(expression).kind)) { this.globalSymbols.push(symbol); this.result.globals.push(new IrPlace(this.checked.symbolIds[symbol],this.typeId(this.checked.symbolTypes[symbol],expression),-1,false,this.source(expression))); }
        }

        if (this.node(edge.node).kind == NodeKind.VariableDeclaration || this.node(edge.node).kind == NodeKind.UsingDeclaration) {
          if (this.node(edge.node).get(AttributeKind.Pattern) != "") {
            for (const item of this.node(edge.node).edges) if (item.role == EdgeRole.ArrayBindings || item.role == EdgeRole.ObjectBindings) { const binding: number = this.binding.files[m].declarations[item.node]; this.globalSymbols.push(binding); this.result.globals.push(new IrPlace(this.checked.symbolIds[binding],this.typeId(this.checked.files[m].types[item.node],item.node),-1,false,this.source(item.node))); }
            continue;
          }
          const symbol: number = this.binding.files[m].declarations[edge.node]; this.globalSymbols.push(symbol);
          this.result.globals.push(new IrPlace(this.checked.symbolIds[symbol],this.typeId(this.checked.files[m].types[edge.node],edge.node),-1,false,this.source(edge.node)));
        }
      }
    }

    for (let m: number = 0; m < this.graph.modules.length; m = m+1) { this.module = m; for (const e of this.node(this.graph.modules[m].cached.result.ast.root).edges) if (e.role == EdgeRole.Statements && this.node(e.node).kind == NodeKind.FunctionDeclaration) this.registerFunction(e.node); }
    for (let m: number = 0; m < this.graph.modules.length; m = m+1) {
      this.module = m; const root: number = this.graph.modules[m].cached.result.ast.root; const record = this.checked.moduleRecords[m]; const index: number = this.result.functions.length;
      this.result.modules.push(new IrModule(record.id,record.sourceHash,record.file,index));
      this.result.functions.push(new IrFunction("$init",record.id+":init",this.typeId("void",root),this.source(root)));
      this.functionModules.push(m); this.functionNodes.push(root); if (record.file == this.graph.entry) this.result.entry = index;
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m+1) {
      this.module = m; const root: number = this.graph.modules[m].cached.result.ast.root; this.result.modules[m].finalizer = this.result.functions.length;
      this.result.functions.push(new IrFunction("$fini",this.checked.moduleRecords[m].id+":fini",this.typeId("void",root),this.source(root))); this.functionModules.push(m); this.functionNodes.push(root);
    }
    for (let f: number = 0; f < this.result.functions.length; f = f+1) {
      this.currentFunction = f; this.module = this.functionModules[f]; this.symbols = []; this.breakTargets = []; this.continueTargets = []; this.breakDepths = []; this.continueDepths = []; this.cleanupScopes = [new IrCleanupScope()];
      const id: number = this.functionNodes[f]; this.block = this.newBlock(id);
      if (this.result.functions[f].name == "$fini") {
        for (let g: number = this.globalSymbols.length-1; g >= 0; g = g-1) if (this.result.globals[g].source.moduleId == this.checked.moduleRecords[this.module].id && this.result.typeDefinitions[this.result.globals[g].typeId].resource) this.emit("dropRemaining",-1,[],this.place(this.globalSymbols[g],id),-1,"",id);
      } else if (this.node(id).kind != NodeKind.Program) {
        for (let at: number = 0; at < this.result.functions[f].captureSymbols.length; at = at+1) {
          let symbol: number = -1; for (let sid: number = 0; sid < this.checked.symbolIds.length; sid = sid+1) if (this.checked.symbolIds[sid] == this.result.functions[f].captureSymbols[at]) symbol = sid;
          const p: number = this.local(symbol,this.result.functions[f].captureTypes[at],false,id); this.result.functions[f].places[p].kind = "capture"; this.result.functions[f].places[p].field = at;
        }
        let parameter: number = 0;
        if (this.result.functions[f].receiverType >= 0) {
          let symbol: number = -1; for (let sid: number = 0; sid < this.binding.symbols.length; sid = sid+1) if (this.binding.symbols[sid].module == this.module && this.binding.symbols[sid].kind == "receiver" && this.binding.symbols[sid].scope >= 0 && this.binding.scopes[this.binding.symbols[sid].scope].node == id) symbol = sid;
          this.local(symbol,this.result.functions[f].receiverType,true,id); parameter = 1;
        }
        for (const e of this.node(id).edges) if (e.role == EdgeRole.Params) {
          const symbol: number = this.binding.files[this.module].declarations[e.node]; const p = this.node(e.node);
          const slot: number = this.local(symbol,this.result.functions[f].parameterTypes[parameter],true,e.node); this.track(slot); parameter = parameter+1;
        }
        if (this.result.functions[f].receiverType >= 0 && this.node(id).get(AttributeKind.Name) == "constructor") {
          const receiverPlace: number = this.result.functions[f].captureTypes.length; const shapeType: number = this.result.typeDefinitions[this.result.functions[f].receiverType].arguments[0];
          const root: number = this.projection(receiverPlace,"deref",shapeType,-1,-1,id);
          for (const e of this.node(id).edges) if (e.role == EdgeRole.Params && this.node(e.node).get(AttributeKind.ParameterProperty) == "true") {
            const name: string = this.node(e.node).get(AttributeKind.Name); let field: number = -1; for (let at: number = 0; at < this.result.typeDefinitions[shapeType].names.length; at = at+1) if (this.result.typeDefinitions[shapeType].names[at] == name) field = at;
            const symbol: number = this.binding.files[this.module].declarations[e.node]; const parameterType: number = this.typeId(this.checked.files[this.module].types[e.node],e.node);
            const value: number = this.emit(this.result.typeDefinitions[parameterType].resource ? "move" : "load",parameterType,[],this.place(symbol,e.node),-1,"",e.node);
            if (field >= 0) this.emit("store",-1,[value],this.projection(root,"field",this.result.typeDefinitions[shapeType].fields[field],-1,field,id),-1,"",id);
          }
        }
        const body: number = bindingChild(this.node(id),EdgeRole.Body);
        if (body >= 0 && this.node(body).kind != NodeKind.BlockStatement) { const returned: number = this.convert(this.expression(body),this.result.functions[f].bodyReturns,id); this.cleanup(0,id); this.terminate("return",returned,[],id); }
        else this.statement(body);
      } else this.statement(id);
      if (this.open()) {
        if (this.result.types[this.result.functions[f].bodyReturns] == "void") { this.cleanup(0,id); this.terminate("return",-1,[],id); }
        else this.terminate("unreachable",-1,[],id);
      }
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m+1) this.order(m);
    for (let at: number = this.result.initializationOrder.length-1; at >= 0; at = at-1) for (const module of this.result.modules) if (module.initializer == this.result.initializationOrder[at]) this.result.finalizationOrder.push(module.finalizer);
    for (let f: number = 0; f < this.result.functions.length; f = f+1) if (this.result.functions[f].asynchronous) { for (let value: number = 0; value < this.result.functions[f].values.length; value = value+1) this.result.functions[f].frameValues.push(value); for (let place: number = 0; place < this.result.functions[f].places.length; place = place+1) if ((this.result.functions[f].places[place].base) < 0 && (this.result.functions[f].places[place].global) < 0) this.result.functions[f].framePlaces.push(place); }
    if (this.result.diagnostics.length == 0) this.result = preserveContracts(this.graph,this.checked,this.result);
    if (this.result.diagnostics.length == 0) this.result = finishBorrows(this.result);
    if (this.result.diagnostics.length == 0) this.result.diagnostics = verifyIr(this.result);
    this.result.success = this.result.diagnostics.length == 0; return this.result;
  }
}
export function lowerProject(graph: ModuleGraph, binding: BindingResult, checked: CheckResult): IrProject { let lowering = new IrLowering(graph,binding,checked); return lowering.run(); }
