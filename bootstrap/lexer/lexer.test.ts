import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compileFile, loadModuleGraph } from "../../src/modules/module-loader.ts";
import { Lexer } from "../../src/lexer/lexer.ts";
import { KEYWORDS } from "../../src/lexer/token.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = join(root, "bootstrap/lexer/demo.ets");
const directory = mkdtempSync(join(tmpdir(), "estatic-bootstrap-lexer-"));
const binary = join(directory, "lexer-demo");

before(async () => {
  // The only ETS modules are lexer + its tiny demo. Native compilation is
  // mandatory: evaluating the lexer as JavaScript would not test self-hosting.
  const result = await compileFile(entry, { baseDirectory: root });
  assert.deepEqual(result.moduleNames.map(file => relative(root, file)), ["bootstrap/lexer/lexer.ets", "bootstrap/lexer/demo.ets"]);
  writeFileSync(join(directory, "estatic_common.hpp"), result.header);
  const files = result.modules.map((module, index) => {
    const file = join(directory, `unit-${index}.cpp`); writeFileSync(file, module.cpp); return file;
  });
  execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, `-I${directory}`, ...files, "-o", binary], { encoding: "utf8", timeout: 120000 });
});
after(() => rmSync(directory, { recursive: true, force: true }));

function native(source?: string): { tokens: unknown[]; diagnostics: any[] } {
  return JSON.parse(execFileSync(binary, source === undefined ? [] : [source], { encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024 }));
}

const fixtures: [string, string][] = [
  ["empty", ""],
  ["declaration", "let total: number = 42;"],
  ["all host keywords", Object.keys(KEYWORDS).join(" ")],
  ["prototype names", "constructor prototype toString __proto__ match when"],
  ["identifiers", "foo _private X12 name0"],
  ["decimal numbers", "0 42 3.14 1_000 12_34.56_78"],
  ["numeric prefixes", "0xFF 0X1a 0o77 0O17 0b101 0B11 0xFF_FF"],
  ["numeric boundaries", "0x 0b2 0o8 0x12g 1. 1e3 .5"],
  ["quoted strings", String.raw`'hello' "with \"quote\"" 'a\nb\tc\r'`],
  ["unknown escapes", String.raw`"\q\u0041\0"`],
  ["unicode strings", 'const text:string="España 🙂 漢字"; print(text);'],
  ["unicode comments", '// 🙂 España\nprint("é");'],
  ["raw template", '`hello ${value}`'],
  ["nested templates", '`outer ${`inner ${value}`} end`'],
  ["template literal braces", '`function x(){return {value:7};}`'],
  ["escaped backtick", '`a\\`b`'],
  ["arithmetic and logical operators", "+ - * / % == != < > <= >= && || ! ?? ?. =>"],
  ["compound operators", "+= -= *= /= %= **= &= |= ^= <<= >>= ..."],
  ["shifts stay separate", "<< >> >>> === !=="],
  ["punctuation", "({[]}),;:.?@|&^~"],
  ["line comments", "let x=1; // comment\nprint(x);"],
  ["block comments", "a/* line\nnext */b"],
  ["newlines in blocks", "function run(){\nprint(1)\nreturn 2\n}"],
  ["parenthesized multiline", "print(\n1 +\n2\n)"],
  ["array multiline", "const x=[\n1,\n2\n]"],
  ["multiline chains", "items\n .filter(x=>true)\n .map(x=>x)"],
  ["multiline operator", "value\n + 2\nprint(value)"],
  ["CRLF and tabs", "let x=1;\r\n\tprint(x);\r\n"],
  ["vertical whitespace", "a\v\fb"],
  ["unicode whitespace", "\uFEFFlet\u00a0x\u2003=\u30001;\u2028print(x);"],
  ["trailing whitespace", "answer \n \n"],
  ["unmatched brackets terminate", ")] } ( ["],
];

for (const [name, source] of fixtures) test(`bootstrap lexer native parity: ${name}`, () => {
  const actual = native(source);
  assert.deepEqual(actual.diagnostics, []);
  assert.deepEqual(actual.tokens, new Lexer(source).tokenize());
});

for (const [name, source] of [
  ["unknown symbol", "$"],
  ["unclosed string", '"not closed'],
  ["newline in string", '"first\nsecond'],
  ["unclosed template", '`not closed'],
  ["several errors", '$ "not closed\n? $'],
] as const) test(`bootstrap lexer native diagnostics: ${name}`, () => {
  let expected: unknown[] = [];
  try { new Lexer(source).tokenize(); } catch (error) { assert.ok(error instanceof DiagnosticError); expected = error.diagnostics; }
  assert.ok(expected.length > 0);
  const actual = native(source); assert.deepEqual(actual.diagnostics, expected);
  const eof = actual.tokens.at(-1) as any; assert.equal(eof.kind, "eof");assert.ok(eof.span.end.offset <= source.length);
});

test("bootstrap lexer: unclosed block comment is explicitly diagnosed", () => {
  const result = native("/* open");assert.equal(result.diagnostics[0].message, "Comentario sin cerrar");
  assert.deepEqual(result.diagnostics[0].span, { start: { offset: 0, line: 1, column: 1 }, end: { offset: 7, line: 1, column: 8 } });
});
test("bootstrap lexer: trailing escape never advances past EOF", () => {
  const source = '"escape\\';const result = native(source);assert.equal(result.diagnostics[0].message, "Cadena sin cerrar");
  assert.equal(result.diagnostics[0].span.end.offset, source.length);
});
test("bootstrap lexer: astral unexpected symbol is one diagnostic with UTF-16 span", () => {
  const result = native("🙂");assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].message, "Carácter inesperado '🙂'");assert.equal(result.diagnostics[0].span.end.offset, 2);
});
test("bootstrap lexer: demo calls the inspection function with its default example", () => {
  assert.deepEqual(native().tokens, new Lexer("const answer: number = 42;\nprint(answer);").tokenize());
});
test("bootstrap lexer: implementation tokenizes its own ETS source", () => {
  const source = readFileSync(join(root, "bootstrap/lexer/lexer.ets"), "utf8");
  const result = native(source);assert.deepEqual(result.diagnostics, []);assert.deepEqual(result.tokens, new Lexer(source).tokenize());
});
test("bootstrap lexer: isolated graph has no other compiler modules", async () => {
  const graph = await loadModuleGraph(entry);assert.equal(graph.modules.length, 2);assert.deepEqual(graph.modules[0].dependencies, []);
  const sources = readdirSync(join(root, "bootstrap"), { recursive: true }).filter(file => typeof file === "string" && file.endsWith(".ets")).sort();
  assert.deepEqual(sources, ["lexer/demo.ets", "lexer/lexer.ets"]);
});
test("bootstrap lexer: deterministic generated ASCII corpus", () => {
  const pieces = ["alpha", "123", '"hello"', "const", "=>", "+=", "...", "0xFF", ";", "/*x*/", "//x\n", " ", "\n", "(", ")", "[", "]", "{", "}"];
  let seed = 41831;
  for (let run = 0; run < 40; run++) {
    const parts: string[] = [];
    for (let i = 0; i < 25; i++) { seed = (seed * 16807) % 2147483647;parts.push(pieces[seed % pieces.length]); }
    const source = parts.join(" ");assert.deepEqual(native(source).tokens, new Lexer(source).tokenize());
  }
});
