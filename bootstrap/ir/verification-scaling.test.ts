import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {buildLoader,root} from '../modules/build.ts';

let binary:string;
before(async()=>{
  binary=process.env.ESTATIC_VERIFICATION_PROFILE??await buildLoader(
    join(root,'build/verification-profile'),'bootstrap/ir/verification-profile.ets',true);
});
function run(...args:string[]){
  const start=performance.now();
  const child=spawnSync(binary,args,{encoding:'utf8',timeout:8000});
  const milliseconds=performance.now()-start;
  assert.ifError(child.error);assert.equal(child.status,0,child.stderr+child.stdout);
  const result=JSON.parse(child.stdout);assert.equal(result.success,true);
  return{...result,milliseconds};
}
test('initialization tree preserves scan semantics for aliases, parents, siblings and moves',()=>{
  assert.equal(run('relations').checks,1056);
});
test('isolated verifier accepts initialized locals and rejects each uninitialized read',()=>{
  for(const size of [256,512,1024]){
    assert.equal(run('stores',String(size)).issues,0);
    assert.equal(run('uninitialized',String(size)).issues,size);
  }
});
test('isolated writes do not scan every unrelated local',{timeout:30000},t=>{
  const samples:{places:number;milliseconds:number}[]=[];
  for(const size of [256,1024]){
    const times=Array.from({length:3},()=>run('stores',String(size)).milliseconds).sort((a,b)=>a-b);
    samples.push({places:size,milliseconds:times[1]});
  }
  t.diagnostic(JSON.stringify(samples));
  assert(samples[1].milliseconds<=samples[0].milliseconds*8+30,
    `four times the locals regained quadratic scans: ${JSON.stringify(samples)}`);
});
