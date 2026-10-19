const adjustment: number = 1;

function adjust(value: number): number {
  return value + adjustment;
}

function identity<T>(value: T): T {
  return value;
}

function compute<T>(value: T): T {
  print(adjust(7));
  return identity<T>(value);
}

@etsgen export function generate(): string {
  return "print(etsDefinition(\"compute\", 7));";
}
