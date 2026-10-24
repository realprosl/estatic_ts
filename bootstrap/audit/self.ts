import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildLoader,root} from '../modules/build.ts';

const directory=mkdtempSync(join(root,'build-native-self-'));
try {
  const binary=await buildLoader(join(directory,'binary'),'bootstrap/audit/self.ets',true,'-O2');
  const run=spawnSync(binary,[join(root,'bootstrap/checker/demo.ets')],{
    cwd:root,encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','inherit'],
  });
  if(run.error)throw run.error;
  if(run.signal || ![0,1].includes(run.status??-1))throw new Error(`Native self audit failed: ${run.status}, ${run.signal}: ${run.stderr}`);
  const result=JSON.parse(run.stdout);
  if(typeof result.success!=='boolean' || !Array.isArray(result.diagnostics) || result.success!==(run.status===0))throw new Error('Inconsistent native audit result');
  console.log(JSON.stringify(result,null,2));
  process.exitCode=run.status??1;
} finally {
  rmSync(directory,{recursive:true,force:true});
}
