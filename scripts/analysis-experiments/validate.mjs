import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {compileFile} from '../../src/modules/module-loader.ts';
const root=resolve(import.meta.dirname,'../..');
const files=['bootstrap/checker/effects.ets','bootstrap/checker/safety.ets'];
const saved=files.map(f=>readFileSync(join(root,f),'utf8'));
try {
 for(const variant of ['control','summary-fields','module-search','call-metadata','path-prefix','combined']) {
  files.forEach((f,i)=>writeFileSync(join(root,f),saved[i]));
  execFileSync('python3',['scripts/analysis-experiments/variants.py',variant],{cwd:root});
  await compileFile(join(root,'bootstrap/checker/demo.ets'),{baseDirectory:root});
  console.log(`${variant}: source compiler accepted checker`);
 }
} finally {files.forEach((f,i)=>writeFileSync(join(root,f),saved[i]));}
