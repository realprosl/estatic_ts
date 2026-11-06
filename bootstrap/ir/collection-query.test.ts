import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildIrFrontend,nativeIr} from './cpp.ts';
import {root} from '../root.ts';
import {generateCppFromIr} from '../../src/codegen/ir/cpp-generator.ts';
import type {IrProject} from '../../src/codegen/ir/model.ts';

const directory=mkdtempSync(join(root,'build-collection-query-'));let frontend:string,serial=0;
before(async()=>{frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();});
after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
function project(source:string):IrProject{
  const entry=join(directory,'input-'+serial+++'.ets');writeFileSync(entry,'function boolText(value:boolean):string{return value?"true":"false";}\n'+source);
  return nativeIr(frontend,entry);
}
function generate(p:IrProject):string[]{
  const results=[generateCppFromIr(p).cpp];
  if(process.env.ESTATIC_NATIVE_CODEGEN){
    const r=spawnSync(process.env.ESTATIC_NATIVE_CODEGEN,['--codegen-json'],
      {input:JSON.stringify(p),encoding:'utf8',maxBuffer:64*1024*1024});
    assert.ifError(r.error);assert.equal(r.status,0,r.stderr);results.push(JSON.parse(r.stdout).cpp);
  }
  return results;
}
const count=(cpp:string)=>cpp.split('// collection query load fused with read-only lookup').length-1;
function execute(cpp:string):string[]{
  const path=join(directory,'program-'+serial+++'.cpp'),binary=path+'.bin';writeFileSync(path,cpp);
  const build=spawnSync(process.env.CXX??'g++',['-std=c++20','-O0','-pthread','-fno-exceptions','-I'+root,path,'-o',binary],
    {encoding:'utf8',timeout:120000,env:{...process.env,TMPDIR:directory}});
  assert.ifError(build.error);assert.equal(build.status,0,build.stderr);
  const r=spawnSync(binary,[],{encoding:'utf8',timeout:10000});
  assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n');
}

test('collection lookups avoid primitive Map/Set copies and preserve independent values',()=>{
  const p=project(`
    class Holder{m:Map<string,number>;constructor(m:Map<string,number>){this.m=m;}}
    let m=new Map<string,number>();m.set("k",7);let s=new Set<number>();s.add(3);
    print(boolText(m.has("k")));print(m.get("k").valueOr(0));
    print(boolText(s.has(3)));print(boolText(new Holder(m).m.has("k")));
    const maps:Map<string,number>[]=[m];print(boolText(maps[0].has("k")));
    const copy=m;m.set("k",9);print(copy.get("k").valueOr(0));print(m.get("k").valueOr(0));
  `);
  const outputs=generate(p);assert(count(outputs[0])>=5);
  for(const cpp of outputs){assert.equal(count(cpp),count(outputs[0]));assert.deepEqual(execute(cpp),['true','7','true','true','true','7','9']);}
});

test('collection queries keep aggregate-valued maps on the conservative path',()=>{
  const p=project('let m=new Map<string,number[]>();m.set("k",[1,2]);print(boolText(m.has("k")));');
  for(const cpp of generate(p)){assert.equal(count(cpp),0);assert.deepEqual(execute(cpp),['true']);}
});

test('collection snapshots survive extra consumers, writes and intervening calls',()=>{
  const original=project('let m=new Map<string,number>();m.set("k",1);print(boolText(m.has("k")));');
  for(const mode of ['shared','write','call'] as const){
    const p=structuredClone(original);let changed=false;
    for(const f of p.functions)for(const b of f.blocks){
      if(changed)continue;
      const at=b.instructions.findIndex(i=>i.op==='runtimeCall'&&p.runtimeContracts[i.contract]?.name==='Map.has');
      if(at<0)continue;
      const read=b.instructions[at],load=b.instructions.find(i=>i.result===read.operands[0])!;
      assert.equal(load.op,'load');
      if(mode==='shared'){
        const extra=structuredClone(read);extra.result=f.values.length;f.values.push(extra.typeId);
        b.instructions.splice(at+1,0,extra);
      }else if(mode==='write'){
        const empty=structuredClone(b.instructions.find(i=>i.op==='collection'&&i.typeId===load.typeId)!);
        empty.result=f.values.length;f.values.push(empty.typeId);
        const store=structuredClone(load);store.op='store';store.result=-1;store.operands=[empty.result];
        store.typeId=p.types.indexOf('void');b.instructions.splice(at,0,empty,store);
      }else{
        const call=structuredClone(b.instructions.find(i=>i.op==='intrinsic'&&i.text==='print')!);
        call.operands=[read.operands[1]];b.instructions.splice(at,0,call);
      }
      changed=true;
    }
    assert(changed);
    for(const cpp of generate(p)){
      assert.equal(count(cpp),0,mode+' must retain the captured map value');
      assert.deepEqual(execute(cpp),mode==='call'?['k','true']:['true']);
    }
  }
});
