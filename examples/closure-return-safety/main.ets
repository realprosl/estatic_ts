// Una closure devuelta puede conservar una copia de solo lectura.
function makeReader(value: number): () => number {
  return (): number => value + 1;
}

function runDemo(): void {
  let value: number = 0;
  // La mutacion por referencia se mantiene dentro del lifetime del local.
  const increment: () => number = (): number => { value += 1; return value; };
  print(increment()); print(increment()); print(value);
  const read: () => number = makeReader(7);
  print(read()); print(read());
}

runDemo();
