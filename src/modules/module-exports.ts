import type { Program, Statement } from "../ast/nodes.ts";
import type { Span } from "../core/span.ts";
import type { LoadedModule } from "./module-loader.ts";
import { DiagnosticError } from "../core/diagnostic.ts";

export type ExportTarget={kind:"binding";file:string;name:string;pending?:boolean;span?:Span}|{kind:"namespace";file:string};
export type ExportTables=Map<string,Map<string,ExportTarget>>;
type ModuleProgram={module:LoadedModule;ast:Program};
const location=(line:number):Span=>({start:{offset:0,line,column:1},end:{offset:0,line,column:2}});

/** Resolve public names to their declaration identity. Re-exporting neither
 * duplicates a declaration nor injects a binding into the barrel's scope. */
export function resolveModuleExports(programs:ModuleProgram[]):ExportTables {
  const tables:ExportTables=new Map();
  const declarations=new Map<string,Map<string,any[]>>();
  const defaults=new Map<string,{name:string;span:Span}[]>();
  const fail=(module:LoadedModule,span:Span,code:string,message:string):never=>{throw new DiagnosticError([{phase:"semantic",code,message,span,file:module.file,source:module.source}]);};
  for(const {module,ast} of programs) {
    const occupied=new Set(module.source.match(/[A-Za-z_$][\w$]*/g) ?? []);
    let nextDefault=0;
    const entries:{name:string;span:Span}[]=[];
    ast.statements=ast.statements.map(statement=>{
      if(statement.kind !== "ExportDefaultDeclaration") return statement;
      let declaration=statement.declaration as any;
      if(!declaration.kind.endsWith("Declaration")) {
        let name:string;do {name=`ets_default_value_${nextDefault++}`;} while(occupied.has(name));occupied.add(name);
        declaration={kind:"VariableDeclaration",name,mutable:false,initializer:declaration,span:{...statement.span,moduleDefault:true}};
      }
      declaration.exported=true;declaration.span={...declaration.span,moduleDefault:true};
      entries.push({name:declaration.name,span:statement.span});return declaration as Statement;
    });
    defaults.set(module.file,entries);
    const own=new Map<string,any[]>();
    for(const statement of ast.statements as any[]) if(statement.name) own.set(statement.name,[...(own.get(statement.name) ?? []),statement]);
    declarations.set(module.file,own);
  }
  const get=(file:string,name:string,module:LoadedModule,span:Span):ExportTarget=>{
    const target=tables.get(file)?.get(name);
    if(!target) {
      if(declarations.get(file)?.has(name)) fail(module,span,"MODULE_EXPORT_PRIVATE",`El símbolo '${name}' es privado y no puede importarse`);
      fail(module,span,"MODULE_EXPORT_MISSING",`El módulo importado no declara '${name}' como export`);
    }
    return target;
  };
  for(const {module,ast} of programs) {
    const table=new Map<string,ExportTarget>(), explicit=new Set<string>();
    const hasGenerator=(file:string,name:string)=>declarations.get(file)?.get(name)?.some(node=>node.kind === "FunctionDeclaration" && node.decorators?.some((d:any)=>d.name === "etsgen"));
    const canGenerate=[...declarations.get(module.file)!.keys()].some(name=>hasGenerator(module.file,name)) || module.imports.filter(item=>!item.reexport).some(entry=>{
      if(entry.namespace) return [...namespaceExports(tables,entry.dependency).values()].some(target=>target.pending || hasGenerator(target.file,target.name));
      return (entry.bindings ?? entry.names.map(name=>({imported:name,local:name}))).some(binding=>{
        const target=tables.get(entry.dependency)?.get(binding.imported);
        return target?.kind === "binding" ? target.pending || hasGenerator(target.file,target.name) : target?.kind === "namespace" && [...namespaceExports(tables,target.file).values()].some(leaf=>leaf.pending || hasGenerator(leaf.file,leaf.name));
      });
    });
    const add=(name:string,target:ExportTarget,span:Span)=>{
      if(explicit.has(name)) fail(module,span,"MODULE_EXPORT_DUPLICATE",`Export duplicado '${name}'`);
      explicit.add(name);table.set(name,target);
      if(target.kind === "binding") for(const declaration of declarations.get(target.file)?.get(target.name) ?? []) declaration.exported=true;
    };
    for(const [name,group] of declarations.get(module.file)!) if(group.some(node=>node.exported && !node.span.moduleDefault)) {
      if(group.some(node=>!node.exported)) fail(module,group[0].span,"MODULE_EXPORT_VISIBILITY",`Todas las sobrecargas de '${name}' deben usar la misma visibilidad`);
      add(name,{kind:"binding",file:module.file,name},group[0].span);
    }
    for(const entry of defaults.get(module.file)!) add("default",{kind:"binding",file:module.file,name:entry.name},entry.span);
    for(const entry of module.exports ?? []) {
      let target:ExportTarget|undefined;
      if(declarations.get(module.file)!.has(entry.name)) target={kind:"binding",file:module.file,name:entry.name};
      else {
        for(const imported of module.imports.filter(item=>!item.reexport)) {
          if(imported.namespace === entry.name) target={kind:"namespace",file:imported.dependency};
          const binding=(imported.bindings ?? imported.names.map(name=>({imported:name,local:name}))).find(item=>item.local === entry.name);
          if(binding) target=get(imported.dependency,binding.imported,module,entry.span);
        }
      }
      if(!target && canGenerate) target={kind:"binding",file:module.file,name:entry.name,pending:true,span:entry.span};
      if(!target) fail(module,entry.span,"MODULE_EXPORT_MISSING",`No existe el binding local '${entry.name}' que se quiere exportar`);
      add(entry.exported,target,entry.span);
    }
    for(const entry of module.imports.filter(item=>item.reexport && !item.star)) {
      if(entry.namespace) add(entry.namespace,{kind:"namespace",file:entry.dependency},location(entry.line));
      else for(const binding of entry.bindings ?? []) add(binding.local,get(entry.dependency,binding.imported,module,location(entry.line)),location(entry.line));
    }
    for(const entry of module.imports.filter(item=>item.reexport && item.star)) {
      for(const [name,target] of tables.get(entry.dependency)!) {
        if(name === "default" || explicit.has(name)) continue;
        const old=table.get(name);
        if(old && (old.kind !== target.kind || old.file !== target.file || (old.kind === "binding" && target.kind === "binding" && old.name !== target.name))) fail(module,location(entry.line),"MODULE_EXPORT_AMBIGUOUS",`El re-export '${name}' es ambiguo; usa un export explícito`);
        table.set(name,target);
      }
    }
    tables.set(module.file,table);
  }
  return tables;
}

export function namespaceExports(tables:ExportTables,file:string,prefix=""):Map<string,Extract<ExportTarget,{kind:"binding"}>> {
  const result=new Map<string,Extract<ExportTarget,{kind:"binding"}>>();
  for(const [name,target] of tables.get(file) ?? []) {
    if(target.kind === "binding") result.set(prefix+name,target);
    else for(const [path,binding] of namespaceExports(tables,target.file,prefix+name+".")) result.set(path,binding);
  }
  return result;
}
