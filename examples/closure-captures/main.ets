// Los parámetros de lambdas interiores no son capturas de la lambda exterior.
function runDemo(): void {
  const source: number[] = [1, 2, 3];
  const total: number = source.map<number>((x: number): number => [1, 2]
    .filter((n: number): boolean => n > 0)
    .map<number>((n: number): number => n * x)
    .reduce<number>(0, (acc: number, n: number): number => acc + n))
    .reduce<number>(0, (acc: number, n: number): number => acc + n);
  print(total);
  print(source[0]); print(source[1]); print(source[2]);
}

runDemo();
