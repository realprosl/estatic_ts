import { IrSource, IrProject, IrFunction, IrIssue } from "./model";

// Validate table references before any dataflow pass indexes through them.
export function verifyIrTables(project: constRef<IrProject>): IrIssue[] {
  let issues: IrIssue[] = []; const source = new IrSource("","","",-1,0,0);
  const count: number = project.types.length;
  if (project.typeDefinitions.length != count) { issues.push(new IrIssue("IR_INVALID","Tabla de tipos incompleta",source)); return issues; }
  for (let at: number = 0; at < count; at = at+1) {
    const shape = project.typeDefinitions[at];
    if (!["scalar","ref","constRef","ptr","constPtr","readonly","function","array","fixedArray","tuple","sum","intersection","variant","enum","union","interface","record","Optional","Result","Map","Set","Promise","pack","iterator","runtime","parameter"].includes(shape.kind)) issues.push(new IrIssue("IR_INVALID","Shape desconocida",source));
    for (const child of shape.arguments) if (child < 0 || child >= count) issues.push(new IrIssue("IR_INVALID","Argumento de tipo inexistente",source));
    for (const child of shape.fields) if (child < 0 || child >= count) issues.push(new IrIssue("IR_INVALID","Campo de tipo inexistente",source));
    if (shape.methods.length != shape.methodTypes.length) issues.push(new IrIssue("IR_INVALID","Tabla de métodos incompleta",source));
    for (const child of shape.methodTypes) if (child < 0 || child >= count) issues.push(new IrIssue("IR_INVALID","Firma de método inexistente",source));
    for (const child of shape.variants) if (child < 0 || child >= count) issues.push(new IrIssue("IR_INVALID","Variante de tipo inexistente",source));
    if (shape.fields.length != shape.names.length) issues.push(new IrIssue("IR_INVALID","Tabla de campos incompatible",source));
    let names: string[] = []; for (const name of shape.names) { if (name == "" || names.includes(name)) issues.push(new IrIssue("IR_INVALID","Identidad de campo duplicada/vacía",source)); names.push(name); }
    const unary: boolean = ["ref","constRef","ptr","constPtr","readonly","array","fixedArray","Optional","Set","Promise","enum","variant"].includes(shape.kind);
    const binary: boolean = ["Map","Result","iterator"].includes(shape.kind);
    if ((unary && shape.arguments.length != 1) || (binary && shape.arguments.length != 2) || (shape.kind == "function" && shape.arguments.length == 0)) issues.push(new IrIssue("IR_INVALID","Aridad de shape incompatible",source));
    if ((shape.kind == "fixedArray" ? (shape.length) < 0 || shape.length % 1 != 0 : shape.length != -1)) issues.push(new IrIssue("IR_INVALID","Longitud de shape incompatible",source));
    if ((shape.discriminatorType) < -1 || shape.discriminatorType >= count || (shape.discriminator != "" && (shape.discriminatorType) < 0)) issues.push(new IrIssue("IR_INVALID","Discriminador de shape incompatible",source));
  }
  // Recompute the structural ownership bit; trusting it would let a malformed
  // producer turn move-only values into copies and bypass every route check.
  if (issues.length == 0) {
    let resources: boolean[] = []; for (const shape of project.typeDefinitions) resources.push(["ptr","constPtr","Promise"].includes(shape.kind) || (shape.kind == "runtime" && project.types[resources.length] == "Server"));
    let changed: boolean = true;
    while (changed) {
      changed = false;
      for (let at: number = 0; at < count; at = at+1) if (!resources[at]) {
        const shape = project.typeDefinitions[at]; let owns: boolean = false;
        if (["array","fixedArray","tuple","pack","Optional","Result","Map","Set","sum","intersection","variant"].includes(shape.kind)) for (const child of shape.arguments) if (resources[child]) owns = true;
        if (["record","interface","union"].includes(shape.kind)) { for (const child of shape.fields) if (resources[child]) owns = true; for (const child of shape.variants) if (resources[child]) owns = true; }
        if (owns) { resources[at] = true; changed = true; }
      }
    }
    for (let at: number = 0; at < count; at = at+1) if (resources[at] != project.typeDefinitions[at].resource) issues.push(new IrIssue("IR_INVALID","Propiedad de recurso incompatible con su shape",source));
  }
  for (const contract of project.runtimeContracts) {
    if (contract.name == "" || contract.capability == "" || contract.effects.length == 0 || (contract.returns) < 0 || contract.returns >= count) issues.push(new IrIssue("IR_INVALID","Contrato runtime inválido",source));
    for (const parameter of contract.parameters) if (parameter < 0 || parameter >= count || project.types[parameter] == "void") issues.push(new IrIssue("IR_INVALID","Parámetro runtime inválido",source));
  }
  for (const f of project.functions) {
    if ((f.returns) < 0 || f.returns >= count || (f.bodyReturns) < 0 || f.bodyReturns >= count) issues.push(new IrIssue("IR_INVALID","Tipo de retorno inexistente",f.source));
    for (const typeId of f.values) if (typeId < 0 || typeId >= count || project.types[typeId] == "void") issues.push(new IrIssue("IR_INVALID","Tipo de valor inválido",f.source));
    for (const typeId of f.parameterTypes) if (typeId < 0 || typeId >= count || project.types[typeId] == "void") issues.push(new IrIssue("IR_INVALID","Tipo de parámetro inválido",f.source));
    for (let p: number = 0; p < f.places.length; p = p+1) {
      const place = f.places[p];
      if ((place.typeId) < 0 || place.typeId >= count || project.types[place.typeId] == "void") issues.push(new IrIssue("IR_INVALID","Tipo de place inválido",place.source));
      if ((place.base) < -1 || place.base >= p || (place.global) < -1 || place.global >= project.globals.length) issues.push(new IrIssue("IR_INVALID","Referencia de place inválida",place.source));
    }
    for (const block of f.blocks) {
      for (const target of block.targets) if (target < 0 || target >= f.blocks.length) issues.push(new IrIssue("IR_INVALID","Destino de bloque inexistente",block.source));
      for (const i of block.instructions) {
        if ((i.typeId) < -1 || i.typeId >= count || (i.typeId == -1 && !["store","dropValue","dropRemaining","dropFrame","endBorrow"].includes(i.op))) issues.push(new IrIssue("IR_INVALID","Tipo de instrucción inválido",i.source));
        for (const operand of i.operands) if (operand < 0 || operand >= f.values.length) issues.push(new IrIssue("IR_INVALID","Operando inexistente",i.source));
      }
    }
  }
  return issues;
}

