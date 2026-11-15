import { defineAnswer, printFromDefinition } from "./lib";

defineAnswer();

function run(): void {
  const helper: number = 99;
  const base: string = "caller";
  const value: number = 7;
  print(answer(value: 41));
  printFromDefinition();
}

run();
