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
let graph: Awaited<ReturnType<typeof loadModuleGraph>>;
type NativeNode = { kind: string; span: any; attributes: { name: string; value: string }[]; edges: { role: string; node: number }[] };
type NativeResult = { root: number; nodes: NativeNode[]; diagnostics: { message: string; span: any }[] };

before(async () => {
  graph = await loadModuleGraph(entry);
  const result = await compileFile(entry, { baseDirectory: root });
  assert.deepEqual(result.moduleNames.map(file => relative(root, file)), ["bootstrap/parser/parser.ets", "bootstrap/parser/demo.ets"]);
  writeFileSync(join(directory, "estatic_common.hpp"), result.header);
  const units = result.modules.map((module, index) => {
    const file = join(directory, `unit-${index}.cpp`); writeFileSync(file, module.cpp); return file;
  });
  execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, `-I${directory}`, ...units, "-o", binary], { encoding: "utf8", timeout: 120000, env: { ...process.env, TMPDIR: directory } });
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
const scalarKeys = new Set(["name", "mutable", "declaredType", "async", "returnType", "type", "constraint", "default", "literalType", "raw", "operator", "callee", "member", "method", "optional", "className", "targetType", "isAsync", "await", "out", "passing", "variadic", "readonly", "access", "isStatic", "exported", "key", "value", "underlying", "payload", "field"]);
const roleKinds: Record<string, string> = { params: "Parameter", typeParameters: "TypeParameter", fields: "ClassField", methods: "ClassMethod", properties: "ObjectProperty", decorators: "Decorator", members: "EnumMember", variants: "UnionVariant", discriminator: "Discriminator" };
const excludedRoles = new Set(["span", "typeArguments", "variadicTypeParameters", "arrayBindings", "objectBindings", "generatedSources"]);
function hostShape(node: any, forcedKind?: string): any {
  const kind = node.kind ?? forcedKind;
  const attributes: Record<string, string[]> = {}, edges: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "kind" || excludedRoles.has(key) || value === undefined || (value === false && key !== "value")) continue;
    if (scalarKeys.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      if (key === "value" && node.literalType === "number" && node.raw !== undefined) continue;
      attributes[key] = [String(value)];
    } else if (Array.isArray(value)) {
      if (value.length) edges[key] = value.map(item => hostShape(item, kind === "InterfaceDeclaration" && (key === "fields" || key === "methods") ? (key === "fields" ? "InterfaceField" : "InterfaceMethod") : roleKinds[key]));
    } else if (value && typeof value === "object") {
      // The for-of/in binding initializer is synthetic in stage 0.
      if ((kind === "ForOfStatement" || kind === "ForInStatement") && key === "binding") {
        const { initializer, ...binding } = value as any; edges[key] = [hostShape(binding)];
      } else edges[key] = [hostShape(value, roleKinds[key])];
    }
  }
  if (node.mutable === false) attributes.mutable = ["false"];
  if (node.typeArguments?.length) attributes.typeArgument = node.typeArguments;
  if (kind === "Discriminator") attributes.literalType = [typeof node.value];
  return { kind, attributes, edges };
}
function nativeShape(result: NativeResult, id = result.root, visiting = new Set<number>()): any {
  assert.ok(!visiting.has(id), "AST has no cycles"); visiting.add(id);
  const item = result.nodes[id], attributes: Record<string, string[]> = {}, edges: Record<string, any[]> = {};
  for (const field of item.attributes) {
    if (field.value === "false" && field.name !== "mutable" && field.name !== "value") continue;
    (attributes[field.name] ??= []).push(field.value);
  }
  for (const edge of item.edges) {
    // Stage 0 discards binding names. The new AST retains them and dedicated
    // tests verify their names, order, types and positions independently.
    if (item.kind === "UnionVariant" && edge.role === "bindings") continue;
    (edges[edge.role] ??= []).push(nativeShape(result, edge.node, visiting));
  }
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
test("bootstrap parser: graph contains only parser and its driver", () => {
  assert.equal(graph.modules.length, 2); assert.deepEqual(graph.modules[0].dependencies, []);
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
for (const source of ["import {x} from 'm';", "export default 1;", "const text=`hello ${name}`;"])
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

const declarationFixtures: [string, string][] = [
  ["enum automatic values", "enum Color{Red,Green,Blue}"],
  ["enum explicit reset", "enum Level{Low=2,Medium,High=10,Extreme}"],
  ["enum zero and duplicate values", "enum Alias{First=0,Same=0,Next}"],
  ["enum strings", "enum Method{Get='GET',Post='POST'}"],
  ["enum numeric prefixes", "enum Mask{Hex=0xFF,AfterHex,Binary=0b10,AfterBinary,Octal=0o17,AfterOctal}"],
  ["enum fractions", "enum Fraction{Start=0.12,Next,Reset=1.250,After}"],
  ["enum trailing comma", "enum Color{Red,Green,}"],
  ["enum export and following statement", "export enum Color{Red,Green} const color=Color.Green;"],
  ["enum unicode values", "enum Label{First='España 🙂',Second='漢字'}"],
  ["union named variants", "union Flag=On | Off;"],
  ["union typed payloads", "union Outcome<T,E> = Ok(T) | Err(E);"],
  ["union generic constraints", "union Item<T extends Value=Value> = Some(T) | Empty;"],
  ["union composite payloads", "union Data=Items(Map<string,number[]>) | Pair([number,string]) | Callback((x:number)=>string);"],
  ["union export", "export union Value=Text(string) | Number(number);"],
  ["union string discriminants", "union Shape={kind:'Circle';radius:number} | {kind:'Square';width:number;height:number};"],
  ["union boolean discriminants", "union Result<T> = {ok:true;value:T} | {ok:false;error:string};"],
  ["union zero bindings", "union Flag={ok:true} | {ok:false};"],
  ["union numeric discriminants", "union Tagged={tag:0x10;value:number} | {tag:2};"],
  ["union false non-ok discriminant", "union Flags={enabled:false} | {enabled:true};"],
  ["union comma bindings", "union Entry={kind:'Entry',key:string,value:number};"],
];
for (const [name, source] of declarationFixtures) test(`bootstrap parser native declarations parity: ${name}`, () => { parity(source); });

function fields(node: NativeNode): Record<string, string> { return Object.fromEntries(node.attributes.map(field => [field.name, field.value])); }
function children(result: NativeResult, node: NativeNode, role: string): NativeNode[] { return node.edges.filter(edge => edge.role === role).map(edge => result.nodes[edge.node]); }
function statements(result: NativeResult): NativeNode[] { return children(result, result.nodes[result.root], "statements"); }
function values(result: NativeResult, node: NativeNode): string[] { return children(result, node, "members").map(member => fields(children(result, member, "value")[0]).value); }

test("bootstrap parser: enum counters preserve exact integers beyond double precision", () => {
  const result = native("enum Wide{A=9007199254740992,B,C}"); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(values(result, statements(result)[0]), ["9007199254740992", "9007199254740993", "9007199254740994"]);
});
test("bootstrap parser: enum exact decimal increment and separators", () => {
  const result = native("enum Exact{A=0001.2300,B,C=0xFF_FF,D,E=1_000,F}"); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(values(result, statements(result)[0]), ["1.23", "2.23", "65535", "65536", "1000", "1001"]);
});
test("bootstrap parser: enum multiline and boundary positions", () => {
  const source = "enum Color {\n Red=2,\n Green,\n Blue,\n}\nprint(Color.Blue);";
  const result = native(source); assert.deepEqual(result.diagnostics, []);
  const declaration = statements(result)[0], members = children(result, declaration, "members");
  assert.deepEqual(values(result, declaration), ["2", "3", "4"]);
  assert.equal(declaration.span.start.offset, 0); assert.equal(declaration.span.end.offset, source.indexOf("}") + 1);
  assert.deepEqual(members[1].span.start, { offset: source.indexOf("Green"), line: 3, column: 2 });
  assert.equal(statements(result)[1].kind, "ExpressionStatement");
});
test("bootstrap parser: union preserves binding names order and source positions", () => {
  const source = "union Entry={kind:'Entry';key:string;value:Map<string,number>};";
  const result = parity(source); const variant = children(result, statements(result)[0], "variants")[0];
  const bindings = children(result, variant, "bindings");
  assert.deepEqual(bindings.map(fields), [{ name: "key", type: "string" }, { name: "value", type: "Map<string,number>" }]);
  assert.equal(bindings[0].span.start.offset, source.indexOf("key")); assert.equal(bindings[1].span.end.offset, source.lastIndexOf(">") + 1);
  assert.equal(fields(variant).payload, "[string,Map<string,number>]");
});
test("bootstrap parser: union multiline and trailing binding separators", () => {
  const result = native("union Result<T> =\n {\n ok:true;\n value:T;\n }\n | {ok:false;error:string,};\nprint(1);");
  assert.deepEqual(result.diagnostics, []); const variants = children(result, statements(result)[0], "variants");
  assert.deepEqual(variants.map(item => fields(item).name), ["Ok", "Err"]);
  assert.deepEqual(variants.map(item => fields(item).payload), ["T", "string"]);
  assert.equal(statements(result)[1].kind, "ExpressionStatement");
});
test("bootstrap parser: union discriminants retain exact numbers and booleans", () => {
  const result = native("union Tag={code:0x20000000000001} | {ok:false};"); assert.deepEqual(result.diagnostics, []);
  const variants = children(result, statements(result)[0], "variants");
  assert.deepEqual(fields(children(result, variants[0], "discriminator")[0]), { field: "code", literalType: "number", value: "9007199254740993" });
  assert.deepEqual(fields(children(result, variants[1], "discriminator")[0]), { field: "ok", literalType: "boolean", value: "false" });
});

function shape(kind: string, attributes: Record<string, string> = {}, edges: Record<string, any[]> = {}): any {
  return { kind, attributes: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, [value]])), edges };
}
test("bootstrap parser: switch full AST is fixed independently of stage 0", () => {
  const result = native("switch(value){case 1:print('one');break;default:return;}"); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(nativeShape(result), shape("Program", {}, { statements: [shape("SwitchStatement", {}, {
    discriminant: [shape("IdentifierExpression", { name: "value" })],
    clauses: [shape("CaseClause", {}, {
      labels: [shape("LiteralExpression", { literalType: "number", raw: "1" })],
      body: [shape("ExpressionStatement", {}, { expression: [shape("CallExpression", { callee: "print" }, { args: [shape("LiteralExpression", { literalType: "string", value: "one" })] })] }), shape("BreakStatement")],
    }), shape("DefaultClause", {}, { body: [shape("ReturnStatement")] })],
  })] }));
});
const switchFixtures: [string, string, string[]][] = [
  ["empty", "switch(x){}", []],
  ["default only", "switch(x){default:print(0);}", ["DefaultClause"]],
  ["no default", "switch(x){case 1:break;case 2:break;}", ["CaseClause", "CaseClause"]],
  ["empty fallthrough cases", "switch(x){case 1:case 2:print(2);break;}", ["CaseClause", "CaseClause"]],
  ["default first", "switch(x){default:print(0);case 1:print(1);}", ["DefaultClause", "CaseClause"]],
  ["default in middle", "switch(x){case 1:break;default:print(0);case 2:break;}", ["CaseClause", "DefaultClause", "CaseClause"]],
  ["multiline", "switch(x){\ncase 1:\nprint(1)\nbreak\ndefault:\nprint(0)\n}", ["CaseClause", "DefaultClause"]],
  ["string labels", "switch(name){case 'España 🙂':print(1);default:break;}", ["CaseClause", "DefaultClause"]],
  ["expression labels", "switch(get()){case limit+1:break;case flag?1:2:break;}", ["CaseClause", "CaseClause"]],
  ["block bodies", "switch(x){case 1:{let n=1;print(n);}break;default:{print(0);}}", ["CaseClause", "DefaultClause"]],
  ["nested switch", "switch(x){case 1:switch(y){case 2:break;default:break;}break;}", ["CaseClause"]],
  ["inside loop", "while(ok){switch(x){case 1:continue;default:break;}break;}", ["CaseClause", "DefaultClause"]],
  ["in function with declarations", "function f(x:number):void{switch(x){case 1:enum E{A}break;default:union U=A | B;return;}}", ["CaseClause", "DefaultClause"]],
];
for (const [name, source, clauseKinds] of switchFixtures) test(`bootstrap parser native switch: ${name}`, () => {
  const result = native(source); assert.deepEqual(result.diagnostics, []);
  const node = result.nodes.find(node => node.kind === "SwitchStatement")!;
  assert.ok(node); assert.deepEqual(children(result, node, "clauses").map(item => item.kind), clauseKinds);
  assert.ok(!result.nodes.some(node => node.kind === "ErrorNode")); nativeShape(result);
});
test("bootstrap parser: switch preserves fallthrough and statement order", () => {
  const result = native("switch(x){case 1:case 2:print(1);print(2);break;default:}");
  const clauses = children(result, statements(result)[0], "clauses");
  assert.equal(children(result, clauses[0], "body").length, 0);
  assert.deepEqual(children(result, clauses[1], "body").map(item => item.kind), ["ExpressionStatement", "ExpressionStatement", "BreakStatement"]);
  assert.equal(children(result, clauses[2], "body").length, 0);
});
test("bootstrap parser: switch clause spans preserve Unicode positions", () => {
  const source = "switch(x){\ncase '🙂':\n break;\ndefault:\n}\nprint(1);";
  const result = native(source); const node = statements(result)[0], clauses = children(result, node, "clauses");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(clauses[0].span.start, { offset: source.indexOf("case"), line: 2, column: 1 });
  assert.deepEqual(clauses[1].span.start, { offset: source.indexOf("default"), line: 4, column: 1 });
  assert.equal(node.span.end.offset, source.indexOf("}") + 1); assert.equal(statements(result).length, 2);
});
for (const [name, source, message] of [
  ["empty enum", "enum Empty{}", "al menos un miembro"],
  ["duplicate enum name", "enum E{A,A}", "duplicado"],
  ["mixed enum numeric string", "enum E{A=1,B='b'}", "mezclar"],
  ["mixed enum implicit string", "enum E{A,B='b'}", "mezclar"],
  ["mixed enum string numeric", "enum E{A='a',B=1}", "mezclar"],
  ["implicit string member", "enum E{A='a',B}", "valores explícitos"],
  ["negative enum", "enum E{A=-1}", "literal numérico"],
  ["computed enum", "enum E{A=make()}", "literal numérico"],
  ["missing enum comma", "enum E{A B}", "entre miembros"],
  ["incomplete numeric enum", "enum E{A=0x}", "Literal numérico"],
  ["invalid numeric separator", "enum E{A=1__0}", "Separador numérico"],
  ["missing enum brace", "enum E{A=1", "'}'"],
  ["empty union", "union U=;", "variante"],
  ["duplicate union variant", "union U=A | A;", "duplicada"],
  ["missing union payload close", "union U=A(number;", "')'"],
  ["invalid object discriminator", "union U={tag:identifier};", "discriminador"],
  ["duplicate object binding", "union U={kind:'A';x:number;x:string};", "duplicado"],
  ["binding reuses discriminator", "union U={kind:'A';kind:number};", "duplicado"],
  ["trailing union bar", "union U=A | ;", "variante"],
  ["missing switch case expression", "switch(x){case :break;}", "case necesita"],
  ["missing switch colon", "switch(x){case 1 break;}", "':'"],
  ["duplicate switch default", "switch(x){default:break;default:break;}", "solo puede tener un default"],
  ["statement before case", "switch(x){print(1);case 1:break;}", "case o default"],
  ["missing switch close", "switch(x){case 1:break;", "'}'"],
  ["stray case", "case 1:break;", "requiere un switch"],
  ["stray default", "default:break;", "requiere un switch"],
  ["exported switch", "export switch(x){}", "export necesita"],
] as const) test(`bootstrap parser native declaration diagnostics: ${name}`, () => {
  const result = native(source); assert.ok(result.diagnostics.some(item => item.message.includes(message)), JSON.stringify(result.diagnostics));
  assert.ok(result.diagnostics.every(item => item.span.start.offset <= source.length));
});
test("bootstrap parser: malformed declarations recover to a later declaration", () => {
  const result = native("enum E{A=-1,B=2}\nunion U={kind:bad} | Good;\nswitch(x){case :break;default:break;}\nconst after=42;");
  assert.ok(result.diagnostics.length >= 3);
  assert.equal(fields(statements(result).at(-1)!).name, "after");
});
test("bootstrap parser: nested switches respect the existing recursion bound", () => {
  const source = "switch(x){case 1:".repeat(180) + "break;" + "}".repeat(180);
  assert.ok(native(source).diagnostics.some(item => item.message.includes("anidamiento")));
});
test("bootstrap parser: deterministic declaration token corpus terminates", () => {
  const pieces = ["enum", "union", "switch", "case", "default", "A", "1", "'tag'", "{", "}", "(", ")", ":", ";", ",", "=", "|", "number"];
  let seed = 27183;
  for (let run = 0; run < 40; run++) {
    const parts: string[] = [];
    for (let i = 0; i < 35; i++) { seed = (seed * 16807) % 2147483647; parts.push(pieces[seed % pieces.length]); }
    native(parts.join(" "));
  }
});
