// Canonical semantic types. Nominals and type variables use binding identity,
// so identically named declarations from separate modules never coincide.
export function splitTypes(text: string, separator: string): string[] {
  if ((separator == "|" || separator == "&") && functionClose(text) >= 0) { let callable: string[] = [text]; return callable; }
  let result: string[] = []; let round: number = 0; let square: number = 0; let angle: number = 0; let start: number = 0;
  for (let i: number = 0; i < text.length; i = i + 1) {
    const c: string = text.charAt(i);
    if (c == "(") round = round + 1; else if (c == ")") round = round - 1;
    else if (c == "[") square = square + 1; else if (c == "]") square = square - 1;
    else if (c == "<") angle = angle + 1; else if (c == ">" && text.charAt(i - 1) != "=") angle = angle - 1;
    else if (c == separator && round == 0 && square == 0 && angle == 0) { result.push(separator == "|" || separator == "&" ? ungroupElement(text.slice(start, i).trim()) : text.slice(start, i).trim()); start = i + 1; }
  }
  if (start < text.length) result.push(separator == "|" || separator == "&" ? ungroupElement(text.slice(start, text.length).trim()) : text.slice(start, text.length).trim()); return result;
}
export function joinTypes(parts: string[], separator: string): string {
  if (parts.length == 1) return parts[0];
  let values: string[] = [];
  for (const part of parts) values.push(functionClose(part) >= 0 ? "(" + part + ")" : part);
  return values.join(separator);
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
export function restPosition(text: string): number {
  const params: string[] = functionParams(text);
  for (let at: number = 0; at < params.length; at = at + 1) if (params[at].startsWith("...")) return at;
  return -1;
}
export function argumentType(text: string, spread: boolean): string {
  if (!text.startsWith("...")) return text;
  const array: string = text.slice(3,text.length);
  if (!array.endsWith("[]")) return "";
  return spread ? array : semanticElement(array);
}
export function numericType(text: string): boolean { return ["number","i8","u8","i16","u16","i32","u32","i64","u64","f32","f64"].includes(text); }
export function primitiveType(text: string): boolean { return numericType(text) || ["string","boolean","void"].includes(text); }
// Canonical nominal identities are decimal symbol indices, never source names.
export function canonicalSymbol(text: string): number {
  const open: number = text.indexOf("<",0); const end: number = open >= 0 ? open : text.length;
  if (end < 2 || text.charAt(0) != "#") return -1;
  let result: number = 0;
  for (let at: number = 1; at < end; at = at+1) { const digit: number = text.charCodeAt(at)-48; if (digit < 0 || digit > 9) return -1; result = result*10+digit; if (result > 2147483647) return -1; }
  return result;
}
export function typeCompatible(actual: string, expected: string): boolean {
  if (actual == "!error" || expected == "!error") return true;
  if (actual == expected || (numericType(actual) && numericType(expected))) return true;
  const a: string = memoryMode(actual); const e: string = memoryMode(expected);
  if (e == "readonly") return typeCompatible(memoryInner(actual),memoryInner(expected));
  if (e == "ref" || e == "constRef") {
    if (e == "ref" && readonlyType(actual)) return false;
    return actual == memoryInner(expected) || memoryValue(actual) == memoryInner(expected);
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
      if (!(next >= 48 && next <= 57)) {
        const before: string = at > 0 ? text.charAt(at-1) : ""; const after: string = text.charAt(at+from.length);
        let replacement: string = to;
        if (after == "[") replacement = aggregateElement(to);
        else if (functionClose(to) >= 0 && (before == "|" || before == "&" || after == "|" || after == "&")) replacement = "(" + to + ")";
        result = result + replacement; at = at + from.length; continue;
      }
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

export function aggregateElement(element: string): string {
  return functionClose(element) >= 0 || splitTypes(element,"|").length > 1 || splitTypes(element,"&").length > 1 ? "(" + element + ")" : element;
}
export function ungroupElement(element: string): string {
  if (element.startsWith("(") && element.endsWith(")")) {
    let depth: number = 0;
    for (let at: number = 0; at < element.length; at = at+1) {
      if (element.charAt(at) == "(") depth = depth+1;
      if (element.charAt(at) == ")") { depth = depth-1; if (depth == 0) return at == element.length-1 ? element.slice(1,element.length-1) : element; }
    }
  }
  return element;
}
export function semanticArray(element: string): string { return aggregateElement(element) + "[]"; }
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
  return ungroupElement(element);
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
  return ungroupElement(element);
}
export function semanticFixedArray(element: string, size: number): string {
  return aggregateElement(element) + "[" + numberToString(size) + "]";
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
