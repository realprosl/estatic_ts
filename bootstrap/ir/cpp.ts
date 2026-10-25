#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Build/I/O adapter. Source analysis/lowering stay in the native ETS process.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildLoader, root } from "../modules/build.ts";
import { generateCppFromIr, type IrCppResult } from "../../src/codegen/ir/cpp-generator.ts";
import type { IrProject } from "../../src/codegen/ir/model.ts";

export function nativeIr(binary:string, entry:string):IrProject {
  const p=spawnSync(binary,[resolve(entry)],{encoding:"utf8",maxBuffer:64*1024*1024,timeout:120000});
  if(p.error)throw p.error;
  if(p.status!==0)throw new Error(`Native IR failed (${p.status}): ${p.stderr}\n${p.stdout.slice(-8000)}`);
  return JSON.parse(p.stdout);
}
export function buildIrCpp(result:IrCppResult,cpp:string,binary:string,cxx=process.env.CXX??"g++",flags:string[]=[]):void {
  const args=["-std=c++20","-O0","-pthread","-fno-exceptions",`-I${root}`,...flags,cpp];
  const local=join(root,"build/libs/libuv"), libs:string[]=[];
  if(result.runtimeBackends.libuv) {
    if(existsSync(join(local,"include/uv.h")))args.push(`-I${local}/include`);
    args.push(join(root,"runtime/runtime_ets_libuv.cpp"));
    if(result.headers.includes("runtime/ets_runtime_full.hpp"))args.push(join(root,"runtime/runtime_ets_net_libuv.cpp"));
    libs.push(existsSync(join(local,"lib/libuv.a"))?join(local,"lib/libuv.a"):"-luv");
    if(process.platform==="linux")libs.push("-ldl","-lrt");
  }
  if(result.runtimeBackends.tls)libs.push("-lssl","-lcrypto");
  if(result.runtimeBackends.curl)libs.push("-lcurl");
  mkdirSync(dirname(binary),{recursive:true});
  const p=spawnSync(cxx,[...args,...libs,"-o",binary],{encoding:"utf8",maxBuffer:8*1024*1024,timeout:180000});
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
  const ir=fromIr?JSON.parse(readFileSync(resolve(entry),"utf8")):nativeIr(await buildLoader(join(root,"build/bootstrap/ir-cpp"),"bootstrap/ir/demo.ets",true),entry);
  // Generate fully before touching the output; unsupported capabilities leave no partial C++.
  const result=generateCppFromIr(ir);
  output=resolve(output||"build/ir-app.cpp");mkdirSync(dirname(output),{recursive:true});writeFileSync(output,result.cpp);
  if(build){binary=resolve(binary||output.replace(/\.cpp$/,"")+".bin");buildIrCpp(result,output,binary,cxx);}
  if(run){const p=spawnSync(binary,[],{stdio:"inherit"});if(p.error)throw p.error;process.exitCode=p.status??1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
