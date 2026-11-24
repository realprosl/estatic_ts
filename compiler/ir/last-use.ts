import { IrProject } from "./model";

// Último uso → movimiento (#351). Con semántica de valores, leer una variable
// local la copia. Si nadie vuelve a leerla, la copia es innecesaria: el `load`
// se convierte en `move` y el valor se traslada (en C++, `take()` en vez de
// `get()`). Sin esto, pasar el grafo de módulos de una fase a otra lo copiaba
// entero cada vez.
//
// Solo se aplica a variables locales enteras (no proyecciones, globales,
// capturas ni readonly) que nunca se prestan en la función, y de tipos que no
// son escalares, referencias, funciones ni recursos. La verificación de la IR
// rechaza cualquier lectura posterior de un place movido, así que un error aquí
// no produce código incorrecto: se detecta como IR_INVALID.
const fixedKinds: string[] = ["scalar","literal","ref","constRef","ptr","constPtr","readonly","function","enum","parameter","invalid","pending","Promise","iterator"];

export function moveLastUses(project: ref<IrProject>): void {
  for (let f: number = 0; f < project.functions.length; f = f+1) if (!project.functions[f].asynchronous) moveInFunction(project,f);
}

function moveInFunction(project: ref<IrProject>, f: number): void {
  const places: number = project.functions[f].places.length; const blocks: number = project.functions[f].blocks.length;
  if (places == 0 || blocks == 0) return;
  // Raíz de cada place y variables candidatas.
  let root: number[] = []; let candidate: boolean[] = [];
  for (let p: number = 0; p < places; p = p+1) {
    let at: number = p; let steps: number = 0;
    while (project.functions[f].places[at].base >= 0 && project.functions[f].places[at].base < at && steps < places) { at = project.functions[f].places[at].base; steps = steps+1; }
    root.push(project.functions[f].places[at].base >= 0 ? -1 : at);
    const typeId: number = project.functions[f].places[p].typeId;
    const movable: boolean = typeId >= 0 && typeId < project.typeDefinitions.length && !project.typeDefinitions[typeId].resource && !fixedKinds.includes(project.typeDefinitions[typeId].kind);
    candidate.push(project.functions[f].places[p].kind == "local" && project.functions[f].places[p].base < 0 && project.functions[f].places[p].global < 0 && !project.functions[f].places[p].readOnly && movable);
  }
  let any: boolean = false;
  for (let b: number = 0; b < blocks; b = b+1) for (let at: number = 0; at < project.functions[f].blocks[b].instructions.length; at = at+1) {
    const place: number = project.functions[f].blocks[b].instructions[at].place; if (place < 0 || place >= places || root[place] < 0) continue;
    const op: string = project.functions[f].blocks[b].instructions[at].op;
    if (op != "load" && op != "store") candidate[root[place]] = false; // préstamos, iteradores, movimientos...
  }
  for (let p: number = 0; p < places; p = p+1) if (candidate[p]) any = true;
  if (!any) return;
  // Vivacidad hacia atrás hasta el punto fijo: live[b*places+p] = p vivo a la entrada de b.
  let live: boolean[] = []; for (let at: number = 0; at < blocks*places; at = at+1) live.push(false);
  let changed: boolean = true;
  while (changed) {
    changed = false;
    for (let b: number = blocks-1; b >= 0; b = b-1) {
      let current: boolean[] = liveOut(project,f,b,live,places);
      for (let at: number = project.functions[f].blocks[b].instructions.length-1; at >= 0; at = at-1) step(project,f,b,at,root,candidate,current);
      for (let p: number = 0; p < places; p = p+1) if (current[p] && !live[b*places+p]) { live[b*places+p] = true; changed = true; }
    }
  }
  // Un `load` de la variable entera es su último uso si no está viva justo después.
  for (let b: number = 0; b < blocks; b = b+1) {
    let current: boolean[] = liveOut(project,f,b,live,places);
    for (let at: number = project.functions[f].blocks[b].instructions.length-1; at >= 0; at = at-1) {
      const place: number = project.functions[f].blocks[b].instructions[at].place;
      if (project.functions[f].blocks[b].instructions[at].op == "load" && place >= 0 && place < places && root[place] == place && candidate[place] && !current[place]) {
        project.functions[f].blocks[b].instructions[at].op = "move"; project.functions[f].blocks[b].instructions[at].effects = ["transfer"];
      }
      step(project,f,b,at,root,candidate,current);
    }
  }
}

function liveOut(project: constRef<IrProject>, f: number, b: number, live: constRef<boolean[]>, places: number): boolean[] {
  let current: boolean[] = []; for (let p: number = 0; p < places; p = p+1) current.push(false);
  for (let t: number = 0; t < project.functions[f].blocks[b].targets.length; t = t+1) {
    const target: number = project.functions[f].blocks[b].targets[t]; if (target < 0 || target >= project.functions[f].blocks.length) continue;
    for (let p: number = 0; p < places; p = p+1) if (live[target*places+p]) current[p] = true;
  }
  return current;
}

// Efecto de una instrucción sobre la vivacidad (de abajo arriba): una escritura
// de la variable entera la mata; cualquier otro acceso a ella o a una de sus
// proyecciones la usa.
function step(project: constRef<IrProject>, f: number, b: number, at: number, root: constRef<number[]>, candidate: constRef<boolean[]>, current: ref<boolean[]>): void {
  const place: number = project.functions[f].blocks[b].instructions[at].place;
  if (place < 0 || place >= root.length || root[place] < 0 || !candidate[root[place]]) return;
  if (project.functions[f].blocks[b].instructions[at].op == "store" && root[place] == place) current[place] = false;
  else current[root[place]] = true;
}
