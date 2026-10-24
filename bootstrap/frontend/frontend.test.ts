import {assertDiagnostic} from "./diagnostic-contract.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compileFile, loadModuleGraph } from "../../src/modules/module-loader.ts";
import { Lexer } from "../../src/lexer/lexer.ts";
import { Parser } from "../../src/parser/parser.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { prepareParserTokens } from "../parser/template-tokens.ts";
import { transportTokens } from "../parser/token-transport.ts";
import { templateCases, invalidTemplateCases } from "../../test/fixtures/templates.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = mkdtempSync(join(tmpdir(), "estatic-bootstrap-frontend-"));
const binary = join(directory, "frontend-demo"), parserBinary = join(directory, "parser-demo");
let graph: Awaited<ReturnType<typeof loadModuleGraph>>;
type NativeResult = { file: string; parsed: boolean; success: boolean; tokens: any[]; ast: { root: number; nodes: any[]; diagnostics: any[] }; diagnostics: any[] };

before(async () => {
  const entry = join(root, "bootstrap/frontend/demo.ets");
  graph = await loadModuleGraph(entry);
  // Complete asynchronous source reads before building executable fixtures.
  const frontend = await compileFile(entry, { baseDirectory: root });
  const parser = await compileFile(join(root,"bootstrap/parser/demo.ets"), { baseDirectory: root });
  assert.deepEqual(frontend.moduleNames.map(file => relative(root,file)), ["bootstrap/lexer/lexer.ets","bootstrap/parser/parser.ets","bootstrap/frontend/frontend.ets","bootstrap/frontend/demo.ets"]);
  assert.equal(parser.moduleNames.length, 2);
  for (const [name, result, executable] of [["frontend",frontend,binary],["parser",parser,parserBinary]] as const) {
    const build = join(directory,name); mkdirSync(build);
    writeFileSync(join(build,"estatic_common.hpp"),result.header);
    const units = result.modules.map((module,index) => { const file=join(build,`unit-${index}.cpp`);writeFileSync(file,module.cpp);return file; });
    execFileSync(process.env.CXX??"g++",["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,`-I${build}`,...units,"-o",executable],{encoding:"utf8",timeout:120000,env:{...process.env,TMPDIR:directory}});
  }
});
after(() => rmSync(directory,{recursive:true,force:true}));

function nativeMany(inputs: [string,string][]): NativeResult[] {
  const output=execFileSync(binary,inputs.flat(),{encoding:"utf8",timeout:20000,maxBuffer:64*1024*1024});
  return output.trim().split("\n").map(line => {const result=JSON.parse(line);result.diagnostics.forEach(assertDiagnostic);return result;});
}
function native(source:string,file="test.ets"): NativeResult { return nativeMany([[source,file]])[0]; }
function parity(source:string,file="test.ets"): NativeResult {
  const result=native(source,file), expected=prepareParserTokens(new Lexer(source).tokenize());
  assert.equal(result.file,file); assert.equal(result.parsed,true);
  assert.deepEqual(result.tokens,expected,"expanded tokens, decoded lexemes and all UTF-16 coordinates");
  const isolated=JSON.parse(execFileSync(parserBinary,transportTokens(expected),{encoding:"utf8",timeout:20000,maxBuffer:64*1024*1024}));
  assert.deepEqual(result.ast,isolated,"the native chain and isolated parser produce the exact same arena");
  assert.deepEqual(result.diagnostics.map(({file,phase,message,span}:any)=>({file,phase,message,span})),isolated.diagnostics.map(d=>({...d,file})));
  assert.equal(result.success,result.diagnostics.length===0);
  return result;
}

const fixtures: [string,string][] = [
  ["empty",""], ["whitespace","\uFEFF \t\n\r\n"],
  ["statements","let x:number=1; x+=2; print(x);"],
  ["Unicode and CRLF",'const s="España 🙂 漢字";\r\nprint(s);'],
  ["headers and decorators",'@include("<vector>") @link("m") @first export @second function @third f():void;'],
  ["modules",'import run,{value as local} from "./missing"; import type {Shape as View} from "./types"; export {local as answer}; export * from "./other";'],
  ["classes and interfaces",'@tag interface I{@field value?:number; @native read():number;} class C{@field value:number=1; constructor(public name:string="guest",readonly id:number=1){} @method read():number{return this.value;}}'],
  ["generics and packs",'function log<Head,...Tail>(head:Head,...tail:Tail):void{print(head,tail);} log("a",1);'],
  ["destructuring",'const [first:number=1,second]=items; const {name:alias="guest",count:number=2}=source;'],
  ["enum union switch",'enum E{A=9007199254740992,B} union U<T> = Some(T) | None; switch(x){case E.A:print(1);break;default:break;}'],
  ["control flow",'for(let i:number=0;i<3;i+=1){if(i==1)continue;} for(const value of values){print(value);} while(ok){break;}'],
  ["types and arrows",'let f:(x:number)=>string=convert; const g=async (x:number)=>await load(x); let a:Map<string,Array<number>> = source;'],
  ["operators",'x=(1+2)*3; a?.items[0]; build(name:"x",...items); value as number; 1<<2;'],
  ["raw template escapes",'const s=`raw \\n \\${name}`;'],
  ["template empty parts",'`${a}${b}`; ``;'],
  ["template multiline comments",'const s=`🙂\r\n${1 /* } ` ${ */ + 2}\n${"España"}`;'],
];
for(const [name,source] of fixtures) test(`bootstrap frontend native parity: ${name}`,()=>{assert.deepEqual(parity(source).diagnostics,[]);});
for(const [name,source] of templateCases) test(`bootstrap frontend native template: ${name}`,()=>{assert.deepEqual(parity('const s='+source+'; const after=7;').diagnostics,[]);});
for(const [name,source,message] of invalidTemplateCases) test(`bootstrap frontend invalid template: ${name}`,()=>{
  const result=native(source,"broken.ets"); assert.equal(result.parsed,false);assert.equal(result.success,false);
  assert.deepEqual(result.ast,{root:-1,nodes:[],diagnostics:[]});
  assert.ok(result.diagnostics.some(d=>d.phase==="lexer"&&d.file==="broken.ets"&&d.message===message));
});
for(const source of ['let x=; const after=2;','class C{@tag} const after=2;','`${}`;','`${1+}`;','`${a b}`;','`${foo(}`;','`${({a:})}`;'])
  test(`bootstrap frontend parser diagnostics: ${source}`,()=>{const result=parity(source,"syntax.ets");assert.equal(result.parsed,true);assert.equal(result.success,false);assert.ok(result.diagnostics.every(d=>d.phase==="parser"));});
for(const source of ['const s="🙂"; $;','"unterminated','/* unterminated','`🙂\n${$}`;','`outer ${`España ${$}`}`;'])
  test(`bootstrap frontend lexical diagnostics retain file and stop before parsing: ${source}`,()=>{
    const result=native(source,"dir/lexical.ets");assert.equal(result.parsed,false);assert.equal(result.success,false);assert.equal(result.ast.root,-1);assert.deepEqual(result.ast.nodes,[]);
    assert.ok(result.diagnostics.length>0);assert.ok(result.diagnostics.every(d=>d.phase==="lexer"&&d.file==="dir/lexical.ets"));
    const dollar=source.lastIndexOf('$');
    if(dollar>=0) assert.ok(result.diagnostics.some(d=>d.span.start.offset===dollar&&d.span.end.offset===dollar+1));
  });
test("bootstrap frontend interpolation diagnostics have absolute UTF-16 lines and columns",()=>{
  const source='const s="🙂";\nconst t=`España\n${$}`;'; const result=native(source,"é/🙂.ets"); const offset=source.lastIndexOf('$');
  assert.deepEqual(result.diagnostics[0].span,{start:{offset,line:3,column:3},end:{offset:offset+1,line:3,column:4}});
});
test("bootstrap frontend calls are independent inside one native process",()=>{
  const sources:[string,string][]=[['$','bad.ets'],['const a=1;','a.ets'],['const b=;','b.ets'],['const c=`🙂 ${3}`;','c.ets']];
  const results=nativeMany(sources);assert.deepEqual(results.map(r=>[r.file,r.parsed,r.success]),[['bad.ets',false,false],['a.ets',true,true],['b.ets',true,false],['c.ets',true,true]]);
  for(let i=0;i<sources.length;i++)assert.deepEqual(results[i],native(...sources[i]));
});
test("bootstrap frontend preserves module syntax without resolving files or merging scopes",()=>{
  const results=nativeMany([['import {x as local} from "./not-on-disk"; export {local as x};','a.ets'],['export const x=2;','b.ets']]);
  assert.ok(results.every(r=>r.success));
  const imported=results[0].ast.nodes.find(n=>n.kind==="ImportDeclaration");assert.ok(imported.attributes.some(a=>a.name==="source"&&a.value==="./not-on-disk"));
  assert.ok(!results[0].ast.nodes.some(n=>n.kind==="VariableDeclaration"));
  assert.equal(results[1].ast.nodes.filter(n=>n.kind==="VariableDeclaration").length,1);
});
for(const file of ['bootstrap/lexer/lexer.ets','bootstrap/parser/parser.ets','bootstrap/frontend/frontend.ets','bootstrap/frontend/demo.ets'])
  test(`bootstrap frontend parses real source with exact token/AST parity: ${file}`,()=>{assert.deepEqual(parity(readFileSync(join(root,file),"utf8"),file).diagnostics,[]);});
test("bootstrap frontend graph integrates exactly four ETS modules and leaves isolated phases independent",()=>{
  assert.equal(graph.modules.length,4);assert.deepEqual(graph.modules[0].dependencies,[]);assert.deepEqual(graph.modules[1].dependencies,[]);
  const host=readFileSync(join(root,'bootstrap/frontend/run.ts'),'utf8');assert.doesNotMatch(host,/src\/(?:lexer|parser)|template-tokens|token-transport/);
});
test("bootstrap frontend accepts repository examples accepted by the direct stage 0 parser",t=>{
  const files=readdirSync(join(root,"examples"),{recursive:true}).map(String).filter(f=>f.endsWith('.ets')).sort();let count=0;const excluded:string[]=[],failures:string[]=[];
  for(const file of files){const source=readFileSync(join(root,"examples",file),'utf8');try{new Parser(new Lexer(source).tokenize()).parseProgram();}catch(error){if(!(error instanceof DiagnosticError))throw error;excluded.push(file);continue;}
    const result=native(source,file);if(!result.success)failures.push(file+': '+JSON.stringify(result.diagnostics.slice(0,3)));count++;
  }
  assert.deepEqual(excluded,["exports-demo.ets","generated-module-exports/index.ets","generated-module-exports/main.ets","generated-module-exports/producer.ets","imports-as/main.ets","module-exports/counter.ets","module-exports/index.ets","module-exports/main.ets"]);
  assert.ok(count>=120);assert.deepEqual(failures,[]);t.diagnostic(`${count}/${files.length} examples accepted directly by stage 0 also pass the native chain`);
});
test("bootstrap frontend lexical and parser nesting remain bounded",()=>{
  const lexical=native('`${'.repeat(140)+'1'+'}`'.repeat(140),'deep-template.ets');assert.equal(lexical.parsed,false);assert.ok(lexical.diagnostics.some(d=>d.message.includes('Límite de anidamiento')));
  const syntax=native('('.repeat(150)+'1'+')'.repeat(150),'deep-parser.ets');assert.equal(syntax.parsed,true);assert.ok(syntax.diagnostics.some(d=>d.message.includes('Límite de anidamiento')));assert.ok(syntax.diagnostics.length<=100);
});

test('frontend diagnostics share a versioned contract and preserve UTF-16 ranges',()=>{
 const source='const text="🙂";\r\n$;';const g=native(source,'unicode.ets');
 const d=g.diagnostics.find((d:any)=>d.phase==='lexer');assert.ok(d);
 assert.equal(d.code,'LEXER_ERROR');assert.equal(d.generated,null);
 assert.deepEqual(d.span,{start:{offset:source.indexOf('$'),line:2,column:1},end:{offset:source.indexOf('$')+1,line:2,column:2}});
});
test('frontend parser diagnostics use the same schema as lexical diagnostics',()=>{
 const g=native('const n=;','parse.ets');assert.ok(g.diagnostics.length);
 for(const d of g.diagnostics){assertDiagnostic(d);assert.equal(d.code,'PARSER_ERROR');assert.equal(d.generated,null);}
});
