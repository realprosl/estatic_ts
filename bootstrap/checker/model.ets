import { SourceDiagnostic } from "../frontend/frontend";

export class TypedFile {
  types: string[]; members: number[]; selected: number[]; selectedModules: number[]; signatures: string[]; states: number[];
  exactIntegers: string[]; conversions: string[]; caseValues: string[];
  constructor(count: number) {
    this.types = []; this.members = []; this.selected = []; this.selectedModules = []; this.signatures = []; this.states = [];
    this.exactIntegers = []; this.conversions = []; this.caseValues = [];
    for (let i: number = 0; i < count; i = i + 1) { this.types.push(""); this.members.push(-1); this.selected.push(-1); this.selectedModules.push(-1); this.signatures.push(""); this.states.push(0); this.exactIntegers.push(""); this.conversions.push(""); this.caseValues.push(""); }
  }
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
  targets: number[]; origins: number[];
  constructor() { this.targets = []; this.origins = []; }
}
export class EffectBorrow {
  call: number; callback: number; root: number; mode: string;
  constructor(call: number, callback: number, root: number, mode: string) { this.call = call; this.callback = callback; this.root = root; this.mode = mode; }
}
export class EffectSummary {
  module: number; node: number; parameters: number[]; reads: number[]; writes: number[]; moves: number[];
  invokes: number[]; retains: number[]; returned: number[]; callees: number[]; borrows: EffectBorrow[]; unknown: boolean; recursive: boolean; external: boolean;
  constructor(module: number, node: number) {
    this.module = module; this.node = node; this.parameters = []; this.reads = []; this.writes = []; this.moves = [];
    this.invokes = []; this.retains = []; this.returned = []; this.callees = []; this.borrows = []; this.unknown = false; this.recursive = false; this.external = false;
  }
}
export class CheckResult {
  files: TypedFile[]; symbolTypes: string[]; captures: NativeCapture[]; borrows: BorrowLease[]; effects: EffectSummary[]; diagnostics: SourceDiagnostic[]; success: boolean;
  constructor() { this.files = []; this.symbolTypes = []; this.captures = []; this.borrows = []; this.effects = []; this.diagnostics = []; this.success = false; }
}
