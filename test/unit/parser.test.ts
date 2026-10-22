// Unit tests del parser.
// Verifica que el parser produce el AST esperado para snippets
// representativos del dialecto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../src/lexer/lexer.ts";
import { Parser } from "../../src/parser/parser.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { templateCases } from "../fixtures/templates.ts";

function parse(source: string) {
  return new Parser(new Lexer(source).tokenize()).parseProgram();
}

function firstStatement(source: string): unknown {
  const ast = parse(source);
  assert.equal(ast.kind, "Program");
  return ast.statements[0];
}

for (const [name, source] of templateCases) test(`parser templates: ${name}`, () => {
  const statement = firstStatement(source + ";") as any;
  assert.equal(statement.expression.kind, "TemplateLiteralExpression");
  assert.equal(statement.expression.parts.length, statement.expression.expressions.length + 1);
  assert.deepEqual(statement.expression.span, new Lexer(source).tokenize()[0].span);
});
test("parser templates: escaped interpolation is literal and keeps raw escapes", () => {
  const statement = firstStatement('`raw \\${name} \\n \\` \\\\`;') as any;
  assert.deepEqual(statement.expression.parts, ['raw \\${name} \\n \\` \\\\']);
  assert.deepEqual(statement.expression.expressions, []);
});
test("parser templates: nested AST and absolute UTF-16 spans", () => {
  const source = 'const s=`🙂\nouter ${`inner ${missing}`}`;';
  const statement = firstStatement(source) as any;
  assert.deepEqual(statement.initializer.parts, ["🙂\nouter ", ""]);
  const inner = statement.initializer.expressions[0]; assert.equal(inner.kind, "TemplateLiteralExpression");
  assert.deepEqual(inner.parts, ["inner ", ""]);
  const identifier = inner.expressions[0]; assert.equal(identifier.name, "missing");
  const offset = source.indexOf("missing"), column = offset - source.lastIndexOf("\n", offset);
  assert.deepEqual(identifier.span, { start: { offset, line: 2, column }, end: { offset: offset + 7, line: 2, column: column + 7 } });
});
for (const source of ['`${}`;', '`${a b}`;', '`${1+}`;', '`${1;2}`;']) test(`parser templates reject malformed expression: ${source}`, () => {
  assert.throws(() => parse(source), (error: any) => error instanceof DiagnosticError && error.diagnostics.some(d => d.phase === "parser"));
});
test("parser templates: lexical diagnostics use absolute interpolation position", () => {
  const source = 'const s=`🙂\nvalue ${$}`;'; const offset = source.indexOf("$}");
  assert.throws(() => parse(source), (error: any) => error instanceof DiagnosticError && error.diagnostics[0].phase === "lexer" && error.diagnostics[0].span.start.offset === offset && error.diagnostics[0].span.start.line === 2);
});
test("parser templates: truncated calls, arrays and objects report diagnostics at EOF", () => {
  for (const source of ['`${foo(}`;', '`${[1,}`;', '`${({a:})}`;']) {
    assert.throws(() => parse(source), (error: any) => error instanceof DiagnosticError && error.diagnostics.some(d => d.phase === "parser"), source);
  }
});

test("parser: declaración de variable simple", () => {
  const stmt = firstStatement("let x: number = 42;") as { kind: string; name: string; mutable: boolean };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.name, "x");
  assert.equal(stmt.mutable, true);
});

test("parser: declaración const inmutable", () => {
  const stmt = firstStatement("const pi: number = 3.14;") as { kind: string; name: string; mutable: boolean };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.name, "pi");
  assert.equal(stmt.mutable, false);
});

test("parser: array literal", () => {
  const stmt = firstStatement("const arr: number[] = [1, 2, 3];") as { kind: string; initializer: { kind: string; elements: unknown[] } };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.initializer.kind, "ArrayLiteralExpression");
  assert.equal(stmt.initializer.elements.length, 3);
});

