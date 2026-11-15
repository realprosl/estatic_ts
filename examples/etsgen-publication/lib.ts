const base: number = 7;

function helper(value: number): number {
  return value + 1;
}

@etsgen export function defineAnswer(): string {
  return "@etsPublish function answer(value: number): number { return value + 1; }";
}

@etsgen export function printFromDefinition(): string {
  return "print(etsDefinition(\"helper\", etsCapture(\"value\"))); print(etsDefinition(\"base\"));";
}
