// Auditoría de capas del compilador (#176, épica #174).
//
// Cada módulo de compiler/ pertenece a una capa y solo puede importar de su
// propia capa o de las de debajo:
//
//   platform     platform/                         (host, platform, progress)
//   syntax       lexer/, parser/                   (sin dependencias)
//   diag         diag/                             (diagnósticos, catálogo, parseSource)
//   semantic     modules/, binder/, checker/, analysis/
//   ir           ir/
//   backend-cpp  backend/                          (de ir/ solo el modelo)
//   driver       driver/, audit/ y los demo.ets    (entradas: nadie las importa)
//
// Además, el grafo de imports entre archivos no puede tener ciclos.
//
// Uso: node --experimental-strip-types compiler/audit/layers.ts [--json]
// Sale con 1 si hay alguna violación.
import {readdirSync,readFileSync,statSync} from "node:fs";
import {dirname,join,normalize,relative} from "node:path";
import {fileURLToPath} from "node:url";

export const layers=["platform","syntax","diag","semantic","ir","backend-cpp","driver"] as const;
export type Layer=typeof layers[number];

const directories:Record<string,Layer>={
  platform:"platform",lexer:"syntax",parser:"syntax",diag:"diag",
  modules:"semantic",binder:"semantic",checker:"semantic",analysis:"semantic",
  ir:"ir",backend:"backend-cpp",driver:"driver",audit:"driver",
};
// Lo único de ir/ que puede ver el backend: el modelo (y con él, el formato wire).
const backendFromIr=new Set(["ir/model.ets"]);

export function layerOf(file:string):Layer|undefined{
  if(file.endsWith("/demo.ets"))return "driver";
  return directories[file.split("/")[0]];
}

export interface Violation{kind:"layer"|"cycle"|"unknown";file:string;target?:string;message:string}

function sources(root:string):string[]{
  const result:string[]=[];
  const walk=(directory:string)=>{for(const name of readdirSync(directory).sort()){const path=join(directory,name);if(statSync(path).isDirectory())walk(path);else if(name.endsWith(".ets"))result.push(relative(root,path));}};
  walk(root);return result;
}

export function imports(root:string,file:string):string[]{
  const text=readFileSync(join(root,file),"utf8");const result:string[]=[];
  for(const match of text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gm)){
    const spec=match[1];if(!spec.startsWith("."))continue;
    let target=normalize(join(dirname(file),spec));if(!target.endsWith(".ets"))target+=".ets";result.push(target);
  }
  return [...new Set(result)];
}

export function audit(root:string):{files:number;edges:number;violations:Violation[]}{
  const files=sources(root);const graph=new Map<string,string[]>();const violations:Violation[]=[];let edges=0;
  for(const file of files){
    const layer=layerOf(file);
    if(!layer){violations.push({kind:"unknown",file,message:`${file}: no pertenece a ninguna capa (añade su directorio a compiler/audit/layers.ts)`});continue;}
    const targets=imports(root,file);graph.set(file,targets);edges+=targets.length;
    for(const target of targets){
      const other=layerOf(target);
      if(!other){violations.push({kind:"unknown",file,target,message:`${file} importa ${target}, que no pertenece a ninguna capa`});continue;}
      if(other=="driver"&&target.endsWith("/demo.ets"))violations.push({kind:"layer",file,target,message:`${file} importa la entrada ${target}`});
      else if(layers.indexOf(other)>layers.indexOf(layer))violations.push({kind:"layer",file,target,message:`${file} (${layer}) importa ${target} (${other}): una capa solo puede importar de sí misma o de las de debajo`});
      else if(layer=="backend-cpp"&&other=="ir"&&!backendFromIr.has(target))violations.push({kind:"layer",file,target,message:`${file} (backend-cpp) importa ${target}: de ir/ solo puede usar ${[...backendFromIr].join(", ")}`});
    }
  }
  // Ciclos entre archivos (DFS iterativo con colores).
  const color=new Map<string,number>();
  for(const start of graph.keys()){
    if(color.get(start))continue;
    const stack:[string,number][]=[[start,0]];const path:string[]=[start];color.set(start,1);
    while(stack.length){
      const top=stack[stack.length-1];const next=(graph.get(top[0])??[])[top[1]];
      if(next===undefined){color.set(top[0],2);stack.pop();path.pop();continue;}
      top[1]++;
      if(!graph.has(next))continue;
      const state=color.get(next)??0;
      if(state==1){const cycle=[...path.slice(path.indexOf(next)),next];violations.push({kind:"cycle",file:next,message:`ciclo de imports: ${cycle.join(" → ")}`});}
      else if(state==0){color.set(next,1);stack.push([next,0]);path.push(next);}
    }
  }
  return {files:files.length,edges,violations};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const root=join(dirname(fileURLToPath(import.meta.url)),"..");
  const result=audit(root);
  if(process.argv.includes("--json"))console.log(JSON.stringify(result,null,2));
  else{
    for(const violation of result.violations)console.error("✗ "+violation.message);
    console.log(result.violations.length?`✗ capas: ${result.violations.length} violaciones en ${result.files} módulos`:`✓ capas: ${result.files} módulos, ${result.edges} imports, sin subidas de capa ni ciclos`);
  }
  process.exit(result.violations.length?1:0);
}
