import {configureAnalysisJobs,configureAnalysisProfile} from "../analysis/options";
import {ModuleLoader,LoaderOptions,PathAlias} from "../modules/loader";
import {analyzeProject} from "../checker/expansion";
import {lowerProject} from "../ir/lower";
import {IrProject,IrIssue,IrSource} from "../ir/model";
import {formatIr} from "../ir/format";
import {generateCppFromIr,IrCppResult} from "../backend/cpp/generator";
import {parseIrProject} from "../backend/cpp/decode";
import {formatCppResult} from "../backend/cpp/wire";
import {parseConfig,configStrings} from "./config";
import {environment,exists,readText,stdinText,writeText,hostError,launch,poll,pause,files,compilerHome,objectKeys,directories,remove,rename,now,executable} from "./host";
import {contentHash,fileMetadata} from "../modules/platform";
import {configureProgress,progressInteractive,progressStart,progressDetail,progressTick,progressFinish,progressSummary} from "../progress/progress";
function driverError(message:string,status:number=1):void{progressFinish(false);printError(message);exitProcess(status);}
function checkedWrite(path:string,text:string):void{if(!writeText(path,text))driverError(hostError());}
function checkedRead(path:string):string{const text=readText(path);if(hostError()!="")driverError(hostError());return text;}
function pathAt(base:string,path:string):string{return normalizePath(path.startsWith("/")?path:base+"/"+path);}
function parent(path:string):string{let end:number=-1;for(let k:number=0;k<path.length;k=k+1)if(path.charAt(k)=="/")end=k;return end<0?".":path.slice(0,end);}
function stem(path:string):string{let start:number=0;let end:number=path.length;for(let k:number=0;k<path.length;k=k+1){if(path.charAt(k)=="/"){start=k+1;end=path.length;}else if(path.charAt(k)==".")end=k;}return path.slice(start,end);}
function execute(command:string[],output:string="",errors:string=""):number{progressDetail(command.join(" "));const pid=launch(command,output,errors);if(pid<0)driverError(hostError());let status=poll(pid);while(status<0){progressTick();pause(80);status=poll(pid);}return status;}
function help():string{return "Uso: etsc build|run [entrada.ets] [opciones]\n  --check                  Verificar sin generar\n  -o archivo.cpp           Ruta C++\n  --binary archivo         Ruta ejecutable (con build)\n  --from-ir archivo        Generar desde ets-ir-2 verificado\n  --emit-ir archivo        Guardar IR\n  --config archivo         JSON u objeto declarativo\n  --root ruta | --alias nombre ruta | --cache ruta\n  --cxx compilador | --cxx-flag flag | --link-flag flag\n  --jobs N                 Procesos de análisis (1..32; por defecto 1)\n  --profile-analysis       Tiempos, CPU y RSS por fase en stderr\n  --verbose | --no-progress\n  init [directorio] [--no-src] | update-types [directorio]\n  --no-src                 (init) no crear src/: para una carpeta que ya tiene código\n  --help | --version\n";}
// Ficheros fuente del último análisis: alimentan la huella de entradas (fase 3).
let analyzedFiles:string[]=[];
function sourceIr(entry:string,options:LoaderOptions,verbose:boolean):IrProject{
 let loader=new ModuleLoader(options);const graph=loader.load(entry);for(const file of graph.modules)analyzedFiles.push(file.file);const project=analyzeProject(graph,verbose||progressInteractive());
 let diagnostics=project.graph.diagnostics;for(const d of project.binding.diagnostics)diagnostics.push(d);for(const d of project.checked.diagnostics)diagnostics.push(d);
 let ir=new IrProject();if(diagnostics.length==0){progressDetail("Generando IR verificado");ir=lowerProject(project.graph,project.binding,project.checked,verbose||progressInteractive());}
 let seen:string[]=[];for(const d of diagnostics){const key=d.file+":"+numberToString(d.token.offset)+":"+d.code+":"+d.message;if(!seen.includes(key)){seen.push(key);ir.diagnostics.push(new IrIssue(d.code,d.message,new IrSource("","",d.file,-1,d.token.offset,d.endToken.endOffset)));}}
 if(!ir.success||ir.diagnostics.length>0){progressFinish(false);for(const d of ir.diagnostics)printError(d.source.file+":"+numberToString(d.source.start)+": "+d.code+": "+d.message);driverError("No se produjo IR verificado");}return ir;
}
function initialize(root:string,directory:string,update:boolean,sources:boolean=true):void{
 const target=directory+"/types/estatic.d.ts";const types=checkedRead(root+"/types/estatic.d.ts");if(update){if(exists(target)){const previous=checkedRead(target);if(previous==types)return;if(exists(target+".bak"))driverError("Ya existe "+target+".bak");checkedWrite(target+".bak",previous);}checkedWrite(target,types);return;}
 let templates=root+"/templates";if(!exists(templates))templates=root+"/native-cpp/templates";if(!exists(templates))driverError("Faltan las plantillas de instalación");// --no-src: el proyecto ya tiene su codigo; no se crea ni se comprueba src/.
 let paths:string[]=[];for(const path of files(templates))if(sources||!path.startsWith("src/"))paths.push(path);if(exists(target))driverError("No se sobrescribe "+target);for(const path of paths)if(exists(directory+"/"+path))driverError("No se sobrescribe "+directory+"/"+path);for(const path of paths)if(path!="types/estatic.d.ts")checkedWrite(directory+"/"+path,checkedRead(templates+"/"+path));checkedWrite(target,types);
}
// --- Huella de entradas (#149, fase 3) ---------------------------------------
// Si nada de lo que determina el binario ha cambiado (fuentes, configuración,
// argumentos, etsc, runtime y compilador C++), build no analiza ni compila.
function buildKey(args:string[],configText:string,root:string,cxx:string,scratch:string):string{
 let text="etsc "+executable()+" "+fileMetadata(executable())+"\nroot "+root+" "+runtimeIdentity(root)+"\ncxx "+compilerIdentity(cxx,scratch)+"\nCXX "+environment("CXX")+"\nconfig "+configText+"\n";
 for(const arg of args)text=text+"arg "+arg+"\n";return contentHash(text);
}
function fingerprintText(key:string,inputs:string[],outputs:string[]):string{
 let text=key+"\n";for(const file of inputs)text=text+"in\t"+file+"\t"+fileMetadata(file)+"\n";for(const file of outputs)text=text+"out\t"+file+"\t"+fileMetadata(file)+"\n";return text;
}
// Vigente si la clave coincide y cada fichero sigue con la misma metadata.
function fingerprintCurrent(path:string,key:string):boolean{
 if(!exists(path))return false;const lines=readText(path).split("\n");if(lines.length<2||lines[0]!=key)return false;let outputs=0;
 for(let k:number=1;k<lines.length;k=k+1){if(lines[k]=="")continue;const fields=lines[k].split("\t");if(fields.length!=3)return false;if(!exists(fields[1])||fileMetadata(fields[1])!=fields[2])return false;if(fields[0]=="out")outputs=outputs+1;}
 return outputs>0;
}
// --- Compilación C++ con caché de objetos del runtime (#149, fase 1) -------
// Los .cpp del runtime (libuv, red, httplib, regex) no cambian entre
// compilaciones: cada uno se compila a un .o guardado en la caché de usuario
// con una huella de todo lo que lo determina (compilador, flags, fuente y
// ficheros del runtime). El programa se compila a su propio .o y se enlaza.
class CppPlan{flags:string[];sources:string[];libraries:string[];constructor(){this.flags=[];this.sources=[];this.libraries=[];}}
function cppPlan(result:constRef<IrCppResult>,root:string,cxx:string,flags:string[]):CppPlan{
 let plan=new CppPlan();const base:string[]=[cxx,"-std=c++20","-O0","-pthread","-fno-exceptions","-I"+root];for(const flag of base)plan.flags.push(flag);for(const flag of flags)plan.flags.push(flag);
 if(result.runtimeBackends.libuv){const uv=root+"/build/libs/libuv";if(exists(uv+"/include/uv.h"))plan.flags.push("-I"+uv+"/include");plan.sources.push(root+"/runtime/runtime_ets_libuv.cpp");plan.sources.push(root+"/runtime/runtime_ets_net_libuv.cpp");plan.libraries.push(exists(uv+"/lib/libuv.a")?uv+"/lib/libuv.a":"-luv");plan.libraries.push("-ldl");plan.libraries.push("-lrt");}
 if(result.headers.includes("runtime/ets_http_httplib.hpp")){plan.flags.push("-DCPPHTTPLIB_NO_EXCEPTIONS");plan.sources.push(root+"/runtime/external/httplib/httplib.cc");}
 if(result.headers.includes("runtime/ets_regex.hpp")){plan.sources.push(root+"/runtime/ets_regex_compile.cpp");plan.flags.push("-fexceptions");}
 if(result.headers.includes("runtime/ets_http_drogon.hpp")){plan.flags.push("-fexceptions");plan.flags.push("-I/usr/include/jsoncpp");const drogon=root+"/build/libs/drogon";if(exists(drogon+"/include/drogon/drogon.h"))plan.flags.push("-I"+drogon+"/include");if(exists(drogon+"/lib/libdrogon.a"))plan.libraries.push("-L"+drogon+"/lib");const dependencies:string[]=["-ldrogon","-ltrantor","-ljsoncpp","-luuid","-lz","-lssl","-lcrypto","-lresolv","-ldl"];for(const dependency of dependencies)plan.libraries.push(dependency);}
 if(result.runtimeBackends.tls){plan.libraries.push("-lssl");plan.libraries.push("-lcrypto");}if(result.runtimeBackends.curl)plan.libraries.push("-lcurl");
 return plan;
}
// Directorio de la caché de objetos del runtime: ESTC_OBJECT_CACHE, o
// $XDG_CACHE_HOME/estc/objects, o ~/.cache/estc/objects. Vacío = sin caché.
function runtimeObjectCache():string{
 let directory=environment("ESTC_OBJECT_CACHE");if(directory=="off")return "";
 if(directory==""){const xdg=environment("XDG_CACHE_HOME");const home=environment("HOME");if(xdg!="")directory=xdg+"/estc/objects";else if(home!="")directory=home+"/.cache/estc/objects";}
 if(directory==""||!directories(directory))return "";return directory;
}
// Identidad del compilador C++: su salida de --version (cambia al actualizarlo).
function compilerIdentity(cxx:string,scratch:string):string{
 const file=scratch+".cxx-version";const pid=launch([cxx,"--version"],file,"/dev/null");if(pid<0)return cxx;let status=poll(pid);while(status<0){pause(5);status=poll(pid);}
 const text=readText(file);remove(file);return cxx+"\n"+text;
}
// Huella de los ficheros del runtime instalado: ruta, tamaño y fecha de cada
// fuente o cabecera. La instalación es inmutable; en un checkout de desarrollo
// cualquier edición cambia la fecha y con ella la huella.
function runtimeIdentity(root:string):string{
 let text="";for(const path of files(root+"/runtime")){if(path.endsWith(".hpp")||path.endsWith(".h")||path.endsWith(".cpp")||path.endsWith(".cc")||path.endsWith(".c"))text=text+path+" "+fileMetadata(root+"/runtime/"+path)+"\n";}
 return contentHash(text);
}
// Lanza todos los comandos a la vez y espera a que acaben. Devuelve el primer
// estado distinto de cero (o 0).
function executeAll(commands:string[][]):number{
 let pids:number[]=[];for(const command of commands){progressDetail(command.join(" "));const pid=launch(command);if(pid<0)driverError(hostError());pids.push(pid);}
 let statuses:number[]=[];for(const pid of pids)statuses.push(-1);let pending=pids.length;
 while(pending>0){pending=0;for(let k:number=0;k<pids.length;k=k+1){if(statuses[k]<0){statuses[k]=poll(pids[k]);if(statuses[k]<0)pending=pending+1;}}if(pending>0){progressTick();pause(40);}}
 for(const status of statuses)if(status!=0)return status;return 0;
}
function linkCommand(plan:constRef<CppPlan>,objects:string[],links:string[],binary:string):string[]{
 let command:string[]=[];for(const flag of plan.flags)command.push(flag);for(const object of objects)command.push(object);for(const library of plan.libraries)command.push(library);for(const link of links)command.push(link);command.push("-o");command.push(binary);return command;
}
function compileCpp(result:constRef<IrCppResult>,cpp:string,binary:string,root:string,cxx:string,flags:string[],links:string[],cacheObjects:boolean):void{
 if(!directories(parent(binary)))driverError(hostError());progressStart("Preparando runtime");const plan=cppPlan(result,root,cxx,flags);
 const cache=cacheObjects&&plan.sources.length>0?runtimeObjectCache():"";
 if(cache==""){
  // Sin caché: una sola llamada, como siempre.
  let sources:string[]=[cpp];for(const source of plan.sources)sources.push(source);
  progressStart("Compilando y enlazando C++");const status=executeAll([linkCommand(plan,sources,links,binary)]);
  if(status!=0)driverError(cxx+" terminó con "+numberToString(status),status);if(!exists(binary))driverError("El compilador no creó "+binary);return;
 }
 const identity=contentHash(compilerIdentity(cxx,binary)+"\n"+plan.flags.join("\n")+"\n"+runtimeIdentity(root));
 let objects:string[]=[];let fresh:string[]=[];let temporary:string[]=[];let commands:string[][]=[];
 const programObject=binary+".o";let program:string[]=[];for(const flag of plan.flags)program.push(flag);program.push("-c");program.push(cpp);program.push("-o");program.push(programObject);commands.push(program);objects.push(programObject);
 for(const source of plan.sources){
  const object=cache+"/"+contentHash(identity+"\n"+source+"\n"+fileMetadata(source))+".o";objects.push(object);
  if(exists(object))continue;
  const partial=object+"."+numberToString(now())+".tmp";let command:string[]=[];for(const flag of plan.flags)command.push(flag);command.push("-c");command.push(source);command.push("-o");command.push(partial);commands.push(command);fresh.push(object);temporary.push(partial);
 }
 progressStart(fresh.length>0?"Compilando C++ y runtime":"Compilando C++ (runtime en caché)");
 let status=executeAll(commands);
 for(let k:number=0;k<temporary.length;k=k+1){if(status==0&&exists(temporary[k]))rename(temporary[k],fresh[k]);else remove(temporary[k]);}
 if(status!=0)driverError(cxx+" terminó con "+numberToString(status),status);
 progressStart("Enlazando");
 status=executeAll([linkCommand(plan,objects,links,binary)]);
 if(status!=0&&fresh.length<plan.sources.length){
  // Un objeto de la caché puede estar dañado: se descartan los reutilizados,
  // se recompilan y se vuelve a enlazar una vez.
  progressStart("Recompilando el runtime en caché");let retry:string[][]=[];
  for(let k:number=0;k<plan.sources.length;k=k+1){const object=objects[k+1];if(fresh.includes(object))continue;remove(object);const partial=object+"."+numberToString(now())+".tmp";let command:string[]=[];for(const flag of plan.flags)command.push(flag);command.push("-c");command.push(plan.sources[k]);command.push("-o");command.push(partial);retry.push(command);fresh.push(object);temporary.push(partial);}
  status=executeAll(retry);for(let k:number=0;k<temporary.length;k=k+1){if(status==0&&exists(temporary[k]))rename(temporary[k],fresh[k]);else remove(temporary[k]);}
  if(status==0)status=executeAll([linkCommand(plan,objects,links,binary)]);
 }
 remove(programObject);
 if(status!=0)driverError(cxx+" terminó con "+numberToString(status),status);if(!exists(binary))driverError("El compilador no creó "+binary);
}
function main():void{
 let args:string[]=[];for(let k:number=1;k<argumentCount();k=k+1)args.push(argument(k));
 if(args.length==1&&args[0]=="--codegen-json"){const wireProject=parseIrProject(stdinText());const wireResult=generateCppFromIr(wireProject);print(formatCppResult(wireResult));return;}
 if(args.length==1&&["--help","-h","-H"].includes(args[0])){print(help());return;}
 if(args.length==1&&["--version","-version","-v","-V","/V"].includes(args[0])){print("etsc bootstrap ETS (ets-ir-2)");return;}
 let root=environment("ESTC_ROOT");if(root=="")root=compilerHome();root=normalizePath(root);
 if(args.length>0&&(args[0]=="init"||args[0]=="update-types")){
  let directory=".";let sources=true;let positional=0;
  for(let k:number=1;k<args.length;k=k+1){if(args[k]=="--no-src"&&args[0]=="init")sources=false;else if(args[k].startsWith("-")||positional>0)driverError(help(),2);else{directory=args[k];positional=positional+1;}}
  configureProgress(false,true);progressStart(args[0]=="init"?"Creando proyecto":"Actualizando tipos");initialize(root,directory,args[0]=="update-types",sources);progressSummary();return;}
 let build:boolean=false;let run:boolean=false;let check:boolean=false;let verbose:boolean=false;let animate:boolean=true;let entry:string="";let output:string="";let binary:string="";let fromIr:string="";let emitIr:string="";let configPath:string="";let cxx:string="";let options=new LoaderOptions();let flags:string[]=[];let links:string[]=[];let programArgs:string[]=[];
 let at:number=0;if(args.length>0&&(args[0]=="build"||args[0]=="run")){build=true;run=args[0]=="run";at=1;}
 for(;at<args.length;at=at+1){const arg=args[at];if(arg=="--"){for(let k:number=at+1;k<args.length;k=k+1)programArgs.push(args[k]);break;}if(arg=="--profile-analysis"){if(!configureAnalysisProfile())driverError(hostError());continue;}if(arg=="--jobs"){at=at+1;if(at>=args.length||!configureAnalysisJobs(args[at]))driverError("--jobs requiere un entero entre 1 y 32",2);continue;}if(arg=="--verbose"){verbose=true;continue;}if(arg=="--no-progress"){animate=false;continue;}if(arg=="--build"){build=true;continue;}if(arg=="--run"){run=true;build=true;continue;}if(arg=="--check"){check=true;continue;}
 if(["-o","--binary","--from-ir","--emit-ir","--config","--cxx","--root","--cache","--alias","--cxx-flag","--link-flag"].includes(arg)){at+=1;if(at>=args.length)driverError("Falta un valor para "+arg,2);const value=args[at];if(value.startsWith("-")&&arg!="--cxx-flag"&&arg!="--link-flag")driverError("Falta un valor para "+arg,2);if(arg=="-o")output=value;else if(arg=="--binary")binary=value;else if(arg=="--from-ir")fromIr=value;else if(arg=="--emit-ir")emitIr=value;else if(arg=="--config")configPath=value;else if(arg=="--cxx")cxx=value;else if(arg=="--cache")options.cacheDirectory=value;else if(arg=="--root")options.roots.push(normalizePath(value));else if(arg=="--cxx-flag")flags.push(value);else if(arg=="--link-flag")links.push(value);else if(arg=="--alias"){at+=1;if(at>=args.length)driverError("Falta la ruta del alias",2);options.aliases.push(new PathAlias(value,args[at]));}continue;}
 if(arg.startsWith("-")||entry!="")driverError("Argumento inesperado: "+arg,2);entry=arg;}
 if(entry!=""&&fromIr!="")driverError("Usa una fuente o --from-ir",2);if(check&&(build||run||output!=""||binary!=""))driverError("--check no admite generación o ejecución",2);if(programArgs.length>0&&!run)driverError("Los argumentos del programa requieren run",2);
 configureProgress(verbose,animate);progressStart("Cargando configuración");if(configPath==""&&entry==""&&fromIr==""){if(exists("estatic.config.json"))configPath="estatic.config.json";else if(exists("estatic.config.ts"))configPath="estatic.config.ts";}
 let config:JsonValue=JSON.parseValue("{}");let configText="";let base:string=".";if(configPath!=""){configText=checkedRead(configPath);config=parseConfig(configText);base=parent(configPath);}const configuredEntry=jsonAsString(jsonObjectGet(config,"entry"));if(entry==""&&fromIr==""&&configuredEntry!="")entry=pathAt(base,configuredEntry);if(entry==""&&fromIr=="")driverError(help(),2);
 const incremental=jsonObjectGet(config,"incremental");const cache=jsonAsString(jsonObjectGet(incremental,"cacheDirectory"));if(options.cacheDirectory==""&&cache!="")options.cacheDirectory=pathAt(base,cache);
 for(const path of configStrings(jsonObjectGet(config,"moduleRoots")))options.roots.push(pathAt(base,path));const aliases=jsonObjectGet(config,"aliases");for(const name of objectKeys(aliases))options.aliases.push(new PathAlias(name,pathAt(base,jsonAsString(jsonObjectGet(aliases,name)))));
 // Fase 3 de #149: con una huella vigente no se analiza ni se compila.
 const compilerConfig=jsonObjectGet(config,"compiler");const outputConfig=jsonObjectGet(config,"output");
 const willCompile=build||jsonAsBool(jsonObjectGet(compilerConfig,"enabled"));
 const incrementalEnabled=!jsonIsBool(jsonObjectGet(incremental,"enabled"))||jsonAsBool(jsonObjectGet(incremental,"enabled"));
 let fingerprintPath="";let fingerprintKey="";
 if(willCompile&&fromIr==""&&emitIr==""&&!check&&incrementalEnabled&&options.cacheDirectory!=""){
  if(output==""){const configured=jsonAsString(jsonObjectGet(outputConfig,"cpp"));output=(configured!=""?pathAt(base,configured):"build/"+stem(entry)+".cpp");}
  if(binary==""){const configured=jsonAsString(jsonObjectGet(outputConfig,"binary"));binary=(configured!=""?pathAt(base,configured):output+".bin");}
  if(cxx=="")cxx=jsonAsString(jsonObjectGet(compilerConfig,"command"));if(cxx=="")cxx=environment("CXX");if(cxx=="")cxx="g++";
  let keyArgs:string[]=["entry "+entry,"output "+output,"binary "+binary];for(const flag of flags)keyArgs.push("cxx-flag "+flag);for(const link of links)keyArgs.push("link-flag "+link);for(const moduleRoot of options.roots)keyArgs.push("root "+moduleRoot);for(const alias of options.aliases)keyArgs.push("alias "+alias.name+" "+alias.target);
  if(directories(options.cacheDirectory)){fingerprintPath=options.cacheDirectory+"/build-fingerprint";fingerprintKey=buildKey(keyArgs,configText,root,cxx,options.cacheDirectory+"/build-fingerprint");}
  if(fingerprintPath!=""&&fingerprintCurrent(fingerprintPath,fingerprintKey)){
   progressStart("Sin cambios: se reutiliza el binario");progressSummary(output,binary);
   if(run){let command:string[]=[normalizePath(binary)];for(const arg of programArgs)command.push(arg);exitProcess(execute(command));}
   return;
  }
 }
 if(fingerprintPath!=""&&exists(fingerprintPath))remove(fingerprintPath);
 options.verbose=verbose||progressInteractive();progressStart(fromIr==""?"Analizando fuentes y verificando IR":"Leyendo IR");const ir:IrProject=fromIr==""?sourceIr(entry,options,verbose):parseIrProject(checkedRead(fromIr));if(emitIr!="")checkedWrite(emitIr,formatIr(ir)+"\n");if(check){progressSummary();return;}
 progressStart("Generando C++ desde IR verificado");const generated=generateCppFromIr(ir);const outConfig=jsonObjectGet(config,"output");const compiler=jsonObjectGet(config,"compiler");if(output==""){const configured=jsonAsString(jsonObjectGet(outConfig,"cpp"));output=(configured!=""?pathAt(base,configured):"build/"+stem(fromIr==""?entry:fromIr)+".cpp");}progressStart("Guardando resultados");checkedWrite(output,generated.cpp);
 if(build||jsonAsBool(jsonObjectGet(compiler,"enabled"))){if(binary==""){const configured=jsonAsString(jsonObjectGet(outConfig,"binary"));binary=(configured!=""?pathAt(base,configured):output+".bin");}if(cxx=="")cxx=jsonAsString(jsonObjectGet(compiler,"command"));if(cxx=="")cxx=environment("CXX");if(cxx=="")cxx="g++";let compileFlags=configStrings(jsonObjectGet(compiler,"flags"));for(const flag of flags)compileFlags.push(flag);let linkFlags=configStrings(jsonObjectGet(compiler,"linkFlags"));for(const flag of links)linkFlags.push(flag);for(const library of configStrings(jsonObjectGet(config,"linkLibraries")))linkFlags.push("-l"+library);compileCpp(generated,output,binary,root,cxx,compileFlags,linkFlags,!jsonIsBool(jsonObjectGet(incremental,"enabled"))||jsonAsBool(jsonObjectGet(incremental,"enabled")));if(fingerprintPath!=""){let inputs:string[]=[];for(const file of analyzedFiles)inputs.push(file);if(configPath!="")inputs.push(configPath);checkedWrite(fingerprintPath,fingerprintText(fingerprintKey,inputs,[output,binary]));}}
 progressSummary(output,(build||jsonAsBool(jsonObjectGet(compiler,"enabled")))?binary:"");if(run){let command:string[]=[normalizePath(binary)];for(const arg of programArgs)command.push(arg);exitProcess(execute(command));}
}
main();
