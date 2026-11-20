// generate-estatic-modules-dts.ts — genera los bloques `declare module "estatic:*"`
// de `types/estatic.d.ts` a partir de las librerías del runtime (`runtime/lib/`).
//
// Por qué generarlos: el `.d.ts` es la única fuente canónica que `etsc init`
// copia a los proyectos, así que si las declaraciones se escriben a mano se
// quedan atrás en cuanto una librería cambia su API. Aquí se derivan del
// código, y `--check` falla si el `.d.ts` no está al día.
//
// Detalles que condicionan el formato:
//   - En un contexto ambiental no hay `async` (lo dice el tipo de retorno) ni
//     valores por defecto en los parámetros (se vuelven `?`).
//   - TypeScript NO resuelve un import entre dos módulos ambientales del
//     mismo archivo, así que los tipos que una librería toma de otra se
//     copian dentro de su bloque (locales, sin `export`).
//
// Uso:
//   node --experimental-strip-types scripts/generate-estatic-modules-dts.ts           # escribe
//   node --experimental-strip-types scripts/generate-estatic-modules-dts.ts --check   # solo verifica
//
// Salida: exit 0 si pasa; exit 1 + el motivo si el `.d.ts` está desfasado.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const LIB_DIR = "runtime/lib";
const DTS = "types/estatic-modules.d.ts";
// El fichero es un SCRIPT (sin import/export en la raiz): asi sus bloques
// `declare module "estatic:*"` son declaraciones ambientales de verdad. En un
// fichero que sea modulo (como types/estatic.d.ts) TS las trataria como
// augmentaciones y no resolveria `import ... from "estatic:math"`.

// ─── Utilidades de texto ────────────────────────────────────────────────────

// Índice de la llave que cierra la de `open` (o -1).
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at = at + 1) {
    if (text[at] == "{") depth = depth + 1;
    if (text[at] == "}") { depth = depth - 1; if (depth == 0) return at; }
  }
  return -1;
}

// El cuerpo de una declaración con llaves: lo que hay entre la primera `{` y
// su llave de cierre.
function bodyOf(text: string): string {
  const open = text.indexOf("{");
  if (open < 0) return "";
  const close = matchBrace(text, open);
  if (close < 0) return "";
  return text.slice(open + 1, close);
}

// Separa los miembros de un cuerpo de clase por `;` o `}` de nivel superior.
function splitMembers(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let at = 0; at < body.length; at = at + 1) {
    const char = body[at];
    if (char == "{") depth = depth + 1;
    if (char == "}") depth = depth - 1;
    if ((char == ";" || char == "}") && depth == 0) {
      const member = current.trim();
      if (member != "") out.push(member);
      current = "";
      continue;
    }
    current = current + char;
  }
  const rest = current.trim();
  if (rest != "") out.push(rest);
  return out;
}

// Divide una lista de parámetros por comas de nivel superior.
function splitParams(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char == "(" || char == "<" || char == "[" || char == "{") depth = depth + 1;
    if (char == ")" || char == ">" || char == "]" || char == "}") depth = depth - 1;
    if (char == "," && depth == 0) { out.push(current.trim()); current = ""; continue; }
    current = current + char;
  }
  if (current.trim() != "") out.push(current.trim());
  return out;
}

// En una declaración ambiental no vale un valor por defecto: se convierte en
// un parámetro opcional (`x: number = 1` -> `x?: number`).
function ambientParams(text: string): string {
  return splitParams(text).map((param) => {
    const match = /^([A-Za-z_$][\w$]*)\s*:\s*(.+?)\s*=\s*.+$/.exec(param);
    if (!match) return param;
    return match[1] + "?: " + match[2];
  }).join(", ");
}

