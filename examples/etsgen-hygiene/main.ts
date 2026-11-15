@etsgen
function child(): string {
  return "const value: number = etsCapture(\"value\") + 1; print(value);";
}

@etsgen
function parent(): string {
  return "const value: number = 7; child(); child();";
}

function run(): void {
  const value: number = 99;
  parent();
  parent();
  print(value);
}

run();