test("parser: object destructuring aliases and typed bindings preserve defaults", () => {
  const statement = firstStatement("const {name:alias='guest',count:number=2,total:sum:number=3}=source;") as any;
  assert.deepEqual(statement.objectBindings.map((b:any) => [b.property,b.name,b.declaredType,b.defaultValue.value]), [["name","alias",undefined,"guest"],["count","count","number",2],["total","sum","number",3]]);
});
test("parser: multiline object destructuring retains aliases and defaults", () => {
  const statement = firstStatement("const {\n name:\n alias:string=\n 'guest',\n count=2,\n}=source;") as any;
  assert.deepEqual(statement.objectBindings.map((b:any) => [b.property,b.name,b.defaultValue.value]), [["name","alias","guest"],["count","count",2]]);
});
test("parser: constructor parameter properties preserve access, readonly and defaults", () => {
  const cls = firstStatement("class User{constructor(public name:string='guest',private readonly id:number=7,readonly tag:string='x',age:number=18){}}") as any;
  assert.equal(cls.fields.length, 0);
  assert.deepEqual(cls.methods[0].params.map((p:any) => [p.name,p.type,p.access,p.readonly,p.defaultValue.value]), [["name","string","public",false,"guest"],["id","number","private",true,7],["tag","string",undefined,true,"x"],["age","number",undefined,false,18]]);
});
test("parser: readonly parameter type alone does not declare a property", () => {
  const cls = firstStatement("class Box{constructor(values:readonly number[]){}}") as any;
  assert.equal(cls.methods[0].params[0].readonly, false); assert.equal(cls.methods[0].params[0].access, undefined);
  assert.equal(cls.methods[0].params[0].type, "readonly<number[]>");
});
for (const source of ["class C{method(public value:number):void{}}", "class C{method(readonly value:number):void{}}", "class C{static method(private value:number):void{}}", "class C{static constructor(public value:number){}}"])
  test(`parser rejects parameter properties outside instance constructors: ${source}`, () => {
    assert.throws(() => parse(source), (error:any) => error instanceof DiagnosticError && error.diagnostics.some(d => d.phase === "parser" && d.message.includes("constructores de instancia")));
  });

test("parser: variadic type parameters preserve ordered pack names and rest parameters", () => {
  const fn = firstStatement("function f<Head,...Left,...Right>(head:Head,...values:Left):void{}") as any;
  assert.deepEqual(fn.typeParameters.map((p:any)=>p.name), ["Head","Left","Right"]);
  assert.deepEqual(fn.variadicTypeParameters, ["Left","Right"]);
  assert.equal(fn.params[1].variadic,true); assert.equal(fn.params[1].type,"Left");
});
test("parser: multiline generic packs accept trailing comma and retain constraints and defaults", () => {
  const fn = firstStatement("function f<\nHead=number,\n...Tail extends Box<number> =Box<number>,\n>(head:Head,...tail:Tail):void{}") as any;
  assert.deepEqual(fn.variadicTypeParameters,["Tail"]);
  assert.equal(fn.typeParameters[0].default,"number");
  assert.equal(fn.typeParameters[1].constraint,"Box<number>"); assert.equal(fn.typeParameters[1].default,"Box<number>");
});
test("parser: class packs remain visible for semantic rejection", () => {
  const cls=firstStatement("class Box<Head,...Tail>{}") as any; assert.deepEqual(cls.variadicTypeParameters,["Tail"]);
});
for(const source of ["function f<>():void{}","function f<...>():void{}","function f<T,T>():void{}","function f<T,...T>(...values:T):void{}","function f<T U>():void{}","class C{f<...T>():void{}}","class C{static f<...T>():void{}}","union U<...T> = Value(T);"])
  test(`parser: invalid generic list or unsupported pack is diagnosed ${source}`,()=>{
    assert.throws(()=>parse(source),(error:any)=>error instanceof DiagnosticError && error.diagnostics.some(d=>d.phase==="parser"));
  });
test("parser: array destructuring", () => {
  // Usamos un initializer literal para que el parser no necesite saber el
  // tipo de `arr` (eso es responsabilidad del type-checker, no del parser).
  const stmt = firstStatement("const [a, b, c] = [1, 2, 3];") as { kind: string; arrayBindings: { name: string }[] };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.ok(stmt.arrayBindings);
  assert.equal(stmt.arrayBindings.length, 3);
  assert.deepEqual(stmt.arrayBindings.map(b => b.name), ["a", "b", "c"]);
});

