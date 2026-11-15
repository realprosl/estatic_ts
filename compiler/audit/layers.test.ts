// Auditoría de capas (#176): el repo la cumple y detecta subidas de capa y ciclos.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {audit,layerOf} from "./layers.ts";

const compiler=join(dirname(fileURLToPath(import.meta.url)),"..");

test("layers: compiler/ no tiene subidas de capa ni ciclos",()=>{
  const result=audit(compiler);
  assert.deepEqual(result.violations.map(v=>v.message),[]);
  assert.ok(result.files>40);
});

test("layers: cada directorio tiene su capa",()=>{
  assert.equal(layerOf("platform/host.ts"),"platform");
  assert.equal(layerOf("parser/parser.ts"),"syntax");
  assert.equal(layerOf("diag/source.ts"),"diag");
  assert.equal(layerOf("checker/safety.ts"),"semantic");
  assert.equal(layerOf("ir/lower.ts"),"ir");
  assert.equal(layerOf("backend/cpp/generator.ts"),"backend-cpp");
  assert.equal(layerOf("checker/demo.ts"),"driver");
});

function project(files:Record<string,string>):string{
  const root=mkdtempSync(join(tmpdir(),"etsc-layers-"));
  for(const [name,text] of Object.entries(files)){mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),text);}
  return root;
}

test("layers: detecta un import que sube de capa",()=>{
  const root=project({"parser/parser.ts":'import { x } from "../checker/index";\n',"checker/index.ts":'export { x } from "./checker";\n',"checker/checker.ts":"export const x = 1;\n"});
  try{const v=audit(root).violations;assert.equal(v.length,1);assert.equal(v[0].kind,"layer");assert.match(v[0].message,/parser\/parser\.ts \(syntax\) importa checker\/index\.ts \(semantic\)/);}
  finally{rmSync(root,{recursive:true,force:true});}
});

test("layers: el backend solo ve el modelo del IR",()=>{
  const root=project({"backend/cpp/g.ts":'import { a } from "../../ir/model";\nimport { b } from "../../ir/lower";\n',"ir/model.ts":"export const a = 1;\n","ir/lower.ts":"export const b = 1;\n"});
  try{const v=audit(root).violations;assert.equal(v.length,1);assert.match(v[0].message,/ir\/lower\.ts: de ir\/ solo puede usar ir\/model\.ts/);}
  finally{rmSync(root,{recursive:true,force:true});}
});

test("layers: detecta ciclos y directorios sin capa",()=>{
  const root=project({"checker/a.ts":'import { b } from "./b";\nexport const a = 1;\n',"checker/b.ts":'import { a } from "./a";\nexport const b = 1;\n',"misc/x.ts":"export const x = 1;\n"});
  try{const v=audit(root).violations;assert.ok(v.some(x=>x.kind=="cycle"&&/checker\/a\.ts → checker\/b\.ts → checker\/a\.ts/.test(x.message)));assert.ok(v.some(x=>x.kind=="unknown"&&x.file=="misc/x.ts"));}
  finally{rmSync(root,{recursive:true,force:true});}
});

test("layers: desde otro módulo solo se importa su index.ts",()=>{
  const root=project({"checker/c.ts":'import { a } from "../binder/binder";\nimport { b } from "../binder/index";\nexport const c = 1;\n',"binder/binder.ts":"export const a = 1;\nexport const b = 2;\n","binder/index.ts":'export { a, b } from "./binder";\n'});
  try{const v=audit(root).violations;assert.equal(v.length,1);assert.equal(v[0].kind,"index");assert.match(v[0].message,/checker\/c\.ts importa binder\/binder\.ts: desde otro módulo solo se importa binder\/index\.ts/);}
  finally{rmSync(root,{recursive:true,force:true});}
});
