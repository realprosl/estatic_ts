// Validation orchestration only; estc performs all compiler stages natively.
import {readdirSync,mkdtempSync,rmSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {root} from "../root.ts";
import {buildNativeCompiler} from "../build/native-compiler.ts";
import {buildIrFrontend} from "./cpp.ts";
mkdirSync(join(root,"build"),{recursive:true});const directory=mkdtempSync(join(root,"build/audit-estc-"));
try {
 const compiler=process.env.ESTC_BINARY??buildNativeCompiler(),frontend=process.env.ESTATIC_IR_BINARY??await buildIrFrontend();const results=[];
 for(const file of readdirSync(join(root,"examples"),{recursive:true}).map(String).filter(file=>file.endsWith(".ets")).sort()){
  const p=spawnSync(compiler,["build",join(root,"examples",file),"--frontend",frontend,"-o",join(directory,"app.cpp"),"--binary",join(directory,"app")],{encoding:"utf8",maxBuffer:8*1024*1024,timeout:180000,env:{...process.env,ESTC_ROOT:root}});
  results.push({file,success:p.status===0,message:p.status===0?undefined:(p.error?.message??p.stderr).slice(-4000)});
 }
 console.log(JSON.stringify({accepted:results.filter(r=>r.success).length,total:results.length,compile:true,native:true,results},null,2));process.exitCode=results.some(r=>!r.success&&r.file!=="expected-errors/private-bad.ets")?1:0;
}finally{rmSync(directory,{recursive:true,force:true});}
