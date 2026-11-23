import { IrProject, IrFunction, IrInstruction, IrIssue } from "./model";
export class IrOwnershipFacts {
  reachable: boolean; must: boolean[]; may: boolean[];
  constructor(count: number) { this.reachable = false; this.must = []; this.may = []; for (let i: number = 0; i < count; i = i+1) { this.must.push(true); this.may.push(false); } }
}
export function verifyOwnershipRoutes(project: constRef<IrProject>, f: constRef<IrFunction>): IrIssue[] {
  // Solo importan los valores y places con ownership (recursos): el resto
  // nunca produce un diagnóstico. Se trabaja sobre ellos (índice compacto) y
  // con los predecesores calculados una vez; antes cada iteración recorría
  // todos los valores y places y todos los bloques por bloque.
  let issues: IrIssue[] = []; const offset: number = f.values.length; const total: number = offset+f.places.length;
  let slot: number[] = []; let count: number = 0;
  for (let at: number = 0; at < f.values.length; at = at+1) { if (project.typeDefinitions[f.values[at]].resource) { slot.push(count); count = count+1; } else slot.push(-1); }
  for (let at: number = 0; at < f.places.length; at = at+1) { if (f.places[at].kind == "local" && (f.places[at].global) < 0 && project.typeDefinitions[f.places[at].typeId].resource) { slot.push(count); count = count+1; } else slot.push(-1); }
  if (count == 0 || f.blocks.length == 0) return issues;
  let entry: boolean[] = []; for (let at: number = 0; at < count; at = at+1) entry.push(false);
  for (let at: number = offset; at < total; at = at+1) if (slot[at] >= 0 && f.places[at-offset].parameter) entry[slot[at]] = true;
  let predecessors: number[][] = []; for (let b: number = 0; b < f.blocks.length; b = b+1) predecessors.push([]);
  for (let b: number = 0; b < f.blocks.length; b = b+1) for (let t: number = 0; t < f.blocks.length; t = t+1) if (f.blocks[b].targets.includes(t)) predecessors[t].push(b);
  let facts: IrOwnershipFacts[] = []; for (let b: number = 0; b < f.blocks.length; b = b+1) facts.push(new IrOwnershipFacts(count));
  facts[0].reachable = true; let changed: boolean = true;
  while (changed) {
    changed = false;
    for (let b: number = 0; b < f.blocks.length; b = b+1) {
      let must: boolean[] = []; let may: boolean[] = [];
      for (let at: number = 0; at < count; at = at+1) { must.push(b == 0 ? entry[at] : true); may.push(b == 0 ? entry[at] : false); }
      for (const predecessor of predecessors[b]) if (facts[predecessor].reachable) {
        if (!facts[b].reachable) { facts[b].reachable = true; changed = true; }
        if (b != 0) for (let at: number = 0; at < count; at = at+1) { must[at] = must[at] && facts[predecessor].must[at]; may[at] = may[at] || facts[predecessor].may[at]; }
      }
      if (!facts[b].reachable) continue;
      for (let k: number = 0; k < f.blocks[b].instructions.length; k = k+1) {
        const op: string = f.blocks[b].instructions[k].op; const place: number = f.blocks[b].instructions[k].place; const result: number = f.blocks[b].instructions[k].result;
        if (op == "dropFrame") for (let at: number = 0; at < count; at = at+1) { must[at] = false; may[at] = false; }
        for (const operand of f.blocks[b].instructions[k].operands) if (operand >= 0 && operand < offset && slot[operand] >= 0) { must[slot[operand]] = false; may[slot[operand]] = false; }
        if (op == "store" && place >= 0 && slot[offset+place] >= 0) { must[slot[offset+place]] = true; may[slot[offset+place]] = true; }
        if ((op == "move" || op == "dropRemaining") && place >= 0 && slot[offset+place] >= 0) { must[slot[offset+place]] = false; may[slot[offset+place]] = false; }
        if (result >= 0 && slot[result] >= 0) { must[slot[result]] = true; may[slot[result]] = true; }
      }
      const returned: number = f.blocks[b].value;
      if ((f.blocks[b].terminator == "return" || f.blocks[b].terminator == "suspend") && returned >= 0 && slot[returned] >= 0) { must[slot[returned]] = false; may[slot[returned]] = false; }
      for (let at: number = 0; at < count; at = at+1) if (facts[b].must[at] != must[at] || facts[b].may[at] != may[at]) { facts[b].must[at] = must[at]; facts[b].may[at] = may[at]; changed = true; }
    }
  }
  for (let b: number = 0; b < f.blocks.length; b = b+1) if (facts[b].reachable) {
    let must: boolean[] = []; let may: boolean[] = [];
    for (let at: number = 0; at < count; at = at+1) { must.push(b == 0 ? entry[at] : true); may.push(b == 0 ? entry[at] : false); }
    if (b != 0) for (const predecessor of predecessors[b]) if (facts[predecessor].reachable) for (let at: number = 0; at < count; at = at+1) { must[at] = must[at] && facts[predecessor].must[at]; may[at] = may[at] || facts[predecessor].may[at]; }
    for (let k: number = 0; k < f.blocks[b].instructions.length; k = k+1) {
      const op: string = f.blocks[b].instructions[k].op; const place: number = f.blocks[b].instructions[k].place; const result: number = f.blocks[b].instructions[k].result;
      if (op == "dropFrame") for (let at: number = 0; at < count; at = at+1) { must[at] = false; may[at] = false; }
      for (const operand of f.blocks[b].instructions[k].operands) if (operand >= 0 && operand < offset && slot[operand] >= 0) { if (!must[slot[operand]]) issues.push(new IrIssue("IR_INVALID","Temporal con ownership consumido o no disponible en todas las rutas",f.blocks[b].instructions[k].source)); must[slot[operand]] = false; may[slot[operand]] = false; }
      if (op == "store" && place >= 0 && slot[offset+place] >= 0) { must[slot[offset+place]] = true; may[slot[offset+place]] = true; }
      if ((op == "move" || op == "dropRemaining") && place >= 0 && slot[offset+place] >= 0) { if (op == "move" && !must[slot[offset+place]]) issues.push(new IrIssue("IR_INVALID","Move de owner no disponible",f.blocks[b].instructions[k].source)); must[slot[offset+place]] = false; may[slot[offset+place]] = false; }
      if (result >= 0 && slot[result] >= 0) { if (may[slot[result]]) issues.push(new IrIssue("IR_INVALID","Temporal owner sobrescrito sin consumo",f.blocks[b].instructions[k].source)); must[slot[result]] = true; may[slot[result]] = true; }
    }
    const returned: number = f.blocks[b].value;
    if ((f.blocks[b].terminator == "return" || f.blocks[b].terminator == "suspend") && returned >= 0 && slot[returned] >= 0) { if (!must[slot[returned]]) issues.push(new IrIssue("IR_INVALID","Retorno de owner consumido",f.blocks[b].source)); may[slot[returned]] = false; }
    if (["return","cancel"].includes(f.blocks[b].terminator)) for (let at: number = 0; at < count; at = at+1) if (may[at]) issues.push(new IrIssue("IR_INVALID","Salida sin consumir o limpiar un recurso",f.blocks[b].source));
  }
  return issues;
}
