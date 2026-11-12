// Values live in an evaluator-owned arena. Aggregate entries are arena indices,
// never AST nodes or JavaScript objects. Exact integers retain all 64 bits.
export class ConstantValue {
  kind: string; typeName: string; text: string; scalar: number; bits: u64;
  entries: number[]; keys: string[]; module: number; node: number; environment: number;
  constructor(kind: string, typeName: string = "") {
    this.kind = kind; this.typeName = typeName; this.text = ""; this.scalar = 0; this.bits = 0;
    this.entries = []; this.keys = []; this.module = -1; this.node = -1; this.environment = -1;
  }
}
export function constantError(code: string, message: string): ConstantValue { let v = new ConstantValue("error",code); v.text = message; return v; }
export function constantNumber(value: number, name: string = "number"): ConstantValue { let v = new ConstantValue("number",name); v.scalar = value; return v; }
export function constantBoolean(value: boolean): ConstantValue { let v = new ConstantValue("boolean","boolean"); v.scalar = (value ? 1 : 0); return v; }
export function constantString(value: string): ConstantValue { let v = new ConstantValue("string","string"); v.text = value; return v; }
export function constantInteger(text: string, name: string): ConstantValue {
  let bits: u64 = 0; const ten: u64 = 10; const zero: u64 = 0;
  for (let at: number = text.charAt(0) == "-" ? 1 : 0; at < text.length; at = at+1) bits = bits*ten + u64(text.charCodeAt(at)-48);
  if (text.charAt(0) == "-") bits = zero-bits;
  let v = new ConstantValue("integer",name); v.bits = bits; return v;
}
export function constantUnsignedDouble(value: u64): number { return value; }
export function constantSignedDouble(value: i64): number { return value; }
export function constantIntegerText(v: ConstantValue): string {
  const zero: u64 = 0; const ten: u64 = 10; const sign: u64 = 9223372036854775808;
  const negative: boolean = v.typeName.startsWith("i") && (v.bits & sign) != zero;
  let bits: u64 = negative ? zero-v.bits : v.bits; let text: string = "";
  while (bits != zero) { text = "0123456789".charAt(constantUnsignedDouble(bits%ten))+text; bits = bits/ten; }
  if (text == "") text = "0"; return negative ? "-"+text : text;
}
export function constantFloat(v: ConstantValue, explicitCast: boolean): ConstantValue {
  if (v.kind != "integer") return v;
  const max: u64 = 9007199254740991; const zero: u64 = 0; const sign: u64 = 9223372036854775808;
  const negative: boolean = v.typeName.startsWith("i") && (v.bits & sign) != zero;
  const magnitude: u64 = negative ? zero-v.bits : v.bits;
  if (!explicitCast && magnitude > max) return constantError("COMPTIME_INTEGER_PRECISION","conversión implícita pierde precisión");
  return constantNumber(negative ? -(constantUnsignedDouble(magnitude)) : constantUnsignedDouble(magnitude));
}
export function constantCast(v: ConstantValue, name: string): ConstantValue {
  if (["number","f32","f64"].includes(name)) {
    if (name == "f32" && v.kind == "integer") {
      let f = constantNumber(0,"f32");
      if (v.typeName.startsWith("i")) { const input: i64 = i64(v.bits); const rounded: f32 = f32(input); f.scalar = rounded; }
      else { const rounded: f32 = f32(v.bits); f.scalar = rounded; } return f;
    }
    let f = constantFloat(v,true); if (f.kind != "number") return f;
    if (name == "f32") { const rounded: f32 = f32(f.scalar); f.scalar = rounded; }
    f.typeName = name; return f;
  }
  if (!["i8","u8","i16","u16","i32","u32","i64","u64"].includes(name)) return v;
  let result = new ConstantValue("integer",name);
  const zero: u64 = 0; const one: u64 = 1; const high: u64 = 9223372036854775808;
  let width: number = name.endsWith("8") ? 8 : name.endsWith("16") ? 16 : name.endsWith("32") ? 32 : 64;
  const mask: u64 = width == 64 ? ~zero : (one << u64(width))-one;
  if (v.kind == "integer") result.bits = v.bits & mask;
  else if (v.kind == "number") {
    if (v.scalar-v.scalar != 0) return constantError("COMPTIME_INTEGER_CAST","entero desde un valor no finito");
    const truncated: number = (v.scalar) < 0 ? Math.ceil(v.scalar) : Math.floor(v.scalar);
    const limit: number = Math.pow(2,name.startsWith("i") ? width-1 : width);
    if ((name.startsWith("i") && (truncated < -limit || truncated >= limit)) || (name.startsWith("u") && (truncated < 0 || truncated >= limit))) return constantError("COMPTIME_INTEGER_CAST_RANGE","conversión fuera de rango");
    result.bits = (truncated < 0 ? zero-u64(-truncated) : u64(truncated));
    result.bits = result.bits & mask;
  } else return constantError("COMPTIME_INTEGER_CAST","valor no numérico");
  const sign: u64 = width == 64 ? high : one << u64(width-1);
  if (name.startsWith("i") && (result.bits & sign) != zero) result.bits = result.bits | ~mask;
  return result;
}
export function constantWord(value: number): i32 {
  if (value-value != 0) return 0;
  let truncated: number = value < 0 ? Math.ceil(value) : Math.floor(value); truncated = truncated%4294967296;
  if (truncated < 0) truncated = truncated+4294967296; if (truncated >= 2147483648) truncated = truncated-4294967296;
  return i32(truncated);
}
export function constantNumeric(left: ConstantValue, right: ConstantValue, op: string, name: string): ConstantValue {
  const compare: boolean = ["==","!=","<","<=",">",">="].includes(op);
  if (left.kind == "integer" && right.kind == "integer") {
    let a: u64 = left.bits; let b: u64 = right.bits; const zero: u64 = 0; const one: u64 = 1; const high: u64 = 9223372036854775808;
    const isUnsigned: boolean = name.startsWith("u");
    if (compare) {
      let yes: boolean = false;
      if (op == "==") yes = a == b; else if (op == "!=") yes = a != b;
      else if (isUnsigned) { if (op == "<") yes = a < b; else if (op == "<=") yes = a <= b; else if (op == ">") yes = a > b; else yes = a >= b; }
      else { const x: i64 = i64(a); const y: i64 = i64(b); if (op == "<") yes = x < y; else if (op == "<=") yes = x <= y; else if (op == ">") yes = x > y; else yes = x >= y; }
      return constantBoolean(yes);
    }
    let bits: u64 = zero; const aSign: boolean = (a & high) != zero; const bSign: boolean = (b & high) != zero;
    if (op == "+" || op == "-") {
      bits = (op == "+" ? a+b : a-b);
      if (!isUnsigned && (op == "+" ? aSign == bSign : aSign != bSign) && ((bits & high) != zero) != aSign) return constantError("COMPTIME_INTEGER_OVERFLOW","desbordamiento firmado");
    } else if (op == "*") {
      const x: u64 = aSign && !isUnsigned ? zero-a : a; const y: u64 = bSign && !isUnsigned ? zero-b : b;
      const limit: u64 = aSign != bSign ? high : high-one;
      if (!isUnsigned && y != zero && x > limit/y) return constantError("COMPTIME_INTEGER_OVERFLOW","multiplicación fuera de rango");
      bits = a*b;
    } else if (op == "/" || op == "%") {
      if (b == zero) return constantError("COMPTIME_INTEGER_DIVISION_ZERO","división por cero");
      if (!isUnsigned && a == high && b == ~zero) return constantError("COMPTIME_INTEGER_OVERFLOW","división o resto fuera de rango");
      else if (isUnsigned) bits = (op == "/" ? a/b : a%b);
      else { const x: i64 = i64(a); const y: i64 = i64(b); const quotient: i64 = op == "/" ? x/y : x%y; bits = u64(quotient); }
    } else if (op == "&") bits = a & b; else if (op == "|") bits = a | b; else if (op == "^") bits = a ^ b;
    else if (op == "<<" || op == ">>") {
      const maxShift: u64 = name == "i64" || name == "u64" ? 64 : 32; if (b >= maxShift) return constantError("COMPTIME_INTEGER_SHIFT","desplazamiento fuera de rango");
      if (op == "<<") bits = a << b; else if (isUnsigned) bits = a >> b; else { const signedValue: i64 = i64(a); bits = (signedValue >> (i64(b))) as u64; }
    } else return constantError("COMPTIME_UNSUPPORTED","operador entero " + op);
    if (name == "i32" && ["+","-","*","/","%"].includes(op)) { const signedResult: i64 = i64(bits); const minimum: i64 = -2147483648; const maximum: i64 = 2147483647; if (signedResult < minimum || signedResult > maximum) return constantError("COMPTIME_INTEGER_OVERFLOW","Aritmética i32 fuera de rango"); }
    let result = new ConstantValue("integer",name); result.bits = bits; return constantCast(result,name);
  }
  const x = constantFloat(left,false); const y = constantFloat(right,false); if (x.kind == "error") return x; if (y.kind == "error") return y;
  const a: number = x.scalar; const b: number = y.scalar;
  if (compare) { if (op == "==") return constantBoolean(a == b); if (op == "!=") return constantBoolean(a != b); if (op == "<") return constantBoolean(a < b); if (op == "<=") return constantBoolean(a <= b); if (op == ">") return constantBoolean(a > b); return constantBoolean(a >= b); }
  if ((op == "/" || op == "%") && b == 0) return constantError("COMPTIME_FLOAT_DIVISION_ZERO","división por cero");
  let value: number = 0;
  if (op == "+") value = a+b; else if (op == "-") value = a-b; else if (op == "*") value = a*b; else if (op == "/") value = a/b; else if (op == "%") value = a%b; else if (op == "**") value = Math.pow(a,b);
  else if (["&","|","^","<<",">>"].includes(op)) {
    const l: i32 = constantWord(a); const r: i32 = constantWord(b); let result: i32 = 0; const shift: i32 = r & 31;
    if (op == "&") result = l & r; else if (op == "|") result = l | r; else if (op == "^") result = l ^ r; else if (op == "<<") result = l << shift; else result = l >> shift;
    value = constantSignedDouble(result);
  } else return constantError("COMPTIME_UNSUPPORTED","operador numérico " + op);
  return constantCast(constantNumber(value),name);
}
