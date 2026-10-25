import { createHash, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { root } from "./root.ts";
import { buildIrFrontend } from "./ir/cpp.ts";
import { precompileRuntime } from "./build/runtime-cache.ts";

const folders=["src","runtime","types"];
const hostFiles=["root.ts","cli.ts","ir/cpp.ts","build/runtime-cache.ts","build/precompile-runtime.ts"];
const digest=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
function command(executable:string,args:string[]):void {
  const child=spawnSync(executable,args,{stdio:"inherit",timeout:180000});
  if(child.error)throw child.error;if(child.status!==0)throw new Error(`${executable} terminó con ${child.status}`);
}
export async function install(argv:string[]):Promise<void> {
  let prefix="/usr/local",cxx=process.env.CXX??"g++",frontend="";
  for(let at=0;at<argv.length;at++){
    if(argv[at]==="--help"||argv[at]==="-h"){
      console.log("Uso: ./install.sh [--prefix /usr/local] [--cxx g++] [--frontend binario]\nConstruye el frontend con src/, precompila libuv/httplib e instala nativo.\nRequisitos: Node >=22.6, C++20, ar y las dependencias del runtime.\nNode sigue siendo necesario para el driver/emisor TypeScript actuales.");return;
    }
    const flag=argv[at];if(!["--prefix","--cxx","--frontend"].includes(flag)||!argv[at+1]||argv[at+1].startsWith("-"))throw new Error(`Opción inválida o sin valor: ${flag}`);
    const value=argv[++at];if(flag==="--prefix")prefix=resolve(value);else if(flag==="--cxx")cxx=value;else frontend=resolve(value);
  }
  if(Number(process.versions.node.split(".")[0])<22 || Number(process.versions.node.split(".")[0])===22&&Number(process.versions.node.split(".")[1])<6)throw new Error("Se requiere Node >=22.6");
  process.env.CXX=cxx;
  const nodeCandidate=isAbsolute(process.execPath)?process.execPath:(process.env.PATH??"").split(":").map(path=>join(path,process.execPath)).find(existsSync);
  if(!nodeCandidate)throw new Error("No se encuentra el ejecutable de Node en PATH");
  const nodeExecutable=realpathSync(nodeCandidate);
  const library=join(prefix,"lib/nativo"),current=join(library,"current"),destination=join(prefix,"bin/nativo");
  let oldPointer:string|undefined;
  if(existsSync(current)){
    if(!lstatSync(current).isSymbolicLink())throw new Error(`No se sobrescribe un directorio ajeno: ${current}`);
    oldPointer=readlinkSync(current);
    try{if(JSON.parse(readFileSync(join(current,"installation.json"),"utf8")).format!=="nativo-install-1")throw new Error();}
    catch{throw new Error(`No se sustituye una distribución ajena: ${current}`);}
  }
  if(existsSync(destination)){
    let owned=false;
    try{owned=JSON.parse(readFileSync(join(current,"installation.json"),"utf8")).commandHash===digest(destination);}catch{}
    if(!owned)throw new Error(`No se sobrescribe un comando ajeno: ${destination}; usa otro --prefix`);
  }
  // Finish compilation in the clone before attempting publication to the prefix.
  console.log("==> Construyendo el frontend nativo mediante src/");
  const native=frontend||await buildIrFrontend();
  if(!existsSync(native))throw new Error(`Frontend inexistente: ${native}`);
  console.log("==> Precompilando runtime (libuv, red y cpp-httplib)");
  const archives=precompileRuntime(cxx);
  const work=join(root,"build/install-"+randomUUID());mkdirSync(work,{recursive:true});
  let stage="",release="",pointerChanged=false;
  try{
    writeFileSync(join(work,"install_config.hpp"),`#define ESTATIC_NODE ${JSON.stringify("node")}\n`);
    const driver=join(work,"nativo");command(cxx,["-std=c++20","-O2",`-I${work}`,join(root,"bootstrap/driver.cpp"),"-o",driver]);
    const key=createHash("sha256").update(digest(native)).update(digest(driver));
    for(const folder of folders)for(const file of readdirSync(join(root,folder),{recursive:true}).map(String).sort()){
      const path=join(root,folder,file);if(lstatSync(path).isFile()&&!file.endsWith(".test.ts"))key.update(folder+"/"+file).update(digest(path));
    }
    for(const file of hostFiles)key.update(file).update(digest(join(root,"bootstrap",file)));
    key.update(digest(join(root,"package.json")));for(const archive of archives)key.update(digest(archive));
    const version=key.digest("hex").slice(0,24);
    mkdirSync(join(library,"releases"),{recursive:true});mkdirSync(dirname(destination),{recursive:true});
    stage=join(library,".install-"+randomUUID());mkdirSync(stage);
    for(const folder of folders)cpSync(join(root,folder),join(stage,folder),{recursive:true,filter:path=>!path.endsWith(".test.ts")});
    for(const file of hostFiles){mkdirSync(dirname(join(stage,"bootstrap",file)),{recursive:true});cpSync(join(root,"bootstrap",file),join(stage,"bootstrap",file));}
    cpSync(join(root,"package.json"),join(stage,"package.json"));
    mkdirSync(join(stage,"native"));cpSync(native,join(stage,"native/frontend"));chmodSync(join(stage,"native/frontend"),0o755);
    for(const archive of archives){const relative=join("build/runtime-cache",basename(dirname(archive)),basename(archive)),dir=dirname(relative);mkdirSync(join(stage,dir),{recursive:true});cpSync(archive,join(stage,relative));cpSync(join(dirname(archive),"manifest.json"),join(stage,dir,"manifest.json"));}
    if(existsSync(join(root,"build/libs")))cpSync(join(root,"build/libs"),join(stage,"build/libs"),{recursive:true,verbatimSymlinks:true});
    writeFileSync(join(stage,"installation.json"),JSON.stringify({format:"nativo-install-1",version,compiler:cxx,node:nodeExecutable,frontend:"native/frontend",commandHash:digest(driver)},null,2)+"\n");
    release=join(library,"releases",version+"-"+randomUUID().slice(0,8));
    renameSync(stage,release);stage="";
    const pointer=join(library,".current-"+randomUUID());symlinkSync("releases/"+release.split("/").at(-1),pointer);renameSync(pointer,current);pointerChanged=true;
    const newCommand=join(dirname(destination),".nativo-"+randomUUID());cpSync(driver,newCommand);chmodSync(newCommand,0o755);renameSync(newCommand,destination);
    console.log(`==> Instalado: ${destination}\n    nativo init proyecto\n    cd proyecto\n    nativo build\n    nativo run`);
  }catch(error){
    if((error as NodeJS.ErrnoException).code==="EACCES")console.error(`Sin permisos en ${prefix}; utiliza un prefijo escribible, por ejemplo --prefix "$HOME/.local"`);
    if(pointerChanged){if(oldPointer){const restore=join(library,".restore-"+randomUUID());symlinkSync(oldPointer,restore);renameSync(restore,current);}else rmSync(current,{force:true});}
    throw error;
  }finally{if(stage)rmSync(stage,{recursive:true,force:true});rmSync(work,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))install(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
