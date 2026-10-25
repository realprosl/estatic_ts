#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Build/I/O adapter. Source analysis/lowering stay in the native ETS process.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildLoader, root } from "../modules/build.ts";
import { generateCppFromIr, type IrCppResult } from "../../src/codegen/ir/cpp-generator.ts";
import type { IrProject } from "../../src/codegen/ir/model.ts";

export async function buildIrFrontend(directory=join(root,"build/bootstrap/ir-cpp")):Promise<string> {
  const hash=createHash("sha256").update(root).update(process.platform).update(process.arch).update(process.env.CXX??"g++");
  for(const folder of ["src","bootstrap","runtime"])for(const path of readdirSync(join(root,folder),{recursive:true}).map(String).filter(p=>/\.(ts|ets|hpp|cpp)$/.test(p)&&!p.endsWith(".test.ts")).sort())hash.update(folder+"/"+path).update(readFileSync(join(root,folder,path)));
  hash.update(readFileSync(join(root,"package.json")));
  const identity=hash.digest("hex"),stamp=join(directory,"frontend.sha256"),binary=join(directory,"modules-demo");
  if(existsSync(binary)&&existsSync(stamp)&&readFileSync(stamp,"utf8")===identity)return binary;
  const built=await buildLoader(directory,"bootstrap/ir/demo.ets",true);writeFileSync(stamp,identity);return built;
}
export function nativeIr(binary:string, entry:string,loaderArgs:string[]=[]):IrProject {
  const p=spawnSync(binary,[resolve(entry),...loaderArgs],{encoding:"utf8",maxBuffer:64*1024*1024,timeout:120000});
  if(p.error)throw p.error;
  if(p.status!==0){
    let details=p.stderr;
    try {const project=JSON.parse(p.stdout);details=project.diagnostics.map((d:{code:string;message:string;source?:{file:string;start:number}})=>`${d.source?.file??entry}:${d.source?.start??0}: ${d.code}: ${d.message}`).join("\n")||details;}catch{}
    throw new Error(`Native IR failed (${p.status}): ${details||p.stdout.slice(-8000)}`);
  }
  return JSON.parse(p.stdout);
}
export function buildIrCpp(result:IrCppResult,cpp:string,binary:string,cxx=process.env.CXX??"g++",flags:string[]=[],linkFlags:string[]=[]):void {
  const args=["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,...flags,cpp];
  const local=join(root,"build/libs/libuv"), libs:string[]=[];
  if(result.runtimeBackends.libuv) {
    if(existsSync(join(local,"include/uv.h")))args.push(`-I${local}/include`);
    args.push(join(root,"runtime/runtime_ets_libuv.cpp"));
    if(result.headers.includes("runtime/ets_runtime_full.hpp"))args.push(join(root,"runtime/runtime_ets_net_libuv.cpp"));
    libs.push(existsSync(join(local,"lib/libuv.a"))?join(local,"lib/libuv.a"):"-luv");
    if(process.platform==="linux")libs.push("-ldl","-lrt");
  }
  if(result.headers.includes("runtime/ets_http_httplib.hpp"))args.push("-DCPPHTTPLIB_NO_EXCEPTIONS",join(root,"runtime/external/httplib/httplib.cc"));
  if(result.headers.includes("runtime/ets_http_drogon.hpp")) {
    const drogon=join(root,"build/libs/drogon");
    // Drogon's public template headers require C++ exception support internally.
    args.push("-fexceptions","-I/usr/include/jsoncpp");
    if(existsSync(join(drogon,"include/drogon/drogon.h")))args.push(`-I${drogon}/include`);
    if(existsSync(join(drogon,"lib/libdrogon.a")))libs.push(`-L${drogon}/lib`);
    libs.push("-ldrogon","-ltrantor","-ljsoncpp","-luuid","-lz","-lssl","-lcrypto","-lresolv","-ldl");
  }
  if(result.runtimeBackends.tls)libs.push("-lssl","-lcrypto");
  if(result.runtimeBackends.curl)libs.push("-lcurl");
  mkdirSync(dirname(binary),{recursive:true});
  const p=spawnSync(cxx,[...args,...libs,...linkFlags,"-o",binary],{encoding:"utf8",maxBuffer:8*1024*1024,timeout:180000});
  if(p.error)throw p.error;if(p.status!==0)throw new Error(`C++ compile/link failed:\n${p.stdout}${p.stderr}`);
}
export async function main(argv:string[]):Promise<void> {
  let entry="",fromIr=false,output="",binary="",build=false,run=false,cxx=process.env.CXX??"g++";
  for(let n=0;n<argv.length;n++) {
    const a=argv[n];
    if(a==="--help"){console.log("etsc-ir-cpp <entry.ets | --from-ir project.json> [-o app.cpp] [--build] [--run] [--binary app] [--cxx g++]");return;}
    if(a==="--from-ir"){fromIr=true;continue;}
    if(["-o","--binary","--cxx"].includes(a)){const value=argv[++n];if(!value)throw new Error(`Missing value for ${a}`);if(a==="-o")output=value;else if(a==="--binary")binary=value;else cxx=value;continue;}
    if(a==="--build"){build=true;continue;}if(a==="--run"){run=build=true;continue;}
    if(a.startsWith("-")||entry)throw new Error(`Unexpected argument: ${a}`);entry=a;
  }
  if(!entry)throw new Error("Expected source entry or --from-ir project.json");
  const ir=fromIr?JSON.parse(readFileSync(resolve(entry),"utf8")):nativeIr(await buildIrFrontend(),entry);
  // Generate fully before touching the output; unsupported capabilities leave no partial C++.
  const result=generateCppFromIr(ir);
  output=resolve(output||"build/ir-app.cpp");mkdirSync(dirname(output),{recursive:true});writeFileSync(output,result.cpp);
  if(build){binary=resolve(binary||output.replace(/\.cpp$/,"")+".bin");buildIrCpp(result,output,binary,cxx);}
  if(run){const p=spawnSync(binary,[],{stdio:"inherit"});if(p.error)throw p.error;process.exitCode=p.status??1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
