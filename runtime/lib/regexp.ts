// RegExp de TypeScript como librería del runtime (no es un builtin):
//
//   import RegExp from "estatic:regexp";
//   const re = new RegExp("(\\d+)-(\\d+)", "g");   // o el literal /(\d+)-(\d+)/g
//   re.test("10-20"); re.exec("10-20");
//   "a1b22".replace(/\d+/g, "#"); "a,b;c".split(/[,;]/); "x9".match(/\d/);
//
// El motor es std::regex con la gramática ECMAScript (runtime/lib/regexp.hpp):
// flags g, i, m e y. Sin lookbehind, grupos con nombre ni los flags s, u, v y d.
// Los índices (index, lastIndex) cuentan bytes, como el resto de strings.

@include("runtime/lib/regexp.hpp")
@cpp_native("ets_regexp::execAt") function execAt(source: string, flags: string, text: string, from: number): number[];
@cpp_native("ets_regexp::compiled") function compile(source: string, flags: string): void;

export default class RegExp {
  source: string;
  flags: string;
  lastIndex: number;
  global: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  sticky: boolean;
  // Índice del último match de exec (en JavaScript es el campo index del resultado).
  lastMatchIndex: number;
  constructor(pattern: string, flags?: string) {
    this.source = pattern; this.flags = flags ?? ""; this.lastIndex = 0; this.lastMatchIndex = -1;
    this.global = this.flags.includes("g"); this.ignoreCase = this.flags.includes("i");
    this.multiline = this.flags.includes("m"); this.sticky = this.flags.includes("y");
    // Un patrón no válido es un SyntaxError al construirlo, como en JavaScript.
    compile(this.source, this.flags);
  }
  // exec: el match y sus grupos ("" si un grupo no participa), o undefined. Con
  // g o y empieza en lastIndex y lo avanza; si no hay match, lo pone a 0.
  exec(text: string): string[] | undefined {
    const from: number = this.global || this.sticky ? this.lastIndex : 0;
    const offsets: number[] = execAt(this.source, this.flags, text, from);
    if (offsets.length == 0) { if (this.global || this.sticky) this.lastIndex = 0; this.lastMatchIndex = -1; return undefined; }
    let groups: string[] = [];
    for (let at: number = 0; at < offsets.length; at = at + 2) groups.push(offsets[at] < 0 ? "" : text.slice(offsets[at], offsets[at + 1]));
    this.lastMatchIndex = offsets[0];
    if (this.global || this.sticky) this.lastIndex = offsets[1] == offsets[0] ? offsets[1] + 1 : offsets[1];
    return groups;
  }
  test(text: string): boolean { return this.exec(text) !== undefined; }
  toString(): string { return "/" + this.source + "/" + this.flags; }
}
