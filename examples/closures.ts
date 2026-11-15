function makeAdder(amount: number): (value: number) => number {
  return (value: number): number => value + amount;
}

// Mutable captures stay inside their lifetime; returning this closure would
// leave its reference to count dangling.
function runCounter(start: number): void {
  let count: number = start;
  const counter: () => number = (): number => {
    count = count + 1;
    return count;
  };
  print("Contador: ", counter());
  print("Contador: ", counter());
}

const timesTwo: (value: number) => number = (value: number): number => value * 2;
const addTen: (value: number) => number = makeAdder(10);

print("Doble: ", timesTwo(6));
print("Suma capturada: ", addTen(5));
runCounter(100);
