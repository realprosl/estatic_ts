import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync,execFileSync} from "node:child_process";
import {markCppOrigin,mapCppSources} from "../../src/codegen/cpp-source-map.ts";
import type {Span,GeneratedSource} from "../../src/core/span.ts";

const span:Span={start:{offset:0,line:3,column:1},end:{offset:10,line:3,column:11}};
const generated:Span={...span,generated:{id:"etsgen:0",span}};
const sources:GeneratedSource[]=[{id:"etsgen:0",kind:"etsgen",generator:"emit",source:"\n\nprint(7);",callSpan:span}];
const map=(code:string,cpp="main.cpp",ets="fragment.ets")=>mapCppSources(markCppOrigin(generated,code),cpp,sources,[ets]);
function temporary(run:(dir:string)=>void){const dir=mkdtempSync(join(tmpdir(),"ets-cpp-lines-"));try{run(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function native(dir:string,cpp:string,syntax=false){const file=join(dir,"main.cpp");writeFileSync(file,cpp);return spawnSync("g++",["-std=c++20",file,...(syntax?["-fsyntax-only"]:["-o",join(dir,"app")])],{encoding:"utf8"});}

test("cpp lines native: varias líneas C++ de la misma sentencia conservan línea ETS",()=>temporary(dir=>{
 const file=join(dir,"main.cpp"),ets=join(dir,"fragment.ets");writeFileSync(ets,sources[0].source);
 const result=map('template<typename T>\nvoid broken(MissingType value);\nstatic_assert(false,"tail_failure");',file,ets);
 const compiled=native(dir,result.cpp,true);assert.notEqual(compiled.status,0);const errors=compiled.stderr.split("\n").filter(line=>line.includes("error:"));assert.ok(errors.length>=2,compiled.stderr);assert.ok(errors.every(line=>line.startsWith(ets+":3:")),compiled.stderr);
}));

for(const prefix of ["","u8","u","U","L"]){
 test(`cpp lines: raw string ${prefix || "sin prefijo"} conserva contenido y marcadores literales`,()=>{
  const text=`${prefix}R"tag(first\n// @ets-cpp-origin-end\n// @ets-cpp-origin {invalid json}\nlast)tag"`;
  const result=map(`auto text=${text};\nint tail;`);assert.ok(result.cpp.includes(text));assert.equal(result.mappings.at(-1)!.origin.span.start.line,3);assert.ok(result.cpp.includes('#line 3 "fragment.ets"\nint tail;'));
 });
}

test("cpp lines: bloque de comentario con marcador no cierra la expansión",()=>{
 const comment="/* block\n// @ets-cpp-origin-end\n*/";const result=map(comment+"\nint tail;");assert.ok(result.cpp.includes(comment));assert.ok(result.cpp.includes('#line 3 "fragment.ets"\nint tail;'));
});
test("cpp lines: comentario partido por splice se reconoce antes de insertar directivas",()=>{
 const comment="/\\\n* block\n// @ets-cpp-origin-end\n*/";const result=map(comment+"\nint tail;");assert.ok(result.cpp.includes(comment));assert.ok(result.cpp.includes('#line 3 "fragment.ets"\nint tail;'));
});
test("cpp lines: comentario de línea prolongado protege la línea siguiente",()=>{
 const comment="// continuation \\\n// @ets-cpp-origin-end";const result=map(comment+"\nint tail;");assert.ok(result.cpp.includes(comment));assert.ok(result.cpp.includes('#line 3 "fragment.ets"\nint tail;'));
});
test("cpp lines: macro CRLF con continuaciones conserva bytes",()=>{
 const macro="#define ADD(x) \\\r\n ((x) + \\\r\n 1)";const result=map(macro+"\nint tail;");assert.ok(result.cpp.includes(macro));assert.ok(result.cpp.includes('#line 3 "fragment.ets"\nint tail;'));
});
test("cpp lines: literal normal con splice conserva contenido",()=>{
 const literal='"first\\\nsecond"';const result=map(`auto text=${literal};\nint tail;`);assert.ok(result.cpp.includes(literal));assert.ok(result.cpp.includes('#line 3 "fragment.ets"\nint tail;'));
});
test("cpp lines: separadores numéricos y caracteres no bloquean el mapa",()=>{
 const code="auto number=1'000; auto hex=0xAB'CD; auto character=u8'a';\nint tail;";const result=map(code);assert.ok(result.cpp.includes('#line 3 "fragment.ets"\nint tail;'));
});
test("cpp lines native: raw strings, comentarios, macros y splices mantienen semántica",()=>temporary(dir=>{
 const raw='R"tag(first\n// @ets-cpp-origin-end\nlast)tag"';
 const macro="#define ADD(x) \\\r\n ((x) + \\\r\n 1)";
 const cpp='#include <iostream>\n'+map(`${macro}\nint main(){\nauto text=${raw};\nauto joined="a\\\nb";\n/\\\n* comment\n// @ets-cpp-origin-end\n*/\nstd::cout << text << "\\n" << joined << "\\n" << ADD(4) << "\\n" << 1'000 << "\\n";\n}`).cpp;
 const compiled=native(dir,cpp);assert.equal(compiled.status,0,compiled.stderr);assert.equal(execFileSync(join(dir,"app"),{encoding:"utf8"}),"first\n// @ets-cpp-origin-end\nlast\nab\n5\n1000\n");
}));

test("cpp lines: splice con espacios conserva el macro sin insertar dentro",()=>{
 const macro="#define VALUE \\  \n 7";const result=map(macro+"\nint tail;");assert.ok(result.cpp.includes(macro));assert.ok(result.cpp.includes('#line 3 "fragment.ets"\nint tail;'));
});
test("cpp lines: literal inválido no oculta el diagnóstico nativo con un error de mapa",()=>{
 assert.doesNotThrow(()=>map('const char *broken="unterminated;'));
});
