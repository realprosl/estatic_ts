import { createHash, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeProject } from "../src/project/init-project.ts";
import { buildNativeCompiler } from "./build/native-compiler.ts";
import { root } from "./root.ts";
import { buildIrFrontend } from "./ir/cpp.ts";
import { precompileRuntime } from "./build/runtime-cache.ts";

const folders=["runtime","types"];
const digest=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
export async function install(argv:string[]):Promise<void> {
  let prefix="/usr/local",cxx=process.env.CXX??"g++",frontend="";
  for(let at=0;at<argv.length;at++){
    if(argv[at]==="--help"||argv[at]==="-h"){
      console.log("Uso: ./install.sh [--prefix /usr/local] [--cxx g++] [--frontend binario]\nConstruye el frontend con src/, precompila libuv/httplib e instala etsc.\nRequisitos: Node >=22.6, C++20, ar y las dependencias del runtime.\nNode sólo se usa durante el bootstrap y la instalación; etsc es nativo.");return;
    }
    const flag=argv[at];if(!["--prefix","--cxx","--frontend"].includes(flag)||!argv[at+1]||argv[at+1].startsWith("-"))throw new Error(`Opción inválida o sin valor: ${flag}`);
    const value=argv[++at];if(flag==="--prefix")prefix=resolve(value);else if(flag==="--cxx")cxx=value;else frontend=resolve(value);
  }
  if(Number(process.versions.node.split(".")[0])<22 || Number(process.versions.node.split(".")[0])===22&&Number(process.versions.node.split(".")[1])<6)throw new Error("Se requiere Node >=22.6");
  process.env.CXX=cxx;
  const library=join(prefix,"lib/estc"),current=join(library,"current"),destination=join(prefix,"bin/etsc");
  let oldPointer:string|undefined;
  if(existsSync(current)){
    if(!lstatSync(current).isSymbolicLink())throw new Error(`No se sobrescribe un directorio ajeno: ${current}`);
    oldPointer=readlinkSync(current);
    try{if(JSON.parse(readFileSync(join(current,"installation.json"),"utf8")).format!=="estc-install-1")throw new Error();}
    catch{throw new Error(`No se sustituye una distribución ajena: ${current}`);}
  }
  if(existsSync(destination)){
    let owned=false;
    try{owned=JSON.parse(readFileSync(join(current,"installation.json"),"utf8")).commandHash===digest(destination);}catch{}
    // npm link from this checkout is an owned stage-0 launcher, not another tool.
    if(!owned&&lstatSync(destination).isSymbolicLink()){
      try{owned=realpathSync(destination)===realpathSync(join(root,"src/cli.ts"));}catch{}
    }
    if(!owned)throw new Error(`No se sobrescribe un comando ajeno: ${destination}; usa otro --prefix`);
  }
  const legacyEstc=join(prefix,"bin/estc");let ownedEstc=false;
  try{const old=JSON.parse(readFileSync(join(current,"installation.json"),"utf8"));ownedEstc=old.format==="estc-install-1"&&existsSync(legacyEstc)&&old.commandHash===digest(legacyEstc);}catch{}
  // Finish compilation in the clone before attempting publication to the prefix.
  console.log("==> Construyendo el frontend nativo mediante src/");
  const native=frontend||await buildIrFrontend();
  if(!existsSync(native))throw new Error(`Frontend inexistente: ${native}`);
  console.log("==> Precompilando runtime (libuv, red y cpp-httplib)");
  const archives=precompileRuntime(cxx);
  const work=join(root,"build/install-"+randomUUID());mkdirSync(work,{recursive:true});
  let stage="",release="",pointerChanged=false;
  try{
    console.log("==> Compilando driver y emisor nativos etsc");
    const driver=buildNativeCompiler(undefined,cxx);
    const templates=join(work,"templates");await initializeProject(templates,{command:"etsc",native:true,compiler:cxx});
    const config=(await import(pathToFileURL(join(templates,"estatic.config.ts")).href)).default;
    config.incremental.cacheDirectory=".build/cache";
    config.incremental.generatedDirectory=".build/generated";
    config.logging.file=".build/transpiler-report.json";
    writeFileSync(join(templates,"estatic.config.json"),JSON.stringify(config,null,2)+"\n");
    writeFileSync(join(templates,".gitignore"),readFileSync(join(templates,".gitignore"),"utf8")+".build/\n");
    const editorConfig=JSON.parse(readFileSync(join(templates,"tsconfig.json"),"utf8"));
    editorConfig.include=editorConfig.include.filter((p:string)=>p!=="estatic.config.ts");
    editorConfig.include.push("estatic.config.json");
    writeFileSync(join(templates,"tsconfig.json"),JSON.stringify(editorConfig,null,2)+"\n");
    writeFileSync(join(templates,"README.md"),readFileSync(join(templates,"README.md"),"utf8").replaceAll("estatic.config.ts","estatic.config.json"));rmSync(join(templates,"estatic.config.ts"));
    const key=createHash("sha256").update(digest(native)).update(digest(driver));
    for(const folder of folders)for(const file of readdirSync(join(root,folder),{recursive:true}).map(String).sort()){
      const path=join(root,folder,file);if(lstatSync(path).isFile()&&!file.endsWith(".test.ts"))key.update(folder+"/"+file).update(digest(path));
    }
    key.update(digest(join(root,"package.json")));for(const archive of archives)key.update(digest(archive));
    const version=key.digest("hex").slice(0,24);
    mkdirSync(join(library,"releases"),{recursive:true});mkdirSync(dirname(destination),{recursive:true});
    stage=join(library,".install-"+randomUUID());mkdirSync(stage);
    for(const folder of folders)cpSync(join(root,folder),join(stage,folder),{recursive:true,filter:path=>!path.endsWith(".test.ts")});
    cpSync(templates,join(stage,"templates"),{recursive:true});
    cpSync(join(root,"package.json"),join(stage,"package.json"));
    mkdirSync(join(stage,"native"));cpSync(native,join(stage,"native/frontend"));chmodSync(join(stage,"native/frontend"),0o755);
    for(const archive of archives){const relative=join("build/runtime-cache",basename(dirname(archive)),basename(archive)),dir=dirname(relative);mkdirSync(join(stage,dir),{recursive:true});cpSync(archive,join(stage,relative));cpSync(join(dirname(archive),"manifest.json"),join(stage,dir,"manifest.json"));}
    if(existsSync(join(root,"build/libs")))cpSync(join(root,"build/libs"),join(stage,"build/libs"),{recursive:true,verbatimSymlinks:true});
    writeFileSync(join(stage,"installation.json"),JSON.stringify({format:"estc-install-1",version,compiler:cxx,native:true,frontend:"native/frontend",commandHash:digest(driver)},null,2)+"\n");
    release=join(library,"releases",version+"-"+randomUUID().slice(0,8));
    renameSync(stage,release);stage="";
    const pointer=join(library,".current-"+randomUUID());symlinkSync("releases/"+release.split("/").at(-1),pointer);renameSync(pointer,current);pointerChanged=true;
    const newCommand=join(dirname(destination),".etsc-"+randomUUID());cpSync(driver,newCommand);chmodSync(newCommand,0o755);renameSync(newCommand,destination);
    if(ownedEstc)rmSync(legacyEstc);
    const legacy=join(prefix,"bin/nativo");
    try{const old=JSON.parse(readFileSync(join(prefix,"lib/nativo/current/installation.json"),"utf8"));if(old.format==="nativo-install-1"&&existsSync(legacy)&&old.commandHash===digest(legacy))rmSync(legacy);}catch{}
    console.log(`==> Instalado: ${destination}\n    etsc init proyecto\n    cd proyecto\n    etsc build\n    etsc run`);
  }catch(error){
    if((error as NodeJS.ErrnoException).code==="EACCES")console.error(`Sin permisos en ${prefix}; utiliza un prefijo escribible, por ejemplo --prefix "$HOME/.local"`);
    if(pointerChanged){if(oldPointer){const restore=join(library,".restore-"+randomUUID());symlinkSync(oldPointer,restore);renameSync(restore,current);}else rmSync(current,{force:true});}
    throw error;
  }finally{if(stage)rmSync(stage,{recursive:true,force:true});rmSync(work,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))install(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
