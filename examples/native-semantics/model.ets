export class Counter {
  value: number = 0;
  constructor(seed: number) { this.value = seed; }
  add(amount: number): number { this.value += amount; return this.value; }
}
