import { SourceDiagnostic } from "../frontend/frontend";

export class TypedFile {
  types: string[]; members: number[]; selected: number[]; selectedModules: number[]; signatures: string[]; states: number[];
  constructor(count: number) {
    this.types = []; this.members = []; this.selected = []; this.selectedModules = []; this.signatures = []; this.states = [];
    for (let i: number = 0; i < count; i = i + 1) { this.types.push(""); this.members.push(-1); this.selected.push(-1); this.selectedModules.push(-1); this.signatures.push(""); this.states.push(0); }
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
export class CheckResult {
  files: TypedFile[]; symbolTypes: string[]; captures: NativeCapture[]; borrows: BorrowLease[]; diagnostics: SourceDiagnostic[]; success: boolean;
  constructor() { this.files = []; this.symbolTypes = []; this.captures = []; this.borrows = []; this.diagnostics = []; this.success = false; }
}
