import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));

function execute(source: string): string {
  const directory = mkdtempSync(join(root, "build-owned-tree-test-"));
  try {
    const result = compile(source), file = join(directory, "main.cpp"), binary = join(directory, "main");
    writeFileSync(file, result.cpp);
    execFileSync(process.env.CXX ?? "g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, file, "-o", binary], { encoding: "utf8", timeout: 60000, env: { ...process.env, TMPDIR: directory } });
    return execFileSync(binary, [], { encoding: "utf8", timeout: 15000 }).trim();
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
const node = `class Node {
  value:number;children:ptr<Node>[];
  constructor(value:number){this.value=value+10;this.children=[];}
  add(child:ptr<Node>):void{this.children.push(move(child));}
  read():number{return this.value;}
  set(value:number):void{this.value=value;}
}`;

test("owned tree: children stay in their parent and can be read and changed through indexed owners", () => {
  assert.equal(execute(node + `
    let root:ptr<Node> = new Node(1);
    let left:ptr<Node> = new Node(2);
    root.add(move(left));
    root.add(new Node(3));
    print(root.read());print(root.children[0].read());print(root.children[1].value);
    root.children[0].set(99);print(root.children[0].value);print(root.children.length);
  `), "11\n12\n13\n99\n2");
});
test("owned tree: an owning aggregate can be constructed by value without copying its children", () => {
  assert.equal(execute(node + `let root:Node=new Node(4);let child:ptr<Node> =new Node(5);root.add(move(child));print(root.children[0].read());`), "15");
});
test("owned tree: named child fields accept explicit ownership transfers", () => {
  assert.equal(execute(`class Leaf {value:number;constructor(value:number){this.value=value+1;}}
    class Parent {left:ptr<Leaf>;right:ptr<Leaf>;constructor(left:ptr<Leaf>,right:ptr<Leaf>){this.left=move(left);this.right=move(right);}}
    let left:ptr<Leaf> =new Leaf(1);let right:ptr<Leaf> =new Leaf(2);
    let parent:ptr<Parent> =new Parent(move(left),move(right));print(parent.left.value+parent.right.value);
  `), "5");
});
test("owned allocation runs explicit constructors and synthesized field defaults exactly once", () => {
  assert.equal(execute(`class Explicit {value:number;constructor(n:number){print("ctor");this.value=n*2;}}
    class Defaulted {value:number=42;}
    const a:ptr<Explicit> =new Explicit(7);const b:ptr<Defaulted> =new Defaulted();
    print(a.value);print(b.value);
  `), "ctor\n14\n42");
});
test("owned allocations work inside closures and do not capture generated temporary names", () => {
  assert.equal(execute(`class Box{value:number;constructor(n:number){this.value=n+1;}}
    const make=(__ets_owned_1:number):number=>{const p:ptr<Box> =new Box(__ets_owned_1);return p.value;};print(make(6));
  `), "7");
});
test("owned generic allocations execute the specialized ETS constructor", () => {
  assert.equal(execute(`class Box<T>{value:T;constructor(value:T){this.value=value;}}
    const b:ptr<Box<number>> =new Box<number>(17);print(b.value);
  `), "17");
});
test("owned push preserves ordinary lvalue copying", () => {
  assert.equal(execute(`class Box{value:number;constructor(value:number){this.value=value;}}
    let source:Box=new Box(1);let values:Box[]=[];values.push(source);source.value=9;print(values[0].value);
  `), "1");
});
test("owner member lowering uses expression types rather than names from another scope", () => {
  assert.equal(execute(`class Box{value:number;constructor(n:number){this.value=n;}}
    function fromOwner(item:ptr<Box>):number{return item.value;}
    function fromValue():number{const item:Box=new Box(8);return item.value;}
    print(fromValue());
  `), "8");
});
test("read-only owner receivers reject mutating methods", () => {
  assert.throws(() => compile(node + `let root:constPtr<Node> =new Node(1);root.set(2);`), DiagnosticError);
});
test("transferred owners cannot be read again", () => {
  assert.throws(() => compile(node + `let root:ptr<Node> =new Node(1);let child:ptr<Node> =new Node(2);root.add(move(child));print(child.value);`), DiagnosticError);
});

test("owned tree: construction follows ownership through nested value fields", () => {
  assert.equal(execute(`class Leaf{value:number;constructor(value:number){this.value=value;}}
    class Inner{children:ptr<Leaf>[];constructor(){this.children=[];}}
    class Outer{inner:Inner;constructor(){this.inner=new Inner();}}
    let outer:Outer=new Outer();let child:ptr<Leaf> =new Leaf(6);outer.inner.children.push(move(child));print(outer.inner.children[0].value);
  `), "6");
});

test("read-only owners cannot bypass mutability through fluent methods", () => {
  assert.throws(() => compile(`class Builder{value:number;constructor(){this.value=0;}set(n:number):Builder{this.value=n;return this;}}
    let builder:constPtr<Builder> =new Builder();builder.set(1);`), DiagnosticError);
});
