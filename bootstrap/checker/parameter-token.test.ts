import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {buildLoader,root} from '../modules/build.ts';
const directory=mkdtempSync(join(root,'build-checker-token-'));
let binary:string;
before(async()=>{binary=process.env.ESTATIC_CHECKER_TOKEN_PROFILE??await buildLoader(
  join(directory,'binary'),'bootstrap/checker/parameter-token-profile.ets',true);});
after(()=>rmSync(directory,{recursive:true,force:true}));
async function run(arg:string){
  const child=spawn(binary,[arg]);let stdout='',stderr='',pending='',start=0,elapsed=-1;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{
    stderr+=chunk;pending+=chunk;let end:number;
    while((end=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,end);pending=pending.slice(end+1);
      if(/^TRACE analyze\.checker\.(tokenProbe|memberProbe) BEGIN$/.test(line))start=performance.now();
      if(/^TRACE analyze\.checker\.(tokenProbe|memberProbe) END$/.test(line))elapsed=performance.now()-start;
    }
  });
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  const status=await new Promise<number|null>((resolve,reject)=>{
    child.on('error',reject);child.on('close',resolve);
  }).finally(()=>clearTimeout(timer));
  assert.equal(status,0,stderr+stdout);return{value:JSON.parse(stdout),elapsed};
}
test('checker parameter tokens preserve bounds, packs and exact canonical IDs',async()=>{
  const entry=join(directory,'main.ets');
  writeFileSync(entry,'function id<T extends number>(x:T):T{return x;} function pack<...P>(...values:P):void{print(values);}');
  const {value}=await run(entry);
  assert.equal(value[0].bound,'number');assert.equal(value[0].pack,false);
  assert.equal(value[1].bound,'');assert.equal(value[1].pack,true);
  for(const item of value.slice(2))assert.deepEqual({bound:item.bound,pack:item.pack},{bound:'',pack:false},item.token);
});
test('checker ordinary type probes do not scan the symbol table',{timeout:60000},async t=>{
  const samples:{symbols:number;milliseconds:number}[]=[];
  for(const symbols of [512,1024,2048]){
    const durations:number[]=[];
    for(let repeat=0;repeat<3;repeat++){
      const {value,elapsed}=await run(String(symbols));assert.equal(value.success,true);assert(elapsed>=0);
      durations.push(elapsed);
    }
    durations.sort((a,b)=>a-b);samples.push({symbols,milliseconds:durations[1]});
  }
  t.diagnostic(JSON.stringify(samples));
  for(let i=1;i<samples.length;i++)assert(samples[i].milliseconds<=samples[i-1].milliseconds*1.5+20,
    `type probes scan unrelated symbols: ${JSON.stringify(samples)}`);
});
test('checker class member lookup ignores unrelated class symbols',{timeout:60000},async t=>{
  const samples:{symbols:number;milliseconds:number}[]=[];
  for(const symbols of [512,1024,2048]){
    const durations:number[]=[];
    for(let repeat=0;repeat<3;repeat++){
      const {value,elapsed}=await run('m'+symbols);assert.equal(value.success,true);assert(elapsed>=0);
      durations.push(elapsed);
    }
    durations.sort((a,b)=>a-b);samples.push({symbols,milliseconds:durations[1]});
  }
  t.diagnostic(JSON.stringify(samples));
  for(let i=1;i<samples.length;i++)assert(samples[i].milliseconds<=samples[i-1].milliseconds*1.5+20,
    `class member lookup scans unrelated symbols: ${JSON.stringify(samples)}`);
});
