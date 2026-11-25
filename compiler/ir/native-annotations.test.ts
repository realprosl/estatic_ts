import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildNativeCompiler} from '../build/native-compiler.ts';
import {buildIrFrontend,nativeIr,buildIrCpp} from './cpp.ts';
import {root} from '../root.ts';
import type {IrProject} from '../../src/codegen/ir/model.ts';
const compiler=process.env.ESTATIC_NATIVE_COMPILER??buildNativeCompiler();
const directory=mkdtempSync(join(root,'build-native-annotations-test-'));
let frontend:string;
before(async()=>{frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();});
after(()=>rmSync(directory,{recursive:true,force:true}));
const identity='@cppgen function code(text:string):string{return text;}';
function ir(source:string){const entry=join(directory,'main.ets');writeFileSync(entry,source);return nativeIr(frontend,entry);}
function emit(p:IrProject){const result=spawnSync(compiler,['--codegen-json'],{input:JSON.stringify(p),encoding:'utf8',maxBuffer:64*1024*1024});assert.ifError(result.error);return result;}
function generated(p:IrProject){const r=emit(p);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
function execute(source:string){const result=generated(ir(source));const cpp=join(directory,'app.cpp'),bin=join(directory,'app');writeFileSync(cpp,result.cpp);buildIrCpp(result,cpp,bin);const r=spawnSync(bin,[],{encoding:'utf8'});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout;}
function rejected(p:IrProject,pattern:RegExp){const r=emit(p);assert.notEqual(r.status,0);assert.equal(r.stdout,'');assert.match(r.stderr,/IR_CPP_UNSUPPORTED/);assert.match(r.stderr,pattern);}
test('native @include deduplicates validated paths before declarations',()=>{
 const p=ir('@include("compiler/modules/platform.hpp")\n@include("compiler/modules/platform.hpp")\nprint(1);');
 const result=generated(p);assert.equal(result.cpp.split('#include "compiler/modules/platform.hpp"').length-1,1);assert(result.headers.includes('compiler/modules/platform.hpp'));
 for(const path of ['', '../escape.hpp','/tmp/a.hpp','a/../b.hpp','a//b.hpp','a/./b.hpp','a\\b.hpp','a"\n#error bad','a\0b']){const q=structuredClone(p);q.annotations![0].arguments=[path];rejected(q,/@include.*ruta/);}
 for(const args of [[],['a.hpp','b.hpp'],[42]]){const q=structuredClone(p);q.annotations![0].arguments=args as string[];rejected(q,/@include/);}
});
test('native @cppgen expands in order with caller parameters and return type',()=>{
 assert.equal(execute(identity+'function f(value:number):number{print("before");code("return value + 2;");return 0;}print(f(5));'), 'before\n7\n');
 assert.equal(execute(identity+'function f(value:string):string{code("value += \\"!\\";");code("return value;");return "";}print(f("ok"));'),'ok!\n');
});
test('native @cppgen parameter names cannot shadow IR slots or bridge temporaries',()=>{
 assert.equal(execute(identity+'function f(p0:number,v0:number,ir_cpp_arg0:number):number{code("return p0+v0+ir_cpp_arg0;");return 0;}print(f(1,2,3));'),'6\n');
});
test('native @cppgen implements all six real platform functions',()=>{
 const record=join(directory,'record.txt');
 const out=execute(`import {canonicalFile,fileMetadata,contentHash,publishRecord,syntaxIdentity,readSnapshot} from "${root}/compiler/platform/platform";
 print(contentHash("abc"));print(publishRecord(${JSON.stringify(record)},"hello"));
 print(canonicalFile(${JSON.stringify(record)}));print(fileMetadata(${JSON.stringify(record)}).length>0);
 const snap=readSnapshot(${JSON.stringify(record)});print(snap.length);print(snap[0]);print(syntaxIdentity().length>0);`);
 assert.match(out,/^ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\ntrue\n/);
 assert(out.includes(record+'\ntrue\n4\nhello\ntrue\n'));assert.equal(readFileSync(record,'utf8'),'hello');
});
test('native @cppgen rejects dynamic input and unsupported generator bodies',()=>{
 rejected(ir(identity+'function f(s:string):void{code(s);}f("print(1);");'),/literal string/);
 rejected(ir('@cppgen function code(s:string):string{return s+";";}code("print(1)");'),/identidad/);
});
test('native @cppgen validates annotations, callee, literal types and statement contract',()=>{
 const p=ir(identity+'code("print(1);");');
 const escape=(q:IrProject)=>q.functions.flatMap(f=>f.blocks.flatMap(b=>b.instructions)).find(i=>i.op==='backendEscape')!;
 const mutations:[(q:IrProject)=>void,RegExp][]=[
  [q=>{q.annotations=[];},/sin anotación/],
  [q=>{q.annotations![0].arguments=['bad'];},/anotación/],
  [q=>{q.annotations!.push(q.annotations![0]);},/duplicado/],
  [q=>{q.annotations![0].target.start+=1;},/destino/],
  [q=>{q.functions[escape(q).callee].asynchronous=true;},/síncrona|identidad/],
  [q=>{q.functions[escape(q).callee].parameterTypes=[];},/identidad/],
  [q=>{escape(q).operands=[];},/sentencia/],
  [q=>{escape(q).result=0;},/sentencia/],
  [q=>{escape(q).op='call';},/directa como sentencia/],
  [q=>{escape(q).callee=99999;},/sin anotación/],
 ];
 for(const [mutate,pattern] of mutations){const q=structuredClone(p);mutate(q);rejected(q,pattern);}
});
test('native @cppgen rejects return type mismatch through the C++ compiler',()=>{
 const result=generated(ir(identity+'function f():number{code("return std::string(\\"bad\\");");return 0;}print(f());'));
 const cpp=join(directory,'bad.cpp');writeFileSync(cpp,result.cpp);assert.throws(()=>buildIrCpp(result,cpp,join(directory,'bad')),/compile\/link failed/);
});
test('frontend rejects malformed annotations and cppgen expression uses',()=>{
 for(const source of ['@include(42)\nprint(1);', '@include("a", "b")\nprint(1);', '@cppgen("bad") function code(s:string):string{return s;}', identity+'const x=code("1");'])assert.throws(()=>ir(source),/Native IR failed/);
});
test('native bootstrap path builtins have runtime contracts',()=>{
 const out=execute('import { normalizePath, pathDirectory } from "estatic:path";print(normalizePath("sample.ets"));print(pathDirectory(normalizePath("sample.ets")));print(resolveProjectPath(normalizePath("config.json"),"source.ets"));print(resolveImportPath(normalizePath("main.ets"),"./missing"));print(compilerRoot().length>0);');
 assert.equal(out,root+'/sample.ets\n'+root+'\n'+root+'/source.ets\n'+root+'/missing.ets\ntrue\n');
});
test('native bootstrap mutates out and ref collection receivers',()=>{
 assert.equal(execute('function fill(values:ref<string[]>):void{values.push("a");values.push("b");values.pop();}let xs:string[]=[];fill(xs);print(xs.join(","));function add(values:ref<number[]>):void{values.push(3);}let ns:number[]=[1];add(ns);print(ns.length);print(ns[1]);'),'a\n2\n3\n');
});
test('native bootstrap supports string padding contracts',()=>{
 assert.equal(execute('print("x".padStart(3,"0"));print("x".padEnd(4,"ab"));'),'00x\nxaba\n');
});
test('native @link: argumentos de enlazado solo de los módulos del programa (#215)',()=>{
 const lib=join(directory,'cbrt.ets');writeFileSync(lib,'@link("m")\n@link("-framework Cocoa")\n@link("m")\n@cpp_native("std::cbrt") export function cbrt(x:number):number;\n');
 assert.deepEqual(generated(ir('import {cbrt} from "./cbrt";print(cbrt(27));')).links,['-lm','-framework','Cocoa']);
 assert.deepEqual(generated(ir('print(1);')).links,[]);
 const p=ir('@link("m")\nprint(1);');
 for(const value of ['','a b','../m','a/b']){const q=structuredClone(p);q.annotations!.find(a=>a.name==='link')!.arguments=[value];rejected(q,/@link/);}
});
test('native @link enlaza la librería al construir con etsc (#215)',()=>{
 // El driver C++ heredado necesita el frontend; etsc (stage 2) lo lleva dentro.
 const driver=process.env.ESTATIC_NATIVE_COMPILER?[]:['--frontend',frontend];
 const lib=join(directory,'cbrt.ets');writeFileSync(lib,'@link("m")\n@cpp_native("std::cbrt") export function cbrt(x:number):number;\n');
 const entry=join(directory,'main.ets');const cpp=join(directory,'linked.cpp'),bin=join(directory,'linked');
 writeFileSync(entry,'import {cbrt} from "./cbrt";print(cbrt(8));');
 let r=spawnSync(compiler,[...driver,entry,'-o',cpp,'--binary',bin,'--run'],{encoding:'utf8',env:{...process.env,ESTC_ROOT:root}});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'2\n');
 writeFileSync(lib,'@link("estatic_no_existe")\n@cpp_native("std::cbrt") export function cbrt(x:number):number;\n');
 r=spawnSync(compiler,[...driver,entry,'-o',cpp,'--binary',bin,'--build'],{encoding:'utf8',env:{...process.env,ESTC_ROOT:root}});assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/estatic_no_existe/);
});
// #215 tandas 2 y 3: sección "native" de una librería. Solo etsc (stage 2) lee
// las dependencias del estatic.config.json; el driver C++ heredado no.
test('librería con código nativo: sources a .a cacheado, includeDirs, linkLibraries y build (#215)',{skip:!process.env.ESTATIC_NATIVE_COMPILER},()=>{
 const project=mkdtempSync(join(directory,'native-dep-'));const lib=join(project,'lib');
 for(const dir of ['native/include','app'])mkdirSync(join(lib,dir),{recursive:true});
 writeFileSync(join(lib,'native/include/cubo.h'),'#pragma once\n#ifdef __cplusplus\nextern "C" {\n#endif\ndouble cubo(double x);\ndouble extra(double x);\n#ifdef __cplusplus\n}\n#endif\n');
 writeFileSync(join(lib,'native/cubo.c'),'#include <math.h>\n#include "cubo.h"\ndouble cubo(double x){return pow(x,3.0);}\n');
 writeFileSync(join(lib,'native/extra.c'),'#include "cubo.h"\ndouble extra(double x){return x+1;}\n');
 writeFileSync(join(lib,'estatic.config.json'),JSON.stringify({name:'cubo',native:{sources:['native/*.c'],includeDirs:['native/include'],cflags:['-O2'],linkLibraries:['m'],build:{command:'cc -Inative/include -c native/extra.c -o extra.o && ar rcs libextra.a extra.o',outputs:['libextra.a']}}}));
 // extra.c también entra en el .a por el patrón; el build aparte prueba "build".
 writeFileSync(join(lib,'index.ts'),'@include("cubo.h")\n@cpp_native("cubo") export function cubo(x:number):number;\n');
 writeFileSync(join(project,'main.ts'),'import {cubo} from "cubo/index";\nprint(cubo(2));\n');
 writeFileSync(join(project,'estatic.config.json'),JSON.stringify({entry:'main.ts',aliases:{cubo:'lib'},dependencies:{cubo:{url:'file:///no/existe',version:'1.0.0'}},output:{cpp:'build/app.cpp',binary:'build/app'}}));
 const config=join(project,'estatic.config.json');
 let r=spawnSync(compiler,['run','--config',config],{cwd:project,encoding:'utf8',env:{...process.env,ESTC_ROOT:root}});assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stdout.trim().split('\n').pop(),'8');
 const archives=()=>readdirSync(join(lib,'.estatic-build'),{recursive:true}).map(String).filter(f=>f.endsWith('libcubo.a'));
 assert.equal(archives().length,1);assert(existsSync(join(lib,'libextra.a')));const before=statSync(join(lib,'.estatic-build',archives()[0])).mtimeMs;
 writeFileSync(join(project,'main.ts'),'import {cubo} from "cubo/index";\nprint(cubo(3));\n');
 r=spawnSync(compiler,['run','--config',config],{cwd:project,encoding:'utf8',env:{...process.env,ESTC_ROOT:root}});assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stdout.trim().split('\n').pop(),'27');
 assert.equal(archives().length,1);assert.equal(statSync(join(lib,'.estatic-build',archives()[0])).mtimeMs,before,'el .a se reutiliza');
 // Una fuente que no compila da un error claro.
 writeFileSync(join(lib,'native/cubo.c'),'esto no es C\n');
 r=spawnSync(compiler,['run','--config',config],{cwd:project,encoding:'utf8',env:{...process.env,ESTC_ROOT:root}});assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/No se pudo compilar .*cubo\.c/);
});
