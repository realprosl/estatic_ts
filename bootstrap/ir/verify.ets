import { IrSource, IrIssue, IrProject, IrFunction, IrInstruction } from "./model";
import { numericType, primitiveType } from "../checker/types";
import { nativeNumericLiteral, nativeInteger64, nativeUnaryPromotion, nativeBinaryPromotion } from "../checker/numeric";
export class IrFacts {
  reachable: boolean; dominators: boolean[]; initialized: boolean[];
  constructor(blocks: number, places: number) { this.reachable = false; this.dominators = []; this.initialized = []; for (let i: number = 0; i < blocks; i = i+1) this.dominators.push(true); for (let i: number = 0; i < places; i = i+1) this.initialized.push(true); }
}
export class IrVerifier {
  project: IrProject; issues: IrIssue[]; definitions: number[]; positions: number[]; facts: IrFacts[];
  constructor(project: IrProject) { this.project = project; this.issues = []; this.definitions = []; this.positions = []; this.facts = []; }
  error(source: IrSource, message: string): void { this.issues.push(new IrIssue("IR_INVALID",message,source)); }
  typeId(id: number): boolean { return id >= 0 && id < this.project.types.length; }
  value(f: constRef<IrFunction>, id: number): boolean { return id >= 0 && id < f.values.length; }
  operandType(f: constRef<IrFunction>, id: number): string { return this.value(f,id) && this.typeId(f.values[id]) ? this.project.types[f.values[id]] : "!invalid"; }
  use(f: constRef<IrFunction>, value: number, block: number, position: number, source: IrSource): void {
    if (!this.value(f,value)) { this.error(source,"Valor inexistente"); return; }
    const definition: number = this.definitions[value];
    if (definition < 0) { this.error(source,"Valor sin definición"); return; }
    if (definition == block) { if (this.positions[value] >= position) this.error(source,"Uso antes de definición"); }
    else if (this.facts[block].reachable && !this.facts[block].dominators[definition]) this.error(source,"Definición no domina el uso");
  }
  instruction(f: constRef<IrFunction>, i: constRef<IrInstruction>): void {
    const hasResult: boolean = i.result >= 0;
    if (hasResult && (!this.value(f,i.result) || !this.typeId(i.typeId) || f.values[i.result] != i.typeId || this.project.types[i.typeId] == "void")) this.error(i.source,"Resultado/tipo inválido");
    const resultType: string = this.typeId(i.typeId) ? this.project.types[i.typeId] : "!invalid";
    const a: string = i.operands.length > 0 ? this.operandType(f,i.operands[0]) : "";
    const b: string = i.operands.length > 1 ? this.operandType(f,i.operands[1]) : "";
    if (i.op == "store" || i.op == "load") {
      if ((i.place) < 0 || i.place >= f.places.length) { this.error(i.source,"Place inexistente"); return; }
      if (i.op == "load" && (i.operands.length != 0 || !hasResult || i.typeId != f.places[i.place].typeId)) this.error(i.source,"Load incompatible");
      if (i.op == "store" && (i.operands.length != 1 || hasResult || i.typeId != -1 || !this.value(f,i.operands[0]) || f.values[i.operands[0]] != f.places[i.place].typeId)) this.error(i.source,"Store incompatible");
    } else if (i.op == "constant") {
      if (!hasResult || i.operands.length != 0 || !primitiveType(resultType) || resultType == "void") this.error(i.source,"Constante inválida");
      if (resultType == "boolean" && i.text != "true" && i.text != "false") this.error(i.source,"Constante boolean inválida");
      if (numericType(resultType)) {
        const negative: boolean = i.text.startsWith("-"); const raw: string = negative ? i.text.slice(1,i.text.length) : i.text;
        if (!nativeNumericLiteral(raw).valid) this.error(i.source,"Constante numérica inválida");
        if ((resultType == "i64" || resultType == "u64") && nativeInteger64(raw,negative,resultType) == "") this.error(i.source,"Constante exacta fuera de rango");
      }
    } else if (i.op == "convert") {
      if (!hasResult || i.operands.length != 1 || !primitiveType(a) || a == "void" || !primitiveType(resultType) || resultType == "void") this.error(i.source,"Conversión inválida");
    } else if (i.op == "unary") {
      let valid: boolean = false;
      if (i.text == "!") valid = a == "boolean" && resultType == "boolean";
      if (["+","-","~"].includes(i.text)) valid = numericType(a) && resultType == nativeUnaryPromotion(a);
      if (!hasResult || i.operands.length != 1 || !valid) this.error(i.source,"Operación unaria inválida");
    } else if (i.op == "binary") {
      let valid: boolean = false;
      if (["+","-","*","/","%","&","|","^","<<",">>"].includes(i.text)) valid = numericType(a) && numericType(b) && resultType == nativeBinaryPromotion(a,b,i.text);
      if (i.text == "+" && resultType == "string") valid = (a == "string" || b == "string") && primitiveType(a) && primitiveType(b);
      if (["<",">","<=",">="].includes(i.text)) valid = resultType == "boolean" && ((numericType(a) && numericType(b)) || (a == "string" && b == "string"));
      if (["==","!="].includes(i.text)) valid = resultType == "boolean" && (a == b || (numericType(a) && numericType(b)));
      if (!hasResult || i.operands.length != 2 || !valid) this.error(i.source,"Operación binaria inválida");
    } else if (i.op == "call") {
      if ((i.callee) < 0 || i.callee >= this.project.functions.length) { this.error(i.source,"Destino de llamada inexistente"); return; }
      const target = this.project.functions[i.callee];
      if (i.typeId != target.returns || i.operands.length != target.parameterTypes.length || hasResult != (resultType != "void")) this.error(i.source,"Firma de llamada incompatible");
      for (let p: number = 0; p < i.operands.length && p < target.parameterTypes.length; p = p+1) if (!this.value(f,i.operands[p]) || f.values[i.operands[p]] != target.parameterTypes[p]) this.error(i.source,"Argumento de llamada incompatible");
    } else if (i.op == "intrinsic") {
      if (!["print","write","printError","writeError"].includes(i.text) || resultType != "void" || hasResult) this.error(i.source,"Intrínseco sin contrato");
      for (const operand of i.operands) if (!primitiveType(this.operandType(f,operand)) || this.operandType(f,operand) == "void") this.error(i.source,"Argumento intrínseco inválido");
    } else this.error(i.source,"Opcode desconocido: "+i.op);
    if (i.op != "load" && i.op != "store" && i.place != -1) this.error(i.source,"Place inesperado");
    if (i.op != "call" && i.callee != -1) this.error(i.source,"Callee inesperado");
  }
  functionBody(f: constRef<IrFunction>): void {
    this.definitions = []; this.positions = []; this.facts = [];
    if (!this.typeId(f.returns) || f.blocks.length == 0) { this.error(f.source,"Función sin entrada/tipo de retorno"); return; }
    for (const typeId of f.values) { if (!this.typeId(typeId) || this.project.types[typeId] == "void") this.error(f.source,"Tipo de valor inválido"); this.definitions.push(-1); this.positions.push(-1); }
    let parameter: number = 0;
    for (const p of f.places) {
      if (!this.typeId(p.typeId) || this.project.types[p.typeId] == "void") this.error(p.source,"Tipo de place inválido");
      if (p.global >= 0 && (p.global >= this.project.globals.length || this.project.globals[p.global].typeId != p.typeId || p.parameter)) this.error(p.source,"Global incompatible");
      if (p.parameter) { if (parameter >= f.parameterTypes.length || f.parameterTypes[parameter] != p.typeId) this.error(p.source,"Place de parámetro incompatible"); parameter = parameter+1; }
    }
    if (parameter != f.parameterTypes.length) this.error(f.source,"Faltan places de parámetros");
    for (let b: number = 0; b < f.blocks.length; b = b+1) {
      this.facts.push(new IrFacts(f.blocks.length,f.places.length)); const block = f.blocks[b];
      for (let at: number = 0; at < block.instructions.length; at = at+1) {
        const i = block.instructions[at]; if (i.result >= 0 && this.value(f,i.result)) {
          if (this.definitions[i.result] >= 0) this.error(i.source,"Resultado definido más de una vez");
          this.definitions[i.result] = b; this.positions[i.result] = at;
        }
      }
      const count: number = block.terminator == "jump" ? 1 : block.terminator == "branch" ? 2 : 0;
      if (!["jump","branch","return","unreachable"].includes(block.terminator) || block.targets.length != count) this.error(block.source,"Terminador inválido");
      for (const target of block.targets) if (target < 0 || target >= f.blocks.length) this.error(block.source,"Destino de bloque inexistente");
    }
    this.facts[0].reachable = true; let changed: boolean = true;
    while (changed) { changed = false; for (let b: number = 0; b < f.blocks.length; b = b+1) if (this.facts[b].reachable) for (const target of f.blocks[b].targets) if (target >= 0 && target < f.blocks.length && !this.facts[target].reachable) { this.facts[target].reachable = true; changed = true; } }
    // Greatest fixed point: must-dominance and must-initialization at block exit.
    changed = true;
    while (changed) {
      changed = false;
      for (let b: number = 0; b < f.blocks.length; b = b+1) if (this.facts[b].reachable) {
        let dom: boolean[] = []; let init: boolean[] = [];
        for (let d: number = 0; d < f.blocks.length; d = d+1) dom.push(b == 0 ? d == 0 : true);
        for (const p of f.places) init.push(b == 0 ? p.parameter || p.global >= 0 : true);
        if (b != 0) for (let predecessor: number = 0; predecessor < f.blocks.length; predecessor = predecessor+1) if (this.facts[predecessor].reachable && f.blocks[predecessor].targets.includes(b)) {
          for (let d: number = 0; d < dom.length; d = d+1) dom[d] = dom[d] && this.facts[predecessor].dominators[d];
          for (let p: number = 0; p < init.length; p = p+1) init[p] = init[p] && this.facts[predecessor].initialized[p];
        }
        dom[b] = true;
        for (const i of f.blocks[b].instructions) if (i.op == "store" && i.place >= 0 && (i.place) < init.length) init[i.place] = true;
        for (let d: number = 0; d < dom.length; d = d+1) if (dom[d] != this.facts[b].dominators[d]) { this.facts[b].dominators[d] = dom[d]; changed = true; }
        for (let p: number = 0; p < init.length; p = p+1) if (init[p] != this.facts[b].initialized[p]) { this.facts[b].initialized[p] = init[p]; changed = true; }
      }
    }
    for (let b: number = 0; b < f.blocks.length; b = b+1) {
      const block = f.blocks[b]; let initialized: boolean[] = [];
      for (const p of f.places) initialized.push(b == 0 ? p.parameter || p.global >= 0 : true);
      if (b != 0) for (let predecessor: number = 0; predecessor < f.blocks.length; predecessor = predecessor+1) if (this.facts[predecessor].reachable && f.blocks[predecessor].targets.includes(b)) for (let p: number = 0; p < initialized.length; p = p+1) initialized[p] = initialized[p] && this.facts[predecessor].initialized[p];
      for (let at: number = 0; at < block.instructions.length; at = at+1) {
        const i = block.instructions[at]; this.instruction(f,i); for (const value of i.operands) this.use(f,value,b,at,i.source);
        if (i.place >= 0 && (i.place) < initialized.length) {
          if (i.op == "load" && this.facts[b].reachable && !initialized[i.place]) this.error(i.source,"Load de place sin inicializar en todas las rutas");
          if (i.op == "store") initialized[i.place] = true;
        }
      }
      if (block.terminator == "branch") {
        this.use(f,block.value,b,block.instructions.length,block.source);
        if (this.operandType(f,block.value) != "boolean") this.error(block.source,"Branch requiere boolean");
      } else if (block.terminator == "return") {
        if (this.project.types[f.returns] == "void") { if (block.value != -1) this.error(block.source,"Return void con valor"); }
        else { this.use(f,block.value,b,block.instructions.length,block.source); if (!this.value(f,block.value) || f.values[block.value] != f.returns) this.error(block.source,"Tipo de retorno incompatible"); }
      } else if (block.value != -1) this.error(block.source,"Valor inesperado en terminador");
    }
    for (const definition of this.definitions) if (definition < 0) this.error(f.source,"Temporal sin definición");
  }
  run(): IrIssue[] {
    for (const typeId of this.project.types) if (!primitiveType(typeId)) this.error(new IrSource("","","",-1,0,0),"Tipo fuera del contrato escalar");
    for (const f of this.project.functions) this.functionBody(f);
    const source = new IrSource("","","",-1,0,0);
    let initializers: number[] = [];
    for (const module of this.project.modules) {
      if ((module.initializer) < 0 || module.initializer >= this.project.functions.length) this.error(new IrSource(module.id,module.sourceHash,module.file,-1,0,0),"Inicializador inexistente");
      else if (this.project.types[this.project.functions[module.initializer].returns] != "void" || this.project.functions[module.initializer].parameterTypes.length != 0) this.error(source,"Firma de inicializador inválida");
      if (initializers.includes(module.initializer)) this.error(source,"Inicializador duplicado"); initializers.push(module.initializer);
    }
    let seen: number[] = [];
    for (const initializer of this.project.initializationOrder) {
      if (!initializers.includes(initializer) || seen.includes(initializer)) this.error(source,"Orden de inicialización inválido"); seen.push(initializer);
    }
    if (seen.length != initializers.length || !initializers.includes(this.project.entry)) this.error(source,"Entrada u orden de inicialización incompleto");
    for (const p of this.project.globals) if (!this.typeId(p.typeId) || this.project.types[p.typeId] == "void") this.error(p.source,"Tipo de global inválido");
    return this.issues;
  }
}
export function verifyIr(project: IrProject): IrIssue[] { let verifier = new IrVerifier(project); return verifier.run(); }
