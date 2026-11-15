import { IrFunction } from "./model";
import { irConstantIndex } from "./verify-shapes";
export function irPlacePath(f: constRef<IrFunction>, place: number, depth: number): string {
  if (place < 0 || place >= f.places.length || depth > f.places.length) return "invalid";
  const p = f.places[place];
  if ((p.base) < 0) return "p"+numberToString(place);
  const base: string = irPlacePath(f,p.base,depth+1);
  if (p.kind == "field") return base+".f"+numberToString(p.field);
  if (p.kind == "deref") return base+".d";
  if (p.kind == "index") { const constant: number = irConstantIndex(f,p.index); return base+".i"+(constant >= 0 ? numberToString(constant) : "v"+numberToString(p.index)); }
  return base;
}
export function irInitialPlace(f: constRef<IrFunction>, place: number): boolean {
  let root: number = place; let steps: number = 0;
  while (f.places[root].base >= 0 && (f.places[root].base) < root && steps < f.places.length) { root = f.places[root].base; steps = steps+1; }
  return f.places[root].parameter || f.places[root].global >= 0 || f.places[root].kind == "capture";
}
