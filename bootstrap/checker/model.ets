import { SourceDiagnostic } from "../frontend/frontend";

export class TypedFile {
  types: string[]; members: number[]; selected: number[]; selectedModules: number[]; signatures: string[]; states: number[];
  constantCodes: string[]; constantStates: string[]; constantValues: string[]; taskSources: number[][]; exactIntegers: string[]; conversions: string[]; caseValues: string[]; argumentParameters: number[];
  constructor(count: number) {
    this.types = []; this.members = []; this.selected = []; this.selectedModules = []; this.signatures = []; this.states = [];
    this.constantCodes = []; this.constantStates = []; this.constantValues = []; this.taskSources = []; this.exactIntegers = []; this.conversions = []; this.caseValues = []; this.argumentParameters = [];
    for (let i: number = 0; i < count; i = i + 1) { this.constantCodes.push(""); this.constantStates.push(""); this.constantValues.push(""); this.taskSources.push([]); this.types.push(""); this.members.push(-1); this.selected.push(-1); this.selectedModules.push(-1); this.signatures.push(""); this.states.push(0); this.exactIntegers.push(""); this.conversions.push(""); this.caseValues.push(""); this.argumentParameters.push(-1); }
  }
}
export function argumentParameter(file: TypedFile, node: number, position: number): number {
  return file.argumentParameters[node] >= 0 ? file.argumentParameters[node] : position;
}
export class NativeCapture {
  module: number; closure: number; symbol: number; mode: string;
  constructor(module: number, closure: number, symbol: number) { this.module = module; this.closure = closure; this.symbol = symbol; this.mode = "value"; }
}
export class BorrowLease {
  module: number; symbol: number; root: number; owner: number; begin: number; end: number; mode: string;
  constructor(module: number, symbol: number, root: number, owner: number, begin: number, mode: string) {
    this.module = module; this.symbol = symbol; this.root = root; this.owner = owner; this.begin = begin; this.end = begin; this.mode = mode;
  }
}
export class EffectPoint {
  targets: number[]; origins: number[]; tasks: number[];
  constructor() { this.targets = []; this.origins = []; this.tasks = []; }
}
export class EffectBorrow {
  call: number; callback: number; root: number; mode: string;
  constructor(call: number, callback: number, root: number, mode: string) { this.call = call; this.callback = callback; this.root = root; this.mode = mode; }
}
export class EffectSummary {
  phase: string; creation: number; module: number; node: number; parameters: number[]; reads: number[]; writes: number[]; moves: number[];
  invokes: number[]; retains: number[]; returned: number[]; callees: number[]; borrows: EffectBorrow[]; unknown: boolean; recursive: boolean; external: boolean;
  constructor(module: number, node: number) {
    this.phase = "body"; this.creation = -1; this.module = module; this.node = node; this.parameters = []; this.reads = []; this.writes = []; this.moves = [];
    this.invokes = []; this.retains = []; this.returned = []; this.callees = []; this.borrows = []; this.unknown = false; this.recursive = false; this.external = false;
  }
}
export class NativeDecorator {
  module: number; node: number; target: number; name: string; arguments: string[];
  constructor(module: number, node: number, target: number, name: string) { this.module = module; this.node = node; this.target = target; this.name = name; this.arguments = []; }
}
export class CheckResult {
  decorators: NativeDecorator[]; files: TypedFile[]; symbolTypes: string[]; captures: NativeCapture[]; borrows: BorrowLease[]; effects: EffectSummary[]; diagnostics: SourceDiagnostic[]; success: boolean;
  constructor() { this.decorators = []; this.files = []; this.symbolTypes = []; this.captures = []; this.borrows = []; this.effects = []; this.diagnostics = []; this.success = false; }
}
