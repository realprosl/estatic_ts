import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compileFile, loadModuleGraph } from "../../src/modules/module-loader.ts";
import { Lexer } from "../../src/lexer/lexer.ts";
import { Parser } from "../../src/parser/parser.ts";
import type { Token } from "../../src/lexer/token.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = join(root, "bootstrap/parser/demo.ets");
const directory = mkdtempSync(join(tmpdir(), "estatic-bootstrap-parser-"));
const binary = join(directory, "parser-demo");
type NativeNode = { kind: string; span: any; attributes: { name: string; value: string }[]; edges: { role: string; node: number }[] };
type NativeResult = { root: number; nodes: NativeNode[]; diagnostics: { message: string; span: any }[] };

before(async () => {
  const result = await compileFile(entry, { baseDirectory: root });
  assert.deepEqual(result.moduleNames.map(file => relative(root, file)), ["bootstrap/parser/parser.ets", "bootstrap/parser/demo.ets"]);
  writeFileSync(join(directory, "estatic_common.hpp"), result.header);
  const units = result.modules.map((module, index) => {
    const file = join(directory, `unit-${index}.cpp`); writeFileSync(file, module.cpp); return file;
  });
  execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, `-I${directory}`, ...units, "-o", binary], { encoding: "utf8", timeout: 120000 });
});
after(() => rmSync(directory, { recursive: true, force: true }));

function transport(tokens: Token[]): string[] {
  return tokens.flatMap(token => [token.kind, token.lexeme, ...Object.values(token.span.start).map(String), ...Object.values(token.span.end).map(String)]);
}
function nativeTokens(tokens?: Token[]): NativeResult {
  const result: NativeResult = JSON.parse(execFileSync(binary, tokens === undefined ? [] : transport(tokens), { encoding: "utf8", timeout: 15000, maxBuffer: 32 * 1024 * 1024 }));
  assert.ok(Number.isInteger(result.root) && result.root >= 0 && result.root < result.nodes.length);
  for (const node of result.nodes) for (const edge of node.edges) assert.ok(Number.isInteger(edge.node) && edge.node >= 0 && edge.node < result.nodes.length);
  return result;
}
function native(source: string): NativeResult { return nativeTokens(new Lexer(source).tokenize()); }

// Compare every supported semantic field/edge, independently of arena order.
// Spans have dedicated tests: stage 0 has historical differences for classes
// and synthetic nodes. This projection never evaluates or parses expressions.
const scalarKeys = new Set(["name", "mutable", "declaredType", "async", "returnType", "type", "constraint", "default", "literalType", "raw", "operator", "callee", "member", "method", "optional", "className", "targetType", "isAsync", "await", "out", "passing", "variadic", "readonly", "access", "isStatic", "exported", "key", "value"]);
const roleKinds: Record<string, string> = { params: "Parameter", typeParameters: "TypeParameter", fields: "ClassField", methods: "ClassMethod", properties: "ObjectProperty", decorators: "Decorator" };
const excludedRoles = new Set(["span", "typeArguments", "variadicTypeParameters", "arrayBindings", "objectBindings", "generatedSources"]);
function hostShape(node: any, forcedKind?: string): any {
  const kind = node.kind ?? forcedKind;
  const attributes: Record<string, string[]> = {}, edges: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "kind" || excludedRoles.has(key) || value === undefined || (value === false && key !== "value")) continue;
    if (scalarKeys.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      if (key === "value" && node.literalType === "number") continue;
      attributes[key] = [String(value)];
    } else if (Array.isArray(value)) {
      if (value.length) edges[key] = value.map(item => hostShape(item, kind === "InterfaceDeclaration" && (key === "fields" || key === "methods") ? (key === "fields" ? "InterfaceField" : "InterfaceMethod") : roleKinds[key]));
    } else if (value && typeof value === "object") {
      // The for-of/in binding initializer is synthetic in stage 0.
      if ((kind === "ForOfStatement" || kind === "ForInStatement") && key === "binding") {
        const { initializer, ...binding } = value as any; edges[key] = [hostShape(binding)];
      } else edges[key] = [hostShape(value)];
    }
  }
  if (node.mutable === false) attributes.mutable = ["false"];
  if (node.typeArguments?.length) attributes.typeArgument = node.typeArguments;
  return { kind, attributes, edges };
}
function nativeShape(result: NativeResult, id = result.root, visiting = new Set<number>()): any {
  assert.ok(!visiting.has(id), "AST has no cycles"); visiting.add(id);
  const item = result.nodes[id], attributes: Record<string, string[]> = {}, edges: Record<string, any[]> = {};
  for (const field of item.attributes) {
    if (field.value === "false" && field.name !== "mutable" && field.name !== "value") continue;
    (attributes[field.name] ??= []).push(field.value);
  }
  for (const edge of item.edges) (edges[edge.role] ??= []).push(nativeShape(result, edge.node, visiting));
  visiting.delete(id); return { kind: item.kind, attributes, edges };
}
function parity(source: string): NativeResult {
  const tokens = new Lexer(source).tokenize();
  const expected = new Parser(tokens).parseProgram(); const result = nativeTokens(tokens);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.deepEqual(nativeShape(result), hostShape(expected)); return result;
}

