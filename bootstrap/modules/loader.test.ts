import {assertDiagnostic} from "../frontend/diagnostic-contract.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync, readdirSync, statSync, utimesSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildLoader, root } from "./build.ts";
import { loadModuleGraph } from "../../src/modules/module-loader.ts";

const workspace = mkdtempSync(join(root, "build-modules-test-"));
let binary: string;
before(async () => { binary = await buildLoader(join(workspace, "binary")); });
after(() => rmSync(workspace, { recursive: true, force: true }));
function fixture(files: Record<string,string>) {
  const directory = mkdtempSync(join(workspace, "project-"));
  for (const [file, text] of Object.entries(files)) put(join(directory, file), text);
  return { directory, entry: join(directory, "main.ets"), cache: join(directory, "cache") };
}
function put(file: string, text: string) { mkdirSync(resolve(file, ".."), { recursive: true }); writeFileSync(file, text); }
function invoke(entry: string, flags: string[] = [], status = 0): any[] {
  const result = spawnSync(binary, [entry, ...flags], { encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, status, result.stderr + result.stdout.slice(0, 3000));
  assert.equal(result.stderr, ""); return result.stdout.trim().split("\n").map(line => {const g=JSON.parse(line);g.diagnostics.forEach(assertDiagnostic);for(const m of g.modules)m.source.diagnostics.forEach(assertDiagnostic);return g;});
}
function run(f: ReturnType<typeof fixture>, flags: string[] = [], status = 0) { return invoke(f.entry, ["--cache", f.cache, ...flags], status)[0]; }
function names(graph: any) { return graph.modules.map((m: any) => basename(m.file)); }
function hash(text: string | Buffer) { return createHash("sha256").update(text).digest("hex"); }
function stable(graph: any) { return {entry:graph.entry,success:graph.success,diagnostics:graph.diagnostics,modules:graph.modules.map(({reused,metadata,...m}: any)=>m)}; }
function record(f: ReturnType<typeof fixture>, name = "main.ets") { return join(f.cache, hash(join(f.directory, name)) + ".record"); }

test("native graph: dependency order, diamond dedup and repeated requests", async () => {
  const f=fixture({"main.ets":'import "./left"; import "./right"; import "./left.ets";',"left.ets":'export * from "./leaf";',"right.ets":'import "./leaf";',"leaf.ets":'export const x=1;'});
  const native=run(f);assert.equal(native.success,true);assert.deepEqual(names(native),["leaf.ets","left.ets","right.ets","main.ets"]);
  assert.equal(native.cache.misses,4);assert.equal(native.modules.at(-1).requests.length,3);assert.equal(native.modules.at(-1).dependencies.length,2);
  const reference=await loadModuleGraph(f.entry);assert.deepEqual(native.modules.map((m:any)=>m.file),reference.modules.map(m=>m.file));
});
test("native graph: all import/reexport forms preserve AST metadata and type edges",()=>{
  const f=fixture({"main.ets":'import Main,{type Shape as View,value as local} from "./lib"; import * as ns from "./lib"; import type {Shape} from "./types"; export {local as answer}; export {value as renamed} from "./lib"; export * as all from "./lib"; export type {Shape as Other} from "./types";',"lib.ets":'export default function f():void{} export const value=1;',"types.ets":'export interface Shape{x:number;}'});
  const g=run(f);assert.equal(g.cache.misses,3);const m=g.modules.at(-1);assert.equal(m.requests.length,6);assert.equal(m.requests.filter((r:any)=>r.typeOnly).length,2);
  assert.equal(m.source.ast.nodes.filter((n:any)=>n.kind==="ImportSpecifier"&&n.attributes.some((a:any)=>a.name==="local"&&a.value==="local")).length,1);
  assert.deepEqual(stable(run(f)),stable(g));
});
test("native graph: symbol aliases never act as path aliases",()=>{
  const f=fixture({"main.ets":'import {x as local} from "./lib"; import "local";',"lib.ets":'export const x=1;'});const g=run(f,[],1);
  assert.equal(g.diagnostics.length,1);assert.match(g.diagnostics[0].message,/import 'local'/);
});
test("native resolver: longest alias at segment boundaries",()=>{
  const f=fixture({"main.ets":'import "@app/nested/thing"; import "@app/base";',"a/base.ets":"", "b/thing.ets":""});
  const flags=["--alias","@app",join(f.directory,"a"),"--alias","@app/nested",join(f.directory,"b")];
  assert.deepEqual(names(run(f,flags)),["thing.ets","base.ets","main.ets"]);
  put(f.entry,'import "@application/base";');assert.equal(run(f,flags,1).diagnostics.length,1);
});
test("native resolver: ordered roots with TS before ETS within each root",()=>{
  const f=fixture({"main.ets":'import "foo";',"a/foo.ets":"const first=1;","b/foo.ts":"const second=2;"});
  const g=run(f,["--root",join(f.directory,"a"),"--root",join(f.directory,"b")]);assert.equal(g.modules[0].file,join(f.directory,"a/foo.ets"));
  put(join(f.directory,"a/foo.ts"),"const ts=1;");const changed=run(f,["--root",join(f.directory,"a")]);assert.equal(changed.modules[0].file,join(f.directory,"a/foo.ts"));assert.equal(changed.cache.hits,1);
});
test("native resolver: explicit extensions, dotted parents, dotfile names",()=>{
  const f=fixture({"main.ets":'import "./folder.v1/.hidden"; import "./other.ts";',"folder.v1/.hidden.ets":"","other.ts":""});assert.deepEqual(names(run(f)),[".hidden.ets","other.ts","main.ets"]);
});
test("native resolver: canonical symlinks and normalized paths share one parse",()=>{
  const f=fixture({"main.ets":'import "./lib"; import "./alias"; import "./folder/../lib.ets";',"lib.ets":""});mkdirSync(join(f.directory,"folder"));symlinkSync("lib.ets",join(f.directory,"alias.ets"));
  assert.deepEqual(names(run(f)),["lib.ets","main.ets"]);assert.equal(run(f).cache.hits,2);
});
test("native resolver: entry identity is canonical and extension candidates match stage 0",()=>{
  const f=fixture({"main.ets":"","main.ts":"const ts=1;"});symlinkSync("main.ts",join(f.directory,"alias.ts"));
  assert.equal(invoke(join(f.directory,"main"))[0].entry,join(f.directory,"main.ts"));assert.equal(invoke(join(f.directory,"alias.ts"))[0].entry,join(f.directory,"main.ts"));
});
test("native graph: missing entry, directory and missing dependency diagnostics",()=>{
  const f=fixture({"main.ets":'\nimport "./missing";'});const g=run(f,[],1);assert.deepEqual(g.diagnostics.map((d:any)=>[d.phase,d.file,d.line,d.column]),[["resolver",f.entry,2,1]]);
  assert.equal(invoke(join(f.directory,"none"),[],1)[0].modules.length,0);mkdirSync(join(f.directory,"directory.ets"));assert.equal(invoke(join(f.directory,"directory.ets"),[],1)[0].success,false);
});
for (const [name,files,path] of [
  ["self",{"main.ets":'import "./main";'},["main.ets","main.ets"]],
  ["mutual",{"main.ets":'import "./b";',"b.ets":'export * from "./main";'},["main.ets","b.ets","main.ets"]],
  ["nested",{"main.ets":'import "./a";',"a.ets":'import "./b";',"b.ets":'import "./a";'},["a.ets","b.ets","a.ets"]]
] as const) test(`native graph: ${name} cycle reports full path with stable cached diagnostics`,()=>{
  const f=fixture(files);const g=run(f,[],1);assert.equal(g.diagnostics.length,1);assert.equal(g.diagnostics[0].message,"Ciclo de imports: "+path.map(p=>join(f.directory,p)).join(" -> "));assert.deepEqual(stable(run(f,[],1)),stable(g));
});
test("native graph: lexical/syntax errors preserve file and recover other modules",()=>{
  const f=fixture({"main.ets":'import "./lex"; import "./syntax"; import "./ok";',"lex.ets":"$;","syntax.ets":"const x=;","ok.ets":"const ok=1;"});
  const g=run(f,[],1);assert.deepEqual(g.diagnostics.map((d:any)=>[d.phase,basename(d.file)]),[["lexer","lex.ets"],["parser","syntax.ets"]]);
  assert.equal(g.modules.length,4);assert.equal(readdirSync(f.cache).length,2);const warm=run(f,[],1);assert.equal(warm.cache.hits,2);assert.equal(warm.cache.misses,2);assert.deepEqual(stable(warm),stable(g));
});
test("native cache: cold/warm processes reuse exact token and AST arenas with zero writes",()=>{
  const f=fixture({"main.ets":'import "./lib"; const t=`España 🙂 ${1+2}`;',"lib.ets":'export const n=2;'});
  const cold=run(f), before=statSync(record(f),{bigint:true}).mtimeNs;const warm=run(f);assert.deepEqual(cold.cache,{hits:0,misses:2,writes:2});assert.deepEqual(warm.cache,{hits:2,misses:0,writes:0});assert.deepEqual(stable(warm),stable(cold));assert.equal(statSync(record(f),{bigint:true}).mtimeNs,before);
});
test("native cache: one instance shares syntax across loads without shared graph state",()=>{
  const f=fixture({"main.ets":'import "./lib";',"lib.ets":""});const [first,second]=invoke(f.entry,["--twice"]);assert.equal(first.cache.misses,2);assert.equal(second.cache.hits,2);assert.deepEqual(stable(second),stable(first));
});
test("native cache: a multi-file logical module reparses only its edited file",()=>{
  const f=fixture({"main.ets":'import "./module/index";',"module/index.ets":'export * from "./a"; export * from "./b";',"module/a.ets":'export function a():number{return 1;}',"module/b.ets":'export function b():number{return 2;}'});
  run(f);put(join(f.directory,"module/a.ets"),'export function a():number{return 9;}');const g=run(f);assert.equal(g.cache.misses,1);assert.equal(g.cache.hits,3);assert.deepEqual(g.modules.filter((m:any)=>!m.reused).map((m:any)=>basename(m.file)),["a.ets"]);
});
test("native cache: same-size edit with preserved mtime cannot create a false hit",()=>{
  const f=fixture({"main.ets":"const x=1;"});run(f);const before=statSync(f.entry);put(f.entry,"const x=2;");utimesSync(f.entry,before.atime,before.mtime);const g=run(f);assert.equal(g.cache.misses,1);assert.ok(g.modules[0].source.tokens.some((t:any)=>t.lexeme==="2"));
});
test("native cache: timestamp-only changes keep syntax and refresh record metadata",()=>{
  const f=fixture({"main.ets":"const x=1;"});const cold=run(f);utimesSync(f.entry,new Date(),new Date(Date.now()+100000));const g=run(f);assert.equal(g.cache.hits,1);assert.equal(g.cache.misses,0);assert.equal(g.cache.writes,1);assert.notEqual(g.modules[0].metadata,cold.modules[0].metadata);assert.deepEqual(g.modules[0].source,cold.modules[0].source);
});
test("native cache: syntax identity/options mismatch invalidates disk entries",()=>{
  const f=fixture({"main.ets":""});run(f);assert.equal(run(f,["--syntax-key","changed"]).cache.misses,1);assert.equal(run(f,["--syntax-key","changed"]).cache.hits,1);
  let bytes=readFileSync(record(f),"utf8");const index=bytes.indexOf("ets-syntax-1:");bytes=bytes.slice(0,index)+bytes.slice(index).replace("ets-syntax-1:","ets-syntax-2:");writeFileSync(record(f),bytes);assert.equal(run(f,["--syntax-key","changed"]).cache.misses,1);
});
test("native resolver: alias and root changes reuse importer syntax and update edges",()=>{
  const f=fixture({"main.ets":'import "pkg";',"a/pkg.ets":"const a=1;","b/pkg.ets":"const b=1;"});run(f,["--root",join(f.directory,"a")]);const rootChanged=run(f,["--root",join(f.directory,"b")]);assert.equal(rootChanged.cache.hits,1);assert.equal(rootChanged.modules[0].file,join(f.directory,"b/pkg.ets"));
  const g=run(f,["--alias","pkg",join(f.directory,"a/pkg")]);assert.equal(g.cache.hits,2);assert.equal(g.modules[0].file,join(f.directory,"a/pkg.ets"));
});
test("native resolver: new higher-priority candidate and deletion re-probe routes",()=>{
  const f=fixture({"main.ets":'import "./lib";',"lib.ets":"const ets=1;"});run(f);put(join(f.directory,"lib.ts"),"const ts=1;");assert.equal(run(f).modules[0].file,join(f.directory,"lib.ts"));unlinkSync(join(f.directory,"lib.ts"));assert.equal(run(f).modules[0].file,join(f.directory,"lib.ets"));unlinkSync(join(f.directory,"lib.ets"));const missing=run(f,[],1);assert.equal(missing.cache.hits,1);assert.equal(missing.modules.length,1);
  put(join(f.directory,"lib.ets"),"const ets=1;");assert.equal(run(f).success,true);
});
test("native resolver: symlink retargeting updates graph without reparsing importer",()=>{
  const f=fixture({"main.ets":'import "./link";',"a.ets":"const a=1;","b.ets":"const b=1;"});symlinkSync("a.ets",join(f.directory,"link.ets"));run(f);unlinkSync(join(f.directory,"link.ets"));symlinkSync("b.ets",join(f.directory,"link.ets"));const g=run(f);assert.equal(g.cache.hits,1);assert.equal(g.modules[0].file,join(f.directory,"b.ets"));
});
for (const bad of ["", "garbage", "999999999999999999999999:", "1:x", "64:"+"0".repeat(64)+"invalid"]) test(`native cache: corrupt record recovers (${bad.slice(0,12)})`,()=>{
  const f=fixture({"main.ets":"const x=1;"});const good=run(f);writeFileSync(record(f),bad);const recovered=run(f);assert.equal(recovered.cache.misses,1);assert.deepEqual(stable(recovered),stable(good));assert.equal(run(f).cache.hits,1);
});
test("native cache: unwritable persistence is a recoverable optimization miss",()=>{
  const f=fixture({"main.ets":""});put(f.cache,"not a directory");const g=run(f);assert.equal(g.success,true);assert.equal(g.cache.writes,0);assert.equal(g.cache.misses,1);
});
test("native cache: SHA-256 matches Node for empty, blocks, Unicode and embedded NUL",()=>{
  for (const source of ["",'const s="España 🙂";',"//"+"x".repeat(1000)+"\n",'const s="a\0b";']) {
    const f=fixture({"main.ets":source});const result=spawnSync(binary,[f.entry],{encoding:"utf8"});const g=JSON.parse(result.stdout.trim());assert.equal(g.modules[0].hash,hash(source));
  }
});
test("native graph: deep dependency chain uses iterative traversal",()=>{
  const files:Record<string,string>={"main.ets":'import "./n0";'};for(let i=0;i<180;i++) files[`n${i}.ets`]=i===179?"":`import "./n${i+1}";`;
  const f=fixture(files);const g=run(f);assert.equal(g.modules.length,181);assert.equal(g.cache.misses,181);assert.equal(run(f).cache.hits,181);
});
test("native loader analyzes its own complete project without host syntax/runtime resolution",()=>{
  const g=invoke(join(root,"bootstrap/modules/demo.ets"))[0];assert.equal(g.success,true);assert.equal(g.modules.length,7);
  for(const m of g.modules) assert.equal(m.hash,hash(readFileSync(m.file)));
  const adapter=readFileSync(join(root,"bootstrap/modules/run.ts"),"utf8");assert.doesNotMatch(adapter,/lexer|parser|loadModuleGraph|readFile/);
});

function unpack(text: string): string[] {
  const values:string[]=[];let at=0;
  while(at<text.length){const colon=text.indexOf(":",at);assert.ok(colon>=at);const size=Number(text.slice(at,colon));assert.ok(Number.isSafeInteger(size)&&size>=0);at=colon+1;values.push(text.slice(at,at+size));at+=size;}
  assert.equal(at,text.length);return values;
}
function frame(values: string[]) { return values.map(value=>`${value.length}:${value}`).join(""); }
function rewriteRecord(path: string, change: (fields:string[])=>void) {
  const fields=unpack(readFileSync(path,"utf8"));change(fields);const body=frame(fields.slice(1));writeFileSync(path,frame([hash(body)])+body);
}
for(const corruption of ["identity","file","hash","root","coordinate","edge","cycle","framing"] as const)
  test(`native cache: validates ${corruption} even with a recomputed envelope checksum`,()=>{
    const f=fixture({"main.ets":"const x=1; print(x);"});const good=run(f);
    rewriteRecord(record(f),fields=>{
      if(corruption==="identity")fields[1]+="-other-build";
      else if(corruption==="file")fields[2]+=".other";
      else if(corruption==="hash")fields[3]="0".repeat(64);
      else if(corruption==="framing")fields[5]="999999999999999999999:";
      else {
        const syntax=unpack(fields[5]);const tokens=Number(syntax[0]),rootAt=1+8*tokens;
        if(corruption==="root")syntax[rootAt]="2147483647";
        else if(corruption==="coordinate")syntax[1+8*(tokens-1)+2]="2147483647";
        else {
          const count=Number(syntax[rootAt+1]);let cursor=rootAt+2,changed=false;
          for(let i=0;i<count;i++){
            cursor+=17;const attrs=Number(syntax[cursor++]);cursor+=attrs*2;const edges=Number(syntax[cursor++]);
            if(edges>0&&!changed){syntax[cursor+1]=corruption==="cycle"?String(i):"2147483647";changed=true;}
            cursor+=edges*2;
          }
          assert.ok(changed);
        }
        fields[5]=frame(syntax);
      }
    });
    const recovered=run(f);assert.equal(recovered.cache.misses,1);assert.deepEqual(stable(recovered),stable(good));
  });

test("native resolver: empty specifier is never a root or alias request",()=>{
  const f=fixture({"main.ets":'import "";',"accidental.ets":""});const g=run(f,["--root",join(f.directory,"accidental")],1);assert.equal(g.diagnostics.length,1);assert.equal(g.modules.length,1);
});
test("native cache: Unicode paths, CRLF and nested templates survive hydration",()=>{
  const f=fixture({"main.ets":'import "./é/🙂";\r\nconst t=`España 🙂 ${`漢字 ${2}`}`;',"é/🙂.ets":'export const label="漢字 🙂";\r\n'});
  const cold=run(f);const warm=run(f);assert.equal(warm.cache.hits,2);assert.equal(warm.cache.misses,0);assert.equal(warm.cache.writes,0);assert.deepEqual(stable(warm),stable(cold));
});
test("native cache: public signature changes preserve syntax of intact consumers",()=>{
  const f=fixture({"main.ets":'import {f} from "./lib"; print(f());',"lib.ets":'export function f():number{return 1;}'});run(f);
  put(join(f.directory,"lib.ets"),'export function f():string{return "new";}');const g=run(f);assert.equal(g.cache.misses,1);assert.equal(g.cache.hits,1);assert.equal(g.modules.at(-1).reused,true);
});
