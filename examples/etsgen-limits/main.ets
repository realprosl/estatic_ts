@etsgen
function emitNumber(value: number): string {
  return `print(${value});`;
}

@etsgen
function emitNested(value: number): string {
  return emitNumber(value);
}

emitNested(7);
emitNested(8);
