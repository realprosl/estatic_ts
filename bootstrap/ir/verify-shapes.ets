import { IrProject, IrFunction, IrInstruction } from "./model";
import { numericType, primitiveType } from "../checker/types";
export function irAssignable(project: constRef<IrProject>, from: number, to: number, depth: number): boolean {
  if (from < 0 || to < 0 || from >= project.types.length || to >= project.types.length || depth > 64) return false;
  if (from == to) return true;
  const a = project.typeDefinitions[from]; const b = project.typeDefinitions[to];
  if (numericType(project.types[from]) && numericType(project.types[to])) return true;
  if (a.kind == "enum" && a.arguments.length == 1) return irAssignable(project,a.arguments[0],to,depth+1);
  if (a.kind == "variant" && a.arguments.length == 1 && a.arguments[0] == to) return true;
  if (a.kind == "union" && a.variants.includes(to)) return true;
  if (a.kind == "sum" && a.arguments.includes(to)) return true;
  if (a.kind == "function" && b.kind == "function") {
    if (a.arguments.length > b.arguments.length || a.arguments.length == 0) return false;
    for (let p: number = 0; p < a.arguments.length-1; p = p+1) if (!irAssignable(project,b.arguments[p],a.arguments[p],depth+1)) return false;
    return irAssignable(project,a.arguments[a.arguments.length-1],b.arguments[b.arguments.length-1],depth+1);
  }
  if (["Optional","Result"].includes(a.kind) && a.kind == b.kind && a.arguments.length == b.arguments.length) { for (let at: number = 0; at < a.arguments.length; at = at+1) if (!irAssignable(project,a.arguments[at],b.arguments[at],depth+1)) return false; return true; }
  if (b.kind == "readonly" && b.arguments.length == 1) return irAssignable(project,from,b.arguments[0],depth+1);
  if (["ref","constRef","readonly"].includes(a.kind) && a.arguments.length == 1) return irAssignable(project,a.arguments[0],to,depth+1);
  if (b.kind == "Optional" && b.arguments.length == 1) return irAssignable(project,from,b.arguments[0],depth+1);
  if (b.kind == "sum") { for (const choice of b.arguments) if (irAssignable(project,from,choice,depth+1)) return true; }
  if (["array","fixedArray","tuple","pack"].includes(a.kind) && ["array","fixedArray","tuple","pack"].includes(b.kind)) {
    if (b.kind == "tuple" && (a.kind != "tuple" || a.arguments.length != b.arguments.length)) return false;
    for (let at: number = 0; at < a.arguments.length; at = at+1) if (!irAssignable(project,a.arguments[at],b.arguments[b.kind == "tuple" ? at : 0],depth+1)) return false; return true;
  }
  if (b.kind == "interface") {
    for (let field: number = 0; field < b.names.length; field = field+1) { let found: boolean = false;
      for (let source: number = 0; source < a.names.length; source = source+1) if (a.names[source] == b.names[field] && irAssignable(project,a.fields[source],b.fields[field],depth+1)) found = true;
      if (!found) return false;
    } return true;
  }
  return false;
}
export function irConstantIndex(f: constRef<IrFunction>, value: number): number {
  for (const b of f.blocks) for (const i of b.instructions) if (i.result == value && i.op == "constant") {
    let result: number = 0; if (i.text == "") return -1;
    for (let at: number = 0; at < i.text.length; at = at+1) { const digit: number = i.text.charCodeAt(at)-48; if (digit < 0 || digit > 9) return -1; result = result*10+digit; } return result;
  } return -1;
}
export function irElement(project: constRef<IrProject>, f: constRef<IrFunction>, container: number, index: number): number {
  if (container < 0 || container >= project.types.length) return -1;
  const shape = project.typeDefinitions[container];
  if (shape.kind == "array" || shape.kind == "fixedArray") return shape.arguments[0];
  if ((shape.kind == "tuple" || shape.kind == "pack")) { const at: number = irConstantIndex(f,index); return at >= 0 && at < shape.arguments.length ? shape.arguments[at] : -1; }
  if (project.types[container] == "string") return container;
  return -1;
}
export function verifyShapeInstruction(project: constRef<IrProject>, f: constRef<IrFunction>, i: constRef<IrInstruction>): string {
  if ((i.typeId) < 0 || i.typeId >= project.types.length) return "Tipo de resultado inexistente";
  const shape = project.typeDefinitions[i.typeId];
  if (i.op == "some" || i.op == "result") {
    if ((i.result) < 0 || i.operands.length != 1 || i.operands[0] < 0 || i.operands[0] >= f.values.length || shape.kind != (i.op == "some" ? "Optional" : "Result")) return "Contenedor constante incompatible";
    if (i.op == "result" && i.text == "Err") return project.types[f.values[i.operands[0]]] == "string" ? "" : "Error de Result inválido";
    return irAssignable(project,f.values[i.operands[0]],shape.arguments[0],0) ? "" : "Payload de contenedor incompatible";
  }
  if (i.op == "iterator") {
    if (shape.kind != "iterator" || shape.arguments.length != 2 || (i.place) < 0 || i.place >= f.places.length || f.places[i.place].typeId != shape.arguments[0] || (i.result) < 0 || i.operands.length != 0) return "Iterador incompatible"; return "";
  }
  if (i.op == "iterHasNext" || i.op == "iterNext") {
    if (i.operands.length != 1 || i.operands[0] < 0 || i.operands[0] >= f.values.length) return "Cursor inexistente";
    const cursor = project.typeDefinitions[f.values[i.operands[0]]]; if (cursor.kind != "iterator" || (i.result) < 0 || (i.op == "iterHasNext" ? project.types[i.typeId] != "boolean" : cursor.arguments[1] != i.typeId)) return "Operación de iteración incompatible"; return "";
  }
  if (i.op == "typeTag") return i.operands.length == 0 && i.result >= 0 && project.types[i.typeId] == "string" && i.signature >= 0 && (i.signature) < project.types.length ? "" : "Typeof incompatible";
  if (["isPresent","unwrap","typeTest"].includes(i.op)) {
    if (i.operands.length != 1 || i.operands[0] < 0 || i.operands[0] >= f.values.length) return "Operando de inspección inválido";
    let input: number = f.values[i.operands[0]]; if (["ref","constRef"].includes(project.typeDefinitions[input].kind)) input = project.typeDefinitions[input].arguments[0];
    if (i.op == "typeTag") return project.types[i.typeId] == "string" ? "" : "Typeof incompatible";
    if (i.op == "typeTest") return project.types[i.typeId] == "boolean" && i.signature >= 0 && (i.signature) < project.types.length ? "" : "Test de tipo incompatible";
    if (project.typeDefinitions[input].kind != "Optional") return "Inspección requiere Optional";
    return i.op == "isPresent" ? project.types[i.typeId] == "boolean" ? "" : "Test de presencia incompatible" : i.typeId == project.typeDefinitions[input].arguments[0] ? "" : "Payload incompatible";
  }
  if (i.op == "emptyRecord" || i.op == "collection") {
    if ((i.result) < 0 || i.operands.length != 0 || (i.op == "emptyRecord" ? shape.kind != "record" : !["Map","Set"].includes(shape.kind))) return "Construcción vacía inválida"; return "";
  }
  if (i.op == "aggregate") {
    if (!["array","fixedArray","tuple","pack"].includes(shape.kind) || i.names.length != i.operands.length || (i.result) < 0) return "Construcción de agregado inválida";
    let position: number = 0;
    for (let at: number = 0; at < i.operands.length; at = at+1) {
      if (i.operands[at] < 0 || i.operands[at] >= f.values.length) return "Elemento inexistente";
      const actual: number = f.values[i.operands[at]]; let elements: number[] = [actual];
      if (i.names[at] == "spread") { const input = project.typeDefinitions[actual]; if (!["array","fixedArray","tuple","pack"].includes(input.kind)) return "Spread inválido"; elements = input.arguments; }
      else if (i.names[at] != "value") return "Modo de elemento inválido";
      for (const element of elements) {
        const expected: number = (shape.kind == "tuple" || shape.kind == "pack") ? position < shape.arguments.length ? shape.arguments[position] : -1 : shape.arguments[0];
        if (!irAssignable(project,element,expected,0)) return "Tipo de elemento incompatible"; position = position+1;
      }
    }
    if ((shape.kind == "tuple" || shape.kind == "pack") && position != shape.arguments.length) return "Aridad de tupla incompatible";
    return "";
  }
  if (i.op == "record" || i.op == "variant") {
    if (i.op == "variant" && (shape.kind != "variant" || i.text != shape.tag)) return "Identidad de variante incompatible";
    if (!["record","interface","intersection","union","variant"].includes(shape.kind) || i.names.length != i.operands.length || (i.result) < 0) return "Construcción de registro inválida";
    let seen: string[] = [];
    for (let at: number = 0; at < i.operands.length; at = at+1) {
      if (i.operands[at] < 0 || i.operands[at] >= f.values.length || seen.includes(i.names[at])) return "Campo duplicado/inexistente";
      let found: boolean = false; for (let field: number = 0; field < shape.names.length; field = field+1) if (shape.names[field] == i.names[at] && irAssignable(project,f.values[i.operands[at]],shape.fields[field],0)) found = true;
      if (!found) return "Campo de registro incompatible"; seen.push(i.names[at]);
    }
    for (let field: number = 0; field < shape.names.length; field = field+1) if (shape.names[field] != "kind" && shape.names[field] != shape.discriminator && !seen.includes(shape.names[field]) && project.typeDefinitions[shape.fields[field]].kind != "Optional") return "Campo requerido ausente";
    return "";
  }
  if (i.op == "property") {
    if (i.operands.length != 1 || i.operands[0] < 0 || i.operands[0] >= f.values.length || (i.result) < 0) return "Receptor de propiedad inválido";
    let input: number = f.values[i.operands[0]]; if (["ref","constRef"].includes(project.typeDefinitions[input].kind)) input = project.typeDefinitions[input].arguments[0]; const container = project.typeDefinitions[input];
    if (["length","size"].includes(i.text) && project.types[i.typeId] == "number" && (["array","fixedArray","tuple","Map","Set"].includes(container.kind) || project.types[input] == "string")) return "";
    if (i.text == "kind" && project.types[i.typeId] == "string" && ["Result","Optional"].includes(container.kind)) return "";
    if (i.text == "ok" && project.types[i.typeId] == "boolean" && container.kind == "Result") return "";
    return "Propriété sin contrato";
  }
  if (i.op == "extractIndex") {
    if (i.operands.length != 2 || i.operands[0] < 0 || i.operands[0] >= f.values.length || i.operands[1] < 0 || i.operands[1] >= f.values.length || (i.result) < 0) return "Extracción inválida";
    if (irElement(project,f,f.values[i.operands[0]],i.operands[1]) != i.typeId || !numericType(project.types[f.values[i.operands[1]]])) return "Tipo de extracción incompatible";
    return "";
  }
  return "Opcode de shape desconocido";
}