test("parser: destructuring con default values", () => {
  const stmt = firstStatement("const [a = 1, b = 2] = arr;") as { kind: string; arrayBindings: { name: string; defaultValue?: { kind: string } }[] };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.arrayBindings.length, 2);
  assert.ok(stmt.arrayBindings[0].defaultValue);
  assert.ok(stmt.arrayBindings[1].defaultValue);
});

test("parser: destructuring con tipos declarados", () => {
  const stmt = firstStatement("const [a: number, b: string] = arr;") as { kind: string; arrayBindings: { name: string; declaredType?: string }[] };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.arrayBindings[0].declaredType, "number");
  assert.equal(stmt.arrayBindings[1].declaredType, "string");
});

test("parser: spread en array literal", () => {
  const stmt = firstStatement("const c = [...a, ...b];") as { kind: string; initializer: { elements: { kind: string }[] } };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.initializer.elements.length, 2);
  assert.equal(stmt.initializer.elements[0].kind, "SpreadElement");
  assert.equal(stmt.initializer.elements[1].kind, "SpreadElement");
});

test("parser: class con campos", () => {
  const stmt = firstStatement("class Foo { x: number; y: string; }") as { kind: string; name: string; fields: { name: string }[] };
  assert.equal(stmt.kind, "ClassDeclaration");
  assert.equal(stmt.name, "Foo");
  assert.equal(stmt.fields.length, 2);
  assert.deepEqual(stmt.fields.map(f => f.name), ["x", "y"]);
});

test("parser: class con constructor", () => {
  const stmt = firstStatement("class Foo { x: number; constructor(n: number) { this.x = n; } }") as { kind: string; methods: { name: string; params: unknown[] }[] };
  assert.equal(stmt.kind, "ClassDeclaration");
  const ctor = stmt.methods[0];
  assert.equal(ctor.name, "constructor");
  assert.equal(ctor.params.length, 1);
});

test("parser: class con readonly", () => {
  const stmt = firstStatement("class Foo { readonly x: number; }") as { kind: string; fields: { name: string; readonly?: boolean }[] };
  assert.equal(stmt.kind, "ClassDeclaration");
  assert.equal(stmt.fields[0].name, "x");
  assert.equal(stmt.fields[0].readonly, true);
});

test("parser: función con tipos y return", () => {
  const stmt = firstStatement("function add(a: number, b: number): number { return a + b; }") as { kind: string; name: string; params: unknown[]; returnType: string };
  assert.equal(stmt.kind, "FunctionDeclaration");
  assert.equal(stmt.name, "add");
  assert.equal(stmt.params.length, 2);
  assert.equal(stmt.returnType, "number");
});

test("parser: arrow function", () => {
  const stmt = firstStatement("const f = (x: number): number => x + 1;") as { kind: string; initializer: { kind: string; params: unknown[]; returnType: string } };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.initializer.kind, "ArrowFunctionExpression");
  assert.equal(stmt.initializer.params.length, 1);
  assert.equal(stmt.initializer.returnType, "number");
});

test("parser: if-else", () => {
  const stmt = firstStatement("if (x > 0) { print(\"pos\"); } else { print(\"neg\"); }") as { kind: string; condition: unknown; elseBranch: unknown };
  assert.equal(stmt.kind, "IfStatement");
  assert.ok(stmt.condition);
  assert.ok(stmt.elseBranch);
});

test("parser: for-of", () => {
  const stmt = firstStatement("for (const x of arr) { print(x); }") as { kind: string; binding: unknown; iterable: unknown };
  assert.equal(stmt.kind, "ForOfStatement");
  assert.ok(stmt.binding);
  assert.ok(stmt.iterable);
});

test("parser: ternario", () => {
  const stmt = firstStatement("const r = x > 0 ? \"pos\" : \"neg\";") as { kind: string; initializer: { kind: string; condition: unknown; thenBranch: { kind: string }; elseBranch: { kind: string } } };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.initializer.kind, "TernaryExpression");
  assert.equal(stmt.initializer.thenBranch.kind, "LiteralExpression");
  assert.equal(stmt.initializer.elseBranch.kind, "LiteralExpression");
});

