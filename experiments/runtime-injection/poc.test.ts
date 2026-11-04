import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildNativeCompiler} from '../../bootstrap/build/native-compiler.ts';
import {buildIrFrontend,nativeIr,buildIrCpp} from '../../bootstrap/ir/cpp.ts';
import {root} from '../../bootstrap/root.ts';

const directory=mkdtempSync(join(root,'build-runtime-injection-poc-'));
const compiler=process.env.ESTATIC_NATIVE_COMPILER??buildNativeCompiler();
let frontend:string;
before(async()=>{frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();});
after(()=>rmSync(directory,{recursive:true,force:true}));

function compileAndRun(source:string) {
 const entry=join(directory,'main.ets');
 writeFileSync(entry,source);
 const ir=nativeIr(frontend,entry);
 const emitted=spawnSync(compiler,['--codegen-json'],{input:JSON.stringify(ir),encoding:'utf8',maxBuffer:64*1024*1024});
 assert.ifError(emitted.error);
 assert.equal(emitted.status,0,emitted.stderr);
 const result=JSON.parse(emitted.stdout);
 assert(result.cpp.includes('#include "experiments/runtime-injection/console.hpp"'),'expected native include');
 const cpp=join(directory,'app.cpp'),bin=join(directory,'app');
 writeFileSync(cpp,result.cpp);
 buildIrCpp(result,cpp,bin);
 const executed=spawnSync(bin,[],{encoding:'utf8'});
 assert.ifError(executed.error);
 assert.equal(executed.status,0,executed.stderr);
 return executed.stdout;
}
test('phase 2: imported ETS runtime function executes C++ without native registration',()=>{
 const source=`import {format} from "${root}/experiments/runtime-injection/console-v1"; print(format("hello"));`;
 assert.equal(compileAndRun(source),'runtime:hello\n');
});
test('phase 3: expanded ETS module uses same prebuilt compiler',()=>{
 const source=`import {formatExtra} from "${root}/experiments/runtime-injection/console-v2"; print(formatExtra("hello"));`;
 assert.equal(compileAndRun(source),'runtime:hello!\n');
});
