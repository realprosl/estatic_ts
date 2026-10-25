#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Host driver only. Parsing, binding, checking, expansion and lowering execute
// in the native ETS frontend; C++ emission consumes only its verified IR.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { CliProgress, phase, presentation, type ProgressEvent } from "./cli-progress.ts";
import { root } from "./root.ts";
import { buildIrFrontend, nativeIr, buildIrCpp } from "./ir/cpp.ts";
import { generateCppFromIr, IrCppGenerator } from "../src/codegen/ir/cpp-generator.ts";
import type { IrProject } from "../src/codegen/ir/model.ts";
import { loadConfig } from "../src/config/project-config.ts";
import { initializeProject, updateProjectTypes } from "../src/project/init-project.ts";
import { getTs2cppVersionLabel } from "../src/core/ts2cpp-version.ts";

const help=`Uso: etsc init [directorio]
     etsc build [entrada.ts|entrada.ets] [opciones]
     etsc run [entrada.ts|entrada.ets] [opciones] [-- argumentos]
     etsc-bootstrap [entrada.ts|entrada.ets] [opciones]
  -o archivo.cpp       Generar C++ (por defecto build/<entrada>.cpp)
  --build              Compilar y enlazar el C++ con el runtime existente
  --run                Compilar y ejecutar; propagar su código de salida
  --binary archivo     Ruta del ejecutable
  --verbose            Mostrar fases, rutas, opciones y tiempos en stderr
  --no-progress        Desactivar animaciones
  --check              Comprobar frontend e IR sin generar C++
  --emit-ir archivo    Guardar también el IR verificado como JSON
  --from-ir archivo    Consumir IR verificado en lugar de un fuente
  --config archivo     Cargar estatic.config.ts
  --root directorio    Añadir raíz de módulos (repetible)
  --alias nombre ruta  Añadir alias de módulos (repetible)
  --cache directorio   Caché de sintaxis del frontend etsc
  --cxx compilador     Seleccionar compilador C++
  --cxx-flag flag      Añadir opción de compilación (repetible)
  --link-flag flag     Añadir opción de enlace (repetible)
  --frontend binario   Usar un frontend etsc ya construido
  init [directorio] | update-types [directorio]
  --version | --help
El backend HTTP se selecciona con @cpp_drogon; el predeterminado es cpp-httplib.`;
class UsageError extends Error {}
async function compile(argv:string[], report:(event:ProgressEvent)=>void):Promise<void> {
  const started=performance.now();
  const step=<T>(label:string,action:()=>T|Promise<T>)=>phase(label,action,report);
  const detail=(text:string)=>report({type:"detail",text});
  const summary=()=>report({type:"summary",elapsed:performance.now()-started});
  // Consume presentation flags only before --; program arguments are untouched.
  argv=presentation(argv).args;
  if(argv[0]==="build"||argv[0]==="run")argv=[argv[0]==="run"?"--run":"--build",...argv.slice(1)];
  if(argv.length===1&&["--version","-v"].includes(argv[0])){console.log(`${getTs2cppVersionLabel()} (bootstrap IR → C++20)`);return;}
  if(argv.length===1&&["--help","-h"].includes(argv[0])){console.log(help);return;}
  const installed=existsSync(join(root,"installation.json"))?JSON.parse(readFileSync(join(root,"installation.json"),"utf8")):undefined;
  const defaultCompiler=process.env.CXX??installed?.compiler??"g++";
  if(["init","update-types"].includes(argv[0])) {
    if(argv.length>2||argv[1]?.startsWith("-"))throw new UsageError("Uso: etsc-bootstrap init|update-types [directorio]");
    const result=await step(argv[0]==="init"?"Creando proyecto":"Actualizando tipos",()=>argv[0]==="init"?initializeProject(argv[1]??".",{command:"etsc",native:true,compiler:defaultCompiler}):updateProjectTypes(argv[1]??"."));
    console.log(JSON.stringify(result,null,2));return;
  }
  let entry="",output="",binary="",configPath="",emitIr="",fromIr="",frontend="",cache="",cxx="";
  let build=false,run=false,check=false;const roots:string[]=[],aliases:[string,string][]=[],flags:string[]=[],linkFlags:string[]=[],programArgs:string[]=[];
  const value=(at:number):string=>{if(!argv[at])throw new UsageError(`Falta un valor para ${argv[at-1]}`);return argv[at];};
  for(let at=0;at<argv.length;at++) {
    const a=argv[at];if(a==="--"){programArgs.push(...argv.slice(at+1));break;}
    if(a==="--build"){build=true;continue;}if(a==="--run"){run=build=true;continue;}if(a==="--check"){check=true;continue;}
    if(["-o","--binary","--config","--emit-ir","--from-ir","--frontend","--cache","--cxx","--root","--alias","--cxx-flag","--link-flag"].includes(a)) {
      const v=value(++at);if(v.startsWith("-")&&!["--cxx-flag","--link-flag"].includes(a))throw new UsageError(`Falta un valor para ${a}`);
      switch(a){case "-o":output=v;break;case "--binary":binary=v;break;case "--config":configPath=v;break;case "--emit-ir":emitIr=v;break;case "--from-ir":fromIr=v;break;case "--frontend":frontend=v;break;case "--cache":cache=v;break;case "--cxx":cxx=v;break;case "--root":roots.push(resolve(v));break;case "--alias":aliases.push([v,resolve(value(++at))]);break;case "--cxx-flag":flags.push(v);break;case "--link-flag":linkFlags.push(v);break;}
      continue;
    }
    if(a.startsWith("-")||entry)throw new UsageError(`Argumento inesperado: ${a}`);entry=a;
  }
  if(entry&&fromIr)throw new UsageError("Usa una entrada fuente o --from-ir");
  if(check&&(build||run||output||binary))throw new UsageError("--check no admite generación o ejecución");
  if(programArgs.length&&!run)throw new UsageError("Los argumentos del programa requieren --run");
  const config=await step("Cargando configuración",()=>configPath?loadConfig(configPath):!entry&&!fromIr?loadConfig():undefined);
  if(!entry&&!fromIr&&!config)throw new UsageError(help);
  entry=resolve(entry||fromIr||config!.entry);
  const loaderArgs:string[]=[];
  for(const root of [...config?.moduleRoots??[],...roots])loaderArgs.push("--root",root);
  for(const [name,path]of [...Object.entries(config?.aliases??{}),...aliases])loaderArgs.push("--alias",name,path);
  if(cache)loaderArgs.push("--cache",resolve(cache));
  if(fromIr&&loaderArgs.length)throw new UsageError("Las opciones de módulos requieren un fuente");
  detail(`Entrada: ${JSON.stringify(entry)}`);
  if(!fromIr&&!frontend)frontend=await step("Preparando frontend nativo",()=>buildIrFrontend());
  if(!fromIr)detail(`Frontend: ${JSON.stringify(frontend)}; módulos: ${JSON.stringify(loaderArgs)}`);
  const project:IrProject=await step(fromIr?"Leyendo IR":"Analizando fuentes y verificando IR",()=>fromIr?JSON.parse(readFileSync(entry,"utf8")):nativeIr(frontend,entry,loaderArgs));
  // Check the producer boundary even when --check/--from-ir bypasses emission.
  await step("Validando frontera del backend",()=>{
  if(project.format!=="ets-ir-2"||!project.success||!Array.isArray(project.diagnostics)||project.diagnostics.length)throw new Error("Se requiere ets-ir-2 verificado con success:true");
  new IrCppGenerator(project).validateBoundary();
  });
  const save=(path:string,text:string)=>{mkdirSync(dirname(resolve(path)),{recursive:true});writeFileSync(resolve(path),text);};
  const result=check?undefined:await step("Generando C++",()=>generateCppFromIr(project));
  if(emitIr){await step("Guardando IR",()=>save(emitIr,JSON.stringify(project,null,2)+"\n"));detail(`IR: ${JSON.stringify(resolve(emitIr))}`);}
  if(check){summary();console.log(`Comprobado: ${entry}`);return;}
  output=resolve(output||config?.output.cpp||join("build",basename(entry,extname(entry))+".cpp"));await step("Guardando C++",()=>save(output,result!.cpp));detail(`C++: ${JSON.stringify(output)}`);
  if(build||config?.compiler.enabled){binary=resolve(binary||config?.output.binary||output.replace(/\.cpp$/,"")+".bin");const compiler=cxx||config?.compiler.command||defaultCompiler;
    const compileFlags=[...config?.compiler.flags??[],...flags],links=[...config?.compiler.linkFlags??[],...config?.linkLibraries.map(lib=>`-l${lib}`)??[],...linkFlags];
    detail(`Compilador: ${JSON.stringify(compiler)}; flags: ${JSON.stringify(compileFlags)}; enlace: ${JSON.stringify(links)}`);
    await step("Preparando runtime, compilando y enlazando C++",()=>buildIrCpp(result!,output,binary,compiler,compileFlags,links));
    detail(`Ejecutable: ${JSON.stringify(binary)}`);}
  summary();
  if(run){detail(`Ejecutando: ${JSON.stringify([binary,...programArgs])}`);const child=spawnSync(binary,programArgs,{stdio:"inherit"});if(child.error)throw child.error;process.exitCode=child.status??1;}
}
export async function main(argv:string[]):Promise<void> {
  const options=presentation(argv);
  const progress=new CliProgress(options.verbose,options.progress);
  // Blocking frontend/C++ work runs off the host event loop so spinners really
  // animate, including the first build of the native frontend.
  await new Promise<void>((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{bootstrapCLI:true,argv},execArgv:["--experimental-strip-types","--no-warnings"]});
    let result:{exitCode?:number;error?:string;usage?:boolean}|undefined;
    worker.on("message",event=>{
      if(event.type==="done")result=event;
      else progress.handle(event);
    });
    worker.on("error",error=>{progress.clear();reject(error);});
    worker.on("exit",code=>{
      progress.clear();
      if(result?.error)reject(result.usage?new UsageError(result.error):new Error(result.error));
      else if(!result)reject(new Error(`El proceso de compilación terminó inesperadamente (${code})`));
      else{if(result.exitCode)process.exitCode=result.exitCode;resolve();}
    });
  });
}
if(!isMainThread&&workerData?.bootstrapCLI===true){
  compile(workerData.argv,event=>parentPort!.postMessage(event)).then(
    ()=>parentPort!.postMessage({type:"done",exitCode:process.exitCode??0}),
    error=>parentPort!.postMessage({type:"done",error:error instanceof Error?error.message:String(error),usage:error instanceof UsageError})
  );
}else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=error instanceof UsageError?2:1;});
