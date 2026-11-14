import {configureAnalysisJobs,configureAnalysisProfile} from "../analysis/index";
import {ModuleLoader,LoaderOptions,PathAlias} from "../modules/index";
import {analyzeProject,formatModuleInterface} from "../checker/index";
import { lowerProject, IrProject, IrIssue, IrSource, formatIr } from "../ir/index";
import { generateCppFromIr, IrCppResult, parseIrProject, formatCppResult } from "../backend/cpp/index";
import {parseConfig,configStrings} from "./config";
import { canonicalFile, processors, environment, exists, readText, stdinText, writeText, hostError, launch, poll, pause, files, compilerHome, objectKeys, directories, remove, rename, now, executable, contentHash, fileMetadata, configureProgress, progressInteractive, progressStart, progressDetail, progressTick, progressFinish, progressSummary } from "../platform/index";
import {renderDiagnostic,renderSummary,setDiagnosticCatalog,explainCode} from "./diagnostics";
function driverError(message:string,status:number=1):void{progressFinish(false);printError(message);exitProcess(status);}
function checkedWrite(path:string,text:string):void{if(!writeText(path,text))driverError(hostError());}
function checkedRead(path:string):string{const text=readText(path);if(hostError()!="")driverError(hostError());return text;}
function pathAt(base:string,path:string):string{return normalizePath(path.startsWith("/")?path:base+"/"+path);}
function parent(path:string):string{let end:number=-1;for(let k:number=0;k<path.length;k=k+1)if(path.charAt(k)=="/")end=k;return end<0?".":path.slice(0,end);}
function stem(path:string):string{let start:number=0;let end:number=path.length;for(let k:number=0;k<path.length;k=k+1){if(path.charAt(k)=="/"){start=k+1;end=path.length;}else if(path.charAt(k)==".")end=k;}return path.slice(start,end);}
function execute(command:string[],output:string="",errors:string=""):number{progressDetail(command.join(" "));const pid=launch(command,output,errors);if(pid<0)driverError(hostError());let status=poll(pid);while(status<0){progressTick();pause(80);status=poll(pid);}return status;}
function help():string{return "Uso: etsc build|run [entrada.ets] [opciones]\n  --check                  Verificar sin generar\n  --emit-interface         Imprimir la interfaz pública del módulo y su interfaceHash (JSON)\n  --unity                  Compilar el programa como un único .cpp (sin unidades por módulo)\n  -o archivo.cpp           Ruta C++\n  --binary archivo         Ruta ejecutable (con build)\n  --from-ir archivo        Generar desde ets-ir-2 verificado\n  --emit-ir archivo        Guardar IR\n  --config archivo         JSON u objeto declarativo\n  --root ruta | --alias nombre ruta | --cache ruta\n  --cxx compilador | --cxx-flag flag | --link-flag flag\n  --jobs N                 Procesos de análisis (1..32; por defecto 1)\n  --profile-analysis       Tiempos, CPU y RSS por fase en stderr\n  --verbose | --no-progress\n  init [directorio] [--no-src] | update-types [directorio]\n  --no-src                 (init) no crear src/: para una carpeta que ya tiene código\n  --explain CÓDIGO     Explicar un código de error (ej. E3003). ESTC_LANG=en: mensajes en inglés\n  --help | --version\n";}
// Ficheros fuente del último análisis: alimentan la huella de entradas (fase 3).
let analyzedFiles:string[]=[];
// --emit-interface (#177): analiza el módulo como entrada e imprime su interfaz
// pública (firmas, efectos inferidos y si hace falta el cuerpo) con interfaceHash.
function emitModuleInterface(entry:string,options:LoaderOptions):void{
 let loader=new ModuleLoader(options);const graph=loader.load(entry);const project=analyzeProject(graph,false);
 let diagnostics=project.graph.diagnostics;for(const d of project.binding.diagnostics)diagnostics.push(d);for(const d of project.checked.diagnostics)diagnostics.push(d);
 if(diagnostics.length>0){progressFinish(false);for(const d of diagnostics){printError(renderDiagnostic(d.code,d.message,d.file,d.token.offset,d.endToken.endOffset));printError("");}driverError(renderSummary(diagnostics.length));}
 const file=canonicalFile(entry);for(const record of project.checked.moduleRecords)if(record.file==file||canonicalFile(record.file)==file){print(formatModuleInterface(record));return;}
 driverError("No se encontró la interfaz de "+entry);
}
function sourceIr(entry:string,options:LoaderOptions,verbose:boolean):IrProject{
 let loader=new ModuleLoader(options);const graph=loader.load(entry);for(const file of graph.modules)analyzedFiles.push(file.file);const project=analyzeProject(graph,verbose||progressInteractive());
 let diagnostics=project.graph.diagnostics;for(const d of project.binding.diagnostics)diagnostics.push(d);for(const d of project.checked.diagnostics)diagnostics.push(d);
 let ir=new IrProject();if(diagnostics.length==0){progressDetail("Generando IR verificado");ir=lowerProject(project.graph,project.binding,project.checked,verbose||progressInteractive());}
 let seen:string[]=[];for(const d of diagnostics){const key=d.file+":"+numberToString(d.token.offset)+":"+d.code+":"+d.message;if(!seen.includes(key)){seen.push(key);ir.diagnostics.push(new IrIssue(d.code,d.message,new IrSource("","",d.file,-1,d.token.offset,d.endToken.endOffset)));}}
 if(!ir.success||ir.diagnostics.length>0){progressFinish(false);for(const d of ir.diagnostics){printError(renderDiagnostic(d.code,d.message,d.source.file,d.source.start,d.source.end));printError("");}driverError(renderSummary(ir.diagnostics.length));}return ir;
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
// flags: comunes a todo (base, del proyecto e -I). programFlags: los que solo
// necesita el programa por las cabeceras que incluye. sourceFlags[k]: los que
// necesita cada fuente del runtime. Así un objeto del runtime no depende de qué
// otras APIs use el programa y se comparte entre proyectos.
class CppPlan{flags:string[];programFlags:string[];sources:string[];sourceFlags:string[][];libraries:string[];pchHeader:string;programUnits:number;constructor(){this.flags=[];this.programFlags=[];this.sources=[];this.sourceFlags=[];this.libraries=[];this.pchHeader="";this.programUnits=1;}}
function cppPlan(result:constRef<IrCppResult>,root:string,cxx:string,flags:string[]):CppPlan{
 let plan=new CppPlan();const base:string[]=[cxx,"-std=c++20","-O0","-pthread","-fno-exceptions","-I"+root];for(const flag of base)plan.flags.push(flag);for(const flag of flags)plan.flags.push(flag);
 if(result.runtimeBackends.libuv){const uv=root+"/build/libs/libuv";const none:string[]=[];if(exists(uv+"/include/uv.h"))plan.flags.push("-I"+uv+"/include");plan.sources.push(root+"/runtime/runtime_ets_libuv.cpp");plan.sourceFlags.push(none);plan.sources.push(root+"/runtime/runtime_ets_net_libuv.cpp");plan.sourceFlags.push(none);plan.libraries.push(exists(uv+"/lib/libuv.a")?uv+"/lib/libuv.a":"-luv");plan.libraries.push("-ldl");plan.libraries.push("-lrt");}
 if(result.headers.includes("runtime/ets_http_httplib.hpp")){plan.programFlags.push("-DCPPHTTPLIB_NO_EXCEPTIONS");plan.sources.push(root+"/runtime/external/httplib/httplib.cc");plan.sourceFlags.push(["-DCPPHTTPLIB_NO_EXCEPTIONS"]);}
 if(result.headers.includes("runtime/ets_regex.hpp")){plan.sources.push(root+"/runtime/ets_regex_compile.cpp");plan.sourceFlags.push(["-fexceptions"]);plan.programFlags.push("-fexceptions");}
 if(result.headers.includes("runtime/ets_http_drogon.hpp")){plan.programFlags.push("-fexceptions");plan.flags.push("-I/usr/include/jsoncpp");const drogon=root+"/build/libs/drogon";if(exists(drogon+"/include/drogon/drogon.h"))plan.flags.push("-I"+drogon+"/include");if(exists(drogon+"/lib/libdrogon.a"))plan.libraries.push("-L"+drogon+"/lib");const dependencies:string[]=["-ldrogon","-ltrantor","-ljsoncpp","-luuid","-lz","-lssl","-lcrypto","-lresolv","-ldl"];for(const dependency of dependencies)plan.libraries.push(dependency);}
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
// Ejecuta los comandos en paralelo, con como mucho `compileJobs()` a la vez
// (#178: con una unidad por módulo puede haber decenas de g++).
function executeAll(commands:string[][]):number{
 const limit:number=compileJobs();let pids:number[]=[];let statuses:number[]=[];for(const command of commands){pids.push(-1);statuses.push(-1);}
 let next:number=0;let running:number=0;let done:number=0;
 while(done<commands.length){
  while(running<limit&&next<commands.length){progressDetail(commands[next].join(" "));const pid=launch(commands[next]);if(pid<0)driverError(hostError());pids[next]=pid;next=next+1;running=running+1;}
  let finished:boolean=false;
  for(let k:number=0;k<next;k=k+1){if(statuses[k]<0){const status=poll(pids[k]);if(status>=0){statuses[k]=status;running=running-1;done=done+1;finished=true;}}}
  if(!finished){progressTick();pause(40);}
 }
 for(const status of statuses)if(status!=0)return status;return 0;
}
// Procesos de compilación en paralelo: ETSC_CXX_JOBS o el número de procesadores.
function compileJobs():number{
 const text=environment("ETSC_CXX_JOBS");if(text!=""){const value=JSON.parseValue(text);if(jsonIsNumber(value)&&jsonAsNumber(value)>=1)return Math.floor(jsonAsNumber(value));}
 const cores=processors();return cores>=1?cores:1;
}
function linkCommand(plan:constRef<CppPlan>,objects:string[],links:string[],binary:string):string[]{
 let command:string[]=[];for(const flag of plan.flags)command.push(flag);for(const flag of plan.programFlags)command.push(flag);for(const object of objects)command.push(object);for(const library of plan.libraries)command.push(library);for(const link of links)command.push(link);command.push("-o");command.push(binary);return command;
}
// --- Cabecera precompilada compuesta según el uso (#149, fase 2) -----------
// GCC admite una sola PCH por unidad, así que se compone una por combinación:
// las líneas #include que el backend pone al principio del C++ generado (las
// del runtime que el programa usa) más los flags. Se busca primero en la
// instalación (<root>/build/pch) y después en la caché del usuario; si no
// existe, el programa se compila sin ella y la PCH se crea en paralelo para el
// siguiente build.
function generatedIncludes(cpp:string):string[]{
 let lines:string[]=[];for(const line of readText(cpp).split("\n")){if(line.startsWith("#include")){lines.push(line);continue;}if(line==""||line.startsWith("//"))continue;break;}return lines;
}
function pchArtifact(header:string,compiler:string):string{return header+(compiler.includes("clang",0)?".pch":".gch");}
// Deja solo las `keep` PCH usadas más recientemente en la caché del usuario.
function prunePch(directory:string,keep:number):void{
 let keys:string[]=[];let times:string[]=[];
 for(const file of files(directory)){if(!(file.endsWith(".gch")||file.endsWith(".pch")))continue;const slash=file.indexOf("/",0);if(slash<0)continue;const fields=fileMetadata(directory+"/"+file).split("|");keys.push(file.slice(0,slash));times.push(fields.length>1?fields[1]:"");}
 while(keys.length>keep){
  // Fechas "segundos:nanosegundos" de la misma longitud: el orden de texto es el temporal.
  let oldest=0;for(let k:number=1;k<keys.length;k=k+1)if(times[k].localeCompare(times[oldest])<0)oldest=k;
  const dir=directory+"/"+keys[oldest];for(const file of files(dir))remove(dir+"/"+file);remove(dir);
  let restKeys:string[]=[];let restTimes:string[]=[];for(let k:number=0;k<keys.length;k=k+1)if(k!=oldest){restKeys.push(keys[k]);restTimes.push(times[k]);}keys=restKeys;times=restTimes;
 }
}
function compileCommand(plan:constRef<CppPlan>,index:number,source:string,object:string):string[]{
 let command:string[]=[];for(const flag of plan.flags)command.push(flag);if(index<plan.programUnits){for(const flag of plan.programFlags)command.push(flag);if(plan.pchHeader!=""){command.push("-include");command.push(plan.pchHeader);}}else{for(const flag of plan.sourceFlags[index-plan.programUnits])command.push(flag);}command.push("-c");command.push(source);command.push("-o");command.push(object);return command;
}
// Objetos de compilación:
// - runtime: primero los preparados en la instalación (<root>/build/objects, de
//   solo lectura, comunes a todos los usuarios); si no, la caché del usuario.
// - programa: en la caché del proyecto, por huella del C++ generado; si el C++
//   no cambia (comentarios, espacios…), no se vuelve a compilar.
// Contenido de las cabeceras forzadas con `-include X` (#143): si cambian,
// los objetos cacheados que las incluyen dejan de valer.
function includedHeaders(flags:string[]):string{
 let text="";for(let k:number=0;k<flags.length;k=k+1){let header="";if(flags[k]=="-include"&&k+1<flags.length)header=flags[k+1];else if(flags[k].startsWith("-include")&&flags[k].length>8)header=flags[k].slice(8,flags[k].length);
  if(header!="")text=text+header+"\n"+(exists(header)?contentHash(readText(header)):"missing")+"\n";}
 return text;
}
function compileCpp(result:constRef<IrCppResult>,cpp:string,binary:string,root:string,cxx:string,flags:string[],links:string[],cacheObjects:boolean,projectCache:string,unity:boolean=false):void{
 if(!directories(parent(binary)))driverError(hostError());progressStart("Preparando runtime");let plan=cppPlan(result,root,cxx,flags);
 // Modo por módulo (#178): cabecera común + una unidad por módulo en <cpp>.units/;
 // cada unidad es un objeto con su propia clave. --unity compila solo `cpp`.
 let units:string[]=[cpp];let includeSource:string=cpp;
 if(!unity&&result.units.length>0){
  // Copias locales: escribir archivos es un efecto opaco y no puede ocurrir
  // mientras se presta `result`.
  let header:string=result.header;let unitNames:string[]=[];let unitTexts:string[]=[];
  for(const unit of result.units){unitNames.push(unit.name);unitTexts.push(unit.text);}
  const directory=cpp+".units";if(!directories(directory))driverError(hostError());
  writeIfChanged(directory+"/program.hpp",header);units=[];includeSource=directory+"/program.hpp";
  let keep:string[]=["program.hpp"];for(let k:number=0;k<unitNames.length;k=k+1){writeIfChanged(directory+"/"+unitNames[k],unitTexts[k]);units.push(directory+"/"+unitNames[k]);keep.push(unitNames[k]);}
  for(const file of files(directory))if(!keep.includes(file))remove(directory+"/"+file);
  plan.programUnits=units.length;
 }
 const userCache=cacheObjects?runtimeObjectCache():"";const shipped=root+"/build/objects";
 const programCache=cacheObjects&&projectCache!=""&&directories(projectCache+"/objects")?projectCache+"/objects":"";
 if(userCache==""&&programCache==""&&!(cacheObjects&&exists(shipped))){
  // Sin caché: una sola llamada, como siempre.
  let sources:string[]=[];for(const unit of units)sources.push(unit);for(const source of plan.sources)sources.push(source);
  progressStart("Compilando y enlazando C++");const status=executeAll([linkCommand(plan,sources,links,binary)]);
  if(status!=0)driverError(cxx+" terminó con "+numberToString(status),status);if(!exists(binary))driverError("El compilador no creó "+binary);return;
 }
 const identity=contentHash(compilerIdentity(cxx,binary)+"\n"+plan.flags.join("\n")+"\n"+includedHeaders(plan.flags)+includedHeaders(plan.programFlags)+runtimeIdentity(root));
 // targets[k]: objeto a enlazar; build[k]: hay que compilarlo; publish[k]: ruta
 // final si se compila a un temporal; drop[k]: borrar al acabar (sin caché).
 let sources:string[]=[];for(const unit of units)sources.push(unit);for(const source of plan.sources)sources.push(source);
 let targets:string[]=[];let build:boolean[]=[];let publish:string[]=[];let drop:boolean[]=[];
 // La clave de una unidad del programa incluye la cabecera común: si cambian
 // tipos o firmas se recompilan todas; si cambia un cuerpo, solo la suya.
 const headerText:string=includeSource!=cpp?readText(includeSource):"";
 for(let k:number=0;k<sources.length;k=k+1){
  if(k<plan.programUnits){
   if(programCache!=""){const object=programCache+"/program-"+contentHash(identity+"\n"+plan.programFlags.join("\n")+"\n"+sources[k]+"\n"+headerText+"\n"+readText(sources[k]))+".o";targets.push(object);build.push(!exists(object));publish.push(object);drop.push(false);}
   else{targets.push(binary+".unit"+numberToString(k)+".o");build.push(true);publish.push("");drop.push(true);}
   continue;
  }
  const name=contentHash(identity+"\n"+plan.sourceFlags[k-plan.programUnits].join("\n")+"\n"+sources[k]+"\n"+fileMetadata(sources[k]))+".o";
  if(cacheObjects&&exists(shipped+"/"+name)){targets.push(shipped+"/"+name);build.push(false);publish.push("");drop.push(false);}
  else if(userCache!=""){targets.push(userCache+"/"+name);build.push(!exists(userCache+"/"+name));publish.push(userCache+"/"+name);drop.push(false);}
  else{targets.push(binary+".runtime"+numberToString(k)+".o");build.push(true);publish.push("");drop.push(true);}
 }
 let pchPid:number=-1;let pchPartial="";let pchFinal="";
 let buildsProgram:boolean=false;for(let k:number=0;k<plan.programUnits;k=k+1)if(build[k])buildsProgram=true;
 if(buildsProgram){
  const includes=generatedIncludes(includeSource);const compiler=compilerIdentity(cxx,binary);
  if(includes.length>0){
   const key=contentHash(identity+"\n"+plan.programFlags.join("\n")+"\n"+includes.join("\n"));
   const shippedHeader=shipped+"/../pch/"+key+"/pch.hpp";
   if(cacheObjects&&exists(pchArtifact(shippedHeader,compiler)))plan.pchHeader=shippedHeader;
   else if(userCache!=""&&directories(userCache+"/../pch/"+key)){
    const header=userCache+"/../pch/"+key+"/pch.hpp";if(!exists(header))checkedWrite(header,includes.join("\n")+"\n");
    if(exists(pchArtifact(header,compiler)))plan.pchHeader=header;
    else{pchFinal=pchArtifact(header,compiler);pchPartial=pchFinal+"."+numberToString(now())+".tmp";let command:string[]=[];for(const flag of plan.flags)command.push(flag);for(const flag of plan.programFlags)command.push(flag);command.push("-x");command.push("c++-header");command.push(header);command.push("-o");command.push(pchPartial);pchPid=launch(command,"/dev/null","/dev/null");}
   }
  }
 }
 let status=compileObjects(plan,sources,targets,build,publish);
 if(pchPid>=0){
  // La PCH nueva es para el siguiente build: se espera a que acabe y se publica.
  let pchStatus=poll(pchPid);while(pchStatus<0){progressTick();pause(40);pchStatus=poll(pchPid);}
  if(pchStatus==0&&exists(pchPartial)){rename(pchPartial,pchFinal);prunePch(userCache+"/../pch",5);}else remove(pchPartial);
 }
 if(status!=0)driverError(cxx+" terminó con "+numberToString(status),status);
 progressStart("Enlazando");status=executeAll([linkCommand(plan,targets,links,binary)]);
 if(status!=0){
  // Un objeto reutilizado puede estar dañado: se recompila todo lo reutilizado
  // (fuera de la instalación, que es de solo lectura) y se enlaza otra vez.
  let retry:boolean=false;for(let k:number=0;k<sources.length;k=k+1){if(build[k])continue;retry=true;build[k]=true;
   if(targets[k].startsWith(shipped+"/")){if(userCache!=""){targets[k]=userCache+"/"+targets[k].slice(shipped.length+1,targets[k].length);publish[k]=targets[k];}else{targets[k]=binary+".runtime"+numberToString(k)+".o";publish[k]="";drop[k]=true;}}
   else remove(targets[k]);}
  if(retry){progressStart("Recompilando objetos de la caché");status=compileObjects(plan,sources,targets,build,publish);if(status==0)status=executeAll([linkCommand(plan,targets,links,binary)]);}
 }
 for(let k:number=0;k<targets.length;k=k+1)if(drop[k])remove(targets[k]);
 if(status!=0)driverError(cxx+" terminó con "+numberToString(status),status);if(!exists(binary))driverError("El compilador no creó "+binary);
 // La caché del proyecto solo guarda el objeto del programa vigente.
 if(programCache!=""){let current:string[]=[];for(let k:number=0;k<plan.programUnits;k=k+1)current.push(targets[k]);for(const file of files(programCache))if(file.startsWith("program-")&&!current.includes(programCache+"/"+file))remove(programCache+"/"+file);}
}
// Escribe solo si el contenido cambia (las fechas de las unidades intactas no se tocan).
function writeIfChanged(path:string,text:string):void{if(exists(path)&&readText(path)==text)return;checkedWrite(path,text);}
// Compila en paralelo los objetos marcados. Los que van a una caché se escriben
// en un temporal y se publican con rename al terminar bien.
function compileObjects(plan:constRef<CppPlan>,sources:string[],targets:string[],build:boolean[],publish:string[]):number{
 let commands:string[][]=[];let partials:string[]=[];let finals:string[]=[];
 for(let k:number=0;k<sources.length;k=k+1){if(!build[k])continue;const output=publish[k]!=""?publish[k]+"."+numberToString(now())+".tmp":targets[k];commands.push(compileCommand(plan,k,sources[k],output));if(publish[k]!=""){partials.push(output);finals.push(publish[k]);}}
 if(commands.length==0)return 0;
 progressStart(plan.programUnits>1?"Compilando C++ ("+numberToString(commands.length)+" unidades)":(commands.length==1&&build[0]?"Compilando C++":"Compilando C++ y runtime"));
 const status=executeAll(commands);
 for(let k:number=0;k<partials.length;k=k+1){if(status==0&&exists(partials[k]))rename(partials[k],finals[k]);else remove(partials[k]);}
 return status;
}
// --version (#143): "etsc X.Y.Z (vN)". Una instalación guarda la versión en
// installation.json (install.sh); un checkout la lee de package.json.
function versionLabel(root:string):string{
 let version="";let revision="";
 if(exists(root+"/installation.json")){const info=JSON.parseValue(readText(root+"/installation.json"));if(jsonIsObject(info)){version=jsonAsString(jsonObjectGet(info,"packageVersion"));revision=jsonAsString(jsonObjectGet(info,"revision"));}}
 if(version==""&&exists(root+"/package.json")){const info=JSON.parseValue(readText(root+"/package.json"));if(jsonIsObject(info)){version=jsonAsString(jsonObjectGet(info,"version"));const revisionValue=jsonObjectGet(info,"estaticRevision");if(jsonIsNumber(revisionValue))revision=numberToString(jsonAsNumber(revisionValue));}}
 if(version=="")return "etsc (versión desconocida, ets-ir-2)";
 return revision==""?"etsc "+version:"etsc "+version+" (v"+revision+")";
}
function main():void{
 let args:string[]=[];for(let k:number=1;k<argumentCount();k=k+1)args.push(argument(k));
 if(args.length==1&&args[0]=="--codegen-json"){const wireProject=parseIrProject(stdinText());const wireResult=generateCppFromIr(wireProject);print(formatCppResult(wireResult));return;}
 if(args.length==1&&["--help","-h","-H"].includes(args[0])){print(help());return;}
 let root=environment("ESTC_ROOT");if(root=="")root=compilerHome();root=normalizePath(root);
 if(args.length==1&&["--version","-version","-v","-V","/V"].includes(args[0])){print(versionLabel(root));return;}
 setDiagnosticCatalog(root);
 if(args.length==2&&args[0]=="--explain"){print(explainCode(args[1]));return;}
 if(args.length>0&&(args[0]=="init"||args[0]=="update-types")){
  let directory=".";let sources=true;let positional=0;let initVerbose=false;
  for(let k:number=1;k<args.length;k=k+1){if(args[k]=="--no-src"&&args[0]=="init")sources=false;else if(args[k]=="--verbose")initVerbose=true;else if(args[k].startsWith("-")||positional>0)driverError(help(),2);else{directory=args[k];positional=positional+1;}}
  configureProgress(initVerbose,true);progressStart(args[0]=="init"?"Creando proyecto":"Actualizando tipos");initialize(root,directory,args[0]=="update-types",sources);progressSummary();return;}
 let build:boolean=false;let run:boolean=false;let check:boolean=false;let verbose:boolean=false;let animate:boolean=true;let entry:string="";let output:string="";let binary:string="";let fromIr:string="";let emitIr:string="";let emitInterface:boolean=false;let unity:boolean=false;let configPath:string="";let cxx:string="";let options=new LoaderOptions();let flags:string[]=[];let links:string[]=[];let programArgs:string[]=[];
 let at:number=0;if(args.length>0&&(args[0]=="build"||args[0]=="run")){build=true;run=args[0]=="run";at=1;}
 for(;at<args.length;at=at+1){const arg=args[at];if(arg=="--"){for(let k:number=at+1;k<args.length;k=k+1)programArgs.push(args[k]);break;}if(arg=="--profile-analysis"){if(!configureAnalysisProfile())driverError(hostError());continue;}if(arg=="--jobs"){at=at+1;if(at>=args.length||!configureAnalysisJobs(args[at]))driverError("--jobs requiere un entero entre 1 y 32",2);continue;}if(arg=="--verbose"){verbose=true;continue;}if(arg=="--no-progress"){animate=false;continue;}if(arg=="--build"){build=true;continue;}if(arg=="--run"){run=true;build=true;continue;}if(arg=="--check"){check=true;continue;}if(arg=="--emit-interface"){emitInterface=true;continue;}if(arg=="--unity"){unity=true;continue;}
 if(["-o","--binary","--from-ir","--emit-ir","--config","--cxx","--root","--cache","--alias","--cxx-flag","--link-flag"].includes(arg)){at+=1;if(at>=args.length)driverError("Falta un valor para "+arg,2);const value=args[at];if(value.startsWith("-")&&arg!="--cxx-flag"&&arg!="--link-flag")driverError("Falta un valor para "+arg,2);if(arg=="-o")output=value;else if(arg=="--binary")binary=value;else if(arg=="--from-ir")fromIr=value;else if(arg=="--emit-ir")emitIr=value;else if(arg=="--config")configPath=value;else if(arg=="--cxx")cxx=value;else if(arg=="--cache")options.cacheDirectory=value;else if(arg=="--root")options.roots.push(normalizePath(value));else if(arg=="--cxx-flag")flags.push(value);else if(arg=="--link-flag")links.push(value);else if(arg=="--alias"){at+=1;if(at>=args.length)driverError("Falta la ruta del alias",2);options.aliases.push(new PathAlias(value,args[at]));}continue;}
 if(arg.startsWith("-")||entry!="")driverError("Argumento inesperado: "+arg,2);entry=arg;}
 if(entry!=""&&fromIr!="")driverError("Usa una fuente o --from-ir",2);if(emitInterface&&(fromIr!=""||build||run||check||emitIr!=""||output!=""||binary!=""))driverError("--emit-interface solo admite un módulo fuente y opciones de resolución (--config, --root, --alias, --cache)",2);if(check&&(build||run||output!=""||binary!=""))driverError("--check no admite generación o ejecución",2);if(programArgs.length>0&&!run)driverError("Los argumentos del programa requieren run",2);
 configureProgress(verbose,animate);progressStart("Cargando configuración");if(configPath==""&&entry==""&&fromIr==""){if(exists("estatic.config.json"))configPath="estatic.config.json";else if(exists("estatic.config.ts"))configPath="estatic.config.ts";}
 let config:JsonValue=JSON.parseValue("{}");let configText="";let base:string=".";if(configPath!=""){configText=checkedRead(configPath);config=parseConfig(configText);base=parent(configPath);}const configuredEntry=jsonAsString(jsonObjectGet(config,"entry"));if(entry==""&&fromIr==""&&configuredEntry!="")entry=pathAt(base,configuredEntry);if(entry==""&&fromIr=="")driverError(help(),2);
 const incremental=jsonObjectGet(config,"incremental");const cache=jsonAsString(jsonObjectGet(incremental,"cacheDirectory"));
 // incremental.enabled=false (#143): sin ninguna caché del proyecto, ni de sintaxis ni de objetos.
 const cacheEnabled=!jsonIsBool(jsonObjectGet(incremental,"enabled"))||jsonAsBool(jsonObjectGet(incremental,"enabled"));if(options.cacheDirectory==""&&cache!=""&&cacheEnabled)options.cacheDirectory=pathAt(base,cache);
 for(const path of configStrings(jsonObjectGet(config,"moduleRoots")))options.roots.push(pathAt(base,path));const aliases=jsonObjectGet(config,"aliases");for(const name of objectKeys(aliases))options.aliases.push(new PathAlias(name,pathAt(base,jsonAsString(jsonObjectGet(aliases,name)))));
 if(emitInterface){emitModuleInterface(entry,options);return;}
 // Fase 3 de #149: con una huella vigente no se analiza ni se compila.
 const compilerConfig=jsonObjectGet(config,"compiler");const outputConfig=jsonObjectGet(config,"output");
 const willCompile=build||jsonAsBool(jsonObjectGet(compilerConfig,"enabled"));
 const incrementalEnabled=!jsonIsBool(jsonObjectGet(incremental,"enabled"))||jsonAsBool(jsonObjectGet(incremental,"enabled"));
 let fingerprintPath="";let fingerprintKey="";
 if(willCompile&&fromIr==""&&emitIr==""&&!check&&incrementalEnabled&&options.cacheDirectory!=""){
  if(output==""){const configured=jsonAsString(jsonObjectGet(outputConfig,"cpp"));output=(configured!=""?pathAt(base,configured):"build/"+stem(entry)+".cpp");}
  if(binary==""){const configured=jsonAsString(jsonObjectGet(outputConfig,"binary"));binary=(configured!=""?pathAt(base,configured):output+".bin");}
  if(cxx=="")cxx=jsonAsString(jsonObjectGet(compilerConfig,"command"));if(cxx=="")cxx=environment("CXX");if(cxx=="")cxx="g++";
  let keyArgs:string[]=["entry "+entry,"output "+output,"binary "+binary,"unity "+(unity?"1":"0")];for(const flag of flags)keyArgs.push("cxx-flag "+flag);for(const link of links)keyArgs.push("link-flag "+link);for(const moduleRoot of options.roots)keyArgs.push("root "+moduleRoot);for(const alias of options.aliases)keyArgs.push("alias "+alias.name+" "+alias.target);
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
 if(build||jsonAsBool(jsonObjectGet(compiler,"enabled"))){if(binary==""){const configured=jsonAsString(jsonObjectGet(outConfig,"binary"));binary=(configured!=""?pathAt(base,configured):output+".bin");}if(cxx=="")cxx=jsonAsString(jsonObjectGet(compiler,"command"));if(cxx=="")cxx=environment("CXX");if(cxx=="")cxx="g++";let compileFlags=configStrings(jsonObjectGet(compiler,"flags"));for(const flag of flags)compileFlags.push(flag);let linkFlags=configStrings(jsonObjectGet(compiler,"linkFlags"));for(const flag of links)linkFlags.push(flag);for(const library of configStrings(jsonObjectGet(config,"linkLibraries")))linkFlags.push("-l"+library);compileCpp(generated,output,binary,root,cxx,compileFlags,linkFlags,incrementalEnabled,options.cacheDirectory,unity);if(fingerprintPath!=""){let inputs:string[]=[];for(const file of analyzedFiles)inputs.push(file);if(configPath!="")inputs.push(configPath);for(let k:number=0;k+1<flags.length;k=k+1)if(flags[k]=="-include"&&exists(flags[k+1]))inputs.push(flags[k+1]);checkedWrite(fingerprintPath,fingerprintText(fingerprintKey,inputs,[output,binary]));}}
 progressSummary(output,(build||jsonAsBool(jsonObjectGet(compiler,"enabled")))?binary:"");if(run){let command:string[]=[normalizePath(binary)];for(const arg of programArgs)command.push(arg);exitProcess(execute(command));}
}
main();
