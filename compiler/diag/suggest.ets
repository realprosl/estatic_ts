// Sugerencias "¿querías decir ...?" para los diagnósticos: el candidato más
// parecido por distancia de edición (Levenshtein), si se parece lo bastante.
export function editDistance(a: string, b: string): number {
  let previous: number[] = []; for (let j: number = 0; j <= b.length; j = j+1) previous.push(j);
  for (let i: number = 1; i <= a.length; i = i+1) {
    let current: number[] = [i];
    for (let j: number = 1; j <= b.length; j = j+1) {
      const cost: number = a.charCodeAt(i-1) == b.charCodeAt(j-1) ? 0 : 1;
      let best: number = previous[j] + 1; if (current[j-1] + 1 < best) best = current[j-1] + 1; if (previous[j-1] + cost < best) best = previous[j-1] + cost;
      current.push(best);
    }
    previous = current;
  }
  return previous[b.length];
}
// Devuelve "" si ningún candidato está a una distancia razonable: como mucho un
// tercio del nombre (mínimo 1), o si solo difieren en mayúsculas.
export function closestName(name: string, candidates: string[]): string {
  let best: string = ""; let bestDistance: number = 1000;
  const limit: number = name.length < 3 ? 1 : (name.length / 3 < 1 ? 1 : name.length / 3);
  for (const candidate of candidates) {
    if (candidate == name || candidate == "") continue;
    if (candidate.toLowerCase() == name.toLowerCase()) return candidate;
    const distance: number = editDistance(name, candidate);
    if (distance <= limit && distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return best;
}
