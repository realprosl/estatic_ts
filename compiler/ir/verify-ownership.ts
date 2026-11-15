import { IrProject, IrFunction, IrInstruction, IrIssue } from "./model";
export class IrOwnershipFacts {
  reachable: boolean; must: boolean[]; may: boolean[];
  constructor(count: number) { this.reachable = false; this.must = []; this.may = []; for (let i: number = 0; i < count; i = i+1) { this.must.push(true); this.may.push(false); } }
}
export function verifyOwnershipRoutes(project: constRef<IrProject>, f: constRef<IrFunction>): IrIssue[] {
  let issues: IrIssue[] = []; const offset: number = f.values.length; const count: number = offset+f.places.length;
  let facts: IrOwnershipFacts[] = []; let tracked: boolean[] = [];
  for (const typeId of f.values) tracked.push(project.typeDefinitions[typeId].resource);
  for (const p of f.places) tracked.push(p.kind == "local" && (p.global) < 0 && project.typeDefinitions[p.typeId].resource);
  for (const b of f.blocks) facts.push(new IrOwnershipFacts(count)); if (facts.length == 0) return issues;
  facts[0].reachable = true; let changed: boolean = true;
  while (changed) {
    changed = false;
    for (let b: number = 0; b < f.blocks.length; b = b+1) {
      let must: boolean[] = []; let may: boolean[] = [];
      for (let at: number = 0; at < count; at = at+1) { const entry: boolean = at >= offset && f.places[at-offset].parameter && tracked[at]; must.push(b == 0 ? entry : true); may.push(b == 0 ? entry : false); }
      for (let predecessor: number = 0; predecessor < f.blocks.length; predecessor = predecessor+1) if (facts[predecessor].reachable && f.blocks[predecessor].targets.includes(b)) {
        if (!facts[b].reachable) { facts[b].reachable = true; changed = true; }
        if (b != 0) for (let at: number = 0; at < count; at = at+1) { must[at] = must[at] && facts[predecessor].must[at]; may[at] = may[at] || facts[predecessor].may[at]; }
      }
      if (!facts[b].reachable) continue;
      for (const i of f.blocks[b].instructions) {
        if (i.op == "dropFrame") for (let at: number = 0; at < count; at = at+1) { must[at] = false; may[at] = false; }
        for (const operand of i.operands) if (operand >= 0 && operand < offset && tracked[operand]) { must[operand] = false; may[operand] = false; }
        if (i.op == "store" && i.place >= 0 && tracked[offset+i.place]) { must[offset+i.place] = true; may[offset+i.place] = true; }
        if ((i.op == "move" || i.op == "dropRemaining") && i.place >= 0 && tracked[offset+i.place]) { must[offset+i.place] = false; may[offset+i.place] = false; }
        if (i.result >= 0 && tracked[i.result]) { must[i.result] = true; may[i.result] = true; }
      }
      if ((f.blocks[b].terminator == "return" || f.blocks[b].terminator == "suspend") && f.blocks[b].value >= 0 && tracked[f.blocks[b].value]) { must[f.blocks[b].value] = false; may[f.blocks[b].value] = false; }
      for (let at: number = 0; at < count; at = at+1) if (facts[b].must[at] != must[at] || facts[b].may[at] != may[at]) { facts[b].must[at] = must[at]; facts[b].may[at] = may[at]; changed = true; }
    }
  }
  for (let b: number = 0; b < f.blocks.length; b = b+1) if (facts[b].reachable) {
    let must: boolean[] = []; let may: boolean[] = [];
    for (let at: number = 0; at < count; at = at+1) { const entry: boolean = at >= offset && f.places[at-offset].parameter && tracked[at]; must.push(b == 0 ? entry : true); may.push(b == 0 ? entry : false); }
    if (b != 0) for (let predecessor: number = 0; predecessor < f.blocks.length; predecessor = predecessor+1) if (facts[predecessor].reachable && f.blocks[predecessor].targets.includes(b)) for (let at: number = 0; at < count; at = at+1) { must[at] = must[at] && facts[predecessor].must[at]; may[at] = may[at] || facts[predecessor].may[at]; }
    for (const i of f.blocks[b].instructions) {
      if (i.op == "dropFrame") for (let at: number = 0; at < count; at = at+1) { must[at] = false; may[at] = false; }
      for (const operand of i.operands) if (operand >= 0 && operand < offset && tracked[operand]) { if (!must[operand]) issues.push(new IrIssue("IR_INVALID","Temporal con ownership consumido o no disponible en todas las rutas",i.source)); must[operand] = false; may[operand] = false; }
      if (i.op == "store" && i.place >= 0 && tracked[offset+i.place]) { must[offset+i.place] = true; may[offset+i.place] = true; }
      if ((i.op == "move" || i.op == "dropRemaining") && i.place >= 0 && tracked[offset+i.place]) { if (i.op == "move" && !must[offset+i.place]) issues.push(new IrIssue("IR_INVALID","Move de owner no disponible",i.source)); must[offset+i.place] = false; may[offset+i.place] = false; }
      if (i.result >= 0 && tracked[i.result]) { if (may[i.result]) issues.push(new IrIssue("IR_INVALID","Temporal owner sobrescrito sin consumo",i.source)); must[i.result] = true; may[i.result] = true; }
    }
    if ((f.blocks[b].terminator == "return" || f.blocks[b].terminator == "suspend") && f.blocks[b].value >= 0 && tracked[f.blocks[b].value]) { if (!must[f.blocks[b].value]) issues.push(new IrIssue("IR_INVALID","Retorno de owner consumido",f.blocks[b].source)); may[f.blocks[b].value] = false; }
    if (["return","cancel"].includes(f.blocks[b].terminator)) for (let at: number = 0; at < count; at = at+1) if (tracked[at] && may[at]) issues.push(new IrIssue("IR_INVALID","Salida sin consumir o limpiar un recurso",f.blocks[b].source));
  }
  return issues;
}
