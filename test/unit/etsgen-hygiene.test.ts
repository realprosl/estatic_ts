import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, parse, evalEtsgenCalls } from "../../src/compiler.ts";
import { DiagnosticError, formatDiagnostic } from "../../src/core/diagnostic.ts";
import { compileFile } from "../../src/modules/module-loader.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

function source(code:string,prefix="",suffix="",repeat=1) {
  return `@etsgen function emit(): string { return ${JSON.stringify(code)}; }
    function run(): void { ${prefix} ${"emit();".repeat(repeat)} ${suffix} } run();`;
}
function bindings(code:string,prefix="") {return compile(source(code,prefix)).ast.generatedSources![0].bindings!;}

test("etsgen hygiene: expansión repetida tiene identidades y nombres distintos",()=>{
  const {ast}=compile(source("const x: number = 7; print(x);","const x: number = 99;","print(x);",2));
  const names=ast.generatedSources!.flatMap(s=>s.bindings!);
  assert.equal(new Set(names.map(b=>b.id)).size,2);
  assert.equal(new Set(names.map(b=>b.emittedName)).size,2);
  assert.ok(names.every(b=>b.name === "x" && b.emittedName !== "x"));
  assert.doesNotThrow(()=>JSON.stringify(ast));
});

test("etsgen hygiene: shadowing anidado conserva identidades léxicas",()=>{
  const names=bindings("const x: number = 1; { const x: number = 2; print(x); } print(x);");
  assert.equal(names.filter(b=>b.name === "x").length,2);
  assert.notEqual(names[0].id,names[1].id);
});

test("etsgen hygiene: captura explícita elude binding generado homónimo",()=>{
  const {ast}=compile(source('const x: number = etsCapture("x") + 1; print(x);',"const x: number = 10;"));
  const generated=ast.generatedSources![0];
  assert.ok(generated.captures?.some(c=>c.name === "x" && c.explicit));
  assert.doesNotMatch(JSON.stringify(ast.statements),/"callee":"etsCapture"/);
});

test("etsgen hygiene: referencias libres existentes se conservan como externas",()=>{
  const {ast}=compile(source("print(base);","const base: number = 7;"));
  assert.ok(ast.generatedSources![0].captures?.some(c=>c.name === "base" && !c.explicit));
});

test("etsgen hygiene: reserva nombres que ya usa el caller",()=>{
  const names=bindings("const x: number = 1; print(x);","const ets_macro_0_x: number = 99;");
  assert.notEqual(names[0].emittedName,"ets_macro_0_x");
});

test("etsgen hygiene: strings permanecen intactos",()=>{
  const {ast}=compile(source('const x: string = "x"; print(x);'));
  assert.equal(ast.generatedSources![0].source,'const x: string = "x"; print(x);');
  const json=JSON.stringify(ast.statements);
  assert.match(json,/"value":"x"/);
});

for(const [label,code] of [
  ["duplicado","let x: number = 1; let x: number = 2;"],
  ["captura inválida",'print(etsCapture("x; print(99)"));'],
  ["captura no literal",'const n: string = "base"; print(etsCapture(n));'],
  ["lectura antes de binding","print(x); const x: number = 2;"],
] as const) {
  test(`etsgen hygiene: rechaza ${label} con procedencia`,()=>{
    assert.throws(()=>compile(source(code,"const x: number = 99;")),(error:unknown)=>{
      assert.ok(error instanceof DiagnosticError);
      const diagnostic=error.diagnostics.find(d=>d.generated);
      assert.ok(diagnostic,error.message);
      assert.equal(diagnostic.generated?.source,code);
      assert.match(formatDiagnostic("main.ets","",diagnostic),/fragmento @etsgen/);
      return true;
    });
  });
}

