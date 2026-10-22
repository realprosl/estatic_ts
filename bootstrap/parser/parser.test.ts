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
import { scanModuleSyntax } from "../../src/modules/module-syntax.ts";
import { transportTokens } from "./token-transport.ts";
import { prepareParserTokens, type ParserInputToken } from "./template-tokens.ts";
import { templateCases } from "../../test/fixtures/templates.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
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

function transport(tokens: ParserInputToken[]): string[] {
  return transportTokens(tokens);
}
function nativeTokens(tokens?: ParserInputToken[]): NativeResult {
  const result: NativeResult = JSON.parse(execFileSync(binary, tokens === undefined ? [] : transport(tokens), { encoding: "utf8", timeout: 15000, maxBuffer: 32 * 1024 * 1024 }));
  assert.ok(Number.isInteger(result.root) && result.root >= 0 && result.root < result.nodes.length);
  for (const node of result.nodes) for (const edge of node.edges) assert.ok(Number.isInteger(edge.node) && edge.node >= 0 && edge.node < result.nodes.length);
  return result;
}
function native(source: string): NativeResult { return nativeTokens(new Lexer(source).tokenize()); }

// Compare every supported semantic field/edge, independently of arena order.
// Spans have dedicated tests: stage 0 has historical differences for classes
// and synthetic nodes. This projection never evaluates or parses expressions.
const scalarKeys = new Set(["name", "mutable", "declaredType", "async", "returnType", "type", "constraint", "default", "literalType", "raw", "operator", "callee", "member", "method", "optional", "className", "targetType", "isAsync", "await", "out", "passing", "variadic", "readonly", "access", "isStatic", "exported", "key", "value", "underlying", "payload", "field", "property"]);
const roleKinds: Record<string, string> = { params: "Parameter", typeParameters: "TypeParameter", fields: "ClassField", methods: "ClassMethod", properties: "ObjectProperty", decorators: "Decorator", members: "EnumMember", variants: "UnionVariant", discriminator: "Discriminator" };
const excludedRoles = new Set(["span", "typeArguments", "variadicTypeParameters", "generatedSources"]);
function hostShape(node: any, forcedKind?: string): any {
  const kind = node.kind ?? forcedKind;
  const attributes: Record<string, string[]> = {}, edges: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "kind" || excludedRoles.has(key) || value === undefined || (value === false && key !== "value")) continue;
    if (key === "parts" && kind === "TemplateLiteralExpression") {
      edges.parts = (value as string[]).map(value => ({ kind: "TemplatePart", attributes: { value: [value] }, edges: {} }));
    } else if (scalarKeys.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      if (key === "value" && node.literalType === "number" && node.raw !== undefined) continue;
      attributes[key] = [String(value)];
    } else if (Array.isArray(value)) {
      if (value.length) edges[key] = value.map(item => hostShape(item, key === "arrayBindings" ? "ArrayBinding" : key === "objectBindings" ? "ObjectBinding" : kind === "InterfaceDeclaration" && (key === "fields" || key === "methods") ? (key === "fields" ? "InterfaceField" : "InterfaceMethod") : roleKinds[key]));
    } else if (value && typeof value === "object") {
      // The for-of/in binding initializer is synthetic in stage 0.
      if ((kind === "ForOfStatement" || kind === "ForInStatement") && key === "binding") {
        const { initializer, ...binding } = value as any; edges[key] = [hostShape(binding)];
      } else edges[key] = [hostShape(value, roleKinds[key])];
    }
  }
  if (node.mutable === false) attributes.mutable = ["false"];
  if (node.typeArguments?.length) attributes.typeArgument = node.typeArguments;
  if (node.arrayBindings !== undefined) attributes.pattern = ["array"];
  if (node.objectBindings !== undefined) attributes.pattern = ["object"];
  if (kind === "Discriminator") attributes.literalType = [typeof node.value];
  if (kind === "Parameter" && (node.access !== undefined || node.readonly === true)) attributes.parameterProperty = ["true"];
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
  ["public constructor property", "class User{constructor(public name:string){}}"],
  ["private constructor property", "class User{constructor(private age:number){}}"],
  ["protected constructor property", "class User{constructor(protected score:number){}}"],
  ["readonly constructor property", "class User{constructor(readonly id:number){}}"],
  ["public readonly constructor property", "class User{constructor(public readonly id:number){}}"],
  ["private readonly constructor property", "class User{constructor(private readonly id:number){}}"],
  ["protected readonly constructor property", "class User{constructor(protected readonly id:number){}}"],
  ["constructor properties mixed with ordinary parameter", "class User{constructor(public name:string,age:number,readonly id:number){print(age);}}"],
  ["constructor property default", "class User{constructor(public name:string='guest',private age:number=18){}}"],
  ["constructor property optional", "class User{constructor(public name?:string,readonly id?:number){}}"],
  ["constructor optional property default", "class User{constructor(public name?:string='guest'){}}"],
  ["generic constructor property", "class Box<T>{constructor(public value:T){}}"],
  ["array constructor property", "class Box{constructor(public values:number[]=[1,2]){}}"],
  ["fixed array constructor property", "class Box{constructor(readonly values:u8[4]){}}"],
  ["tuple constructor property", "class Box{constructor(public value:[number,string]){}}"],
  ["callable constructor property", "class Box{constructor(readonly make:(x:number)=>string=convert){}}"],
  ["constructor property out passing", "class Box{constructor(out public value:number){}}"],
  ["readonly type ordinary constructor parameter", "class Box{constructor(values:readonly number[]){}}"],
  ["readonly type public constructor property", "class Box{constructor(public values:readonly number[]){}}"],
  ["readonly property and readonly type", "class Box{constructor(readonly values:readonly number[]){}}"],
  ["constructor property matches explicit field", "class Box{value:number;constructor(public value:number){}}"],
  ["private constructor with property", "class Box{private constructor(public value:number){}}"],
  ["constructor property nested default", "class Box{constructor(public name:string=make('a',nested(2))){}}"],
  ["constructor property template default", "class Box{constructor(readonly name:string=`hello ${user}`){}}"],
  ["multiline constructor properties", "class Box{constructor(\npublic name:string='🙂',\nprivate readonly id:number=7\n){}}"],
  ["array bindings", "const [a,b]=values;"],
  ["mutable array bindings", "let [a,b]=values; a=2;"],
  ["typed array bindings", "const [a:number,b:string]=values;"],
  ["default array bindings", "const [a=1,b=a+2]=values;"],
  ["typed default array bindings", "const [a:number=1,b:string='x']=values;"],
  ["array pattern type", "const [a,b]:[number,string]=values;"],
  ["array trailing comma", "const [a,b,]=values;"],
  ["array empty pattern", "const []=values;"],
  ["array complex defaults", "const [a=f(1,2),b=[1,2],c={value:3}]=values;"],
  ["array multiline", "const [\n a:number=1,\n b=2,\n]=values;"],
  ["object shorthand bindings", "const {x,y}=source;"],
  ["object alias bindings", "let {x:left,y:right}=source;"],
  ["object default bindings", "const {x=1,y=x+2}=source;"],
  ["object renamed defaults", "const {name:alias='guest',age:years=18}=source;"],
  ["object primitive binding types", "const {x:number,y:string}=source;"],
  ["object typed aliases", "const {x:alias:number=1,y:other:Box<number> =make()}=source;"],
  ["object pattern type", "const {x,y}:Point=source;"],
  ["object empty pattern", "const {}=source;"],
  ["object trailing comma", "const {x,y,}=source;"],
  ["object multiline bindings", "const {\n name:\n alias:string=\n 'guest',\n age=18,\n}=source;"],
  ["object function type", "const {handler:(x:number)=>string=convert}=source;"],
  ["object tuple binding type", "const {pair:[number,string]=make()}=source;"],
  ["object same property distinct aliases", "const {x:a,x:b}=source;"],
  ["binding declaration in function", "function f():void{const [x]=values;const {name:n}=source;}"],
  ["binding declaration in classic for", "for(let [i]=[0];i<3;i=i+1){print(i);}"],
  ["export array bindings", "export const [a,b]=values;"],
  ["decorated object bindings", "@mark const {name:alias}=source;"],
  ["binding defaults with templates", "const {name:alias=`hello ${user}`}=source;"],
  ...templateCases.map(([name, source]): [string, string] => ["complete template " + name, source + ";"]),
  ["empty template", "``;"],
  ["plain template", "`hello world`;"],
  ["template identifier", "const text=`hello ${name}`;"],
  ["template adjacent expressions", "`${a}${b}`;"],
  ["template precedence", "`sum=${1+2*3}!`;"],
  ["template calls", "`value=${items.map(convert)[0]}`;"],
  ["template ternary", "`${ok?left:right}`;"],
  ["template multiline", "`first\n${value}\nlast`;"],
  ["template unicode", "`España 🙂 ${name}`;"],
  ["template member chain", "`x=${value}`.trim().length;"],
  ["template as call argument", "print(`x=${value}`,`done`);"],
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
for (const source of [
  "const [a,a]=values;", "const {x:a,y:a}=source;", "const {x,x}=source;",
  "const [a,,b]=values;", "const [,a]=values;", "const [...rest]=values;", "const {x,...rest}=source;",
  "const [[a]]=values;", "const [a,{b}]=values;", "const {x:{y}}=source;",
  "const {[key]:value}=source;", "const {'x':value}=source;", "const {1:value}=source;",
  "const [a b]=values;", "const {x y}=source;", "const [a=]=values;", "const {x:alias=}=source;",
  "const [a;", "const {x;", "const [a];", "const {x};", "const [a]=;", "const {x}=;",
  "using [a]=values;", "for(const [a] of rows)print(a);", "const [a,[b=values;",
] as const) test(`bootstrap parser destructuring diagnostics: ${source}`, () => {
  const result = native(source + " print(999);");
  assert.ok(result.diagnostics.length > 0 && result.diagnostics.length <= 100);
});
test("bootstrap parser destructuring recovery preserves the next statement", () => {
  for (const source of ["const [a];", "const {x}=;", "const [a,[b=values;"]) {
    const result = native(source + " print(999);");
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.nodes[result.root].edges.some(edge => {
      const node = result.nodes[edge.node];
      return node.kind === "ExpressionStatement" && node.edges.some(child => result.nodes[child.node].kind === "CallExpression" && result.nodes[child.node].attributes.some(a => a.name === "callee" && a.value === "print"));
    }));
  }
});
test("bootstrap parser destructuring preserves binding order, names, types and defaults", () => {
  const result = native("const {source:local:number=first(),other=local+1}=data;");
  assert.deepEqual(result.diagnostics, []);
  const declaration = result.nodes[result.nodes[result.root].edges[0].node];
  const bindings = declaration.edges.filter(edge => edge.role === "objectBindings").map(edge => result.nodes[edge.node]);
  const attr = (node: NativeNode, name: string) => node.attributes.find(field => field.name === name)?.value;
  assert.equal(attr(declaration, "pattern"), "object"); assert.equal(attr(declaration, "name"), "");
  assert.deepEqual(bindings.map(b => [attr(b,"property"),attr(b,"name"),attr(b,"declaredType")]), [["source","local","number"],["other","other",undefined]]);
  assert.deepEqual(bindings.map(b => result.nodes[b.edges.find(e => e.role === "defaultValue")!.node].kind), ["CallExpression","BinaryExpression"]);
  assert.equal(declaration.edges.filter(e => e.role === "initializer").length, 1);
});
test("bootstrap parser destructuring binding spans preserve Unicode and omit separators", () => {
  const source = "const marker='🙂';\nconst {\n title: label = `España ${name}`,\n count:number=2\n}=data;";
  const result = native(source); assert.deepEqual(result.diagnostics, []);
  const bindings = result.nodes.filter(node => node.kind === "ObjectBinding");
  assert.deepEqual(bindings.map(b => source.slice(b.span.start.offset,b.span.end.offset)), ["title: label = `España ${name}`","count:number=2"]);
  assert.deepEqual(bindings.map(b => [b.span.start.line,b.span.start.column]), [[3,2],[4,2]]);
  const name = result.nodes.find(n => n.kind === "IdentifierExpression" && n.attributes.some(a => a.name === "name" && a.value === "name"))!;
  assert.equal(name.span.start.offset, source.indexOf("name"));
});
test("bootstrap parser destructuring array binding spans include complete default expressions", () => {
  const source = "const [a:number=(1+2),b='🙂',]=values;";
  const result = native(source); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.nodes.filter(n => n.kind === "ArrayBinding").map(n => source.slice(n.span.start.offset,n.span.end.offset)), ["a:number=(1+2)","b='🙂'"]);
});
test("bootstrap parser destructuring tuple annotation never introduces nested bindings", () => {
  const result = native("const {x:[Y]}=source;"); assert.deepEqual(result.diagnostics, []);
  const bindings = result.nodes.filter(n => n.kind === "ObjectBinding"); assert.equal(bindings.length, 1);
  assert.ok(bindings[0].attributes.some(a => a.name === "name" && a.value === "x"));
  assert.ok(bindings[0].attributes.some(a => a.name === "declaredType" && a.value === "[Y]"));
});
test("bootstrap parser destructuring malformed token corpus terminates", () => {
  const pieces = ["a", "b", "=", ",", ":", "[", "]", "{", "}", "(", ")", "...", "number", "1", ";"];
  let seed = 5531;
  for (let run = 0; run < 30; run++) {
    const parts: string[] = [];
    for (let i = 0; i < 25; i++) { seed = seed * 16807 % 2147483647; parts.push(pieces[seed % pieces.length]); }
    const result = native("const [" + parts.join(" ") + "]=values; print(999);");
    assert.ok(result.diagnostics.length <= 100);
  }
});
for (const source of [
  "class C{method(public value:number):void{}}", "class C{method(readonly value:number):void{}}",
  "class C{static method(private value:number):void{}}", "class C{static constructor(public value:number){}}",
  "function f(public value:number):void{}", "function f(readonly value:number):void{}",
  "interface C{method(public value:number):void;}", "interface C{method(readonly value:number):void;}",
  "const f=(public value:number):number=>value;", "const f=(readonly value:number):number=>value;",
  "class C{constructor(public private value:number){}}", "class C{constructor(public public value:number){}}",
  "class C{constructor(readonly readonly value:number){}}", "class C{constructor(readonly public value:number){}}",
  "class C{constructor(...public values:number[]){}}", "class C{constructor(public){}}",
  "class C{constructor(readonly){}}", "class C{constructor(public value){}}",
  "class C{constructor(public value:){}}", "class C{constructor(public value:number=){}}",
  "class C{constructor(public value:number=,readonly next:number=2){}}",
  "class C{constructor(public value:number private other:number){}}",
  "class C{constructor(static value:number){}}", "class C{constructor(public out value:number){}}",
  "class C{constructor(public value:number{}}",
] as const) test(`bootstrap parser parameter property diagnostics: ${source}`, () => {
  const result = native(source); assert.ok(result.diagnostics.length > 0 && result.diagnostics.length <= 100);
});
test("bootstrap parser parameter properties preserve modifiers without synthesizing fields", () => {
  const result = native("class User{constructor(public name:string='guest',private readonly id:number=7,age:number=18){}}");
  assert.deepEqual(result.diagnostics, []);
  const cls = result.nodes[result.nodes[result.root].edges[0].node];
  assert.equal(cls.edges.filter(e => e.role === "fields").length, 0);
  const ctor = result.nodes[cls.edges.find(e => e.role === "methods")!.node];
  const params = ctor.edges.filter(e => e.role === "params").map(e => result.nodes[e.node]);
  const attr = (node: NativeNode, name: string) => node.attributes.find(a => a.name === name)?.value;
  assert.deepEqual(params.map(p => [attr(p,"name"),attr(p,"type"),attr(p,"access"),attr(p,"readonly"),attr(p,"parameterProperty")]), [["name","string","public",undefined,"true"],["id","number","private","true","true"],["age","number",undefined,undefined,undefined]]);
  assert.deepEqual(params.map(p => result.nodes[p.edges.find(e => e.role === "defaultValue")!.node].attributes.find(a => a.name === "value" || a.name === "raw")!.value), ["guest","7","18"]);
});
test("bootstrap parser parameter property spans cover modifiers, types and defaults", () => {
  const source = "const marker='🙂';\nclass C{constructor(\n public readonly name:string=`España ${user}`,\n private id:number=(1+2),\n raw:readonly number[]\n){}}";
  const result = native(source); assert.deepEqual(result.diagnostics, []);
  const params = result.nodes.filter(n => n.kind === "Parameter");
  assert.deepEqual(params.map(p => source.slice(p.span.start.offset,p.span.end.offset)), ["public readonly name:string=`España ${user}`","private id:number=(1+2)","raw:readonly number[]"]);
  assert.deepEqual(params.map(p => [p.span.start.line,p.span.start.column]), [[3,2],[4,2],[5,2]]);
  assert.ok(!params[2].attributes.some(a => a.name === "parameterProperty" || a.name === "readonly"));
  assert.ok(result.nodes.some(n => n.kind === "IdentifierExpression" && n.attributes.some(a => a.name === "name" && a.value === "user") && n.span.start.offset === source.indexOf("user")));
});
test("bootstrap parser parameter property recovery keeps following parameters and methods", () => {
  const result = native("class C{constructor(public bad:number=,private good:number=2){} ok():number{return 3;}}");
  assert.ok(result.diagnostics.some(d => d.message.includes("valor por defecto")));
  assert.ok(result.nodes.some(n => n.kind === "Parameter" && n.attributes.some(a => a.name === "name" && a.value === "good") && n.attributes.some(a => a.name === "parameterProperty" && a.value === "true")));
  assert.ok(result.nodes.some(n => n.kind === "ClassMethod" && n.attributes.some(a => a.name === "name" && a.value === "ok")));
});
test("bootstrap parser anonymous default class keeps constructor properties", () => {
  const result = native("export default class{constructor(public value:number=7){}}"); assert.deepEqual(result.diagnostics, []);
  assert.ok(result.nodes.some(n => n.kind === "ClassDeclaration" && n.attributes.some(a => a.name === "anonymous" && a.value === "true")));
  assert.equal(result.nodes.filter(n => n.kind === "Parameter" && n.attributes.some(a => a.name === "parameterProperty")).length, 1);
});
test("bootstrap parser ordinary parameter spans cover out, rest, defaults and arrows", () => {
  const source = "function f(out value:number,...rest:string[]):void{} const g=(x:number=1):number=>x;";
  const result = native(source); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.nodes.filter(n => n.kind === "Parameter").map(p => source.slice(p.span.start.offset,p.span.end.offset)), ["out value:number","...rest:string[]","x:number=1"]);
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

// Stage 0 extracts module forms before parsing and discards their AST. Compare
// preserved requests/exports with that extractor, not its placeholder nodes.
function moduleMetadata(result: NativeResult): { requests: any[]; exports: any[] } {
  const requests: any[] = [], exports: any[] = [];
  for (const node of statements(result)) {
    const attrs = fields(node), specifiers = children(result, node, "specifiers").map(fields);
    if (node.kind === "ImportDeclaration") {
      const bindings = specifiers.filter(item => item.form !== "namespace").map(item => ({ imported: item.imported, local: item.local }));
      const namespace = specifiers.find(item => item.form === "namespace")?.local;
      requests.push({ specifier: attrs.source, names: bindings.map(item => item.imported), ...(bindings.length ? { bindings } : {}), ...(namespace ? { namespace } : {}), line: node.span.start.line });
    } else if (node.kind === "ExportNamedDeclaration") {
      const bindings = specifiers.map(item => ({ imported: item.name, local: item.alias ?? item.name }));
      if (attrs.source !== undefined) requests.push({ specifier: attrs.source, names: bindings.map(item => item.imported), ...(bindings.length ? { bindings } : {}), reexport: true, line: node.span.start.line });
      else exports.push(...bindings.map(item => ({ name: item.imported, exported: item.local })));
    } else if (node.kind === "ExportAllDeclaration") {
      requests.push({ specifier: attrs.source, names: [], ...(attrs.namespace ? { namespace: attrs.namespace } : { star: true }), reexport: true, line: node.span.start.line });
    }
  }
  return { requests, exports };
}
const moduleFixtures: [string, string][] = [
  ["side effect", "import './setup';"],
  ["default import", "import entry from './entry';"],
  ["contextual from binding", "import from from './entry';"],
  ["contextual from namespace", "import * as from from './entry';"],
  ["named imports", "import {one,two} from './values';"],
  ["named aliases", "import {increment as add,base as seed} from './values';"],
  ["default as named", "import {default as entry} from './entry';"],
  ["namespace", "import * as values from './values';"],
  ["default and named", "import entry,{one,two as second} from './entry';"],
  ["default and namespace", "import entry,* as values from './entry';"],
  ["empty import list", "import {} from './setup';"],
  ["trailing import comma", "import {one,two as second,} from './values';"],
  ["import type list", "import type {Shape,Box as Crate} from './types';"],
  ["import type default", "import type Shape from './types';"],
  ["import type namespace", "import type * as Types from './types';"],
  ["per specifier type", "import {type Shape,increment,type Box as Crate} from './values';"],
  ["multiline list", "import {\n one,\n two as second,\n}\nfrom './values';"],
  ["multiline default namespace", "import\n entry,\n *\n as\n values\n from\n './values';"],
  ["comments", "import /*binding*/ {one /*alias*/ as first} /*source*/ from './values';"],
  ["bare package specifier", "import {join as pathJoin} from '@example/path';"],
  ["no semicolon", "import {one} from './values'\nprint(one);"],
  ["several imports", "import './setup'; import first from './a'; import {x as value} from './b';"],
  ["local export list", "export {one,two};"],
  ["local export alias", "export {one as first,two as second};"],
  ["local export default alias", "export {entry as default};"],
  ["empty local export", "export {};"],
  ["trailing export comma", "export {one as first,};"],
  ["named reexport", "export {one,two as second} from './values';"],
  ["default reexport", "export {default as entry} from './entry';"],
  ["reexport as default", "export {entry as default} from './entry';"],
  ["reexport star", "export * from './values';"],
  ["reexport namespace", "export * as values from './values';"],
  ["reexport namespace as default", "export * as default from './values';"],
  ["type local export", "export type {Shape,Box as Crate};"],
  ["type named reexport", "export type {Shape,Box as Crate} from './types';"],
  ["type star reexport", "export type * from './types';"],
  ["type namespace reexport", "export type * as Types from './types';"],
  ["per specifier type export", "export {type Shape,increment as add};"],
  ["multiline reexport", "export\n type\n {Shape as View,}\n from\n './types';"],
  ["export newline terminates", "export {one as first}\nconst next=2;"],
  ["empty reexport", "export {} from './setup';"],
  ["unicode source", "import {value as local} from './España-🙂';"],
];
for (const [name, source] of moduleFixtures) test(`bootstrap parser native module metadata parity: ${name}`, () => {
  const result = native(source); assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  const expected = scanModuleSyntax(source);
  assert.deepEqual(moduleMetadata(result), { requests: expected.requests, exports: expected.exports.map(({name,exported}) => ({name,exported})) });
});

const defaultFixtures: [string, string][] = [
  ["number", "export default 42;"],
  ["identifier", "export default answer;"],
  ["object", "export default {ok:true,value:42};"],
  ["array", "export default [1,2,3];"],
  ["call", "export default create();"],
  ["arrow", "export default (x:number)=>x+1;"],
  ["named function", "export default function add(x:number):number{return x+1;}"],
  ["named async function", "export default async function load():Promise<number>{return await read();}"],
  ["named class", "export default class Box{value:number;constructor(value:number){this.value=value;}}"],
  ["variable declaration compatibility", "export default const answer:number=42;"],
  ["decorated named function", "@trace('f') export default function f():void{}"],
];
for (const [name, source] of defaultFixtures) test(`bootstrap parser native default export parity: ${name}`, () => { parity(source); });

test("bootstrap parser: module AST is pinned independently including alias token kind", () => {
  const source = "import {value as local} from './m'; export {local as publicValue};";
  assert.equal(new Lexer(source).tokenize().find(token => token.lexeme === "as")!.kind, "as");
  const result = native(source); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(nativeShape(result), shape("Program", {}, { statements: [
    shape("ImportDeclaration", { source: "./m" }, { specifiers: [shape("ImportSpecifier", { imported: "value", local: "local", form: "named" })] }),
    shape("ExportNamedDeclaration", {}, { specifiers: [shape("ExportSpecifier", { name: "local", alias: "publicValue" })] }),
  ] }));
});
test("bootstrap parser: type flags survive on declarations and individual bindings", () => {
  const result = native("import type Default,{Box as Crate} from './types'; import {type Shape,run} from './values'; export {type Shape as View,run}; export type * as Types from './types';");
  assert.deepEqual(result.diagnostics, []); const nodes = statements(result);
  assert.equal(fields(nodes[0]).typeOnly, "true");
  assert.deepEqual(children(result, nodes[0], "specifiers").map(node => fields(node).typeOnly), ["true", "true"]);
  assert.deepEqual(children(result, nodes[1], "specifiers").map(node => fields(node).typeOnly), ["true", undefined]);
  assert.deepEqual(children(result, nodes[2], "specifiers").map(node => fields(node).typeOnly), ["true", undefined]);
  assert.deepEqual(fields(nodes[3]), { namespace: "Types", source: "./types", typeOnly: "true" });
});
test("bootstrap parser: contextual type name is distinguished from type modifier", () => {
  const result = native("import {type as typeValue} from './m'; export {typeValue as type};");
  assert.deepEqual(result.diagnostics, []); const nodes = statements(result);
  assert.deepEqual(fields(children(result, nodes[0], "specifiers")[0]), { imported: "type", local: "typeValue", form: "named" });
  assert.deepEqual(fields(children(result, nodes[1], "specifiers")[0]), { name: "typeValue", alias: "type" });
});
for (const [name, source, kind] of [
  ["anonymous function", "export default function(x:number):number{return x;}", "FunctionDeclaration"],
  ["anonymous async function", "export default async function():Promise<number>{return await read();}", "FunctionDeclaration"],
  ["anonymous generic function", "export default function<T>(x:T):T{return x;}", "FunctionDeclaration"],
  ["anonymous class", "export default class{value:number;}", "ClassDeclaration"],
  ["anonymous generic class", "export default class<T>{value:T;}", "ClassDeclaration"],
] as const) test(`bootstrap parser: ${name} keeps anonymous identity without synthetic global`, () => {
  const result = native(source); assert.deepEqual(result.diagnostics, []); const declaration = children(result, statements(result)[0], "declaration")[0];
  assert.equal(declaration.kind, kind); assert.equal(fields(declaration).anonymous, "true");
  assert.equal(fields(declaration).name, undefined);
  assert.ok(!result.nodes.some(node => node.attributes.some(field => field.value.startsWith("ets_default_"))));
});
test("bootstrap parser: default async arrow remains an expression", () => {
  const result = native("export default async (x:number)=>await load(x);"); assert.deepEqual(result.diagnostics, []);
  const declaration = children(result, statements(result)[0], "declaration")[0]; assert.equal(declaration.kind, "ArrowFunctionExpression"); assert.equal(fields(declaration).isAsync, "true");
});
test("bootstrap parser: module source names are metadata and never resolved", () => {
  const result = native("import {missing as local} from './does-not-exist'; export * from 'unknown-package'; export {local as publicName};");
  assert.deepEqual(result.diagnostics, []); assert.equal(moduleMetadata(result).requests.length, 2);
});
test("bootstrap parser: module spans include aliases and preserve following statements", () => {
  const source = "import {value as local} from './🙂'\nexport {local as publicValue};\nconst after=1;";
  const result = native(source); assert.deepEqual(result.diagnostics, []); const nodes = statements(result);
  const item = children(result, nodes[0], "specifiers")[0];
  assert.equal(item.span.start.offset, source.indexOf("value")); assert.equal(item.span.end.offset, source.indexOf("local") + 5);
  assert.equal(nodes[0].span.end.offset, source.indexOf("\n")); assert.equal(nodes[1].span.start.line, 2);
  assert.equal(fields(nodes[2]).name, "after");
});
test("bootstrap parser: both complete drivers now parse their import statements", () => {
  for (const path of ["bootstrap/lexer/demo.ets", "bootstrap/parser/demo.ets"]) {
    const result = native(readFileSync(join(root, path), "utf8")); assert.deepEqual(result.diagnostics, [], path);
    assert.equal(statements(result)[0].kind, "ImportDeclaration");
  }
});
for (const [name, source, message] of [
  ["missing import from", "import {value} './m';", "'from'"],
  ["missing module string", "import {value} from 42;", "literal de módulo"],
  ["missing imported name", "import {,} from './m';", "nombre de import/export"],
  ["missing local alias", "import {value as } from './m';", "'identifier'"],
  ["default cannot be local binding", "import {value as default} from './m';", "'identifier'"],
  ["named default needs alias", "import {default} from './m';", "nombre local"],
  ["duplicate import aliases", "import {one as local,two as local} from './m';", "duplicado"],
  ["duplicate default and named", "import local,{one as local} from './m';", "duplicado"],
  ["namespace requires as", "import * ns from './m';", "requiere 'as nombre'"],
  ["namespace requires name", "import * as from './m';", "'from'"],
  ["missing import comma", "import {one two} from './m';", "entre nombres"],
  ["missing import close", "import {one from './m';", "'}'"],
  ["default trailing comma", "import local, from './m';", "binding, namespace"],
  ["dynamic import", "import('./m');", "import dinámico"],
  ["import in function", "function f():void{import {x} from './m';}", "nivel superior"],
  ["export in function", "function f():void{export {x};}", "nivel superior"],
  ["export import", "export import {x} from './m';", "no puede preceder"],
  ["missing export alias", "export {value as };", "nombre de import/export"],
  ["missing export comma", "export {one two};", "entre nombres"],
  ["duplicate exported names", "export {one as publicName,two as publicName};", "duplicado"],
  ["missing reexport module", "export {x} from;", "literal de módulo"],
  ["star reexport requires source", "export *;", "'from'"],
  ["namespace export requires name", "export * as from './m';", "'from'"],
  ["default missing expression", "export default;", "expresión"],
  ["default missing function body", "export default function f():void", "'{'"],
  ["decorated import", "@trace import {x} from './m';", "decoradores"],
  ["decorated export list", "@trace export {x};", "decoradores"],
  ["decorated default expression", "@trace export default 42;", "decoradores"],
  ["quoted exported name", "export {x as 'public-name'};", "nombre de import/export"],
  ["import attributes remain unsupported", "import data from './m' with {type:'json'};", "terminador"],
] as const) test(`bootstrap parser native module diagnostics: ${name}`, () => {
  const result = native(source); assert.ok(result.diagnostics.some(item => item.message.includes(message)), JSON.stringify(result.diagnostics));
});
test("bootstrap parser: incomplete imports recover before a following declaration", () => {
  for (const source of ["import {x}\nconst after=1;", "export {x} from\nconst after=1;", "import {x as } from './m';\nconst after=1;"]) {
    const result = native(source); assert.ok(result.diagnostics.length > 0);
    assert.equal(fields(statements(result).at(-1)!).name, "after");
  }
});
test("bootstrap parser: anonymous default identity does not collide with source names", () => {
  const result = native("const ets_default_0=1; export default function():number{return ets_default_0;}");
  assert.deepEqual(result.diagnostics, []); const declaration = children(result, statements(result)[1], "declaration")[0];
  assert.deepEqual(fields(declaration), { anonymous: "true", async: "false", returnType: "number" });
});
test("bootstrap parser: deterministic malformed module token corpus terminates", () => {
  const pieces = ["import", "export", "default", "type", "as", "from", "local", "other", "'./m'", "{", "}", ",", ";", "*", "(", ")", "function"];
  let seed = 47329;
  for (let run = 0; run < 40; run++) {
    const parts: string[] = [];
    for (let i = 0; i < 35; i++) { seed = (seed * 16807) % 2147483647; parts.push(pieces[seed % pieces.length]); }
    native(parts.join(" "));
  }
});
for (const [name, source, parts, expressions] of [
  ["escaped interpolation", '`raw \\${name}`;', ['raw \\${name}'], 0],
  ["escaped backtick", '`a\\`b`;', ['a\\`b'], 0],
  ["escaped backslash before interpolation", '`a\\\\${value}`;', ['a\\\\', ''], 1],
  ["object braces", '`${({value:1}).value}`;', ['', ''], 1],
  ["string brace", '`${"}"}`;', ['', ''], 1],
  ["comment braces", '`${1 /* } { */ + 2}`;', ['', ''], 1],
  ["line comment braces", '`${1 // }\n +2}`;', ['', ''], 1],
  ["nested template", '`outer ${`inner ${name}`} end`;', ['outer ', ' end'], 1],
  ["interpolation edge newlines", '`${\n value\n}`;', ['', ''], 1],
] as const) test(`bootstrap parser templates independent: ${name}`, () => {
  const result = native(source); assert.deepEqual(result.diagnostics, []);
  const statement = result.nodes[result.root].edges[0].node;
  const template = result.nodes[result.nodes[statement].edges[0].node];
  assert.equal(template.kind, "TemplateLiteralExpression");
  assert.deepEqual(template.edges.filter(edge => edge.role === "parts").map(edge => result.nodes[edge.node].attributes[0].value), parts);
  assert.equal(template.edges.filter(edge => edge.role === "expressions").length, expressions);
  if (name === "nested template") {
    const inner = result.nodes[template.edges.find(edge => edge.role === "expressions")!.node];
    assert.equal(inner.kind, "TemplateLiteralExpression");
    assert.deepEqual(inner.edges.filter(edge => edge.role === "parts").map(edge => result.nodes[edge.node].attributes[0].value), ["inner ", ""]);
    const identifier = result.nodes[inner.edges.find(edge => edge.role === "expressions")!.node];
    assert.equal(identifier.kind, "IdentifierExpression"); assert.deepEqual(identifier.attributes, [{ name: "name", value: "name" }]);
  }
});
for (const source of ['`${}`; print(7);', '`${a b}`; print(7);', '`${1+}`; print(7);'])
  test(`bootstrap parser templates reject malformed expression: ${source}`, () => {
    const result = native(source); assert.ok(result.diagnostics.length > 0);
    assert.ok(result.nodes.some(node => node.kind === "CallExpression" && node.attributes.some(a => a.name === "callee" && a.value === "print")));
  });
test("bootstrap parser templates preserve absolute UTF-16 positions", () => {
  const source = 'const s=`🙂\nhello ${name + 1}!`;'; const result = native(source);
  assert.deepEqual(result.diagnostics, []);
  const name = result.nodes.find(node => node.kind === "IdentifierExpression" && node.attributes.some(a => a.name === "name" && a.value === "name"))!;
  assert.deepEqual(name.span, { start: { offset: source.indexOf("name"), line: 2, column: 9 }, end: { offset: source.indexOf("name") + 4, line: 2, column: 13 } });
  const template = result.nodes.find(node => node.kind === "TemplateLiteralExpression")!;
  assert.equal(template.span.start.offset, source.indexOf('`'));
  assert.equal(template.span.end.offset, source.lastIndexOf('`') + 1);
});
test("bootstrap parser templates accept hand-prepared tokens without lexer dependency", () => {
  const token = (kind: string, lexeme: string, start: number, end: number): ParserInputToken => ({ kind, lexeme, span: { start: { offset: start, line: 1, column: start + 1 }, end: { offset: end, line: 1, column: end + 1 } } });
  const result = nativeTokens([token("template-start", "`", 0, 1), token("template-text", "", 1, 1), token("interpolation-start", "${", 1, 3), token("number", "42", 3, 5), token("interpolation-end", "}", 5, 6), token("template-text", "", 6, 6), token("template-end", "`", 6, 7), token("eof", "", 7, 7)]);
  assert.deepEqual(result.diagnostics, []); assert.ok(result.nodes.some(node => node.kind === "TemplateLiteralExpression"));
  // Bound the native parser independently of the host adapter's lexical limit.
  const deep: ParserInputToken[] = [];
  for (let i = 0; i < 140; i++) deep.push(token("template-start", "`", 0, 1), token("template-text", "", 1, 1), token("interpolation-start", "${", 1, 3));
  deep.push(token("number", "1", 3, 4));
  for (let i = 0; i < 140; i++) deep.push(token("interpolation-end", "}", 4, 5), token("template-text", "", 5, 5), token("template-end", "`", 5, 6));
  deep.push(token("eof", "", 6, 6));
  const limited = nativeTokens(deep); assert.ok(limited.diagnostics.some(d => d.message.includes("Límite de anidamiento")));
  assert.ok(limited.diagnostics.length <= 100);
});
test("bootstrap parser template adapter is idempotent and retains original tokens", () => {
  const tokens = new Lexer('`x=${name}`;').tokenize(); const saved = JSON.stringify(tokens);
  const prepared = prepareParserTokens(tokens); assert.deepEqual(prepareParserTokens(prepared), prepared);
  assert.equal(JSON.stringify(tokens), saved);
});
for (const omitted of ["template-text", "interpolation-end", "template-end"])
  test(`bootstrap parser templates diagnose missing prepared ${omitted}`, () => {
    const tokens = prepareParserTokens(new Lexer('`x=${name}`; print(7);').tokenize());
    tokens.splice(tokens.findIndex(token => token.kind === omitted), 1);
    const result = nativeTokens(tokens); assert.ok(result.diagnostics.length > 0 && result.diagnostics.length <= 100);
  });
test("bootstrap parser templates diagnose unprepared raw token", () => {
  const tokens = new Lexer('`hello`;').tokenize().map(t => t.kind === "template" ? { ...t, kind: "raw-template" } : t);
  // Bypass host preparation by changing the packed kind after encoding.
  const args = transportTokens(tokens).map(s => s.replace("12:raw-template", "8:template"));
  const result: NativeResult = JSON.parse(execFileSync(binary, args, { encoding: "utf8", timeout: 15000 }));
  assert.ok(result.diagnostics.some(d => d.message.includes("preparación léxica")));
});
test("bootstrap parser templates diagnose missing closing brace in raw input", () => {
  const tokens = new Lexer('`hello`;').tokenize(); tokens[0] = { ...tokens[0], lexeme: '${name' };
  const result = nativeTokens(tokens); assert.ok(result.diagnostics.some(d => d.message.includes("sin cerrar")));
});
test("bootstrap parser template preparation bounds nested lexical scanning", () => {
  const tokens = new Lexer('`hello`;').tokenize();
  tokens[0] = { ...tokens[0], lexeme: '${`'.repeat(200) + 'name' + '`}'.repeat(200) };
  assert.ok(prepareParserTokens(tokens).some(token => token.kind === "template-error"));
});
test("bootstrap parser template preparation keeps empty segments and spans", () => {
  const source = '`${a}${b}`'; const tokens = prepareParserTokens(new Lexer(source).tokenize());
  const parts = tokens.filter(t => t.kind === "template-text");
  assert.deepEqual(parts.map(t => t.lexeme), ["", "", ""]);
  assert.deepEqual(parts.map(t => [t.span.start.offset, t.span.end.offset]), [[1, 1], [5, 5], [9, 9]]);
});
test("bootstrap parser template adapter rebases lexical diagnostics", () => {
  const source = 'const s=`🙂\n${$}`;';
  assert.throws(() => prepareParserTokens(new Lexer(source).tokenize()), (error: any) => error instanceof DiagnosticError && error.diagnostics[0].span.start.offset === source.lastIndexOf("$") && error.diagnostics[0].span.start.line === 2);
});
test("bootstrap parser templates: truncated calls, arrays and objects terminate with diagnostics", () => {
  for (const source of ['`${foo(}`;', '`${[1,}`;', '`${({a:})}`;']) {
    const result = native(source); assert.ok(result.diagnostics.length > 0 && result.diagnostics.length <= 100, source);
  }
});
test("bootstrap parser: packed transport uses UTF-8 lengths and one argument per token", () => {
  const tokens = new Lexer("'🙂:España'").tokenize(); const args = transportTokens(tokens);
  assert.equal(args.length, tokens.length + 1); assert.ok(args[1].startsWith("6:string12:🙂:España"));
  assert.deepEqual(nativeTokens(tokens).diagnostics, []);
});
for (const record of ["", "x:bad", "999:a", "6:number1:10:1:11:11:11:11:1", transportTokens(new Lexer("1").tokenize())[1] + "junk"])
  test(`bootstrap parser: malformed token frame is rejected ${record}`, () => {
    assert.throws(() => execFileSync(binary, ["--tokens", record], { encoding: "utf8", timeout: 5000 }), (error: any) => error.status === 2 && error.stdout.includes("Invalid token transport"));
  });
