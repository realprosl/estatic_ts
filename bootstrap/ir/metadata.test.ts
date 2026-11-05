import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildIrFrontend, nativeIr} from './cpp.ts';

// Assert the IR contract, rather than a noisy wall-clock threshold: a load of
// an ordinary array into a value slot deep-copies all its elements in C++.
test('container metadata borrows storage instead of copying the container', async () => {
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
      function inspect(xs:constRef<Item[]>):number{return xs.length;}
      const xs:Item[]=[new Item()];
      print(new Scan(xs).sum()); print(temporary().length); print(inspect(xs));
      const fixed:number[2]=[1,2]; print(fixed.length);
      const tuple:[number,string]=[1,"s"]; print(tuple.length);
      const m=new Map<string,number>(); print(m.size);
      const s=new Set<number>(); print(s.size);
      print("hello".length); print(optionalSome(1).kind);
    `);
    const project = nativeIr(frontend, file);
    let count=0;
    for (const f of project.functions) for (const b of f.blocks) for (const i of b.instructions) {
      if (i.op !== 'property') continue;
      count++;
      const kind=project.typeDefinitions[f.values[i.operands[0]]].kind;
      assert.equal(kind, 'constRef', `${i.text} must read a constRef, not a copied value`);
    }
    assert(count >= 9, 'must cover fields, rvalues, references, arrays and other metadata');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