const fixtures: [string, string][] = [
  ["empty program", ""],
  ["empty separators", ";;\n;"],
  ["variable and const", "let x:number=42; const label:string='hello';"],
  ["type inference", "const x=true; let y=false;"],
  ["numeric spellings", "const x=[0xff,0b101,0o77,1_234,12.5];"],
  ["arithmetic precedence", "1+2*3-4/2%2;"],
  ["left associativity", "a-b-c;"],
  ["parentheses", "(1+2)*3;"],
  ["boolean precedence", "a||b&&c==d;"],
  ["null coalescing", "a??b||c;"],
  ["bitwise precedence", "a|b&c^d<<2;"],
  ["shift adjacency", "a<<2; b>>1;"],
  ["unary operators", "!-x; ~+x; typeof x;"],
  ["instanceof primitive", "x instanceof string;"],
  ["right associative assignment", "a=b=c;"],
  ["compound assignments", "a+=2; a**=3; b<<=1; obj.x^=2; arr[0]%=2;"],
  ["ternary nesting", "a?b:c?d:e;"],
  ["ordinary calls", "print(1, 'hello', true);"],
  ["generic calls", "identity<number>(1);"],
  ["generic static member", "Box<number>.make(1);"],
  ["member chains", "items.filter(keep).map(convert).length;"],
  ["generic member calls", "items.map<string>(convert);"],
  ["optional access", "item?.value; item?.get();"],
  ["keyword member", "map.delete('key'); ns.default();"],
  ["indexing", "matrix[0][1]; obj.items[2].value;"],
  ["array literals and spread", "const values=[1,...rest,3,];"],
  ["object literal shorthand", "const value={ok:true,count,name};"],
  ["nested objects", "const value={data:{items:[1,2]}};"],
  ["named and spread arguments", "build(name:'x',count:2,...rest);"],
  ["new expressions", "const x=new Box<number>(1); new ns.default();"],
  ["cast", "value as number;"],
  ["satisfies", "value satisfies Shape;"],
  ["dynamic and fixed arrays", "let a:number[]= []; let b:u8[4]=[1,2,3,4];"],
  ["nested generics", "let table:Map<string,Array<number>> = make();"],
  ["tuple and callable types", "let pair:[number,string]=make(); let f:(x:number)=>string=convert;"],
  ["readonly and typeof types", "let values:readonly number[]=items; let copy:typeof values=items;"],
  ["union intersection types", "let value:A | B=source; let combined:A & B=source;"],
  ["namespaced types", "let value:ns.default<number> = source;"],
  ["ordinary functions", "function add(a:number,b:number):number{return a+b;}"],
  ["generic function", "function identity<T extends Value>(x:T):T{return x;}"],
  ["default generic type", "function identity<T=number>(x:T):T{return x;}"],
  ["default optional rest out params", "function run(out x:number,y?:number=2,...rest:number[]):void{}"],
  ["forward function", "function external(x:number):number;"],
  ["async and await", "async function load():Promise<number>{return await read();}"],
  ["arrows", "const f=(x:number)=>x+1;"],
  ["arrow block", "const f=(x:number):number=>{return x+1;};"],
  ["async arrow", "const f=async (x:number)=>await load(x);"],
  ["arrow in chain", "items.map((x:number)=>x+1).filter((x:number)=>x>2);"],
  ["if else newlines", "if(ok){print(1);}\nelse {print(2);}"],
  ["dangling else", "if(a) if(b) print(1); else print(2);"],
  ["while break continue", "while(ok){if(done)break; continue;}"],
  ["classic for", "for(let i:number=0;i<3;i+=1){print(i);}"],
  ["empty for clauses", "for(;;){break;}"],
  ["expression for initializer", "for(i=0;i<3;i+=1)print(i);"],
  ["for of", "for(const value of values){print(value);} for(const fn:(x:number)=>number of functions){fn(1);}"],
  ["for in typed", "for(let key:string in map)print(key);"],
  ["for await", "for await(const item of stream){print(item);}"],
  ["using", "using resource:Handle=open();"],
  ["delete index", "delete map[key];"],
  ["semicolon after blocks", "{print(1);}; {print(2);};"],
  ["significant newlines", "let x=1\nprint(x)\n"],
  ["exported declarations", "export const x=1; export function get():number{return x;}"],
  ["classes and constructor", "class Box { value:number; constructor(value:number){this.value=value;} get():number{return this.value;} }"],
  ["class access and static", "class Counter { private value:number=0; static count:number=0; readonly static limit:number=10; public get():number{return this.value;} }"],
  ["generic class", "class Box<T> { value:T; get():T{return this.value;} }"],
  ["interface fields and methods", "interface Shape { count:number; name?:string; get(x:number):string; }"],
  ["type aliases", "export type Items<T> = Map<string,T[]>;"],
  ["declaration decorator", "@trace('value')\nfunction f():void{}"],
  ["unicode strings positions", "const text='España 🙂';\nprint(text);"],
];
for (const [name, source] of fixtures) test(`bootstrap parser native parity: ${name}`, () => { parity(source); });

