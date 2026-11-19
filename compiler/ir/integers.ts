// #285: deducción de enteros. Un `number` es un double, pero las variables locales
// que solo reciben valores enteros acotados (contadores, índices, longitudes…)
// pasan a ser i64: la aritmética y los índices dejan de ir por coma flotante.
//
// Una variable local (no parámetro, sin préstamos ni proyecciones) es entera si
// todos sus `store` guardan un valor entero:
//   - una constante entera (sin "-0" y con |n| <= 2^53);
//   - la lectura de otra variable entera;
//   - `a + b` / `a - b` de dos enteros donde uno está acotado (una constante
//     pequeña o un `.length`), así el valor crece como mucho de forma lineal;
//   - `a & b`, `a | b`, `a ^ b`, `a >> b` (enteros por definición);
//   - `.length` y las conversiones desde un tipo entero.
// Se deduce por punto fijo (se parte de que todas lo son y se descartan las que no).
// Después se reescriben los tipos: las lecturas y las sumas/restas enteras son i64,
// y donde un valor i64 llega a algo que espera `number` se añade una conversión
// (exacta: el valor es entero y está muy por debajo de 2^53).
import { IrProject, IrFunction, IrInstruction, IrType, IrSource } from "./model";

export class IntegerInference {
  project: IrProject; numberType: number; integerType: number;
  candidate: boolean[]; known: number[]; definitions: number[]; definitionBlocks: number[];
  retyped: boolean[];
  constructor(project: IrProject) { this.project = project; this.numberType = -1; this.integerType = -1; this.candidate = []; this.known = []; this.definitions = []; this.definitionBlocks = []; this.retyped = []; }
  // i64 en la tabla de tipos del proyecto (lo crea si no está).
  ensureInteger(): number {
    for (let at: number = 0; at < this.project.types.length; at = at + 1) if (this.project.types[at] == "i64") return at;
    let shape: IrType = new IrType("scalar"); shape.numericKind = "integer"; shape.bits = 64; shape.isSigned = true;
    this.project.types.push("i64"); this.project.typeDefinitions.push(shape); return this.project.types.length - 1;
  }
  instruction(f: number, value: number): IrInstruction { return this.project.functions[f].blocks[this.definitionBlocks[value]].instructions[this.definitions[value]]; }
  isConstant(f: number, value: number, limit: number): boolean {
    if (this.definitions[value] < 0) return false;
    const i: IrInstruction = this.instruction(f, value);
    if (i.op != "constant" || i.typeId != this.numberType) return false;
    const text: string = i.text; let start: number = 0; if (text.startsWith("-")) start = 1;
    if (text.length == start || text.length - start > limit || text == "-0") return false;
    for (let at: number = start; at < text.length; at = at + 1) { const code: number = text.charCodeAt(at); if (code < 48 || code > 57) return false; }
    return true;
  }
  bounded(f: number, value: number): boolean {
    if (this.isConstant(f, value, 9)) return true;
    if (this.definitions[value] < 0) return false;
    const i: IrInstruction = this.instruction(f, value); return i.op == "property" && i.text == "length";
  }
  // 1 entero, 0 no; known[] lo guarda durante una vuelta del punto fijo.
  integral(f: number, value: number): boolean {
    if (value < 0 || value >= this.known.length) return false;
    if (this.known[value] >= 0) return this.known[value] == 1;
    let result: boolean = false;
    if (this.definitions[value] >= 0) {
      const i: IrInstruction = this.instruction(f, value);
      if (i.op == "constant") result = this.isConstant(f, value, 15);
      else if (i.op == "load") result = i.place >= 0 && this.candidate[i.place];
      else if (i.op == "property") result = i.text == "length" && i.typeId == this.numberType;
      else if (i.op == "convert") { const from: string = this.project.types[this.project.functions[f].values[i.operands[0]]]; result = ["i8","u8","i16","u16","i32","u32"].includes(from); }
      else if (i.op == "binary" && i.typeId == this.numberType) {
        if (["&","|","^",">>"].includes(i.text)) result = true;
        else if (i.text == "+" || i.text == "-") result = this.integral(f, i.operands[0]) && this.integral(f, i.operands[1]) && (this.bounded(f, i.operands[0]) || this.bounded(f, i.operands[1]));
      }
    }
    if (result) this.known[value] = 1; else this.known[value] = 0;
    return result;
  }
  convert(f: number, value: number, typeId: number, source: IrSource): IrInstruction {
    const result: number = this.project.functions[f].values.length; this.project.functions[f].values.push(typeId);
    let conversion: IrInstruction = new IrInstruction("convert", result, typeId, source); conversion.operands.push(value); return conversion;
  }
  run(f: number): void {
    const fn: IrFunction = this.project.functions[f];
    this.candidate = []; for (const place of fn.places) this.candidate.push(place.kind == "local" && !place.parameter && place.global < 0 && place.typeId == this.numberType);
    for (const place of fn.places) if (place.base >= 0) this.candidate[place.base] = false;
    for (const place of fn.framePlaces) this.candidate[place] = false;
    this.definitions = []; this.definitionBlocks = []; for (const value of fn.values) { this.definitions.push(-1); this.definitionBlocks.push(-1); }
    let any: boolean = false;
    for (let b: number = 0; b < fn.blocks.length; b = b + 1) for (let k: number = 0; k < fn.blocks[b].instructions.length; k = k + 1) {
      const i: IrInstruction = fn.blocks[b].instructions[k];
      if (i.result >= 0) { this.definitions[i.result] = k; this.definitionBlocks[i.result] = b; }
      if (i.place >= 0 && i.op != "load" && i.op != "store") this.candidate[i.place] = false;
    }
    for (const flag of this.candidate) if (flag) any = true;
    if (!any) return;
    // Punto fijo: se descartan las variables con algún store no entero.
    let changed: boolean = true;
    while (changed) {
      changed = false; this.known = []; for (const value of fn.values) this.known.push(-1);
      for (const block of fn.blocks) for (const i of block.instructions) if (i.op == "store" && i.place >= 0 && this.candidate[i.place] && !this.integral(f, i.operands[0])) { this.candidate[i.place] = false; changed = true; }
    }
    any = false; for (const flag of this.candidate) if (flag) any = true;
    if (!any) return;
    // Valores que pasan a i64: lecturas de variables enteras y sumas/restas enteras de alguna de ellas.
    this.known = []; for (const value of fn.values) this.known.push(-1);
    this.retyped = []; for (const value of fn.values) this.retyped.push(false);
    for (const block of fn.blocks) for (const i of block.instructions) if (i.op == "load" && i.place >= 0 && this.candidate[i.place]) this.retyped[i.result] = true;
    changed = true;
    while (changed) {
      changed = false;
      for (const block of fn.blocks) for (const i of block.instructions) if (i.op == "binary" && (i.text == "+" || i.text == "-") && i.result >= 0 && !this.retyped[i.result] && this.integral(f, i.result) && (this.retyped[i.operands[0]] || this.retyped[i.operands[1]])) { this.retyped[i.result] = true; changed = true; }
    }
    const count: number = this.retyped.length;
    // Antes de reescribir (los índices de definición cambian al insertar).
    let constants: string[] = []; for (let value: number = 0; value < count; value = value + 1) constants.push(this.isConstant(f, value, 15) ? this.instruction(f, value).text : "");
    for (let p: number = 0; p < fn.places.length; p = p + 1) if (this.candidate[p]) this.project.functions[f].places[p].typeId = this.integerType;
    for (let b: number = 0; b < fn.blocks.length; b = b + 1) {
      let rewritten: IrInstruction[] = [];
      for (const original of this.project.functions[f].blocks[b].instructions) {
        let i: IrInstruction = original;
        const integerConsumer: boolean = (i.op == "binary" && i.result >= 0 && i.result < count && this.retyped[i.result]) || (i.op == "store" && i.place >= 0 && this.candidate[i.place]);
        const comparison: boolean = i.op == "binary" && ["<",">","<=",">=","==","!="].includes(i.text);
        for (let k: number = 0; k < i.operands.length; k = k + 1) {
          const value: number = i.operands[k]; const integer: boolean = value >= 0 && value < count && this.retyped[value];
          if (integer && !integerConsumer && !comparison) { const conversion: IrInstruction = this.convert(f, value, this.numberType, i.source); rewritten.push(conversion); i.operands[k] = conversion.result; }
          else if (!integer && integerConsumer && value >= 0 && value < count && constants[value] != "") {
            // Una constante entera se repite directamente como i64 (sin conversión).
            const result: number = this.project.functions[f].values.length; this.project.functions[f].values.push(this.integerType);
            let constant: IrInstruction = new IrInstruction("constant", result, this.integerType, i.source); constant.text = constants[value]; rewritten.push(constant); i.operands[k] = result;
          }
          else if (!integer && integerConsumer) { const conversion: IrInstruction = this.convert(f, value, this.integerType, i.source); rewritten.push(conversion); i.operands[k] = conversion.result; }
        }
        if (i.result >= 0 && i.result < count && this.retyped[i.result]) { i.typeId = this.integerType; this.project.functions[f].values[i.result] = this.integerType; }
        rewritten.push(i);
      }
      const value: number = this.project.functions[f].blocks[b].value;
      if (value >= 0 && value < count && this.retyped[value]) { const conversion: IrInstruction = this.convert(f, value, this.numberType, this.project.functions[f].blocks[b].source); rewritten.push(conversion); this.project.functions[f].blocks[b].value = conversion.result; }
      this.project.functions[f].blocks[b].instructions = rewritten;
    }
  }
}

export function inferIntegers(project: IrProject): IrProject {
  let inference: IntegerInference = new IntegerInference(project);
  for (let at: number = 0; at < project.types.length; at = at + 1) if (project.types[at] == "number") inference.numberType = at;
  if (inference.numberType < 0) return project;
  inference.integerType = inference.ensureInteger();
  for (let f: number = 0; f < project.functions.length; f = f + 1) inference.run(f);
  return inference.project;
}
