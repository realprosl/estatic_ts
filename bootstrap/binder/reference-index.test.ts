import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {buildLoader, root} from '../modules/build.ts';

const directory=mkdtempSync(join(root,'build-binder-index-'));
let binary:string;
before(async()=>{
  binary=process.env.ESTATIC_BINDER_PROFILE??await buildLoader(join(directory,'binary'),
    'bootstrap/binder/reference-profile.ets',true,'-O2');
});
after(()=>rmSync(directory,{recursive:true,force:true}));
function fixture(files:Record<string,string>){
  const dir=mkdtempSync(join(directory,'project-'));
  for(const [name,text] of Object.entries(files))writeFileSync(join(dir,name),text);
  return join(dir,'main.ets');
}
async function bind(entry:string,status=0){
  const child=spawn(binary,[entry]);
  let stdout='',stderr='',pending='';
  const starts=new Map<string,number>(), uses:number[]=[];
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{
    stderr+=chunk;pending+=chunk;
    let end:number;
    while((end=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,end);pending=pending.slice(end+1);
      const match=/^TRACE analyze\.binding\.uses\.(\d+) (BEGIN|END)$/.exec(line);
      if(!match)continue;
      if(match[2]==='BEGIN')starts.set(match[1],performance.now());
      else {assert(starts.has(match[1]));uses.push(performance.now()-starts.get(match[1])!);}
    }
  });
  const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
  const code=await new Promise<number|null>((resolve,reject)=>{
    child.on('error',reject);child.on('close',resolve);
  }).finally(()=>clearTimeout(timer));
  assert.equal(code,status,stderr+stdout.slice(-4000));
  const result=JSON.parse(stdout);
  assert.equal(result.success,status===0);
  return {result,uses};
}
function resolved(g:any,name:string){return g.references.filter((r:any)=>r.name===name&&!r.deferred);}

test('binder index preserves namespace chains, module identities and ordinary members',async()=>{
  const {result:g}=await bind(fixture({
    'main.ets':'import * as a from "./a"; import * as b from "./b"; print(a.inner.value,b.inner.value); const o={value:3}; print(o.value);',
    'a.ets':'export * as inner from "./left";',
    'b.ets':'export * as inner from "./right";',
    'left.ets':'export const value=1;', 'right.ets':'export const value=2;',
  }));
  const values=resolved(g,'value');assert.equal(values.length,2);
  assert.notEqual(values[0].target,values[1].target);
  assert.equal(g.references.filter((r:any)=>r.name==='value'&&r.deferred).length,1);
});

test('binder index keeps the last value reference when a node has generic type references',async()=>{
  const {result:g}=await bind(fixture({
    'main.ets':'import * as ns from "./lib"; const v=new ns.Box<ns.Tag>(); print(v.field);',
    'lib.ets':'export interface Tag{} export class Box<T>{field:number=1;}',
  }));
  assert.equal(resolved(g,'Box').filter((r:any)=>r.space==='value').length,1);
  assert.equal(resolved(g,'Tag').filter((r:any)=>r.space==='type').length,1);
  assert.equal(g.references.filter((r:any)=>r.name==='field'&&r.deferred).length,1);
});

test('binder index preserves errors for missing and type-only namespace members',async()=>{
  for(const [source,message] of [
    ['print(ns.absent.value);',/no exporta 'absent'/],
    ['print(ns.OnlyType);',/no está disponible como value/],
    ['print(ns?.value);',/acceso opcional/],
  ] as const){
    const {result:g}=await bind(fixture({
      'main.ets':'import * as ns from "./lib"; '+source,
      'lib.ets':'export const value=1; export interface OnlyType{}',
    }),1);
    assert(g.diagnostics.some((d:any)=>message.test(d.message)),JSON.stringify(g.diagnostics));
  }
});

test('binder member resolution scales without repeated full reference scans',{timeout:120000},async t=>{
  const samples:{members:number;milliseconds:number}[]=[];
  for(const count of [128,256,512]){
    const entry=fixture({
      'main.ets':'import * as ns from "./barrel";\n'+'print(ns.inner.value);\n'.repeat(count),
      'barrel.ets':'export * as inner from "./lib";', 'lib.ets':'export const value=1;',
    });
    const elapsed:number[]=[];
    for(let repeat=0;repeat<3;repeat++){
      const {result:g,uses}=await bind(entry);
      assert.equal(resolved(g,'value').filter((r:any)=>r.space==='value').length,count);
      assert.equal(g.references.filter((r:any)=>r.deferred).length,0);
      elapsed.push(uses.at(-1)!); // Entry module is last in loader dependency order.
    }
    elapsed.sort((a,b)=>a-b);
    samples.push({members:count*2,milliseconds:elapsed[1]});
  }
  t.diagnostic(JSON.stringify(samples));
  // Allow scheduling/pipe latency for short runs; quadratic scans exceed this
  // growth bound on the same machine. Loading/formatting are outside the interval.
  for(let i=1;i<samples.length;i++)
    assert(samples[i].milliseconds<=samples[i-1].milliseconds*3.3+20,
      `member resolution regressed: ${JSON.stringify(samples)}`);
});
