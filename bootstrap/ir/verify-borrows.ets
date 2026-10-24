import { IrProject, IrFunction, IrIssue } from "./model";
import { IrBorrowAnalysis, IrLeaseSet, irLeaseUnion, irLeaseRemove, irLeaseEqual } from "./borrows";
import { irPlacePath } from "./verify-memory";
export function verifyBorrowRoutes(project: constRef<IrProject>, f: IrFunction): IrIssue[] {
  let issues: IrIssue[] = []; let analysis = new IrBorrowAnalysis(f,project.types); analysis.propagate();
  let activeOut: IrLeaseSet[] = []; let reachable: boolean[] = []; for (const block of f.blocks) { activeOut.push(new IrLeaseSet()); reachable.push(false); }
  if (f.blocks.length == 0) return issues; reachable[0] = true;
  let changed: boolean = true;
  while (changed) {
    changed = false;
    for (let b: number = 0; b < f.blocks.length; b = b+1) {
      let active: number[] = [];
      for (let predecessor: number = 0; predecessor < f.blocks.length; predecessor = predecessor+1) if (reachable[predecessor] && f.blocks[predecessor].targets.includes(b)) { if (!reachable[b]) { reachable[b] = true; changed = true; } active = irLeaseUnion(active,activeOut[predecessor].values); }
      if (!reachable[b]) continue;
      for (const i of f.blocks[b].instructions) { if (["borrow","address"].includes(i.op) && i.lease >= 0) active = irLeaseUnion(active,[i.lease]); if (i.op == "endBorrow") active = irLeaseRemove(active,i.lease); }
      if (!irLeaseEqual(active,activeOut[b].values)) { activeOut[b].values = active; changed = true; }
    }
  }
  for (let b: number = 0; b < f.blocks.length; b = b+1) if (reachable[b]) {
    let active: number[] = []; for (let predecessor: number = 0; predecessor < f.blocks.length; predecessor = predecessor+1) if (reachable[predecessor] && f.blocks[predecessor].targets.includes(b)) active = irLeaseUnion(active,activeOut[predecessor].values);
    for (const i of f.blocks[b].instructions) {
      const uses: number[] = analysis.uses(i); for (const lease of uses) if (!active.includes(lease)) issues.push(new IrIssue("IR_INVALID","Uso de préstamo fuera de su duración CFG",i.source));
      if (["borrow","address"].includes(i.op)) {
        if ((i.lease) < 0 || i.lease >= f.leases.length || f.leases[i.lease].value != i.result || f.leases[i.lease].place != i.place) { issues.push(new IrIssue("IR_INVALID","Identidad de préstamo inválida",i.source)); continue; }
        const projectionKey: string = irPlacePath(f,i.place,0);
        for (const previous of active) if (previous >= 0 && previous < f.leases.length) { const key: string = irPlacePath(f,f.leases[previous].place,0); if ((projectionKey == key || projectionKey.startsWith(key+".") || key.startsWith(projectionKey+".")) && (f.leases[previous].mode == "ref" || f.leases[i.lease].mode == "ref") && !uses.includes(previous)) issues.push(new IrIssue("IR_INVALID","Préstamos incompatibles sobre el mismo place",i.source)); }
        active = irLeaseUnion(active,[i.lease]);
      }
      if (["store","move","dropRemaining"].includes(i.op) && i.place >= 0) {
        const projectionKey: string = irPlacePath(f,i.place,0); for (const lease of active) if (lease >= 0 && lease < f.leases.length && !uses.includes(lease)) { const key: string = irPlacePath(f,f.leases[lease].place,0); if (projectionKey == key || projectionKey.startsWith(key+".") || key.startsWith(projectionKey+".")) issues.push(new IrIssue("IR_INVALID","Mutación/move/drop con préstamo activo",i.source)); }
      }
      if (i.op == "endBorrow") { if ((i.lease) < 0 || i.lease >= f.leases.length) issues.push(new IrIssue("IR_INVALID","Fin de préstamo inexistente",i.source)); active = irLeaseRemove(active,i.lease); }
    }
    if (["return","cancel","suspend","trap"].includes(f.blocks[b].terminator) && active.length > 0) issues.push(new IrIssue("IR_INVALID","Salida con préstamos activos",f.blocks[b].source));
  }
  return issues;
}
