// Cada etapa termina antes de comenzar la siguiente; source no se consume.
function runDemo(): void {
  const source: number[] = [1, 2, 3];
  const minimum: number = 1;
  const factor: number = 10;
  const initial: number = 5;
  const result: number = source
    .filter((x: number): boolean => x > minimum)
    .map<number>((x: number): number => x * factor)
    .reduce<number>(initial, (total: number, x: number): number => total + x);
  print(result);
  print(source[0]); print(source[1]); print(source[2]);
}

runDemo();