// Frames are conservative logical tables. A backend may choose a smaller layout,
// but cannot omit the values/roots whose lifetime the IR promises to preserve.
export function verifyFunctionContracts(project: constRef<IrProject>, f: constRef<IrFunction>): IrIssue[] {
  let issues: IrIssue[] = [];
  if (f.captureSymbols.length != f.captureTypes.length || f.captureModes.length != f.captureTypes.length) issues.push(new IrIssue("IR_INVALID","Tablas de capturas incompatibles",f.source));
  for (let at: number = 0; at < f.captureTypes.length; at = at+1) {
    if ((f.captureTypes[at]) < 0 || f.captureTypes[at] >= project.types.length) issues.push(new IrIssue("IR_INVALID","Tipo de captura inexistente",f.source));
    if (at < f.captureModes.length && !["value","reference"].includes(f.captureModes[at])) issues.push(new IrIssue("IR_INVALID","Modo de captura inválido",f.source));
  }
  let values: number[] = []; let places: number[] = [];
  for (const value of f.frameValues) { if (!f.asynchronous || value < 0 || value >= f.values.length || values.includes(value)) issues.push(new IrIssue("IR_INVALID","Valor de frame inválido/duplicado",f.source)); values.push(value); }
  for (const place of f.framePlaces) { if (!f.asynchronous || place < 0 || place >= f.places.length || places.includes(place)) issues.push(new IrIssue("IR_INVALID","Place de frame inválido/duplicado",f.source)); else if (f.places[place].base >= 0 || f.places[place].global >= 0) issues.push(new IrIssue("IR_INVALID","Frame requiere un place raíz local",f.source)); places.push(place); }
  if (f.asynchronous) {
    for (let at: number = 0; at < f.values.length; at = at+1) if (!values.includes(at)) issues.push(new IrIssue("IR_INVALID","Valor ausente del frame lógico",f.source));
    for (let at: number = 0; at < f.places.length; at = at+1) if ((f.places[at].base) < 0 && (f.places[at].global) < 0 && !places.includes(at)) issues.push(new IrIssue("IR_INVALID","Place ausente del frame lógico",f.source));
  }
  for (let lease: number = 0; lease < f.leases.length; lease = lease+1) {
    const item = f.leases[lease]; let definitions: number = 0;
    if ((item.place) < 0 || item.place >= f.places.length || (item.value) < 0 || item.value >= f.values.length || !["ref","constRef"].includes(item.mode)) issues.push(new IrIssue("IR_INVALID","Tabla de préstamos inválida",f.source));
    for (const block of f.blocks) for (const i of block.instructions) if (["borrow","address"].includes(i.op) && i.lease == lease) {
      definitions = definitions+1;
      if (i.result != item.value || i.place != item.place || item.mode != (i.op == "address" ? "ref" : project.typeDefinitions[i.typeId].kind)) issues.push(new IrIssue("IR_INVALID","Modo/identidad de préstamo incompatible",i.source));
    }
    if (definitions != 1) issues.push(new IrIssue("IR_INVALID","Préstamo sin definición única",f.source));
  }
  for (let b: number = 0; b < f.blocks.length; b = b+1) {
    const block = f.blocks[b];
    if (block.terminator == "suspend" && block.targets.length == 2) {
      let normal: number = block.targets[0]; let predecessor: number = b; let steps: number = 0;
      // finishBorrows may split a continuation edge with lease cleanup.
      while (steps < f.blocks.length) {
        let incoming: number = 0; for (const previous of f.blocks) for (const target of previous.targets) if (target == normal) incoming = incoming+1;
        if (incoming != 1 || !f.blocks[predecessor].targets.includes(normal)) issues.push(new IrIssue("IR_INVALID","Continuación con entrada ajena a su suspensión",block.source));
        let resumes: number = 0; let cleanup: boolean = true;
        for (const i of f.blocks[normal].instructions) { if (i.op == "resume" && i.continuation == b) resumes = resumes+1; if (i.op != "endBorrow") cleanup = false; }
        if (resumes == 1) break;
        if (!cleanup || f.blocks[normal].terminator != "jump" || f.blocks[normal].targets.length != 1) { issues.push(new IrIssue("IR_INVALID","Suspensión sin reanudación única",block.source)); break; }
        predecessor = normal; normal = f.blocks[normal].targets[0]; steps = steps+1;
      }
      if (steps == f.blocks.length) issues.push(new IrIssue("IR_INVALID","Ciclo en continuación de suspensión",block.source));
    }
    for (const i of block.instructions) if (i.op == "resume") {
      let definitions: number = 0; for (const candidate of f.blocks) for (const other of candidate.instructions) if (other.op == "resume" && other.continuation == i.continuation) definitions = definitions+1;
      if (definitions != 1) issues.push(new IrIssue("IR_INVALID","Reanudación duplicada",i.source));
    }
  }
  return issues;
}

