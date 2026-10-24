import { IrSource, IrPlace, IrInstruction, IrBlock, IrFunction, IrModule, IrIssue, IrProject } from "./model";
import { ModuleGraph } from "../modules/loader";
import { BindingResult, bindingChild } from "../binder/binder";
import { CheckResult } from "../checker/model";
import { functionParams, functionReturn, primitiveType } from "../checker/types";
import { AstNode } from "../parser/parser";
import { NodeKind, EdgeRole, AttributeKind, nodeKindName } from "../parser/ast-schema";
import { verifyIr } from "./verify";

function irIndex(values: number[], value: number): number { for (let i: number = 0; i < values.length; i = i+1) if (values[i] == value) return i; return -1; }

export class IrLowering {
  graph: ModuleGraph; binding: BindingResult; checked: CheckResult; result: IrProject;
  module: number; currentFunction: number; block: number; symbols: number[]; breakTargets: number[]; continueTargets: number[];
  functionModules: number[]; functionNodes: number[]; globalSymbols: number[]; orderState: number[];
  constructor(graph: ModuleGraph, binding: BindingResult, checked: CheckResult) {
    this.graph = graph; this.binding = binding; this.checked = checked; this.result = new IrProject();
    this.module = 0; this.currentFunction = -1; this.block = 0; this.symbols = []; this.breakTargets = []; this.continueTargets = [];
    this.functionModules = []; this.functionNodes = []; this.globalSymbols = []; this.orderState = [];
  }
  node(id: number): AstNode { return this.graph.modules[this.module].cached.result.ast.nodes[id]; }
  source(id: number): IrSource {
    const n = this.node(id); const record = this.checked.moduleRecords[this.module];
    return new IrSource(record.id,record.sourceHash,this.graph.modules[this.module].file,id,n.start.offset,n.end.endOffset);
  }
  fail(id: number, message: string): void { this.result.diagnostics.push(new IrIssue("IR_UNSUPPORTED",message,this.source(id))); }
  typeId(text: string, id: number): number {
    if (!primitiveType(text)) this.fail(id,"Tipo sin contrato de lowering: "+text);
    let found: number = -1; for (let i: number = 0; i < this.result.types.length; i = i+1) if (this.result.types[i] == text) found = i; if (found < 0) { found = this.result.types.length; this.result.types.push(text); } return found;
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
    let instruction = new IrInstruction(op,value,typeId,this.source(id)); instruction.operands = operands; instruction.place = place; instruction.callee = callee; instruction.text = text;
    this.result.functions[this.currentFunction].blocks[this.block].instructions.push(instruction); return value;
  }
  reference(id: number): number {
    let target: number = this.binding.files[this.module].valueTargets[id];
    if (target < 0) for (const r of this.binding.references) if (r.module == this.module && r.node == id && r.space == "value") target = r.target;
    return target;
  }
  place(symbol: number, id: number): number {
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
    return this.emit("convert",typeId,[value],-1,-1,"",id);
  }
  expression(id: number): number {
    if (id < 0) return -1;
    let value: number = this.expressionInner(id); const conversion: string = this.checked.files[this.module].conversions[id];
    if (conversion != "") value = this.convert(value,this.typeId(conversion,id),id); return value;
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
    if (kind == NodeKind.IdentifierExpression) { const p: number = this.place(this.reference(id),id); return this.emit("load",typeId,[],p,-1,"",id); }
    if (kind == NodeKind.NamedArgumentExpression) return this.expression(bindingChild(n,EdgeRole.Value));
    if (kind == NodeKind.SatisfiesExpression) return this.expression(bindingChild(n,EdgeRole.Operand));
    if (kind == NodeKind.AsExpression) return this.convert(this.expression(bindingChild(n,EdgeRole.Expression)),typeId,id);
    if (kind == NodeKind.UnaryExpression) return this.emit("unary",typeId,[this.expression(bindingChild(n,EdgeRole.Operand))],-1,-1,n.get(AttributeKind.Operator),id);
    if (kind == NodeKind.TernaryExpression) return this.conditional(id,bindingChild(n,EdgeRole.Condition),bindingChild(n,EdgeRole.ThenBranch),bindingChild(n,EdgeRole.ElseBranch),typeId,"");
    if (kind == NodeKind.BinaryExpression) {
      const op: string = n.get(AttributeKind.Operator); const left: number = bindingChild(n,EdgeRole.Left); const right: number = bindingChild(n,EdgeRole.Right);
      if (op == "&&" || op == "||") return this.conditional(id,left,right,-1,typeId,op);
      if (op == "??") { this.fail(id,"Coalescencia requiere lowering de Optional"); return -1; }
      const a: number = this.expression(left); const b: number = this.expression(right);
      return this.emit("binary",typeId,[a,b],-1,-1,op,id);
    }
    if (kind == NodeKind.AssignmentExpression || kind == NodeKind.CompoundAssignmentExpression) {
      const target: number = bindingChild(n,EdgeRole.Target);
      if (this.node(target).kind != NodeKind.IdentifierExpression) { this.fail(id,"Place proyectado aún no soportado"); return -1; }
      const p: number = this.place(this.reference(target),target); if (p < 0) return -1;
      const pt: number = this.result.functions[this.currentFunction].places[p].typeId; let previous: number = -1;
      if (kind == NodeKind.CompoundAssignmentExpression) previous = this.emit("load",pt,[],p,-1,"",target);
      let value: number = this.expression(bindingChild(n,EdgeRole.Value));
      if (kind == NodeKind.CompoundAssignmentExpression) { const op: string = n.get(AttributeKind.Operator); value = this.emit("binary",typeId,[previous,value],-1,-1,op.slice(0,op.length-1),id); }
      value = this.convert(value,pt,id); this.emit("store",-1,[value],p,-1,"",id); return value;
    }
    if (kind == NodeKind.CallExpression) return this.call(id,typeId);
    this.fail(id,"Operación sin contrato de lowering: "+nodeKindName(kind)); return -1;
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
    this.block = join; return this.emit("load",typeId,[],p,-1,"",id);
  }
  call(id: number, typeId: number): number {
    const n = this.node(id); const file = this.checked.files[this.module]; const selected: number = file.selected[id]; const owner: number = file.selectedModules[id];
    let callee: number = -1; let intrinsic: string = "";
    if (selected >= 0) {
      for (let f: number = 0; f < this.functionNodes.length; f = f+1) if (this.functionNodes[f] == selected && this.functionModules[f] == owner) callee = f;
      if (callee < 0) { this.fail(id,"Destino directo sin función IR"); return -1; }
    } else {
      const symbol: number = this.reference(id);
      if (symbol >= 0 && (this.binding.symbols[symbol].module) < 0 && ["print","write","printError","writeError"].includes(this.binding.symbols[symbol].name)) intrinsic = this.binding.symbols[symbol].name;
      else { this.fail(id,"Llamada indirecta u opaca sin contrato IR"); return -1; }
    }
    let operands: number[] = []; let positions: number[] = [];
    // Evaluate actuals in source order, then arrange their already computed values.
    for (const edge of n.edges) if (edge.role == EdgeRole.Args) {
      positions.push(file.argumentParameters[edge.node] >= 0 ? file.argumentParameters[edge.node] : positions.length);
      operands.push(this.expression(edge.node));
    }
    if (callee >= 0) {
      const parameters = this.result.functions[callee].parameterTypes; let ordered: number[] = [];
      for (let p: number = 0; p < parameters.length; p = p+1) {
        const at: number = irIndex(positions,p);
        if (at < 0) { this.fail(id,"Argumento omitido/default requiere especialización de llamada"); ordered.push(-1); }
        else ordered.push(this.convert(operands[at],parameters[p],id));
      }
      operands = ordered;
    }
    return this.emit(intrinsic == "" ? "call" : "intrinsic",typeId,operands,-1,callee,intrinsic,id);
  }
  statement(id: number): void {
    if (id < 0 || !this.open()) return;
    const n = this.node(id); const kind: NodeKind = n.kind;
    if (kind == NodeKind.Program || kind == NodeKind.BlockStatement) { for (const e of n.edges) if (e.role == EdgeRole.Statements) this.statement(e.node); return; }
    if (kind == NodeKind.FunctionDeclaration) {
      let found: boolean = false; for (let f: number = 0; f < this.functionNodes.length; f = f+1) if (this.functionNodes[f] == id && this.functionModules[f] == this.module) found = true; if (!found) this.fail(id,"Función anidada sin contrato de entorno"); return;
    }
    if ([NodeKind.ImportDeclaration,NodeKind.ExportNamedDeclaration,NodeKind.ExportAllDeclaration,NodeKind.ModuleHeaderDeclaration,NodeKind.TypeAliasDeclaration,NodeKind.InterfaceDeclaration].includes(kind)) return;
    if (kind == NodeKind.VariableDeclaration) {
      if (n.get(AttributeKind.Pattern) != "") { this.fail(id,"Destructuring sin lowering"); return; }
      const symbol: number = this.binding.files[this.module].declarations[id]; const typeId: number = this.typeId(this.checked.files[this.module].types[id],id);
      const p: number = this.globalSymbols.includes(symbol) ? this.place(symbol,id) : this.local(symbol,typeId,false,id);
      const initializer: number = bindingChild(n,EdgeRole.Initializer); if (initializer < 0) { this.fail(id,"Variable sin inicializador"); return; }
      const value: number = this.convert(this.expression(initializer),typeId,id); this.emit("store",-1,[value],p,-1,"",id); return;
    }
    if (kind == NodeKind.ExpressionStatement) { this.expression(bindingChild(n,EdgeRole.Expression)); return; }
    if (kind == NodeKind.ReturnStatement) {
      const value: number = this.expression(bindingChild(n,EdgeRole.Value));
      this.terminate("return",this.convert(value,this.result.functions[this.currentFunction].returns,id),[],id); return;
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
      this.statement(bindingChild(n,EdgeRole.Initializer));
      const test: number = this.newBlock(id); const body: number = this.newBlock(id); const increment: number = this.newBlock(id); const end: number = this.newBlock(id);
      this.terminate("jump",-1,[test],id); this.block = test;
      const condition: number = bindingChild(n,EdgeRole.Condition);
      if (condition >= 0) this.terminate("branch",this.expression(condition),[body,end],id); else this.terminate("jump",-1,[body],id);
      this.breakTargets.push(end); this.continueTargets.push(increment); this.block = body; this.statement(bindingChild(n,EdgeRole.Body));
      if (this.open()) this.terminate("jump",-1,[increment],id);
      this.block = increment; this.expression(bindingChild(n,EdgeRole.Increment)); this.terminate("jump",-1,[test],id);
      this.breakTargets.pop(); this.continueTargets.pop(); this.block = end; return;
    }
    if (kind == NodeKind.BreakStatement || kind == NodeKind.ContinueStatement) {
      const targets: number[] = kind == NodeKind.BreakStatement ? this.breakTargets : this.continueTargets;
      if (targets.length == 0) { this.fail(id,"Salida sin destino"); return; }
      this.terminate("jump",-1,[targets[targets.length-1]],id); return;
    }
    this.fail(id,"Sentencia sin contrato de lowering: "+nodeKindName(kind));
  }
  registerFunction(id: number): void {
    const n = this.node(id); const symbol: number = this.binding.files[this.module].declarations[id];
    const signature: string = this.checked.files[this.module].types[id];
    let f = new IrFunction(n.get(AttributeKind.Name),this.checked.symbolIds[symbol],this.typeId(functionReturn(signature),id),this.source(id));
    for (const parameter of functionParams(signature)) f.parameterTypes.push(this.typeId(parameter,id));
    if (n.get(AttributeKind.Async) == "true" || n.get(AttributeKind.IsAsync) == "true") this.fail(id,"Async requiere lowering de suspensión");
    for (const e of n.edges) if (e.role == EdgeRole.TypeParameters || e.role == EdgeRole.Decorators) this.fail(id,"Genéricos/decoradores requieren especialización o contrato de backend");
    this.result.functions.push(f); this.functionModules.push(this.module); this.functionNodes.push(id);
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
    if (!this.graph.success || !this.binding.success || !this.checked.success || this.graph.diagnostics.length > 0 || this.binding.diagnostics.length > 0 || this.checked.diagnostics.length > 0 || this.checked.files.length != this.graph.modules.length || this.binding.files.length != this.graph.modules.length || this.checked.moduleRecords.length != this.graph.modules.length || this.checked.symbolIds.length != this.binding.symbols.length) {
      const source = new IrSource("","",this.graph.entry,-1,0,0); this.result.diagnostics.push(new IrIssue("IR_INPUT","Se requiere un proyecto comprobado sin diagnósticos de una misma carga",source)); return this.result;
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m+1) {
      this.module = m; const ast = this.graph.modules[m].cached.result.ast;
      if (this.checked.moduleRecords[m].file != this.graph.modules[m].file || this.checked.moduleRecords[m].sourceHash != this.graph.modules[m].cached.record.hash ||
          this.checked.files[m].types.length != ast.nodes.length || this.binding.files[m].declarations.length != ast.nodes.length ||
          this.binding.files[m].valueTargets.length != ast.nodes.length || this.checked.files[m].conversions.length != ast.nodes.length ||
          this.checked.files[m].selected.length != ast.nodes.length || this.checked.files[m].selectedModules.length != ast.nodes.length ||
          this.checked.files[m].exactIntegers.length != ast.nodes.length || this.checked.files[m].argumentParameters.length != ast.nodes.length) {
        this.result.diagnostics.push(new IrIssue("IR_INPUT","Tablas incompatibles con el AST",this.source(ast.root))); return this.result;
      }
      for (let id: number = 0; id < ast.nodes.length; id = id+1) {
        const target: number = this.binding.files[m].valueTargets[id]; const declaration: number = this.binding.files[m].declarations[id];
        const selected: number = this.checked.files[m].selected[id]; const owner: number = this.checked.files[m].selectedModules[id];
        let valid: boolean = target >= -1 && target < this.binding.symbols.length && declaration >= -1 && declaration < this.binding.symbols.length;
        if (selected >= 0) { if (owner < 0 || owner >= this.graph.modules.length) valid = false; else if (selected >= this.graph.modules[owner].cached.result.ast.nodes.length) valid = false; }
        for (const e of ast.nodes[id].edges) if ((e.node) < 0 || e.node >= ast.nodes.length) valid = false;
        if (!valid) { this.result.diagnostics.push(new IrIssue("IR_INPUT","Identidad de entrada inválida",this.source(id))); return this.result; }
      }
      this.orderState.push(0);
      for (const edge of this.node(ast.root).edges) if (edge.role == EdgeRole.Statements) {
        if (this.node(edge.node).kind == NodeKind.FunctionDeclaration) this.registerFunction(edge.node);
        if (this.node(edge.node).kind == NodeKind.VariableDeclaration) {
          const symbol: number = this.binding.files[m].declarations[edge.node]; this.globalSymbols.push(symbol);
          this.result.globals.push(new IrPlace(this.checked.symbolIds[symbol],this.typeId(this.checked.files[m].types[edge.node],edge.node),-1,false,this.source(edge.node)));
        }
      }
    }
    const count: number = this.result.functions.length;
    for (let m: number = 0; m < this.graph.modules.length; m = m+1) {
      this.module = m; const root: number = this.graph.modules[m].cached.result.ast.root; const record = this.checked.moduleRecords[m]; const index: number = this.result.functions.length;
      this.result.modules.push(new IrModule(record.id,record.sourceHash,record.file,index));
      this.result.functions.push(new IrFunction("$init",record.id+":init",this.typeId("void",root),this.source(root)));
      this.functionModules.push(m); this.functionNodes.push(root); if (record.file == this.graph.entry) this.result.entry = index;
    }
    for (let f: number = 0; f < this.result.functions.length; f = f+1) {
      this.currentFunction = f; this.module = this.functionModules[f]; this.symbols = []; this.breakTargets = []; this.continueTargets = [];
      const id: number = this.functionNodes[f]; this.block = this.newBlock(id);
      if (f < count) {
        for (const e of this.node(id).edges) if (e.role == EdgeRole.Params) {
          const symbol: number = this.binding.files[this.module].declarations[e.node]; const p = this.node(e.node);
          if (p.get(AttributeKind.Variadic) == "true" || p.get(AttributeKind.Out) == "true" || p.get(AttributeKind.Optional) == "true") this.fail(e.node,"Parámetro rest/out/optional sin contrato IR");
          this.local(symbol,this.typeId(this.checked.files[this.module].types[e.node],e.node),true,e.node);
        }
        this.statement(bindingChild(this.node(id),EdgeRole.Body));
      } else this.statement(id);
      if (this.open()) {
        if (this.result.types[this.result.functions[f].returns] == "void") this.terminate("return",-1,[],id);
        else this.terminate("unreachable",-1,[],id);
      }
    }
    for (let m: number = 0; m < this.graph.modules.length; m = m+1) this.order(m);
    if (this.result.diagnostics.length == 0) this.result.diagnostics = verifyIr(this.result);
    this.result.success = this.result.diagnostics.length == 0; return this.result;
  }
}
export function lowerProject(graph: ModuleGraph, binding: BindingResult, checked: CheckResult): IrProject { let lowering = new IrLowering(graph,binding,checked); return lowering.run(); }