// Quita los comentarios de línea de un texto, sin tocar los `//` que están
// dentro de una cadena.
function stripComments(text: string): string {
  let out = "";
  let quote = "";
  for (let at = 0; at < text.length; at = at + 1) {
    const char = text[at];
    if (quote != "") {
      out = out + char;
      if (char == "\\") { out = out + (text[at + 1] ?? ""); at = at + 1; continue; }
      if (char == quote) quote = "";
      continue;
    }
    if (char == "\"" || char == "'" || char == "`") { quote = char; out = out + char; continue; }
    if (char == "/" && text[at + 1] == "/") {
      while (at < text.length && text[at] != "\n") at = at + 1;
      out = out + "\n";
      continue;
    }
    out = out + char;
  }
  return out;
}

// Un miembro de clase: campo, método o constructor -> declaración ambiental.
function ambientMember(member: string): string | null {
  const text = stripComments(member).trim();
  if (text == "") return null;
  // Un campo puede llevar un inicializador con parentesis (`x: number = f()`),
  // asi que se reconoce antes que un metodo.
  const field = /^(static\s+)?([A-Za-z_$][\w$]*)\s*:\s*([^;]+)$/.exec(text);
  if (field) {
    const type = field[3].replace(/=\s*.+$/, "").trim();
    return "  " + (field[1] ?? "") + field[2] + ": " + type + ";";
  }
  const open = text.indexOf("(");
  if (open >= 0) {
    let depth = 0;
    let close = -1;
    for (let at = open; at < text.length; at = at + 1) {
      if (text[at] == "(") depth = depth + 1;
      if (text[at] == ")") { depth = depth - 1; if (depth == 0) { close = at; break; } }
    }
    if (close < 0) return null;
    // La cabecera puede llevar modificadores (`static`), parametros de tipo
    // (`<T>`) y el nombre: `static stringify<T>`.
    const head = text.slice(0, open).trim().replace(/\basync\s+/, "");
    const genericAt = head.indexOf("<");
    const base = genericAt >= 0 ? head.slice(0, genericAt) : head;
    const generics = genericAt >= 0 ? head.slice(genericAt) : "";
    const name = base.split(/\s+/).pop() ?? "";
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    const modifiers = base.slice(0, base.length - name.length);
    const params = ambientParams(text.slice(open + 1, close));
    // El tipo de retorno va hasta la llave del cuerpo (o hasta el fin).
    const rest = text.slice(close + 1);
    const bodyAt = rest.indexOf("{");
    const tail = (bodyAt < 0 ? rest : rest.slice(0, bodyAt)).trim();
    const colon = tail.indexOf(":");
    const result = colon >= 0 ? tail.slice(0, colon).trim() + ": " + tail.slice(colon + 1).trim() : "";
    return "  " + modifiers + name + generics + "(" + params + ")" + result + ";";
  }
  return null;
}

// ─── Lectura de una librería ────────────────────────────────────────────────

type Entity = { name: string; text: string; isDefault?: boolean };
type Lib = { module: string; file: string; entities: Entity[]; imports: { from: string; names: { imported: string; local: string }[] }[] };

function libFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { out.push(...libFiles(path)); continue; }
    if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out.sort();
}

// El nombre del módulo `estatic:*` de un fichero de `runtime/lib`.
function moduleOf(file: string): string {
  return "estatic:" + relative(LIB_DIR, file).replace(/\.ts$/, "").replace(/\\/g, "/");
}

