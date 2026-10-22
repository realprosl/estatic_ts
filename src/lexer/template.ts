import type { Position } from "../core/span.ts";

export interface TemplateRange { start: number; end: number }
export interface TemplateScan {
  end: number;
  parts: TemplateRange[];
  expressions: TemplateRange[];
  error?: string;
}

// A zero frame is template text; a positive frame is an interpolation's
// brace depth. Strings and comments shield punctuation. No recursive calls.
// Offsets index UTF-16 code units, like the host lexer and source spans.
export function scanTemplate(source: string, start = 0): TemplateScan {
  const frames = [0], parts: TemplateRange[] = [], expressions: TemplateRange[] = [];
  let cursor = start + 1, part = cursor, expression = cursor;
  const fail = (error: string): TemplateScan => ({ end: source.length, parts, expressions, error });
  const push = (depth: number): boolean => {
    if (frames.length >= 128) return false;
    frames.push(depth); return true;
  };
  while (cursor < source.length) {
    const top = frames.length - 1, depth = frames[top];
    const c = source[cursor], next = source[cursor + 1];
    if (depth === 0) {
      if (c === "\\") { cursor = Math.min(cursor + 2, source.length); continue; }
      if (c === "`") {
        frames.pop(); cursor++;
        if (!frames.length) { parts.push({ start: part, end: cursor - 1 }); return { end: cursor, parts, expressions }; }
      } else if (c === "$" && next === "{") {
        if (frames.length === 1) { parts.push({ start: part, end: cursor }); expression = cursor + 2; }
        if (!push(1)) return fail("Límite de anidamiento de templates (128)");
        cursor += 2;
      } else cursor++;
    } else if (c === "'" || c === '"') {
      const quote = c; cursor++;
      while (cursor < source.length && source[cursor] !== quote && source[cursor] !== "\n") {
        if (source[cursor] === "\\") {
          cursor++; if (source[cursor] === "\n") break;
        }
        if (cursor < source.length) cursor++;
      }
      if (source[cursor] !== quote) return fail("Cadena sin cerrar en interpolación");
      cursor++;
    } else if (c === "/" && next === "/") {
      cursor += 2; while (cursor < source.length && source[cursor] !== "\n") cursor++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", cursor + 2);
      if (end < 0) return fail("Comentario sin cerrar en interpolación");
      cursor = end + 2;
    } else if (c === "`") {
      if (!push(0)) return fail("Límite de anidamiento de templates (128)");
      cursor++;
    } else {
      if (c === "{") frames[top]++;
      if (c === "}") {
        frames[top]--;
        if (frames[top] === 0) {
          frames.pop();
          if (frames.length === 1) { expressions.push({ start: expression, end: cursor }); part = cursor + 1; }
        }
      }
      cursor++;
    }
  }
  return fail(frames.at(-1)! > 0 ? "Interpolación sin cerrar" : "Template sin cerrar");
}

// Index every original code unit, including both halves of astral characters.
export function templatePositions(source: string, start: Position): Position[] {
  const positions = [{ ...start }]; let position = start;
  for (let i = 0; i < source.length; i++) {
    position = { offset: position.offset + 1, line: position.line + (source[i] === "\n" ? 1 : 0), column: source[i] === "\n" ? 1 : position.column + 1 };
    positions.push(position);
  }
  return positions;
}
