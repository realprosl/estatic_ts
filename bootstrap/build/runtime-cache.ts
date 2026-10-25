import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { root } from "../root.ts";

export type RuntimeUnit = "libuv" | "httplib";
interface Manifest { dependencies: {path:string; hash:string}[]; archiveHash:string }
const sources:Record<RuntimeUnit,string[]> = {
  libuv: ["runtime/runtime_ets_libuv.cpp", "runtime/runtime_ets_net_libuv.cpp"],
  httplib: ["runtime/external/httplib/httplib.cc"],
};
const hash = (data:string|Buffer) => createHash("sha256").update(data).digest("hex");
const identities = new Map<string,string>();
function command(executable:string,args:string[]):string {
  const p=spawnSync(executable,args,{encoding:"utf8",maxBuffer:8*1024*1024,timeout:180000});
  if(p.error)throw p.error;
  if(p.status!==0)throw new Error(`${executable} falló (${p.status}):\n${p.stdout}${p.stderr}`);
  return p.stdout;
}
function identity(executable:string,version=true):string {
  const key=executable+":"+version;let value=identities.get(key);
  if(!value){
    const candidate=isAbsolute(executable)?executable:(process.env.PATH??"").split(":").map(p=>join(p,executable)).find(existsSync);
    value=JSON.stringify([candidate?realpathSync(candidate):executable,candidate?hash(readFileSync(realpathSync(candidate))):"",version?command(executable,["--version"]):"",process.platform,process.arch]);
    identities.set(key,value);
  }
  return value;
}
const portable = (path:string) => path.startsWith(root+"/")?"$ROOT/"+path.slice(root.length+1):path;
const materialize = (path:string) => path.startsWith("$ROOT/")?join(root,path.slice(6)):path;

// Runtime optimization is independent of program optimization. Keep every ABI,
// macro, instrumentation and include option; normalize only these known flags.
export function runtimeFlags(unit:RuntimeUnit,flags:string[]):string[] {
  let standard="-std=c++20",exceptions="-fno-exceptions";const other:string[]=[];
  for(const flag of flags){
    if(flag.startsWith("-std=")){standard=flag;continue;}
    if(["-fexceptions","-fno-exceptions"].includes(flag)){exceptions=flag;continue;}
    if(/^-O/.test(flag)||/^-g(?:$|[0-9]|gdb|dwarf|line|split)/.test(flag)||flag==="-pthread"||["-ffunction-sections","-fdata-sections"].includes(flag))continue;
    if(flag===`-I${root}`||flag===`-I${root}/build/libs/libuv/include`||flag==="-DCPPHTTPLIB_NO_EXCEPTIONS")continue;
    other.push(flag);
  }
  const result=[standard,"-O2","-pthread",exceptions,"-ffunction-sections","-fdata-sections",`-I${root}`,...other];
  if(unit==="libuv"){
    if(existsSync(join(root,"build/libs/libuv/include/uv.h")))result.push(`-I${root}/build/libs/libuv/include`);
  }else result.push("-DCPPHTTPLIB_NO_EXCEPTIONS");
  return result;
}

// Parse GCC/Clang make dependency output, including escaped spaces and continuations.
function dependencyPaths(text:string):string[] {
  const input=text.replace(/\\\r?\n/g,"").slice(text.indexOf(":")+1);let word="";const result:string[]=[];
  for(let at=0;at<input.length;at++){
    const c=input[at];if(c==="\\"&&at+1<input.length){word+=input[++at];continue;}
    if(/\s/.test(c)){if(word){result.push(resolve(word));word="";}}else word+=c;
  }
  if(word)result.push(resolve(word));return result;
}
function valid(directory:string,name:string):boolean {
  try{
    const manifest:Manifest=JSON.parse(readFileSync(join(directory,"manifest.json"),"utf8"));
    return manifest.archiveHash===hash(readFileSync(join(directory,name)))&&manifest.dependencies.length>0&&
      manifest.dependencies.every(d=>hash(readFileSync(materialize(d.path)))===d.hash);
  }catch{return false;}
}

export function runtimeArchive(unit:RuntimeUnit,cxx=process.env.CXX??"g++",flags:string[]=[]):string {
  const options=runtimeFlags(unit,flags),ar=process.env.AR??"ar";
  const key=hash(JSON.stringify(["ets-runtime-cache-1",unit,identity(cxx),identity(ar,false),options.map(flag=>flag.replaceAll(root,"$ROOT")),["CPATH","CPLUS_INCLUDE_PATH","C_INCLUDE_PATH","GCC_EXEC_PREFIX","COMPILER_PATH","SDKROOT"].map(name=>process.env[name]??""),flags.some(flag=>!flag.startsWith("-")||/^-(?:I|iquote|isystem|include|imacros)/.test(flag)&&!isAbsolute(flag.replace(/^-(?:I|iquote|isystem|include|imacros)/,"")))?process.cwd():"",sources[unit].map(p=>hash(readFileSync(join(root,p))))]));
  const name=`libets_${unit}.a`,installed=existsSync(join(root,"installation.json"));
  const prebuilt=join(root,"build/runtime-cache",key);
  const userCache=resolve(process.env.ESTATIC_RUNTIME_CACHE??join(process.env.XDG_CACHE_HOME??join(homedir(),".cache"),"nativo/runtime"));
  const writable=join(installed?userCache:resolve(process.env.ESTATIC_RUNTIME_CACHE??join(root,"build/runtime-cache")),key);
  for(const directory of [...new Set([prebuilt,writable])])if(valid(directory,name))return join(directory,name);
  const temporary=writable+".tmp-"+randomUUID();mkdirSync(temporary,{recursive:true});
  try{
    const dependencies=new Set<string>(),objects:string[]=[];
    for(let at=0;at<sources[unit].length;at++){
      const object=join(temporary,`${at}.o`),deps=join(temporary,`${at}.d`);
      command(cxx,[...options,"-MD","-MF",deps,"-c",join(root,sources[unit][at]),"-o",object]);objects.push(object);
      for(const path of dependencyPaths(readFileSync(deps,"utf8")))dependencies.add(path);
    }
    command(ar,["rcs",join(temporary,name),...objects]);
    const manifest:Manifest={dependencies:[...dependencies].sort().map(path=>({path:portable(path),hash:hash(readFileSync(path))})),archiveHash:hash(readFileSync(join(temporary,name)))};
    writeFileSync(join(temporary,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
    for(let at=0;at<objects.length;at++){rmSync(objects[at]);rmSync(join(temporary,`${at}.d`));}
    mkdirSync(writable,{recursive:true});
    // Publish the archive before the manifest. Concurrent readers either see a
    // complete hit or conservatively rebuild; no build links a partial archive.
    renameSync(join(temporary,name),join(writable,name));renameSync(join(temporary,"manifest.json"),join(writable,"manifest.json"));
    return join(writable,name);
  }finally{rmSync(temporary,{recursive:true,force:true});}
}

export function precompileRuntime(cxx=process.env.CXX??"g++"):string[] {
  return (["libuv","httplib"] as const).map(unit=>runtimeArchive(unit,cxx));
}