function readLib(file: string): Lib {
  const source = stripComments(readFileSync(join(ROOT, file), "utf-8"));
  const entities: Entity[] = [];
  const imports: Lib["imports"] = [];
  let at = 0;

  while (at < source.length) {
    const rest = source.slice(at);
    const lineEnd = rest.indexOf("\n");
    const line = lineEnd < 0 ? rest : rest.slice(0, lineEnd);
    const trimmed = line.trim();

    const importLine = /^import\s+(.+?)\s+from\s+"(.+)";\s*$/.exec(trimmed);
    if (importLine) {
      const specifier = importLine[2];
      // Los imports del prelude son globales (se cargan siempre).
      if (!specifier.includes("../prelude/")) {
        const names: { imported: string; local: string }[] = [];
        const braces = /\{([^}]*)\}/.exec(importLine[1]);
        if (braces) {
          for (const part of braces[1].split(",")) {
            const spec = part.trim();
            if (spec == "") continue;
            const alias = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(spec);
            if (alias) names.push({ imported: alias[1], local: alias[2] });
            else names.push({ imported: spec, local: spec });
          }
        }
        imports.push({ from: specifier, names });
      }
      at = at + line.length + 1;
      continue;
    }

    // Decoradores y comentarios: se saltan.
    if (trimmed.startsWith("@") || trimmed.startsWith("//") || trimmed == "") { at = at + line.length + 1; continue; }

    // interface: se copia el cuerpo tal cual (ya es TS ambiental válido).
    const interfaceLine = /^export interface ([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (interfaceLine) {
      const open = source.indexOf("{", at);
      const close = matchBrace(source, open);
      const text = source.slice(at, close + 1);
      entities.push({ name: interfaceLine[1], text: "  " + text.replace(/\n/g, "\n  ").trimEnd() });
      at = close + 1;
      continue;
    }

    // class: se traducen sus miembros.
    const classLine = /^export (default )?class ([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (classLine) {
      const open = source.indexOf("{", at);
      const close = matchBrace(source, open);
      const header = source.slice(at, open).trim();
      const lines = ["  " + header + " {"];
      for (const member of splitMembers(bodyOf(source.slice(open, close + 1)))) {
        const ambient = ambientMember(member);
        if (ambient != null) lines.push(ambient);
      }
      lines.push("  }");
      entities.push({ name: classLine[2], text: lines.join("\n"), isDefault: classLine[1] == "default " });
      at = close + 1;
      continue;
    }

    // function: se queda con la firma.
    const functionLine = /^export (default )?(async )?function ([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (functionLine) {
      const open = source.indexOf("(", at);
      let depth = 0;
      let close = -1;
      for (let scan = open; scan < source.length; scan = scan + 1) {
        if (source[scan] == "(") depth = depth + 1;
        if (source[scan] == ")") { depth = depth - 1; if (depth == 0) { close = scan; break; } }
      }
      const bodyOpen = source.indexOf("{", close);
      const head = source.slice(at, open).trim().replace(/\basync\s+/, "");
      // El tipo de retorno va despues de `)`: se incluye hasta el cuerpo.
      const signatureEnd = bodyOpen >= 0 ? bodyOpen : source.indexOf("\n", close);
      const params = ambientParams(source.slice(open + 1, close));
      const rest = source.slice(close + 1, signatureEnd < 0 ? close + 1 : signatureEnd);
      const colon = rest.indexOf(":");
      const result = colon >= 0 ? rest.slice(0, colon).trim() + ": " + rest.slice(colon + 1).trim() : "";
      const name = functionLine[3];
      // Los parametros de tipo van entre el nombre y el `(`: `<T>`.
      const raw = source.slice(at, open).trim();
      const generic = raw.slice(raw.indexOf(name) + name.length).trim();
      const text = "  export " + (functionLine[1] ? "default " : "") + "function " + name + generic + "(" + params + ")" + result + ";";
      entities.push({ name, text, isDefault: functionLine[1] == "default " });
      if (bodyOpen >= 0) at = matchBrace(source, bodyOpen) + 1;
      else at = close + 1;
      continue;
    }

    // const: se queda con el tipo.
    const constLine = /^export const ([A-Za-z_$][\w$]*)\s*:\s*([^=;]+)/.exec(trimmed);
    if (constLine) {
      entities.push({ name: constLine[1], text: "  export const " + constLine[1] + ": " + constLine[2].trim() + ";" });
      at = at + line.length + 1;
      continue;
    }

    // `export default <ident>;`: el valor por defecto es una instancia.
    const defaultLine = /^export default ([A-Za-z_$][\w$]*);/.exec(trimmed);
    if (defaultLine) {
      const type = entities.map((entity) => /export class ([A-Za-z_$][\w$]*)/.exec(entity.text)).find((found) => found != null);
      entities.push({ name: defaultLine[1], text: "  const " + defaultLine[1] + ": " + (type ? type[1] : "unknown") + ";\n  export default " + defaultLine[1] + ";", isDefault: true });
      at = at + line.length + 1;
      continue;
    }

    at = at + line.length + 1;
  }

  return { module: moduleOf(file), file, entities, imports };
}

// ─── Generación ─────────────────────────────────────────────────────────────

// Una copia local de una entidad de otro módulo (TypeScript no resuelve
// imports entre módulos ambientales del mismo archivo).
function localCopy(entity: Entity, rename: string | null): string {
  let text = entity.text.replace(/^(\s*)export\s+(default\s+)?/, "$1");
  if (rename != null) {
    text = text.replace(new RegExp("\\b(class|interface|function|const)\\s+" + entity.name + "\\b"), "$1 " + rename);
  }
  // Se indenta un nivel mas: las copias son locales del modulo y asi no se
  // confunden con las declaraciones exportadas (el test del binder extrae
  // los nombres del `.d.ts` con `/^  (function|const|class|...)`).
  return text.split("\n").map((line) => "  " + line).join("\n");
}

function generate(libs: Lib[]): string {
  const byModule = new Map<string, Lib>();
  for (const lib of libs) byModule.set(lib.module, lib);

  const blocks: string[] = [];
  for (const lib of libs) {
    const lines: string[] = [];
    // Tipos que vienen de otra librería: se copian como declaraciones locales.
    for (const imported of lib.imports) {
      // El especificador es relativo al fichero que importa.
      const target = byModule.get(moduleOf(resolve(join(dirname(lib.file), imported.from)) + ".ts"));
      if (!target) continue;
      for (const entity of target.entities) {
        // El export por defecto no se copia: lo importa quien lo usa.
        if (entity.isDefault) continue;
        const alias = imported.names.find((name) => name.imported == entity.name);
        const rename = alias ? alias.local : entity.name;
        lines.push(localCopy(entity, alias ? rename : null));
      }
    }
    for (const entity of lib.entities) lines.push(entity.text);
    blocks.push('declare module "' + lib.module + '" {');
    blocks.push(...lines);
    blocks.push("}");
    blocks.push("");
  }

  const header = [
    "// ─── Librerías del runtime (`estatic:*`) ────────────────────────────────",
    "//",
    "// Cada módulo es una librería del runtime y se importa por su nombre:",
    "//",
    "//   import Math from \"estatic:math\";",
    "//   import { readFile } from \"estatic:fs\";",
    "//",
    "// Los bloques siguientes están GENERADOS por",
    "// `scripts/generate-estatic-modules-dts.ts` a partir de `runtime/lib/`:",
    "// si cambia una librería, se regenera (`npm run generate:estatic-dts`) y",
    "// `test/unit/estatic-modules-dts.test.ts` falla si el `.d.ts` está viejo.",
    "",
  ];
  return header.join("\n") + "\n" + blocks.join("\n").trimEnd() + "\n";
}

const libs = libFiles(LIB_DIR).map((file) => readLib(file));
const region = generate(libs);
// La copia de las plantillas de la semilla: `etsc init` (con `--seed`, que
// publica el driver de la semilla) copia de ahi, asi que tiene que ir al dia.
const TEMPLATE = "native-cpp/templates/types/estatic-modules.d.ts";
const targets = [DTS, TEMPLATE];
const current = targets.map((file) => (existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf-8") : ""));

if (process.argv.includes("--check")) {
  const stale = targets.filter((file, index) => current[index] != region);
  if (stale.length > 0) {
    console.error("Desfasado respecto a runtime/lib/: " + stale.join(", "));
    console.error("Regenera con: node --experimental-strip-types scripts/generate-estatic-modules-dts.ts");
    process.exit(1);
  }
  console.log(targets.join(" y ") + " al día.");
  process.exit(0);
}

for (const file of targets) writeFileSync(join(ROOT, file), region);
console.log(targets.join(" y ") + " regenerados (" + region.split("\n").length + " lineas).");