test("parser: literales no decimales", () => {
  const stmt = firstStatement("const mask: number = 0xFF | 0x0F;") as { kind: string; initializer: { kind: string; left: { kind: string; raw?: string }; right: { kind: string; raw?: string } } };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.initializer.kind, "BinaryExpression");
  assert.equal(stmt.initializer.left.kind, "LiteralExpression");
  assert.equal(stmt.initializer.left.raw, "0xFF");
  assert.equal(stmt.initializer.right.raw, "0x0F");
});

test("parser: enum", () => {
  const stmt = firstStatement("enum Color { Red, Green, Blue }") as { kind: string; name: string; members: { name: string }[] };
  assert.equal(stmt.kind, "EnumDeclaration");
  assert.equal(stmt.name, "Color");
  assert.equal(stmt.members.length, 3);
});

test("parser: interface", () => {
  const stmt = firstStatement("interface I { foo(): number; }") as { kind: string; name: string; methods: { name: string }[] };
  assert.equal(stmt.kind, "InterfaceDeclaration");
  assert.equal(stmt.name, "I");
  assert.equal(stmt.methods[0].name, "foo");
});

// V30.5.3 fix: el parser de interfaces no llamaba a skipNewlines()
// en el bucle de métodos, lo que causaba que el primer método
// después del `{` (cuando el método está en una línea nueva) no se
// parseara. A diferencia de las clases (que sí tienen skipNewlines),
// el parser de interfaces fallaba con "Se esperaba el nombre del
// método" en línea 3:7 del programa:
//
//   interface I {
//     foo(): number;
//   }
//
// Este test verifica que el parser maneja correctamente un interface
// con el método en la línea siguiente al `{` (caso real, no compactado
// en una sola línea como el test anterior).
test("parser: interface con método en línea siguiente al {", () => {
  const stmt = firstStatement(`
    interface I {
      foo(x: number, y: number): number;
    }
  `) as { kind: string; name: string; methods: { name: string; params: unknown[]; returnType: string }[] };
  assert.equal(stmt.kind, "InterfaceDeclaration");
  assert.equal(stmt.name, "I");
  assert.equal(stmt.methods.length, 1);
  assert.equal(stmt.methods[0].name, "foo");
  assert.equal(stmt.methods[0].params.length, 2);
  assert.equal(stmt.methods[0].returnType, "number");
});

test("parser: new expression", () => {
  const stmt = firstStatement("const p: Foo = new Foo(10);") as { kind: string; initializer: { kind: string; className: string; args: unknown[] } };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.initializer.kind, "NewExpression");
  assert.equal(stmt.initializer.className, "Foo");
  assert.equal(stmt.initializer.args.length, 1);
});

test("parser: member call expression", () => {
  const stmt = firstStatement("const r = obj.method(1, 2);") as { kind: string; initializer: { kind: string; method: string; args: unknown[] } };
  assert.equal(stmt.kind, "VariableDeclaration");
  assert.equal(stmt.initializer.kind, "MemberCallExpression");
  assert.equal(stmt.initializer.method, "method");
  assert.equal(stmt.initializer.args.length, 2);
});

// Tests del dialecto ";" opcional: el parser acepta newline significativo
// como terminador de statement (ademas del ';' explicito y el cierre '}').
test("parser: ; opcional entre declaraciones", () => {
  const ast = parse("let a: number = 1\nlet b: number = 2\nlet c: number = 3");
  assert.equal(ast.statements.length, 3);
  assert.equal((ast.statements[0] as { name: string }).name, "a");
  assert.equal((ast.statements[1] as { name: string }).name, "b");
  assert.equal((ast.statements[2] as { name: string }).name, "c");
});

test("parser: ; explicito sigue funcionando", () => {
  const ast = parse("let a: number = 1;\nlet b: number = 2;\nlet c: number = 3;");
  assert.equal(ast.statements.length, 3);
});

test("parser: mezcla de ; y newline", () => {
  const ast = parse("let a: number = 1\nlet b: number = 2;\nlet c: number = 3");
  assert.equal(ast.statements.length, 3);
});

