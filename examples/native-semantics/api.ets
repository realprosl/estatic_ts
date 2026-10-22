import { Counter } from "./model";

export function make(seed: number): ptr<Counter> {
  let owner: ptr<Counter> = new Counter(seed);
  return move(owner);
}

export function reader(value: number): () => number {
  return (): number => value;
}
