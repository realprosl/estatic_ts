import { verifyIrTables, verifyFunctionContracts, verifyModuleContracts } from "./verify-contracts";
import { IrSource, IrIssue, IrProject, IrFunction, IrInstruction } from "./model";
import { numericType, primitiveType } from "../checker/types";
import { nativeNumericLiteral, nativeInteger64, nativeUnaryPromotion, nativeBinaryPromotion } from "../checker/numeric";
import { irNumericWidth, irNumericKind, irNumericSigned, irNumericConstant } from "./type-traits";
import { verifyOwnershipRoutes } from "./verify-ownership";
import { verifyBorrowRoutes } from "./verify-borrows";
import { irPlacePath, irInitialPlace } from "./verify-memory";
import { irAssignable, irElement, verifyShapeInstruction } from "./verify-shapes";

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
    if (["store","load","address","move","borrow","dropRemaining"].includes(i.op)) {
      if ((i.place) < 0 || i.place >= f.places.length) { this.error(i.source,"Place inexistente"); return; }
      if (i.op == "move" && (i.operands.length != 0 || !hasResult || i.typeId != f.places[i.place].typeId)) this.error(i.source,"Move incompatible");
      if (i.op == "borrow" && (i.operands.length != 0 || !hasResult || !["ref","constRef"].includes(this.project.typeDefinitions[i.typeId].kind) || this.project.typeDefinitions[i.typeId].arguments[0] != f.places[i.place].typeId)) this.error(i.source,"Borrow incompatible");
      if (i.op == "dropRemaining" && (i.operands.length != 0 || hasResult || i.typeId != -1 || !this.project.typeDefinitions[f.places[i.place].typeId].resource)) this.error(i.source,"Drop incompatible");
      if (i.op == "load" && this.project.typeDefinitions[i.typeId].resource) this.error(i.source,"Load copiaría un recurso; requiere move/borrow");
      if (i.op == "address" && (i.operands.length != 0 || !hasResult || this.project.typeDefinitions[i.typeId].kind != "ref" || this.project.typeDefinitions[i.typeId].arguments[0] != f.places[i.place].typeId)) this.error(i.source,"Address incompatible");
      if (i.op == "load" && (i.operands.length != 0 || !hasResult || i.typeId != f.places[i.place].typeId)) this.error(i.source,"Load incompatible");
      if (i.op == "store" && (i.operands.length != 1 || hasResult || i.typeId != -1 || !this.value(f,i.operands[0]) || f.values[i.operands[0]] != f.places[i.place].typeId)) this.error(i.source,"Store incompatible");
    } else if (["aggregate","record","property","extractIndex","emptyRecord","collection","isPresent","unwrap","typeTag","typeTest","iterator","iterHasNext","iterNext","some","result","variant"].includes(i.op)) {
      const message: string = verifyShapeInstruction(this.project,f,i); if (message != "") this.error(i.source,message);
    } else if (i.op == "constant") {
      if (!hasResult || i.operands.length != 0 || (!primitiveType(resultType) && this.project.typeDefinitions[i.typeId].kind != "enum") || resultType == "void") this.error(i.source,"Constante inválida");
      if (resultType == "boolean" && i.text != "true" && i.text != "false") this.error(i.source,"Constante boolean inválida");
      if (numericType(resultType)) {
        const negative: boolean = i.text.startsWith("-"); const raw: string = negative ? i.text.slice(1,i.text.length) : i.text;
        if (!irNumericConstant(raw,irNumericKind(resultType) == "float")) this.error(i.source,"Constante numérica inválida");
        if ((resultType == "i64" || resultType == "u64") && nativeInteger64(raw,negative,resultType) == "") this.error(i.source,"Constante exacta fuera de rango");
      }
    } else if (i.op == "convert") {
      if (!hasResult || i.operands.length != 1 || a == "void" || resultType == "void" || !(irAssignable(this.project,f.values[i.operands[0]],i.typeId,0) || (primitiveType(a) && primitiveType(resultType)))) this.error(i.source,"Conversión inválida");
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
    } else if (i.op == "dropFrame") {
      if (!f.asynchronous || hasResult || i.typeId != -1 || i.operands.length != 0) this.error(i.source,"Limpieza de frame inválida");
    } else if (i.op == "resume") {
      if (!f.asynchronous || (i.continuation) < 0 || i.continuation >= f.blocks.length || f.blocks[i.continuation].terminator != "suspend" || i.operands.length != 0) this.error(i.source,"Reanudación inválida");
      else { const task: number = f.blocks[i.continuation].value; if (!this.value(f,task) || this.project.typeDefinitions[f.values[task]].kind != "Promise" || this.project.typeDefinitions[f.values[task]].arguments[0] != i.typeId || hasResult != (resultType != "void")) this.error(i.source,"Tipo de reanudación incompatible"); }
    } else if (i.op == "endBorrow") {
      if (hasResult || i.typeId != -1 || i.operands.length != 0 || (i.lease) < 0 || i.lease >= f.leases.length) this.error(i.source,"EndBorrow incompatible");
    } else if (i.op == "own") {
      if (!hasResult || i.operands.length != 1 || !this.value(f,i.operands[0]) || !["ptr","constPtr"].includes(this.project.typeDefinitions[i.typeId].kind) || this.project.typeDefinitions[i.typeId].arguments[0] != f.values[i.operands[0]]) this.error(i.source,"Transferencia a owner incompatible");
    } else if (i.op == "dropValue") {
      if (hasResult || i.typeId != -1 || i.operands.length != 1 || !this.value(f,i.operands[0]) || !this.project.typeDefinitions[f.values[i.operands[0]]].resource) this.error(i.source,"Drop de temporal incompatible");
    } else if (i.op == "none") {
      if (i.operands.length != 0 || !hasResult || this.project.typeDefinitions[i.typeId].kind != "Optional") this.error(i.source,"None incompatible");
    } else if (i.op == "closure") {
      if ((i.callee) < 0 || i.callee >= this.project.functions.length) this.error(i.source,"Closure sin destino");
      else { const target = this.project.functions[i.callee];
        if (target.signature != this.project.types[i.typeId] || i.operands.length != target.captureTypes.length || !hasResult) this.error(i.source,"Entorno de closure incompatible");
        for (let at: number = 0; at < i.operands.length && at < target.captureTypes.length; at = at+1) if (this.value(f,i.operands[at])) { const actual: number = f.values[i.operands[at]]; const shape = this.project.typeDefinitions[actual]; if (target.captureModes[at] == "reference" ? shape.kind != "ref" || shape.arguments[0] != target.captureTypes[at] : actual != target.captureTypes[at]) this.error(i.source,"Tipo de captura incompatible"); }
      }
    } else if (i.op == "callIndirect") {
      if (!this.typeId(i.signature) || this.project.typeDefinitions[i.signature].kind != "function" || i.operands.length == 0 || !this.value(f,i.operands[0])) this.error(i.source,"Llamada indirecta sin firma");
      else { const signature = this.project.typeDefinitions[i.signature];
        if (f.values[i.operands[0]] != i.signature || signature.arguments.length != i.operands.length || signature.arguments[signature.arguments.length-1] != i.typeId || hasResult != (resultType != "void")) this.error(i.source,"Firma indirecta incompatible");
        for (let at: number = 1; at < i.operands.length; at = at+1) if (!this.value(f,i.operands[at]) || f.values[i.operands[at]] != signature.arguments[at-1]) this.error(i.source,"Argumento indirecto incompatible");
      }
    } else if (i.op == "call" || i.op == "taskCreate") {
      if ((i.callee) < 0 || i.callee >= this.project.functions.length) { this.error(i.source,"Destino de llamada inexistente"); return; }
      const target = this.project.functions[i.callee];
      if ((i.op == "taskCreate") != target.asynchronous) this.error(i.source,"Creación de tarea/invocación incompatible");
      if (i.typeId != target.returns || i.operands.length != target.parameterTypes.length || hasResult != (resultType != "void")) this.error(i.source,"Firma de llamada incompatible");
      for (let p: number = 0; p < i.operands.length && p < target.parameterTypes.length; p = p+1) if (!this.value(f,i.operands[p]) || f.values[i.operands[p]] != target.parameterTypes[p]) this.error(i.source,"Argumento de llamada incompatible");
    } else if (i.op == "backendEscape") {
      if ((i.callee) < 0 || i.callee >= this.project.functions.length || hasResult || resultType != "void") this.error(i.source,"Escape de backend sin generador");
      else { const target = this.project.functions[i.callee]; if (this.project.types[target.returns] != "string" || target.parameterTypes.length != i.operands.length) this.error(i.source,"Firma de generador incompatible"); for (let at: number = 0; at < i.operands.length && at < target.parameterTypes.length; at = at+1) if (!this.value(f,i.operands[at]) || f.values[i.operands[at]] != target.parameterTypes[at]) this.error(i.source,"Argumento de generador incompatible"); }
    } else if (i.op == "runtimeCall") {
      if ((i.contract) < 0 || i.contract >= this.project.runtimeContracts.length) this.error(i.source,"Contrato runtime inexistente");
      else { const contract = this.project.runtimeContracts[i.contract]; if (contract.returns != i.typeId || contract.parameters.length != i.operands.length || hasResult != (resultType != "void") || contract.capability == "" || contract.effects.length == 0) this.error(i.source,"Contrato runtime incompatible");
        for (let at: number = 0; at < i.operands.length && at < contract.parameters.length; at = at+1) if (!this.value(f,i.operands[at]) || f.values[i.operands[at]] != contract.parameters[at]) this.error(i.source,"Argumento runtime incompatible");
      }
    } else if (i.op == "intrinsic") {
      if (!["print","write","printError","writeError"].includes(i.text) || resultType != "void" || hasResult) this.error(i.source,"Intrínseco sin contrato");
      for (const operand of i.operands) if (this.operandType(f,operand) == "!invalid" || this.operandType(f,operand) == "void") this.error(i.source,"Argumento intrínseco inválido");
    } else this.error(i.source,"Opcode desconocido: "+i.op);
    if (!["load","store","address","move","borrow","dropRemaining","iterator"].includes(i.op) && i.place != -1) this.error(i.source,"Place inesperado");
    if (i.op != "call" && i.op != "taskCreate" && i.op != "backendEscape" && i.op != "closure" && i.callee != -1) this.error(i.source,"Callee inesperado");
  }
  updateInitialization(f: constRef<IrFunction>, i: constRef<IrInstruction>, initialized: boolean[]): boolean[] {
    if ((i.place) < 0 || i.place >= f.places.length) return initialized;
    const projectionKey: string = irPlacePath(f,i.place,0);
    if (i.op == "store") {
      for (let p: number = 0; p < f.places.length; p = p+1) { const key: string = irPlacePath(f,p,0); if (key == projectionKey || key.startsWith(projectionKey+".")) initialized[p] = true; }
      let parent: number = f.places[i.place].base;
      while (parent >= 0) { let all: boolean = true; for (let p: number = 0; p < f.places.length; p = p+1) if (f.places[p].base == parent && !initialized[p]) all = false; if (all) initialized[parent] = true; parent = f.places[parent].base; }
    }
    if (i.op == "dropRemaining" || (i.op == "move" && this.project.typeDefinitions[f.places[i.place].typeId].resource)) for (let p: number = 0; p < f.places.length; p = p+1) { const key: string = irPlacePath(f,p,0); if (key == projectionKey || key.startsWith(projectionKey+".") || projectionKey.startsWith(key+".")) initialized[p] = false; }
    return initialized;
  }
  functionBody(f: constRef<IrFunction>): void {
    this.definitions = []; this.positions = []; this.facts = [];
    if (!this.typeId(f.returns) || f.blocks.length == 0) { this.error(f.source,"Función sin entrada/tipo de retorno"); return; }
    for (const typeId of f.values) { if (!this.typeId(typeId) || this.project.types[typeId] == "void") this.error(f.source,"Tipo de valor inválido"); this.definitions.push(-1); this.positions.push(-1); }
    let parameter: number = 0;
    for (let place: number = 0; place < f.places.length; place = place+1) {
      const p = f.places[place];
      if (p.kind == "capture") { if ((p.field) < 0 || p.field >= f.captureTypes.length || f.captureTypes[p.field] != p.typeId) this.error(p.source,"Place de entorno incompatible"); }
      else if (p.kind != "local") {
        if ((p.base) < 0 || p.base >= place) this.error(p.source,"Base de proyección inválida");
        else { const parent: number = f.places[p.base].typeId; const shape = this.project.typeDefinitions[parent];
          if (p.kind == "field" && ((p.field) < 0 || p.field >= shape.fields.length || shape.fields[p.field] != p.typeId)) this.error(p.source,"Campo proyectado incompatible");
          else if (p.kind == "index" && ((p.index) < 0 || !this.value(f,p.index) || irElement(this.project,f,parent,p.index) != p.typeId)) this.error(p.source,"Índice proyectado incompatible");
          else if (p.kind == "deref" && (!["ptr","constPtr","ref","constRef","readonly"].includes(shape.kind) || shape.arguments.length != 1 || shape.arguments[0] != p.typeId)) this.error(p.source,"Deref incompatible");
          else if (p.kind == "checkedView" && !irAssignable(this.project,parent,p.typeId,0) && !irAssignable(this.project,p.typeId,parent,0)) this.error(p.source,"Vista de narrowing incompatible");
          else if (!["field","index","deref","checkedView"].includes(p.kind)) this.error(p.source,"Clase de place desconocida");
        }
      }
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
      const count: number = block.terminator == "jump" ? 1 : block.terminator == "branch" || block.terminator == "suspend" ? 2 : 0;
      if (!["jump","branch","return","unreachable","suspend","cancel","trap"].includes(block.terminator) || block.targets.length != count) this.error(block.source,"Terminador inválido");
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
        for (let p: number = 0; p < f.places.length; p = p+1) init.push(b == 0 ? irInitialPlace(f,p) : true);
        if (b != 0) for (let predecessor: number = 0; predecessor < f.blocks.length; predecessor = predecessor+1) if (this.facts[predecessor].reachable && f.blocks[predecessor].targets.includes(b)) {
          for (let d: number = 0; d < dom.length; d = d+1) dom[d] = dom[d] && this.facts[predecessor].dominators[d];
          for (let p: number = 0; p < init.length; p = p+1) init[p] = init[p] && this.facts[predecessor].initialized[p];
        }
        dom[b] = true;
        for (const i of f.blocks[b].instructions) init = this.updateInitialization(f,i,init);
        for (let d: number = 0; d < dom.length; d = d+1) if (dom[d] != this.facts[b].dominators[d]) { this.facts[b].dominators[d] = dom[d]; changed = true; }
        for (let p: number = 0; p < init.length; p = p+1) if (init[p] != this.facts[b].initialized[p]) { this.facts[b].initialized[p] = init[p]; changed = true; }
      }
    }
    for (let b: number = 0; b < f.blocks.length; b = b+1) {
      const block = f.blocks[b]; let initialized: boolean[] = [];
      for (let p: number = 0; p < f.places.length; p = p+1) initialized.push(b == 0 ? irInitialPlace(f,p) : true);
      if (b != 0) for (let predecessor: number = 0; predecessor < f.blocks.length; predecessor = predecessor+1) if (this.facts[predecessor].reachable && f.blocks[predecessor].targets.includes(b)) for (let p: number = 0; p < initialized.length; p = p+1) initialized[p] = initialized[p] && this.facts[predecessor].initialized[p];
      for (let at: number = 0; at < block.instructions.length; at = at+1) {
        const i = block.instructions[at]; this.instruction(f,i); for (const value of i.operands) this.use(f,value,b,at,i.source);
        if (i.place >= 0 && (i.place) < initialized.length) {
          let root: number = i.place; let steps: number = 0;
          while (f.places[root].base >= 0 && (f.places[root].base) < root && steps < f.places.length) { if (f.places[root].index >= 0) this.use(f,f.places[root].index,b,at,i.source); root = f.places[root].base; steps = steps+1; }
          if (i.op != "dropRemaining" && i.op != "store" && this.facts[b].reachable && !initialized[i.place]) this.error(i.source,"Load de place sin inicializar en todas las rutas");
          initialized = this.updateInitialization(f,i,initialized);
        }
      }
      if (block.terminator == "suspend") {
        this.use(f,block.value,b,block.instructions.length,block.source);
        if (!f.asynchronous || !this.value(f,block.value) || this.project.typeDefinitions[f.values[block.value]].kind != "Promise" || block.targets.length != 2 || f.blocks[block.targets[1]].terminator != "cancel") this.error(block.source,"Suspensión sin tarea/continuaciones");
      } else if (block.terminator == "branch") {
        this.use(f,block.value,b,block.instructions.length,block.source);
        if (this.operandType(f,block.value) != "boolean") this.error(block.source,"Branch requiere boolean");
      } else if (block.terminator == "return") {
        if (this.project.types[f.bodyReturns] == "void") { if (block.value != -1) this.error(block.source,"Return void con valor"); }
        else { this.use(f,block.value,b,block.instructions.length,block.source); if (!this.value(f,block.value) || f.values[block.value] != f.bodyReturns) this.error(block.source,"Tipo de retorno incompatible"); }
      } else if (block.value != -1) this.error(block.source,"Valor inesperado en terminador");
    }
    for (const definition of this.definitions) if (definition < 0) this.error(f.source,"Temporal sin definición");
  }
  run(): IrIssue[] {
    this.issues = verifyIrTables(this.project); if (this.issues.length > 0) return this.issues;
    for (const f of this.project.functions) for (const issue of verifyFunctionContracts(this.project,f)) this.issues.push(issue);
    for (const issue of verifyModuleContracts(this.project)) this.issues.push(issue);
    if (this.issues.length > 0) return this.issues;
    if (this.project.typeDefinitions.length != this.project.types.length) { this.error(new IrSource("","","",-1,0,0),"Tabla de tipos incompleta"); return this.issues; }
    for (let at: number = 0; at < this.project.typeDefinitions.length; at = at+1) {
      const shape = this.project.typeDefinitions[at];
      if (shape.bits != irNumericWidth(this.project.types[at]) || shape.numericKind != irNumericKind(this.project.types[at]) || shape.isSigned != irNumericSigned(this.project.types[at])) this.error(new IrSource("","","",-1,0,0),"Anchura/signo numérico incompatible");
      if (["pending","invalid"].includes(shape.kind)) this.error(new IrSource("","","",-1,0,0),"Shape inválida");
      for (const child of shape.arguments) if (!this.typeId(child)) this.error(new IrSource("","","",-1,0,0),"Argumento de tipo inexistente");
      if (shape.fields.length != shape.names.length) this.error(new IrSource("","","",-1,0,0),"Tabla de campos incompatible");
      for (const child of shape.fields) if (!this.typeId(child)) this.error(new IrSource("","","",-1,0,0),"Campo de tipo inexistente");
    }
    for (const contract of this.project.effectContracts) {
      if (!["body","creation"].includes(contract.phase) || (contract.creation) < -1 || contract.creation >= this.project.effectContracts.length) this.error(contract.source,"Contrato de efectos incompatible");
      for (const target of contract.callees) if (target < 0 || target >= this.project.effectContracts.length) this.error(contract.source,"Arista de efectos inexistente");
      for (const lease of contract.borrows) if (lease.callback == "" || lease.root == "" || !["ref","constRef"].includes(lease.mode)) this.error(lease.source,"Obligación callback incompatible");
    }
    for (const f of this.project.functions) { for (const contract of f.effectContracts) if (contract < 0 || contract >= this.project.effectContracts.length || this.project.effectContracts[contract].source.moduleId != f.source.moduleId || this.project.effectContracts[contract].source.node != f.source.node) this.error(f.source,"Contrato de función inexistente"); this.functionBody(f); }
    if (this.issues.length == 0) for (const f of this.project.functions) { for (const issue of verifyBorrowRoutes(this.project,f)) this.issues.push(issue); for (const issue of verifyOwnershipRoutes(this.project,f)) this.issues.push(issue); }
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
