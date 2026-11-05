import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildIrFrontend} from './cpp.ts';
import {root} from '../root.ts';

const evidence=join(root,'build/analysis-trace/evidence');
let frontend:string;
before(async()=>{
  mkdirSync(evidence,{recursive:true});
  frontend=process.env.ESTATIC_ANALYSIS_FRONTEND??await buildIrFrontend();
});
function phases(stderr:string):string[]{
  const stack:string[]=[],completed:string[]=[];
  for(const line of stderr.split('\n')){
    const match=/^TRACE analyze\.([a-zA-Z0-9.]+) (BEGIN|END|POINT)$/.exec(line);
    if(!match)continue;
    const [,phase,event]=match;
    if(event==='BEGIN')stack.push(phase);
    if(event==='END'){
      assert.equal(stack.pop(),phase,`unbalanced phase: ${line}`);
      completed.push(phase);
    }
  }
  assert.deepEqual(stack,[],'all started phases must finish on normal/error returns');
  return completed;
}
for(const [name,source,files,status] of [
  ['empty','',{},0],
  ['valid','function f(n:number):number{return n+1;}print(f(2));',{},0],
  ['imports','import {f} from "./lib";print(f());',{'lib.ets':'export function f():number{return 7;}'},0],
  ['expansion','@etsgen function make():string{return "const x=1;print(x);";}make();',{},0],
  ['checker-error','const value:number="wrong";',{},1],
  ['binding-error','print(missing);',{},1],
  ['syntax-error','const = ;',{},1],
] as const)test(`analysis trace preserves ${name} IR and diagnostics`,()=>{
  const dir=mkdtempSync(join(evidence,`${name}-`));
  for(const [path,text] of Object.entries({'main.ets':source,...files}))writeFileSync(join(dir,path),text);
  const entry=join(dir,'main.ets');
  const run=(args:string[])=>spawnSync(frontend,[entry,...args],{encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});
  const quiet=run([]),traced=run(['--trace']);
  assert.ifError(quiet.error);assert.ifError(traced.error);
  writeFileSync(join(evidence,`${name}.trace.log`),traced.stderr);
  writeFileSync(join(evidence,`${name}.ir.json`),traced.stdout);
  assert.equal(quiet.status,status,quiet.stderr+quiet.stdout.slice(-3000));
  assert.equal(traced.status,status,traced.stderr+traced.stdout.slice(-3000));
  assert.equal(quiet.stderr,'','trace is disabled by default');
  assert.equal(traced.stdout,quiet.stdout,'tracing must not change stdout IR or diagnostics');
  assert.equal(JSON.parse(traced.stdout).success,status===0);
  const completed=phases(traced.stderr);
  for(const phase of ['loader','project','expansion.construct','expansion.run','binding.final',
    'checker.construct','checker.run','checker.types','checker.records.construct','checker.records.build','lower','format'])
    assert(completed.includes(phase),`missing ${phase}`);
  if(status===0){
    for(const phase of ['expansion.bind','expansion.search','binding.construct','binding.run',
      'binding.initialize','binding.collect.0','binding.imports.0','binding.exports.0',
      'binding.duplicates','binding.uses.0','binding.targets','checker.safety',
      'safety.construct','safety.memory','safety.captures','safety.effects',
      'safety.provenance','safety.visibility','safety.flow','checker.comptime'])
      assert(completed.includes(phase),`missing ${phase}`);
  }
  if(name==='imports')assert(completed.includes('binding.collect.1'),'module indices identify progress');
  if(name==='expansion'){
    assert(completed.includes('expansion.expand'));
    assert.match(traced.stderr,/TRACE analyze\.expansion\.round\.1 POINT/);
  }
  if(name==='checker-error'||name==='binding-error'||name==='syntax-error')
    assert(!completed.includes('checker.safety'),'phases skipped after diagnostics must not appear completed');
});
