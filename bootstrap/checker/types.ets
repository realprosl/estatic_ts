// Canonical semantic types. Nominals and type variables use binding identity,
// so identically named declarations from separate modules never coincide.
export function splitTypes(text: string, separator: string): string[] {
  let result: string[] = []; let round: number = 0; let square: number = 0; let angle: number = 0; let start: number = 0;
  for (let i: number = 0; i < text.length; i = i + 1) {
    const c: string = text.charAt(i);
    if (c == "(") round = round + 1; else if (c == ")") round = round - 1;
    else if (c == "[") square = square + 1; else if (c == "]") square = square - 1;
    else if (c == "<") angle = angle + 1; else if (c == ">" && text.charAt(i - 1) != "=") angle = angle - 1;
    else if (c == separator && round == 0 && square == 0 && angle == 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (start < text.length) result.push(text.slice(start, text.length).trim()); return result;
}
export function functionClose(text: string): number {
  if (!text.startsWith("(")) return -1; let depth: number = 0;
  for (let i: number = 0; i < text.length; i = i + 1) {
    if (text.charAt(i) == "(") depth = depth + 1;
    if (text.charAt(i) == ")") { depth = depth - 1; if (depth == 0 && text.slice(i + 1, i + 3) == "=>") return i; }
  } return -1;
}
export function functionParams(text: string): string[] { const close: number = functionClose(text); if (close < 0) { let empty: string[] = []; return empty; } return splitTypes(text.slice(1, close), ","); }
export function functionReturn(text: string): string { const close: number = functionClose(text); return close < 0 ? "!error" : text.slice(close + 3, text.length); }
export function numericType(text: string): boolean { return ["number","i8","u8","i16","u16","i32","u32","i64","u64","f32","f64"].includes(text); }
export function primitiveType(text: string): boolean { return numericType(text) || ["string","boolean","void"].includes(text); }
export function typeCompatible(actual: string, expected: string): boolean {
  if (actual == "!error" || expected == "!error") return true;
  if (actual == expected || (numericType(actual) && numericType(expected))) return true;
  const a: string = memoryMode(actual); const e: string = memoryMode(expected);
  if (e == "readonly") return typeCompatible(memoryInner(actual),memoryInner(expected));
  if (e == "ref" || e == "constRef") {
    if (e == "ref" && readonlyType(actual)) return false;
    return memoryValue(actual) == memoryInner(expected);
  }
  if (a == "ref" || a == "constRef") return typeCompatible(memoryInner(actual),expected);
  const unions: string[] = splitTypes(expected, "|");
  if (unions.length > 1) {
    for (const a of splitTypes(actual, "|")) { let found: boolean = false; for (const b of unions) if (typeCompatible(a, b)) found = true; if (!found) return false; } return true;
  }
  return false;
}
export function replaceType(text: string, from: string, to: string): string {
  // Only replace complete canonical identity tokens, never @1 inside @10.
  let result: string = ""; let at: number = 0;
  while (at < text.length) {
    if (text.slice(at, at + from.length) == from) {
      const next: number = text.charCodeAt(at + from.length);
      if (!(next >= 48 && next <= 57)) { result = result + (functionClose(to) >= 0 && text.slice(at + from.length,at + from.length + 2) == "[]" ? "(" + to + ")" : to); at = at + from.length; continue; }
    }
    result = result + text.charAt(at); at = at + 1;
  } return result;
}

export function memoryMode(text: string): string {
  for (const name of ["ptr","constPtr","ref","constRef","readonly"]) if (text.startsWith(name + "<") && text.endsWith(">")) {
    let depth: number = 0;
    for (let at: number = name.length; at < text.length; at = at + 1) {
      if (text.charAt(at) == "<") depth = depth + 1;
      if (text.charAt(at) == ">") { depth = depth - 1; if (depth == 0) return at == text.length - 1 ? name : ""; }
    }
  } return "";
}
export function memoryInner(text: string): string { const mode: string = memoryMode(text); return mode == "" ? text : text.slice(mode.length+1,text.length-1); }
export function memoryValue(text: string): string { let result: string = text; while (memoryMode(result) != "") result = memoryInner(result); return result; }
export function ownedType(text: string): boolean { return memoryMode(text) == "ptr" || memoryMode(text) == "constPtr"; }
export function borrowedType(text: string): boolean { return memoryMode(text) == "ref" || memoryMode(text) == "constRef"; }
export function readonlyType(text: string): boolean { return ["readonly","constRef","constPtr"].includes(memoryMode(text)); }

export function semanticArray(element: string): string { return functionClose(element) >= 0 ? "(" + element + ")[]" : element + "[]"; }
export function semanticTuple(text: string): boolean {
  if (!text.startsWith("[")) return false;
  let depth: number = 0;
  for (let at: number = 0; at < text.length; at = at + 1) {
    if (text.charAt(at) == "[") depth = depth + 1;
    if (text.charAt(at) == "]") { depth = depth - 1; if (depth == 0) return at == text.length - 1; }
  } return false;
}
export function semanticElement(text: string): string {
  const element: string = text.slice(0,text.length-2);
  if (element.startsWith("(") && element.endsWith(")") && functionClose(element.slice(1,element.length-1)) >= 0) return element.slice(1,element.length-1);
  return element;
}
export function fixedArraySize(text: string): number {
  if (!text.endsWith("]") || functionClose(text) >= 0) return -1;
  const open: number = text.lastIndexOf("["); if (open <= 0) return -1;
  let size: number = 0;
  if (open + 1 == text.length - 1) return -1;
  for (let at: number = open + 1; at < text.length - 1; at = at + 1) {
    const digit: number = text.charCodeAt(at) - 48; if (digit < 0 || digit > 9) return -1;
    size = size * 10 + digit;
  } return size;
}
export function fixedArrayElement(text: string): string {
  const element: string = text.slice(0,text.lastIndexOf("["));
  if (element.startsWith("(") && element.endsWith(")") && functionClose(element.slice(1,element.length-1)) >= 0) return element.slice(1,element.length-1);
  return element;
}
export function semanticFixedArray(element: string, size: number): string {
  return (functionClose(element) >= 0 ? "(" + element + ")" : element) + "[" + numberToString(size) + "]";
}

export function containsMemory(text: string): boolean {
  for (const name of ["ptr","constPtr","ref","constRef","readonly"]) if (text.indexOf(name + "<",0) >= 0) return true;
  return false;
}
export function localBinding(kind: string): boolean { return ["VariableDeclaration","UsingDeclaration","ArrayBinding","ObjectBinding"].includes(kind); }
export function genericBase(text: string): string {
  if (functionClose(text) >= 0) return "";
  const open: number = text.indexOf("<",0); if (open <= 0 || !text.endsWith(">")) return "";
  let depth: number = 0;
  for (let at: number = open; at < text.length; at = at + 1) {
    if (text.charAt(at) == "<") depth = depth + 1;
    if (text.charAt(at) == ">" && text.charAt(at-1) != "=") { depth = depth - 1; if (depth == 0 && at != text.length-1) return ""; }
  }
  return depth == 0 ? text.slice(0,open) : "";
}
export function genericArguments(text: string): string[] {
  const base: string = genericBase(text); if (base == "") { let empty: string[] = []; return empty; }
  return splitTypes(text.slice(base.length+1,text.length-1),",");
}
