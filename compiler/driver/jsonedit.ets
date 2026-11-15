// Edición de JSON / JSONC conservando el formato del usuario (#192).
//
// estatic.config.json y tsconfig.json los escribe la gente a mano: en vez de
// volver a serializarlos (JsonValue ordena las claves y pierde los comentarios
// de tsconfig), se localiza el miembro a cambiar y solo se reescribe ese trozo.
// Todas las funciones devuelven "" o -1 si el texto no se entiende.

function blankChar(c: string): boolean { return c == " " || c == "\n" || c == "\t" || c == "\r"; }

// Salta espacios y comentarios // y /* */.
export function skipBlank(text: string, at: number): number {
  let k: number = at;
  while (k < text.length) {
    const c: string = text.charAt(k);
    if (blankChar(c)) { k = k + 1; continue; }
    if (c == "/" && k + 1 < text.length && text.charAt(k + 1) == "/") { while (k < text.length && text.charAt(k) != "\n") k = k + 1; continue; }
    if (c == "/" && k + 1 < text.length && text.charAt(k + 1) == "*") { const close: number = text.indexOf("*/", k + 2); k = close < 0 ? text.length : close + 2; continue; }
    break;
  }
  return k;
}

function stringEnd(text: string, at: number): number {
  let k: number = at + 1;
  while (k < text.length) {
    const c: string = text.charAt(k);
    if (c == "\\") { k = k + 2; continue; }
    if (c == "\"") return k + 1;
    k = k + 1;
  }
  return -1;
}

// Fin (exclusivo) del valor que empieza en `at`.
export function valueEnd(text: string, at: number): number {
  if (at >= text.length) return -1;
  const first: string = text.charAt(at);
  if (first == "\"") return stringEnd(text, at);
  if (first == "{" || first == "[") {
    let depth: number = 0; let k: number = at;
    while (k < text.length) {
      const c: string = text.charAt(k);
      if (c == "\"") { k = stringEnd(text, k); if (k < 0) return -1; continue; }
      if (c == "/" && k + 1 < text.length && (text.charAt(k + 1) == "/" || text.charAt(k + 1) == "*")) { k = skipBlank(text, k); continue; }
      if (c == "{" || c == "[") depth = depth + 1;
      else if (c == "}" || c == "]") { depth = depth - 1; if (depth == 0) return k + 1; }
      k = k + 1;
    }
    return -1;
  }
  let k: number = at;
  while (k < text.length) { const c: string = text.charAt(k); if (c == "," || c == "}" || c == "]" || c == "/" || blankChar(c)) break; k = k + 1; }
  return k == at ? -1 : k;
}

export class JsonMember {
  valid: boolean; found: boolean; valueStart: number; valueEnd: number; close: number; firstStart: number; lastEnd: number; lastComma: number;
  constructor() { this.valid = false; this.found = false; this.valueStart = -1; this.valueEnd = -1; this.close = -1; this.firstStart = -1; this.lastEnd = -1; this.lastComma = -1; }
}

// Busca `key` en el objeto cuya '{' está en `open`.
export function findMember(text: string, open: number, key: string): JsonMember {
  let member: JsonMember = new JsonMember();
  if (open < 0 || open >= text.length || text.charAt(open) != "{") return member;
  let k: number = skipBlank(text, open + 1);
  while (k < text.length && text.charAt(k) != "}") {
    if (text.charAt(k) != "\"") return member;
    const keyEnd: number = stringEnd(text, k); if (keyEnd < 0) return member;
    const name: string = text.slice(k + 1, keyEnd - 1);
    if (member.firstStart < 0) member.firstStart = k;
    let at: number = skipBlank(text, keyEnd); if (at >= text.length || text.charAt(at) != ":") return member;
    at = skipBlank(text, at + 1);
    const end: number = valueEnd(text, at); if (end < 0) return member;
    if (name == key && !member.found) { member.found = true; member.valueStart = at; member.valueEnd = end; }
    member.lastEnd = end; member.lastComma = -1;
    k = skipBlank(text, end);
    if (k < text.length && text.charAt(k) == ",") { member.lastComma = k; k = skipBlank(text, k + 1); }
  }
  if (k >= text.length) return member;
  member.close = k; member.valid = true; return member;
}

function lineIndent(text: string, at: number): string {
  let start: number = at; while (start > 0 && text.charAt(start - 1) != "\n") start = start - 1;
  let k: number = start; while (k < text.length && (text.charAt(k) == " " || text.charAt(k) == "\t")) k = k + 1;
  return text.slice(start, k);
}

// '{' del objeto raíz: JSON puro o `export default { ... }` (estatic.config.ts).
export function rootObject(text: string): number {
  const k: number = skipBlank(text, 0);
  if (k < text.length && text.charAt(k) == "{") return k;
  const at: number = text.indexOf("export default", 0); if (at < 0) return -1;
  const start: number = skipBlank(text, at + 14);
  return start < text.length && text.charAt(start) == "{" ? start : -1;
}

// Escribe `"key": valueText` en el objeto de `open` (reemplaza o añade al final).
export function setMember(text: string, open: number, key: string, valueText: string): string {
  const member: JsonMember = findMember(text, open, key); if (!member.valid) return "";
  if (member.found) return text.slice(0, member.valueStart) + valueText + text.slice(member.valueEnd, text.length);
  const indent: string = member.firstStart >= 0 && lineIndent(text, member.firstStart) != lineIndent(text, open) ? lineIndent(text, member.firstStart) : lineIndent(text, open) + "  ";
  const entry: string = "\n" + indent + JSON.stringify(key) + ": " + valueText;
  if (member.lastEnd < 0) return text.slice(0, open + 1) + entry + "\n" + lineIndent(text, open) + text.slice(member.close, text.length);
  if (member.lastComma >= 0) return text.slice(0, member.lastComma + 1) + entry + "," + text.slice(member.lastComma + 1, text.length);
  return text.slice(0, member.lastEnd) + "," + entry + text.slice(member.lastEnd, text.length);
}

// Garantiza que `key` sea un objeto dentro de `open` y devuelve el texto nuevo.
export function ensureObject(text: string, open: number, key: string): string {
  const member: JsonMember = findMember(text, open, key); if (!member.valid) return "";
  if (member.found) return text.charAt(member.valueStart) == "{" ? text : "";
  return setMember(text, open, key, "{}");
}

// '{' del objeto `key` dentro de `open`, o -1.
export function memberObject(text: string, open: number, key: string): number {
  const member: JsonMember = findMember(text, open, key);
  if (!member.valid || !member.found || text.charAt(member.valueStart) != "{") return -1;
  return member.valueStart;
}
