// Backend-independent identities. All indices belong to this IR project/function.
export class IrSource {
  moduleId: string; sourceHash: string; file: string; node: number; start: number; end: number;
  constructor(moduleId: string, sourceHash: string, file: string, node: number, start: number, end: number) {
    this.moduleId = moduleId; this.sourceHash = sourceHash; this.file = file; this.node = node; this.start = start; this.end = end;
  }
}
export class IrPlace {
  symbolId: string; typeId: number; global: number; parameter: boolean; source: IrSource;
  constructor(symbolId: string, typeId: number, global: number, parameter: boolean, source: IrSource) {
    this.symbolId = symbolId; this.typeId = typeId; this.global = global; this.parameter = parameter; this.source = source;
  }
}
export class IrInstruction {
  op: string; result: number; typeId: number; operands: number[]; place: number; callee: number; text: string; source: IrSource;
  constructor(op: string, result: number, typeId: number, source: IrSource) {
    this.op = op; this.result = result; this.typeId = typeId; this.operands = []; this.place = -1; this.callee = -1; this.text = ""; this.source = source;
  }
}
export class IrBlock {
  instructions: IrInstruction[]; terminator: string; value: number; targets: number[]; source: IrSource;
  constructor(source: IrSource) { this.instructions = []; this.terminator = ""; this.value = -1; this.targets = []; this.source = source; }
}
export class IrFunction {
  name: string; symbolId: string; returns: number; parameterTypes: number[]; places: IrPlace[]; values: number[]; blocks: IrBlock[]; source: IrSource;
  constructor(name: string, symbolId: string, returns: number, source: IrSource) {
    this.name = name; this.symbolId = symbolId; this.returns = returns; this.parameterTypes = []; this.places = []; this.values = []; this.blocks = []; this.source = source;
  }
}
export class IrModule {
  id: string; sourceHash: string; file: string; initializer: number;
  constructor(id: string, sourceHash: string, file: string, initializer: number) { this.id = id; this.sourceHash = sourceHash; this.file = file; this.initializer = initializer; }
}
export class IrIssue {
  code: string; message: string; source: IrSource;
  constructor(code: string, message: string, source: IrSource) { this.code = code; this.message = message; this.source = source; }
}
export class IrProject {
  types: string[]; modules: IrModule[]; globals: IrPlace[]; functions: IrFunction[]; initializationOrder: number[]; entry: number; diagnostics: IrIssue[]; success: boolean;
  constructor() { this.types = []; this.modules = []; this.globals = []; this.functions = []; this.initializationOrder = []; this.entry = -1; this.diagnostics = []; this.success = false; }
}
