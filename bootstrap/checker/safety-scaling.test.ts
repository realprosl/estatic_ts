import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {buildIrFrontend} from '../ir/cpp.ts';
import {root} from '../root.ts';

const directory=mkdtempSync(join(root,'build-safety-scaling-'));
let frontend:string;
before(async()=>{frontend=process.env.ESTATIC_ANALYSIS_FRONTEND??await buildIrFrontend();});
after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
async function run(entry:string){
  const child=spawn(frontend,[entry,'--trace']);let stdout='',stderr='',pending='';
  const starts=new Map<string,number>(),times=new Map<string,number>();
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{
    stderr+=chunk;pending+=chunk;let end:number;
    while((end=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,end);pending=pending.slice(end+1);
      const match=/^TRACE analyze\.(safety\.memory|safety\.effects) (BEGIN|END)$/.exec(line);
      if(!match)continue;
      if(match[2]==='BEGIN')starts.set(match[1],performance.now());
      else {assert(starts.has(match[1]));times.set(match[1],performance.now()-starts.get(match[1])!);}
    }
  });
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  const status=await new Promise<number|null>((resolve,reject)=>{
    child.on('error',reject);child.on('close',resolve);
  }).finally(()=>clearTimeout(timer));
  assert.equal(status,0,stderr+stdout.slice(-3000));
  const project=JSON.parse(stdout);assert.equal(project.success,true);assert.deepEqual(project.diagnostics,[]);
  return {project,times};
}

test('safety independent iteration leases and synchronous owners scale',{timeout:120000},async t=>{
  const samples:{loops:number;memoryMs:number;effectsMs:number}[]=[];
  for(const count of [64,128,256]){
    const entry=join(directory,'loops-'+count+'.ets');
    writeFileSync(entry,'const xs:number[]=[1]; function f():void{\n'+
      'for(const x of xs){print(x);}\n'.repeat(count)+'} f();');
    const memory:number[]=[],effects:number[]=[];
    for(let repeat=0;repeat<3;repeat++){
      const {project,times}=await run(entry);
      assert(project.functions.some((f:any)=>f.blocks.length>=count),'loops must survive lowering');
      assert(times.has('safety.memory')&&times.has('safety.effects'));
      memory.push(times.get('safety.memory')!);effects.push(times.get('safety.effects')!);
    }
    memory.sort((a,b)=>a-b);effects.sort((a,b)=>a-b);
    samples.push({loops:count,memoryMs:memory[1],effectsMs:effects[1]});
  }
  t.diagnostic(JSON.stringify(samples));
  for(let i=1;i<samples.length;i++){
    assert(samples[i].memoryMs<=samples[i-1].memoryMs*6+20,
      `independent leases regained cubic work: ${JSON.stringify(samples)}`);
    assert(samples[i].effectsMs<=samples[i-1].effectsMs*3.3+20,
      `synchronous owners revisit large ancestor blocks: ${JSON.stringify(samples)}`);
  }
});
