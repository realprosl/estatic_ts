type Reader = () => number;

// Cada lector guarda value por valor, no una referencia al parámetro local.
function makeReaders(value: number): Reader[] {
  let readers: Reader[] = [];
  readers.push((): number => value + 1);
  return readers;
}

const readers: Reader[] = makeReaders(7);
const reader: Reader = readers[0];
print(reader()); print(reader());
