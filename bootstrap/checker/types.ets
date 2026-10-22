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
      if (!(next >= 48 && next <= 57)) { result = result + to; at = at + from.length; continue; }
    }
    result = result + text.charAt(at); at = at + 1;
  } return result;
}
