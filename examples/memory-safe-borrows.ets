// Prestamos de corta duracion: ref<T> muta y constRef<T> solo lee.
// El checker evita almacenar el préstamo, retornarlo o cruzar un await.

class Counter {
  value: number;
  constructor(value: number) { this.value = value; }
}

function increment(counter: ref<Counter>): void {
  counter.value = counter.value + 1;
}

function inspect(counter: constRef<Counter>): number {
  return counter.value;
}

let counter: Counter = new Counter(9);
increment(counter);
print(numberToString(inspect(counter)));  // 10
