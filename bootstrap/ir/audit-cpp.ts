import { mkdtempSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildLoader, root } from "../modules/build.ts";
import { nativeIr, buildIrCpp } from "./cpp.ts";
import { generateCppFromIr } from "../../src/codegen/ir/cpp-generator.ts";
const directory=mkdtempSync(join(root,"build-ir-cpp-audit-"));
try {
 const binary=process.env.ESTATIC_IR_BINARY??await buildLoader(join(directory,"lower"),"bootstrap/ir/demo.ets",true);
 const compile=process.argv.includes("--compile");const results=[];
 for(const file of readdirSync(join(root,"examples"),{recursive:true}).map(String).filter(f=>f.endsWith(".ets")).sort()) {
  try {
   const result=generateCppFromIr(nativeIr(binary,join(root,"examples",file)));
   if(compile){const cpp=join(directory,"app.cpp");writeFileSync(cpp,result.cpp);buildIrCpp(result,cpp,join(directory,"app"));}
   results.push({file,success:true});
  }catch(e){results.push({file,success:false,message:(e as Error).message.slice(-4000)});}
 }
 console.log(JSON.stringify({accepted:results.filter(r=>r.success).length,total:results.length,compile,results},null,2));
 process.exitCode=results.some(r=>!r.success&&r.file!=="expected-errors/private-bad.ets")?1:0;
}finally{rmSync(directory,{recursive:true,force:true});}