const nativeCases=[
  ["const x: number = 7; print(x);","const x: number = 99;","print(x);",2,"7\n7\n99\n"],
  ['const x: number = etsCapture("x") + 1; print(x);',"const x: number = 10;","print(x);",1,"11\n10\n"],
  ["const x: number = 1; { const x: number = 2; print(x); } print(x);","","",1,"2\n1\n"],
  ["function f(x: number): number { return x + 1; } print(f(2));","const x: number = 99;","",2,"3\n3\n"],
  ["const xs: number[] = [1,2]; const ys: number[] = xs.map<number>((x: number): number => x + 1); print(ys[0]);","const x: number = 99;","",1,"2\n"],
  ["let sum: number = 0; for (let i: number = 0; i < 3; i += 1) { sum += i; } print(sum);","const i: number = 99;","print(i);",1,"3\n99\n"],
  ["const xs: number[] = [1,2]; let sum: number = 0; for (const x of xs) {sum += x;} print(sum);","const x: number = 99;","",1,"3\n"],
  ["const xs: number[] = [7,8]; const [x,y] = xs; print(x); print(y);","const x: number = 99;","",1,"7\n8\n"],
  ["class Box { value: number; } const box: Box = new Box(7); const {value} = box; print(value);","const value: number = 99;","",1,"7\n"],
  ["type Word = i32; const x: Word = 7; print(x);","","",2,"7\n7\n"],
  ["function identity<T>(value: T): T { return value; } print(identity<number>(7));","","",1,"7\n"],
  ["function f(value: number): number { return value; } print(f(value: 7));","","",1,"7\n"],
] as const;

test("etsgen hygiene native: ámbitos, closures, bucles, destructuring y tipos",()=>{
  const root=join(dirname(fileURLToPath(import.meta.url)),"../..");
  const dir=mkdtempSync(join(tmpdir(),"ets-hygiene-"));
  try {
    const rootCases=new Set([3,8,9,10,11]);
    const functions=nativeCases.map(([code,prefix,suffix,repeat],i)=>`
      @etsgen function emit${i}(): string { return ${JSON.stringify(code)}; }
      ${rootCases.has(i) ? "" : `function run${i}(): void {${prefix} ${`emit${i}();`.repeat(repeat)} ${suffix}}`}
    `).join("\n");
    const source=functions+nativeCases.map((c,i)=>rootCases.has(i) ? `emit${i}();`.repeat(c[3]) : `run${i}();`).join("\n");
    writeFileSync(join(dir,"main.cpp"),compile(source).cpp);
    execFileSync("g++",["-std=c++20","-O2","-pthread","-fno-exceptions","-I",root,join(dir,"main.cpp"),"-o",join(dir,"main")],{timeout:60000,stdio:"pipe"});
    assert.equal(execFileSync(join(dir,"main"),{encoding:"utf8",timeout:10000}),nativeCases.map(c=>c[4]).join(""));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("etsgen hygiene módulos: homónimos generados no colisionan entre callers",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"ets-hygiene-modules-"));
  try {
    writeFileSync(join(dir,"lib.ets"),'@etsgen export function emit(): string { return "const same: number = 7; print(same);"; }\nemit();');
    writeFileSync(join(dir,"main.ets"),'import { emit } from "./lib.ets";\nconst same: number = 99;\nemit();\nprint(same);');
    const result=await compileFile(join(dir,"main.ets"));
    const names=result.ast.generatedSources!.flatMap(s=>s.bindings!).map(b=>b.emittedName);
    assert.equal(new Set(names).size,2);
    for(const cpp of result.modules) assert.ok(names.some(name=>cpp.cpp.includes(name)));
    const root=join(dirname(fileURLToPath(import.meta.url)),"../..");
    writeFileSync(join(dir,"estatic_common.hpp"),result.header);
    const files=result.modules.map((module,index)=>{const path=join(dir,`module${index}.cpp`);writeFileSync(path,module.cpp);return path;});
    execFileSync("g++",["-std=c++20","-O2","-pthread","-fno-exceptions","-I",root,"-I",dir,...files,"-o",join(dir,"main")],{timeout:60000,stdio:"pipe"});
    assert.equal(execFileSync(join(dir,"main"),{encoding:"utf8",timeout:10000}),"7\n7\n99\n");
  } finally {rmSync(dir,{recursive:true,force:true});}
});

