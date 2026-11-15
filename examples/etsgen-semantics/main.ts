@etsgen
function emit(): string {
  return "const xs: number[] = [1, 2]; const ys: number[] = xs.map<number>((x: number): number => x + 1); print(base + ys[0]);";
}

function runDemo(): void {
  const base: number = 10;
  emit();
}

runDemo();
