// Build policy stays in ETS; the host only provides file/process primitives.
import {IrCppResult} from "../backend/cpp/generator";
import {contentHash} from "../modules/platform";
import {environment,exists,readText,writeText,hostError,launch,poll,pause,directories,copyFile,files,remove,temporaryDirectory,removeDirectory,objectKeys} from "./host";
import {progressDetail,progressTick,progressStart,progressFinish} from "../progress/progress";
function fail(message:string,status:number=1):void{progressFinish(false);printError(message);exitProcess(status);}
function read(path:string):string{const value=readText(path);if(hostError()!="")fail(hostError());return value;}
function write(path:string,value:string):void{if(!writeText(path,value))fail(hostError());}
function run(args:string[],output:string=""):void{progressDetail(args.join(" "));const pid=launch(args,output,"");if(pid<0)fail(hostError());let status=poll(pid);while(status<0){progressTick();pause(80);status=poll(pid);}if(status!=0)fail(args[0]+" terminó con "+numberToString(status),status);}
function parent(path:string):string{let end:number=-1;for(let k:number=0;k<path.length;k+=1)if(path.charAt(k)=="/")end=k;return end<0?".":path.slice(0,end);}
function compilerIdentity(cxx:string,directory:string):string{const path=directory+"/compiler.txt";run([cxx,"--version"],path);const version=read(path);run([cxx,"-dumpmachine"],path);const identity=contentHash(version+read(path));remove(path);return identity;}
function runtimeArchive(root:string,name:string,identity:string,flags:string[],directory:string):string{
 const manifest=root+"/build/runtime-cache/manifest.json";if(!exists(manifest))return "";
 // Unknown user flags can change the runtime ABI; compile its sources instead.
 for(const flag of flags)if(!["-std=c++20","-O2","-pthread","-fno-exceptions","-ffunction-sections","-fdata-sections"].includes(flag))return "";
 const record=JSON.parseValue(read(manifest));if(jsonAsString(jsonObjectGet(record,"compiler"))!=identity)return "";
 const archives=jsonObjectGet(record,"archives");const expected=jsonAsString(jsonObjectGet(archives,name));const path=root+"/build/runtime-cache/libets_"+name+".a";
 if(expected==""||!exists(path)||contentHash(read(path))!=expected)return "";
 const headers=jsonObjectGet(record,"sources");for(const file of objectKeys(headers))if(!exists(root+"/"+file)||contentHash(read(root+"/"+file))!=jsonAsString(jsonObjectGet(headers,file)))return "";
 if(directory!=""){const local=directory+"/libets_"+name+".a";if(!exists(local)||contentHash(read(local))!=expected)if(!copyFile(path,local))fail(hostError());return local;}return path;
}
export function compileNative(result:constRef<IrCppResult>,cpp:string,binary:string,root:string,cxx:string,flags:string[],links:string[],cache:string):void{
 if(!directories(parent(binary)))fail(hostError());progressStart("Preparando runtime");const work=temporaryDirectory(parent(binary));if(work=="")fail(hostError());
 const identity=compilerIdentity(cxx,work);let compile:string[]=[cxx,"-std=c++20","-O0","-pthread","-fno-exceptions","-I"+root];for(const flag of flags)compile.push(flag);
 let sources:string[]=[];let libraries:string[]=[];const runtime=cache!=""?parent(cache)+"/runtime":work+"/runtime";if(!directories(runtime))fail(hostError());
 if(result.runtimeBackends.libuv){const uv=root+"/build/libs/libuv";if(exists(uv+"/include/uv.h"))compile.push("-I"+uv+"/include");const archive=runtimeArchive(root,"libuv",identity,flags,runtime);if(archive!="")libraries.push(archive);else{sources.push(root+"/runtime/runtime_ets_libuv.cpp");sources.push(root+"/runtime/runtime_ets_net_libuv.cpp");}libraries.push(exists(uv+"/lib/libuv.a")?uv+"/lib/libuv.a":"-luv");libraries.push("-ldl");libraries.push("-lrt");}
 if(result.headers.includes("runtime/ets_http_httplib.hpp")){compile.push("-DCPPHTTPLIB_NO_EXCEPTIONS");const archive=runtimeArchive(root,"httplib",identity,flags,runtime);if(archive!="")libraries.push(archive);else sources.push(root+"/runtime/external/httplib/httplib.cc");}
 if(result.headers.includes("runtime/ets_http_drogon.hpp")){compile.push("-fexceptions");compile.push("-I/usr/include/jsoncpp");const drogon=root+"/build/libs/drogon";if(exists(drogon+"/include/drogon/drogon.h"))compile.push("-I"+drogon+"/include");if(exists(drogon+"/lib/libdrogon.a"))libraries.push("-L"+drogon+"/lib");for(const dependency of ["-ldrogon","-ltrantor","-ljsoncpp","-luuid","-lz","-lssl","-lcrypto","-lresolv","-ldl"])libraries.push(dependency);}
 if(result.runtimeBackends.tls){libraries.push("-lssl");libraries.push("-lcrypto");}if(result.runtimeBackends.curl)libraries.push("-lcurl");
 progressStart("Compilando y enlazando C++");let input=cpp;
 if(cache!=""){
  const objects=cache+"/objects";if(!directories(objects))fail(hostError());const preprocessed=work+"/input.ii";let preprocess=compile;preprocess.push("-E");preprocess.push(cpp);preprocess.push("-o");preprocess.push(preprocessed);run(preprocess);
  const key=contentHash(identity+compile.join("\n")+read(preprocessed));remove(preprocessed);input=objects+"/"+key+".o";
  if(!exists(input)||!exists(input+".sha256")||contentHash(read(input))!=read(input+".sha256")){let objectCommand=compile;objectCommand.push("-c");objectCommand.push(cpp);objectCommand.push("-o");objectCommand.push(work+"/object.o");run(objectCommand);if(!copyFile(work+"/object.o",input))fail(hostError());write(input+".sha256",contentHash(read(input)));}else progressDetail("Reutilizando objeto C++ verificado");
 }
 let command=compile;command.push(input);for(const source of sources)command.push(source);for(const library of libraries)command.push(library);for(const link of links)command.push(link);command.push("-o");command.push(binary);run(command);if(!exists(binary))fail("El compilador no creó "+binary);removeDirectory(work);
}