test("bootstrap parser: demo executes fixed tokens without a lexer", () => {
  const result = nativeTokens(); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(nativeShape(result), hostShape(new Parser(new Lexer("1 + 2 * 3;").tokenize()).parseProgram()));
});
test("bootstrap parser: every expression span matches stage 0", () => {
  const source = "const text='🙂';\nprint((1+2)*3, text.length);";
  const result = parity(source); const expected = new Parser(new Lexer(source).tokenize()).parseProgram();
  const spans: any[] = [];
  function visit(node: any): void { if (!node || typeof node !== "object") return; if (node.kind && node.span) spans.push([node.kind, node.span]); for (const [key, value] of Object.entries(node)) if (key !== "span") { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value); } }
  visit(expected);
  const actual: any[] = [];
  function nativeSpans(id: number): void { const item = result.nodes[id]; actual.push([item.kind, item.span]); for (const edge of item.edges) nativeSpans(edge.node); }
  nativeSpans(result.root);
  const sort = (a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b));
  assert.deepEqual(actual.sort(sort), spans.sort(sort));
});
test("bootstrap parser: parses the complete isolated lexer source", () => { parity(readFileSync(join(root, "bootstrap/lexer/lexer.ets"), "utf8")); });
test("bootstrap parser: parses its own complete ETS source", () => { parity(readFileSync(join(root, "bootstrap/parser/parser.ets"), "utf8")); });
test("bootstrap parser: graph contains only parser and its driver", async () => {
  const graph = await loadModuleGraph(entry); assert.equal(graph.modules.length, 2); assert.deepEqual(graph.modules[0].dependencies, []);
  assert.ok(graph.modules.every(module => module.file.includes("bootstrap/parser/")));
});

