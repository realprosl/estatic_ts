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
  assert.equal(layerOf("platform/host.ets"),"platform");
  assert.equal(layerOf("parser/parser.ets"),"syntax");
  assert.equal(layerOf("diag/source.ets"),"diag");
  assert.equal(layerOf("checker/safety.ets"),"semantic");
  assert.equal(layerOf("ir/lower.ets"),"ir");
  assert.equal(layerOf("backend/cpp/generator.ets"),"backend-cpp");
  assert.equal(layerOf("checker/demo.ets"),"driver");
});

function project(files:Record<string,string>):string{
  const root=mkdtempSync(join(tmpdir(),"etsc-layers-"));
  for(const [name,text] of Object.entries(files)){mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),text);}
  return root;
}

test("layers: detecta un import que sube de capa",()=>{
  const root=project({"parser/parser.ets":'import { x } from "../checker/checker";\n',"checker/checker.ets":"export const x = 1;\n"});
  try{const v=audit(root).violations;assert.equal(v.length,1);assert.equal(v[0].kind,"layer");assert.match(v[0].message,/parser\/parser\.ets \(syntax\) importa checker\/checker\.ets \(semantic\)/);}
  finally{rmSync(root,{recursive:true,force:true});}
});

test("layers: el backend solo ve el modelo del IR",()=>{
  const root=project({"backend/cpp/g.ets":'import { a } from "../../ir/model";\nimport { b } from "../../ir/lower";\n',"ir/model.ets":"export const a = 1;\n","ir/lower.ets":"export const b = 1;\n"});
  try{const v=audit(root).violations;assert.equal(v.length,1);assert.match(v[0].message,/ir\/lower\.ets: de ir\/ solo puede usar ir\/model\.ets/);}
  finally{rmSync(root,{recursive:true,force:true});}
});

test("layers: detecta ciclos y directorios sin capa",()=>{
  const root=project({"checker/a.ets":'import { b } from "./b";\nexport const a = 1;\n',"checker/b.ets":'import { a } from "./a";\nexport const b = 1;\n',"misc/x.ets":"export const x = 1;\n"});
  try{const v=audit(root).violations;assert.ok(v.some(x=>x.kind=="cycle"&&/checker\/a\.ets → checker\/b\.ets → checker\/a\.ets/.test(x.message)));assert.ok(v.some(x=>x.kind=="unknown"&&x.file=="misc/x.ets"));}
  finally{rmSync(root,{recursive:true,force:true});}
});