export function verifyModuleContracts(project: constRef<IrProject>): IrIssue[] {
  let issues: IrIssue[] = []; const source = new IrSource("","","",-1,0,0);
  let ids: string[] = []; let finalizers: number[] = [];
  for (const module of project.modules) {
    if (module.id == "" || module.sourceHash == "" || module.file == "" || ids.includes(module.id)) issues.push(new IrIssue("IR_INVALID","Identidad de módulo inválida/duplicada",source)); ids.push(module.id);
    if ((module.finalizer) < 0 || module.finalizer >= project.functions.length || finalizers.includes(module.finalizer)) issues.push(new IrIssue("IR_INVALID","Finalizador inexistente/duplicado",source));
    else { const f = project.functions[module.finalizer]; if (project.types[f.returns] != "void" || f.parameterTypes.length != 0 || f.asynchronous || f.source.moduleId != module.id) issues.push(new IrIssue("IR_INVALID","Contrato de finalizador inválido",f.source)); }
    finalizers.push(module.finalizer);
  }
  let expected: number[] = [];
  for (let at: number = project.initializationOrder.length-1; at >= 0; at = at-1) for (const module of project.modules) if (module.initializer == project.initializationOrder[at]) expected.push(module.finalizer);
  if (project.finalizationOrder.length != expected.length) issues.push(new IrIssue("IR_INVALID","Orden de finalización incompleto",source));
  else for (let at: number = 0; at < expected.length; at = at+1) if (project.finalizationOrder[at] != expected[at]) issues.push(new IrIssue("IR_INVALID","Orden de finalización incompatible",source));
  return issues;
}