for (const [name, source] of [
  ["missing initializer", "let x:number=;"], ["missing variable name", "let =1;"],
  ["missing right parenthesis", "print(1;"], ["missing right brace", "function f():void{"],
  ["missing type", "let x:=1;"], ["invalid assignment target", "1=2;"],
  ["missing terminator", "let x=1 let y=2;"], ["invalid delete", "delete obj.field;"],
  ["nested export", "function f():void{export const x=1;}"], ["invalid await for", "for await(;;)break;"],
  ["unterminated generic", "let x:Box<number=1;"], ["unexpected close", "} } }"],
  ["missing object value", "const x={key:};"], ["missing ternary colon", "a?b;"],
] as const) test(`bootstrap parser native diagnostics: ${name}`, () => {
  const result = native(source); assert.ok(result.diagnostics.length > 0); assert.ok(result.diagnostics.length <= 100);
  for (const diagnostic of result.diagnostics) assert.ok(diagnostic.span.start.offset <= source.length);
});
for (const source of ["enum Color{Red}", "union Value{ A }", "switch(x){case 1:break;}", "import {x} from 'm';", "export default 1;", "const text=`hello ${name}`;"])
  test(`bootstrap parser: explicit pending syntax ${source}`, () => { assert.ok(native(source).diagnostics.some(item => item.message.includes("pendiente"))); });

test("bootstrap parser: bare return and recovery keep subsequent statements", () => {
  const result = native("function f():void{return\nprint(1);}\nlet bad=;\nprint(2);");
  assert.ok(result.diagnostics.length > 0);
  assert.ok(result.nodes.some(node => node.kind === "CallExpression" && node.attributes.some(field => field.name === "callee" && field.value === "print")));
  const returns = result.nodes.filter(node => node.kind === "ReturnStatement"); assert.equal(returns.length, 1); assert.equal(returns[0].edges.length, 0);
});
test("bootstrap parser: missing EOF token streams terminate", () => {
  const tokens = new Lexer("1;").tokenize().slice(0, -1); const result = nativeTokens(tokens);
  assert.ok(result.diagnostics.some(item => item.message.includes("eof final")));
});
test("bootstrap parser: empty token input has an explicit diagnostic", () => {
  const result: NativeResult = JSON.parse(execFileSync(binary, ["--empty"], { encoding: "utf8", timeout: 5000 }));
  assert.equal(result.nodes[result.root].kind, "Program");
  assert.ok(result.diagnostics.some(item => item.message.includes("eof final")));
});
test("bootstrap parser: early EOF is rejected", () => {
  const tokens = new Lexer("1;").tokenize(); const result = nativeTokens([tokens.at(-1)!, ...tokens]);
  assert.ok(result.diagnostics.some(item => item.message.includes("solo puede aparecer al final")));
});
test("bootstrap parser: precedence is independently pinned", () => {
  const result = native("1+2*3;"); const shape = nativeShape(result);
  const expression = shape.edges.statements[0].edges.expression[0];
  assert.equal(expression.kind, "BinaryExpression"); assert.deepEqual(expression.attributes.operator, ["+"]);
  assert.deepEqual(expression.edges.right[0].attributes.operator, ["*"]);
});
test("bootstrap parser: diagnostic storage is bounded", () => {
  const result = native("}".repeat(500)); assert.equal(result.diagnostics.length, 100);
});
for (const [name, source] of [
  ["parentheses", "(".repeat(200) + "1" + ")".repeat(200) + ";"],
  ["unary", "!".repeat(200) + "true;"],
  ["assignment", "x=".repeat(200) + "1;"],
  ["types", "let x:" + "Box<".repeat(200) + "number" + ">".repeat(200) + "=source;"],
] as const) test(`bootstrap parser: bounded nesting ${name}`, () => { assert.ok(native(source).diagnostics.some(item => item.message.includes("anidamiento"))); });
test("bootstrap parser: deterministic malformed-token corpus terminates", () => {
  for (const source of ["export if(true){}", "const values=[name:1];"]) assert.ok(native(source).diagnostics.length > 0, source);
  const pieces = ["x", "1", ";", ":", "(", ")", "[", "]", "{", "}", "=", "let", "if", "return", ",", "?", "function"];
  let seed = 31415;
  for (let run = 0; run < 30; run++) {
    const parts: string[] = [];
    for (let i = 0; i < 30; i++) { seed = (seed * 16807) % 2147483647; parts.push(pieces[seed % pieces.length]); }
    native(parts.join(" "));
  }
});
