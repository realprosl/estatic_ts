import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
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
 const p=ir('@include("bootstrap/modules/platform.hpp")\n@include("bootstrap/modules/platform.hpp")\nprint(1);');
 const result=generated(p);assert.equal(result.cpp.split('#include "bootstrap/modules/platform.hpp"').length-1,1);assert(result.headers.includes('bootstrap/modules/platform.hpp'));
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
 const out=execute(`import {canonicalFile,fileMetadata,contentHash,publishRecord,syntaxIdentity,readSnapshot} from "${root}/bootstrap/modules/platform";
 print(contentHash("abc"));print(publishRecord(${JSON.stringify(record)},"hello"));
 print(canonicalFile(${JSON.stringify(record)}));print(fileMetadata(${JSON.stringify(record)}).length>0);
 const snap=readSnapshot(${JSON.stringify(record)});print(snap.length);print(snap[0]);print(syntaxIdentity().length>0);`);
 assert.match(out,/^ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\n1\n/);
 assert(out.includes(record+'\n1\n4\nhello\n1\n'));assert.equal(readFileSync(record,'utf8'),'hello');
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