test("parser: newline dentro de () no es terminador", () => {
  // f(\n  1\n  ) debe seguir siendo una sola llamada, no tres statements.
  const ast = parse("let r = f(\n  1,\n  2\n)");
  assert.equal(ast.statements.length, 1);
  const stmt = ast.statements[0] as { initializer: { kind: string; args: unknown[] } };
  assert.equal(stmt.initializer.args.length, 2);
});

test("parser: newline dentro de [] no es terminador", () => {
  const ast = parse("let a = [\n  1,\n  2,\n  3\n]");
  assert.equal(ast.statements.length, 1);
});

test("parser: lineas en blanco entre statements", () => {
  const ast = parse("let a = 1\n\n\nlet b = 2");
  assert.equal(ast.statements.length, 2);
});

test("parser: cierre de bloque } termina statement", () => {
  // El 'if' sin ';' antes del '}' debe seguir siendo valido.
  const ast = parse("if (x) { f() }");
  assert.equal(ast.statements.length, 1);
});

test("parser: 'for' con newlines funciona", () => {
  // El for tiene 3 componentes separados por ';' literales (no newlines).
  // El body puede no tener ';' antes del '}'.
  const ast = parse("for (let i = 0; i < 10; i = i + 1) { f() }");
  assert.equal(ast.statements.length, 1);
});

for (const [kind, source] of [
  ['FunctionDeclaration','@first export @second function @third f():void{}'],
  ['ClassDeclaration','@first export @second class @third C{}'],
  ['InterfaceDeclaration','@first export @second interface @third I{}'],
] as const) test(`parser decorators: preserves all positions in order on ${kind}`, () => {
  const statement = parse(source).statements[0] as any;
  assert.equal(statement.kind, kind); assert.equal(statement.exported, true);
  assert.deepEqual(statement.decorators.map(d => d.name), ['first','second','third']);
});
test("parser decorators: retains interface field and method annotations", () => {
  const statement = firstStatement('interface I{@field("native") value?:number; @method read():number;}') as any;
  assert.deepEqual(statement.fields[0].decorators.map(d => d.name), ['field']);
  assert.equal(statement.fields[0].decorators[0].args[0].value, 'native');
  assert.deepEqual(statement.methods[0].decorators.map(d => d.name), ['method']);
});
test("parser decorators: leading include/link stay module headers", () => {
  const statements = parse('@include("x.hpp") @link("m") @native function f():void;').statements as any[];
  assert.deepEqual(statements.map(s => s.kind), ['ModuleHeaderDeclaration','FunctionDeclaration']);
  assert.deepEqual(statements[0].decorators.map(d => d.name), ['include','link']);
  assert.deepEqual(statements[1].decorators.map(d => d.name), ['native']);
});
for (const declaration of ['function @third f():void{}','class @third C{}','async function @third f():Promise<void>{}'])
  test(`parser decorators: default export retains inline decorators: ${declaration}`, () => {
    const statement = firstStatement('@first export @second default '+declaration) as any;
    assert.deepEqual(statement.declaration.decorators.map(d => d.name), ['first','second','third']);
    assert.ok(['f','C'].includes(statement.declaration.name));
  });
for (const declaration of ['function @native() ():void{}','class @native {}','async function @native() ():Promise<void>{}'])
  test(`parser decorators: anonymous default export parses annotations before assigning internal name: ${declaration}`, () => {
    const statement = firstStatement('export default '+declaration) as any;
    assert.deepEqual(statement.declaration.decorators.map(d => d.name), ['native']);
    assert.match(statement.declaration.name, /^ets_default_/);
  });
test("parser decorators: default variable keeps declaration decorators", () => {
  const statement = firstStatement('@native export default const value=1;') as any;
  assert.deepEqual(statement.declaration.decorators.map(d => d.name), ['native']);
});
for (const source of ['@tag if(true){}','@tag type X=number;','@tag enum E{A}','@tag union U{A}','@tag using value=resource;','@tag export {value};','@tag export default 1;'])
  test(`parser decorators: rejects annotations that would be discarded: ${source}`, () => {
    assert.throws(() => parse(source), (error:any) => error instanceof DiagnosticError && error.diagnostics.some(d => d.message.includes('decoradores')));
  });
