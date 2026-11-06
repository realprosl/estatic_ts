import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {buildIrFrontend} from './cpp.ts';
import {root} from '../root.ts';

const directory=mkdtempSync(join(root,'build-lowering-scaling-'));
let frontend:string;
before(async()=>{frontend=process.env.ESTATIC_ANALYSIS_FRONTEND??await buildIrFrontend();});
after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
async function lower(entry:string){
  const child=spawn(frontend,[entry,'--trace']);let stdout='',stderr='',pending='';
  let started=-1,lowerMs=-1;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{
    stderr+=chunk;pending+=chunk;let end:number;
    while((end=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,end);pending=pending.slice(end+1);
      if(line==='TRACE analyze.lower BEGIN')started=performance.now();
      if(line==='TRACE analyze.lower END'){assert(started>=0);lowerMs=performance.now()-started;}
    }
  });
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  const status=await new Promise<number|null>((resolve,reject)=>{
    child.on('error',reject);child.on('close',resolve);
  }).finally(()=>clearTimeout(timer));
  assert.equal(status,0,stderr+stdout.slice(-3000));
  const project=JSON.parse(stdout);assert.equal(project.success,true);assert.deepEqual(project.diagnostics,[]);
  assert(lowerMs>=0,'lower must finish');
  return {project,lowerMs};
}

test('IR initialization paths avoid repeated whole-function scans',{timeout:120000},async t=>{
  const samples:{stores:number;lowerMs:number}[]=[];
  for(const count of [512,1024]){
    const entry=join(directory,'stores-'+count+'.ets');
    // Every projected store needs initialization checks. Rebuilding its index
    // path scans value definitions; doing that for every other place is cubic.
    writeFileSync(entry,'function f():void{let xs:number[]=[1,2];\n'+
      Array.from({length:count},(_,i)=>`xs[${i%2}]=${i};`).join('\n')+'\nprint(xs[0]);} f();');
    const times:number[]=[];
    for(let repeat=0;repeat<3;repeat++){
      const {project,lowerMs}=await lower(entry);
      assert(project.functions.some((f:any)=>f.places.length>=count),'projected stores must survive lowering');
      times.push(lowerMs);
    }
    times.sort((a,b)=>a-b);samples.push({stores:count,lowerMs:times[1]});
  }
  t.diagnostic(JSON.stringify(samples));
  assert(samples[1].lowerMs<=samples[0].lowerMs*5.5+30,
    `initialization paths regained cubic work: ${JSON.stringify(samples)}`);
});
