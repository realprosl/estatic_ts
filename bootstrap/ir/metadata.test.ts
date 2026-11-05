import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildIrFrontend, nativeIr} from './cpp.ts';
import {generateCppFromIr} from '../../src/codegen/ir/cpp-generator.ts';
import type {IrProject} from '../../src/codegen/ir/model.ts';

// Assert elimination of value copies deterministically, in both backends. A
// timing guard in Actions separately exercises the actual Parser constructor.
test('metadata-only loads avoid copies, while other loads retain snapshots', async () => {
  const frontend = process.env.ESTATIC_IR_BINARY ?? await buildIrFrontend();
  const dir = mkdtempSync(join(tmpdir(), 'ets-metadata-'));
  try {
    const file = join(dir, 'main.ets');
    writeFileSync(file, `
      class Item { value:number=1; }
      class Scan {
        items:Item[];
        constructor(items:Item[]){this.items=items;}
        sum():number{let n=0;for(let i=0;i<this.items.length;i+=1)n+=this.items[i].value;return n;}
      }
      function temporary():Item[]{return [new Item()];}
      const xs:Item[]=[new Item()];
      print(new Scan(xs).sum()); print(temporary().length);
      const fixed:number[2]=[1,2]; print(fixed.length);
      print(xs.length); const matrix:Item[][]=[xs]; print(matrix[0].length);
      const m=new Map<string,number>(); print(m.size);
      const s=new Set<number>(); print(s.size); print("hello".length);
      let ns:number[]=[1]; ns.push(ns.length); print(ns.length);
    `);
    const project = nativeIr(frontend, file);
    const count = (cpp:string) => [...cpp.matchAll(/\/\/ metadata-only load v\d+/g)].length;
    const generate = (p:IrProject):string[] => {
      const results=[generateCppFromIr(p).cpp];
      if(process.env.ESTATIC_NATIVE_CODEGEN){
        const r=spawnSync(process.env.ESTATIC_NATIVE_CODEGEN,['--codegen-json'],
          {input:JSON.stringify(p),encoding:'utf8',maxBuffer:64*1024*1024});
        assert.ifError(r.error); assert.equal(r.status,0,r.stderr);
        results.push(JSON.parse(r.stdout).cpp);
      }
      return results;
    };
    const original=generate(project).map(count);
    assert(original[0]>=8, 'must eliminate array, field, indexed, string and collection copies');
    assert(original.every(n=>n===original[0]), 'backends must agree');
    // A second consumer needs the original value: no fusion is permitted.
    const changed=structuredClone(project);
    let inserted=false;
    for(const f of changed.functions)for(const b of f.blocks){
      if(inserted)continue;
      const at=b.instructions.findIndex((i,k)=>k>0&&i.op==='property'&&i.text==='length'&&
        b.instructions[k-1].op==='load'&&b.instructions[k-1].result===i.operands[0]);
      if(at<0)continue;
      const extra=structuredClone(b.instructions[at]); extra.result=f.values.length;
      f.values.push(extra.typeId); b.instructions.splice(at+1,0,extra); inserted=true;
    }
    assert(inserted);
    assert(generate(changed).every(c=>count(c)===original[0]-1), 'shared loads must retain value semantics');
    // Even a harmless intervening instruction prevents moving a read later.
    const separated=structuredClone(project);
    inserted=false;
    for(const f of separated.functions)for(const b of f.blocks){
      if(inserted)continue;
      const at=b.instructions.findIndex((i,k)=>k>0&&i.op==='property'&&i.text==='length'&&
        b.instructions[k-1].op==='load'&&b.instructions[k-1].result===i.operands[0]);
      if(at<0)continue;
      const gap=structuredClone(b.instructions[at-1]);gap.op='constant';gap.text='0';
      gap.typeId=b.instructions[at].typeId;gap.place=-1;gap.result=f.values.length;gap.operands=[];
      f.values.push(gap.typeId);b.instructions.splice(at,0,gap);inserted=true;
    }
    assert(inserted);
    assert(generate(separated).every(c=>count(c)===original[0]-1), 'non-adjacent loads must retain snapshots');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
