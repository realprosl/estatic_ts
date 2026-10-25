/** Public ets-ir-2 wire contract. No source AST or checker objects cross here. */
export interface IrSource { file: string; moduleId: string; sourceHash: string; node: number; start: number; end: number }
export interface IrType {
  kind: string; arguments: number[]; fields: number[]; names: string[]; variants: number[];
  numericKind: string; bits: number; signed: boolean; resource: boolean; length: number;
  tag: string; discriminator: string; discriminatorType: number; discriminatorValue: string;
}
export interface IrPlace { kind: string; typeId: number; base: number; index: number; field: number; global: number; parameter: boolean; source: IrSource }
export interface IrInstruction {
  op: string; result: number; typeId: number; operands: number[]; place: number; callee: number;
  contract: number; lease: number; continuation: number; signature: number; text: string; names: string[]; effects: string[]; source: IrSource;
}
export interface IrBlock { instructions: IrInstruction[]; terminator: string; targets: number[]; value: number; source: IrSource }
export interface IrFunction {
  name: string; symbolId: string; returns: number; bodyReturns: number; asynchronous: boolean;
  parameterTypes: number[]; values: number[]; places: IrPlace[]; blocks: IrBlock[];
  captureSymbols: string[]; captureTypes: number[]; captureModes: string[];
  frameValues: number[]; framePlaces: number[]; source: IrSource;
}
export interface IrRuntimeContract { name: string; parameters: number[]; returns: number; effects: string[]; capability: string }
export interface IrProject {
  annotations?: {name: string; source: IrSource; target: IrSource; arguments: string[]}[];
  format: "ets-ir-2"; success: boolean; diagnostics: {code: string; message: string}[];
  types: string[]; typeDefinitions: IrType[]; globals: IrPlace[]; functions: IrFunction[];
  modules: {id: string; initializer: number; finalizer: number}[];
  initializationOrder: number[]; finalizationOrder: number[]; runtimeContracts: IrRuntimeContract[];
}
export class IrCodegenError extends Error {
  readonly code = "IR_CPP_UNSUPPORTED";
  readonly source?: IrSource;
  constructor(message: string, source?: IrSource) {
    super(source ? `${source.file}:${source.start}: ${message}` : message);
    this.name = "IrCodegenError"; this.source=source;
  }
}
