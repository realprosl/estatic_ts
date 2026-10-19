@etsgen
function emit(): string {
  return "function generated(value: i32): i32 {\n  const numerator: i32 = 5;\n  const denominator: i32 = 2;\n  return value + numerator / denominator;\n}\nprint(generated(3));";
}

emit();
