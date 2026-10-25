// Backend-independent identities. All indices belong to this IR project/function.
export class IrSource {
  generatedId: string; generatedStart: number; generatedEnd: number;
  moduleId: string; sourceHash: string; file: string; node: number; start: number; end: number;
  constructor(moduleId: string, sourceHash: string, file: string, node: number, start: number, end: number) {
    this.generatedId = ""; this.generatedStart = -1; this.generatedEnd = -1; this.moduleId = moduleId; this.sourceHash = sourceHash; this.file = file; this.node = node; this.start = start; this.end = end;
  }
}
export class IrPlace {
  kind: string; base: number; index: number; field: number; readOnly: boolean;
  symbolId: string; typeId: number; global: number; parameter: boolean; source: IrSource;
  constructor(symbolId: string, typeId: number, global: number, parameter: boolean, source: IrSource) {
    this.kind = "local"; this.base = -1; this.index = -1; this.field = -1; this.readOnly = false;
    this.symbolId = symbolId; this.typeId = typeId; this.global = global; this.parameter = parameter; this.source = source;
  }
}
export class IrInstruction {
  continuation: number;
  lease: number; contract: number;
  names: string[]; signature: number; effects: string[];
  op: string; result: number; typeId: number; operands: number[]; place: number; callee: number; text: string; source: IrSource;
  constructor(op: string, result: number, typeId: number, source: IrSource) {
    this.continuation = -1; this.lease = -1; this.contract = -1; this.names = []; this.signature = -1; this.effects = [];
    this.op = op; this.result = result; this.typeId = typeId; this.operands = []; this.place = -1; this.callee = -1; this.text = ""; this.source = source;
  }
}
export class IrBlock {
  instructions: IrInstruction[]; terminator: string; value: number; targets: number[]; source: IrSource;
  constructor(source: IrSource) { this.instructions = []; this.terminator = ""; this.value = -1; this.targets = []; this.source = source; }
}
export class IrFunction {
  effectContracts: number[];
  frameValues: number[]; framePlaces: number[];
  leases: IrLease[];
  receiverType: number;
  signature: string; substitutionFrom: string[]; substitutionTo: string[];
  captureSymbols: string[]; captureTypes: number[]; captureModes: string[]; asynchronous: boolean; bodyReturns: number;
  name: string; symbolId: string; returns: number; parameterTypes: number[]; places: IrPlace[]; values: number[]; blocks: IrBlock[]; source: IrSource;
  constructor(name: string, symbolId: string, returns: number, source: IrSource) {
    this.effectContracts = []; this.frameValues = []; this.framePlaces = []; this.leases = []; this.receiverType = -1; this.signature = ""; this.substitutionFrom = []; this.substitutionTo = []; this.captureSymbols = []; this.captureTypes = []; this.captureModes = []; this.asynchronous = false; this.bodyReturns = returns;
    this.name = name; this.symbolId = symbolId; this.returns = returns; this.parameterTypes = []; this.places = []; this.values = []; this.blocks = []; this.source = source;
  }
}
export class IrModule {
  id: string; sourceHash: string; file: string; initializer: number; finalizer: number;
  constructor(id: string, sourceHash: string, file: string, initializer: number) { this.id = id; this.sourceHash = sourceHash; this.file = file; this.initializer = initializer; this.finalizer = -1; }
}
export class IrIssue {
  code: string; message: string; source: IrSource;
  constructor(code: string, message: string, source: IrSource) { this.code = code; this.message = message; this.source = source; }
}
export class IrProject {
  dispatches: IrDispatch[];
  effectContracts: IrEffectContract[]; annotations: IrAnnotation[];
  runtimeContracts: IrRuntimeContract[];
  typeDefinitions: IrType[]; finalizationOrder: number[];
  types: string[]; modules: IrModule[]; globals: IrPlace[]; functions: IrFunction[]; initializationOrder: number[]; entry: number; diagnostics: IrIssue[]; success: boolean;
  constructor() { this.dispatches = []; this.effectContracts = []; this.annotations = []; this.runtimeContracts = []; this.typeDefinitions = []; this.finalizationOrder = []; this.types = []; this.modules = []; this.globals = []; this.functions = []; this.initializationOrder = []; this.entry = -1; this.diagnostics = []; this.success = false; }
}

// Concrete method identities for structural interface dispatch, resolved by the producer.
export class IrDispatch {
  interfaceType: number; concreteType: number; name: string; signature: number; callee: number;
  constructor(interfaceType: number, concreteType: number, name: string, signature: number, callee: number) {
    this.interfaceType = interfaceType; this.concreteType = concreteType; this.name = name; this.signature = signature; this.callee = callee;
  }
}

// Logical shapes only: no target layout, C++ spelling or ABI decisions.
export class IrType {
  methods: string[]; methodTypes: number[];
  variants: number[]; tag: string; discriminator: string; discriminatorType: number; discriminatorValue: string;
  numericKind: string; bits: number; isSigned: boolean;
  kind: string; arguments: number[]; fields: number[]; names: string[]; symbolId: string; resource: boolean; length: number;
  constructor(kind: string) { this.methods = []; this.methodTypes = []; this.variants = []; this.tag = ""; this.discriminator = ""; this.discriminatorType = -1; this.discriminatorValue = ""; this.numericKind = "none"; this.bits = 0; this.isSigned = false; this.kind = kind; this.arguments = []; this.fields = []; this.names = []; this.symbolId = ""; this.resource = false; this.length = -1; }
}
export class IrRuntimeContract {
  name: string; parameters: number[]; returns: number; effects: string[]; capability: string;
  constructor(name: string, parameters: number[], returns: number, effects: string[], capability: string) { this.name = name; this.parameters = parameters; this.returns = returns; this.effects = effects; this.capability = capability; }
}
export class IrCleanupScope {
  places: number[];
  constructor() { this.places = []; }
}
export class IrLease {
  place: number; value: number; mode: string;
  constructor(place: number, value: number, mode: string) { this.place = place; this.value = value; this.mode = mode; }
}

// Frontend effect obligations use persistent symbol IDs, never binder indices.
export class IrEffectBorrow {
  source: IrSource; callback: string; root: string; mode: string;
  constructor(source: IrSource, callback: string, root: string, mode: string) { this.source = source; this.callback = callback; this.root = root; this.mode = mode; }
}
export class IrEffectContract {
  source: IrSource; phase: string; creation: number; callees: number[];
  parameters: string[]; reads: string[]; writes: string[]; moves: string[]; invokes: string[]; retains: string[]; returned: string[];
  borrows: IrEffectBorrow[]; unknown: boolean; recursive: boolean; external: boolean;
  constructor(source: IrSource) { this.source = source; this.phase = "body"; this.creation = -1; this.callees = []; this.parameters = []; this.reads = []; this.writes = []; this.moves = []; this.invokes = []; this.retains = []; this.returned = []; this.borrows = []; this.unknown = false; this.recursive = false; this.external = false; }
}
export class IrAnnotation {
  source: IrSource; target: IrSource; name: string; arguments: string[];
  constructor(source: IrSource, target: IrSource, name: string, arguments: string[]) { this.source = source; this.target = target; this.name = name; this.arguments = arguments; }
}
