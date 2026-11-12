import { primitiveType } from "../checker/types";
import { IrProject, IrFunction, IrInstruction, IrBlock, IrLease } from "./model";
export class IrLeaseSet { values: number[]; constructor() { this.values = []; } }
export function irLeaseUnion(left: number[], right: number[]): number[] { for (const value of right) if (!left.includes(value)) left.push(value); return left; }
export function irLeaseEqual(left: number[], right: number[]): boolean { if (left.length != right.length) return false; for (const value of left) if (!right.includes(value)) return false; return true; }
export function irLeaseRemove(values: number[], value: number): number[] { let result: number[] = []; for (const item of values) if (item != value) result.push(item); return result; }
export class IrBorrowAnalysis {
  typeNames: string[];
  body: IrFunction; values: IrLeaseSet[]; places: IrLeaseSet[]; liveIn: IrLeaseSet[]; liveOut: IrLeaseSet[];
  constructor(input: IrFunction, typeNames: string[]) { this.typeNames = typeNames; this.body = input; this.values = []; this.places = []; this.liveIn = []; this.liveOut = []; for (const v of input.values) this.values.push(new IrLeaseSet()); for (const p of input.places) this.places.push(new IrLeaseSet()); for (const b of input.blocks) { this.liveIn.push(new IrLeaseSet()); this.liveOut.push(new IrLeaseSet()); } }
  placeUses(place: number): number[] {
    let result: number[] = []; let count: number = 0;
    while (place >= 0 && place < this.body.places.length && count < this.body.places.length) { result = irLeaseUnion(result,this.places[place].values); place = this.body.places[place].base; count = count+1; }
    return result;
  }
  uses(i: IrInstruction): number[] {
    let result: number[] = []; for (const operand of i.operands) if (operand >= 0 && operand < this.values.length) result = irLeaseUnion(result,this.values[operand].values);
    if (i.place >= 0) result = irLeaseUnion(result,this.placeUses(i.place)); return result;
  }
  propagate(): void {
    for (let lease: number = 0; lease < this.body.leases.length; lease = lease+1) if (this.body.leases[lease].value >= 0 && (this.body.leases[lease].value) < this.values.length) this.values[this.body.leases[lease].value].values.push(lease);
    let changed: boolean = true;
    while (changed) {
      changed = false;
      for (const block of this.body.blocks) for (const i of block.instructions) {
        let values: number[] = [];
        if (["load","move"].includes(i.op) && i.place >= 0) values = this.placeUses(i.place);
        if (["convert","closure","aggregate","record","own"].includes(i.op)) for (const operand of i.operands) if (operand >= 0 && operand < this.values.length) values = irLeaseUnion(values,this.values[operand].values);
        if (i.op == "store" && i.place >= 0 && i.operands.length == 1 && i.operands[0] >= 0) {
          const next: number[] = irLeaseUnion(this.places[i.place].values,this.values[i.operands[0]].values); if (!irLeaseEqual(next,this.places[i.place].values)) { this.places[i.place].values = next; changed = true; }
        }
        if (i.result >= 0 && (i.result) < this.values.length && !primitiveType(this.typeNames[this.body.values[i.result]])) { const next: number[] = irLeaseUnion(this.values[i.result].values,values); if (!irLeaseEqual(next,this.values[i.result].values)) { this.values[i.result].values = next; changed = true; } }
      }
    }
  }
  liveness(): void {
    let changed: boolean = true;
    while (changed) {
      changed = false;
      for (let b: number = this.body.blocks.length-1; b >= 0; b = b-1) {
        let outgoing: number[] = []; for (const target of this.body.blocks[b].targets) outgoing = irLeaseUnion(outgoing,this.liveIn[target].values);
        let live: number[] = outgoing;
        if (this.body.blocks[b].value >= 0) live = irLeaseUnion(live,this.values[this.body.blocks[b].value].values);
        for (let at: number = this.body.blocks[b].instructions.length-1; at >= 0; at = at-1) {
          const i = this.body.blocks[b].instructions[at]; if (i.lease >= 0 && (i.op == "borrow" || i.op == "address")) live = irLeaseRemove(live,i.lease); live = irLeaseUnion(live,this.uses(i));
        }
        if (!irLeaseEqual(live,this.liveIn[b].values) || !irLeaseEqual(outgoing,this.liveOut[b].values)) { this.liveIn[b].values = live; this.liveOut[b].values = outgoing; changed = true; }
      }
    }
  }
}
export function finishBorrows(project: IrProject): IrProject {
  for (let f: number = 0; f < project.functions.length; f = f+1) {
    for (let b: number = 0; b < project.functions[f].blocks.length; b = b+1) for (let at: number = 0; at < project.functions[f].blocks[b].instructions.length; at = at+1) {
      const i = project.functions[f].blocks[b].instructions[at]; if (i.op == "borrow" || i.op == "address") { const lease: number = project.functions[f].leases.length; project.functions[f].leases.push(new IrLease(i.place,i.result,i.op == "borrow" && i.text == "constRef" ? "constRef" : "ref")); project.functions[f].blocks[b].instructions[at].lease = lease; }
    }
    let analysis = new IrBorrowAnalysis(project.functions[f],project.types); analysis.propagate(); analysis.liveness();
    const count: number = project.functions[f].blocks.length;
    for (let b: number = 0; b < count; b = b+1) {
      const original = project.functions[f].blocks[b]; let after: IrLeaseSet[] = []; for (const i of original.instructions) after.push(new IrLeaseSet());
      let live: number[] = analysis.liveOut[b].values; if (original.value >= 0) live = irLeaseUnion(live,analysis.values[original.value].values);
      for (let at: number = original.instructions.length-1; at >= 0; at = at-1) { after[at].values = live; const i = original.instructions[at]; if (i.lease >= 0 && ["borrow","address"].includes(i.op)) live = irLeaseRemove(live,i.lease); live = irLeaseUnion(live,analysis.uses(i)); }
      let instructions: IrInstruction[] = [];
      for (let at: number = 0; at < original.instructions.length; at = at+1) {
        const i = original.instructions[at]; instructions.push(i); let used: number[] = analysis.uses(i); if (i.lease >= 0) used = irLeaseUnion(used,[i.lease]);
        for (const lease of used) if (!after[at].values.includes(lease)) { let end = new IrInstruction("endBorrow",-1,-1,i.source); end.lease = lease; instructions.push(end); }
      }
      project.functions[f].blocks[b].instructions = instructions;
      for (let edge: number = 0; edge < original.targets.length; edge = edge+1) {
        const target: number = original.targets[edge]; let ends: number[] = []; for (const lease of analysis.liveOut[b].values) if (!analysis.liveIn[target].values.includes(lease)) ends.push(lease);
        if (ends.length > 0) { let block = new IrBlock(original.source); for (const lease of ends) { let end = new IrInstruction("endBorrow",-1,-1,original.source); end.lease = lease; block.instructions.push(end); } block.terminator = "jump"; block.targets = [target]; const index: number = project.functions[f].blocks.length; project.functions[f].blocks.push(block); project.functions[f].blocks[b].targets[edge] = index; }
      }
    }
  }
  return project;
}
