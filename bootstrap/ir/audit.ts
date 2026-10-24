// Host build/I/O adapter; every source is checked and lowered by the ETS binary.
import { mkdtempSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildLoader, root } from "../modules/build.ts";
const directory=mkdtempSync(join(root,"build-ir-audit-"));
try {
  const binary=await buildLoader(join(directory,"binary"),"bootstrap/ir/demo.ets",true);
  const files=readdirSync(join(root,"examples"),{recursive:true}).map(String).filter(f=>f.endsWith(".ets")).sort();
  let results:any[]=[];
  for(const file of files){
    const p=spawnSync(binary,[join(root,"examples",file)],{encoding:"utf8",timeout:60000,maxBuffer:32*1024*1024});
    if(p.error)throw p.error;
    if(!p.stdout.trim()){results.push({file,success:false,diagnostics:[{code:"IR_CRASH",message:`exit=${p.status} signal=${p.signal}: ${p.stderr.slice(0,500)}`} ]});continue;}
    const ir=JSON.parse(p.stdout);
    if(!ir.success){const debug=join(root,"build/ir-corpus",file.replaceAll("/","--")+".json");mkdirSync(join(root,"build/ir-corpus"),{recursive:true});writeFileSync(debug,p.stdout);}
    results.push({file,success:ir.success,diagnostics:ir.diagnostics.map((d:any)=>({code:d.code,message:d.message,source:d.source.file,node:d.source.node}))});
  }
  console.log(JSON.stringify({accepted:results.filter(r=>r.success).length,total:results.length,results},null,2));
  process.exitCode=results.some(r=>!r.success&&r.file!=="expected-errors/private-bad.ets")?1:0;
} finally {rmSync(directory,{recursive:true,force:true});}