function nestedSource(child:string,parent:string) {
  return `@etsgen function inner(): string { return ${JSON.stringify(child)}; }
    @etsgen function outer(): string { return ${JSON.stringify(parent)}; }
    function run(): void { const x: number = 99; outer(); print(x); } run();`;
}

test("etsgen hygiene: expansión hija captura binding fresco del padre",()=>{
  const {ast}=compile(nestedSource('const x: number = etsCapture("x") + 1; print(x);','const x: number = 7; inner();'));
  assert.equal(ast.generatedSources?.length,2);
  const [parent,child]=ast.generatedSources!;
  assert.equal(child.parentId,parent.id);
  const captured=child.captures?.find(c=>c.name === "x" && c.explicit);
  assert.equal(captured?.emittedName,parent.bindings?.find(b=>b.name === "x")?.emittedName);
  assert.notEqual(child.bindings?.find(b=>b.name === "x")?.emittedName,captured?.emittedName);
});

test("etsgen hygiene native: captura hija, captura legacy y sobrecargas",()=>{
  const root=join(dirname(fileURLToPath(import.meta.url)),"../..");
  const dir=mkdtempSync(join(tmpdir(),"ets-hygiene-child-"));
  try {
    const source=nestedSource('const x: number = etsCapture("x") + 1; print(x);','const x: number = 7; inner(); inner();');
    writeFileSync(join(dir,"main.cpp"),compile(source).cpp);
    execFileSync("g++",["-std=c++20","-O2","-pthread","-fno-exceptions","-I",root,join(dir,"main.cpp"),"-o",join(dir,"main")],{timeout:60000,stdio:"pipe"});
    assert.equal(execFileSync(join(dir,"main"),{encoding:"utf8",timeout:10000}),"8\n8\n99\n");
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("etsgen hygiene: expansión hija conserva captura libre del padre",()=>{
  const {ast}=compile(nestedSource('print(x);','const x: number = 7; inner();'));
  const [parent,child]=ast.generatedSources!;
  assert.equal(child.captures?.find(c=>c.name === "x")?.emittedName,parent.bindings?.find(b=>b.name === "x")?.emittedName);
});

test("etsgen hygiene: sobrecarga de generador anidado se resuelve por tipos",()=>{
  const {ast}=compile(`@etsgen function inner(x: number): string { return "print(7);"; }
    @etsgen function inner(x: string): string { return "print(99);"; }
    @etsgen function outer(): string { return "inner(1);"; } outer();`);
  assert.equal(ast.generatedSources?.[1].source,"print(7);");
});

for(const [limits,code] of [
  [{maxRecursion:3},"ETSGEN_RECURSION_LIMIT"],
  [{maxInstructions:3},"ETSGEN_EXPANSION_LIMIT"],
  [{maxGeneratedBytes:15},"ETSGEN_GENERATED_LIMIT"],
] as const) {
  test(`etsgen hygiene: recursión de código generado acotada (${code})`,()=>{
    const source='@etsgen function again(): string { return "again();"; } again();';
    assert.throws(()=>evalEtsgenCalls(parse(source),undefined,limits),(error:unknown)=>{
      assert.ok(error instanceof DiagnosticError);
      assert.ok(error.diagnostics.some(d=>d.code === code),error.message);
      assert.ok(error.diagnostics[0].generated);
      return true;
    });
  });
}

test("etsgen hygiene: error hijo conserva fuente e identidad del fragmento",()=>{
  assert.throws(()=>compile(nestedSource('const x: string = 1;','const x: number = 7; inner();')),(error:unknown)=>{
    assert.ok(error instanceof DiagnosticError);
    const diagnostic=error.diagnostics.find(d=>d.generated?.generator === "inner");
    assert.ok(diagnostic,error.message);
    assert.equal(diagnostic.generated?.source,'const x: string = 1;');
    assert.ok(diagnostic.notes?.some(note=>note.includes("etsgen:0")));
    return true;
  });
});
