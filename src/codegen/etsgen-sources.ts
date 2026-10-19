import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { GeneratedSource } from "../core/span.ts";
import { mapCppSources } from "./cpp-source-map.ts";

/** Materialize original ETS, never the renamed AST. Filenames are allocated
 * by the compiler rather than taken from generated strings or generator names. */
export async function writeGeneratedSources(sources:GeneratedSource[], directory:string):Promise<void> {
  const destination=resolve(directory);
  await mkdir(destination,{recursive:true});
  const fragments=[];
  for(const [index,source] of sources.entries()) {
    const file=`etsgen-${index}.ets`;
    await writeFile(join(destination,file),source.source,"utf8");
    const parent=source.callSpan.generated;
    const parentIndex=parent ? sources.findIndex(item=>item.id === parent.id) : -1;
    const callLocation=parent && parentIndex >= 0 ? {file:join(destination,`etsgen-${parentIndex}.ets`),span:parent.span} : {file:source.callSpan.module,span:source.originalCallSpan ?? source.callSpan};
    const displayGenerator=Object.entries(source.callSpan.etsgenScope ?? {}).find(([,target])=>target === source.generator)?.[0]
      ?? sources.flatMap(item=>item.bindings ?? []).find(binding=>binding.emittedName === source.generator)?.name
      ?? source.generator;
    fragments.push({...source,file,callLocation,displayGenerator});
  }
  await writeFile(join(destination,"manifest.json"),JSON.stringify({version:1,fragments},null,2)+"\n","utf8");
}

/** Write the final C++ layout and its sidecar. Call writeGeneratedSources once
 * for the complete program before writing header/modules into this directory. */
export async function writeMappedCpp(cpp:string,file:string,sources:GeneratedSource[],directory:string):Promise<string> {
  const destination=resolve(file);
  if(!sources.length) {await writeFile(destination,cpp,"utf8");await rm(destination+".map.json",{force:true});return cpp;}
  const sourceFiles=sources.map((_,index)=>join(resolve(directory),`etsgen-${index}.ets`));
  const mapped=mapCppSources(cpp,destination,sources,sourceFiles);
  await writeFile(destination,mapped.cpp,"utf8");
  await writeFile(destination+".map.json",JSON.stringify({version:1,cppFile:destination,manifest:join(resolve(directory),"manifest.json"),mappings:mapped.mappings},null,2)+"\n","utf8");
  return mapped.cpp;
}
