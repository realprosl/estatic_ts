import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { parse, analyze } from "../compiler.ts";
import { CppGenerator } from "../codegen/cpp-generator.ts";
import { DiagnosticError, withGeneratedSource, type Diagnostic } from "../core/diagnostic.ts";
import { validateModuleVisibility } from "./module-visibility.ts";
import { declaredNames, validateModuleSymbolCollisions } from "./module-symbols.ts";
import { detectRuntimeBackends, type RuntimeBackends } from "./runtime-backends.ts";
import { computeModuleId, assertUniqueIdentities, type ModuleIdentity } from "./module-identity.ts";
import { bindModuleNames, referencedGlobals, type NamespaceBindings } from "./module-bindings.ts";
import { scanModuleSyntax, type LocalExport } from "./module-syntax.ts";
import { resolveModuleExports, namespaceExports, type ExportTarget } from "./module-exports.ts";
import type { Program, Statement } from "../ast/nodes.ts";
import { getTs2cppRevision, getTs2cppVersion } from "../core/ts2cpp-version.ts";
import { performance } from "node:perf_hooks";
import { BuildProfile } from "../build/build-profile.ts";
import { fingerprintModules, type ModuleFingerprint } from "./module-fingerprints.ts";

// Module declarations are discovered from lexer tokens, including multiline lists.

/** V15: nombre de init estable basado en el nombre del archivo. Si el
 * módulo cambia su contenido, el init mantiene el mismo nombre — así
 * `main.cpp` no se invalida cada vez que una dependencia cambia.
 *
 * V30.6.1: delegado a `computeModuleId` (H-02 del informe de revision).
 * Antes, dos `index.ts` en carpetas distintas colisionaban en
 * `ets_init_index`. Ahora la ruta completa + hash garantiza unicidad. */
function stableInitName(moduleFile: string, baseDirectory: string): string {
  return computeModuleId(moduleFile, baseDirectory).initName;
}

export interface ModuleCompilationResult {
  ast: import("../ast/nodes.ts").Program;
  header: string;
  modules: { name: string; cpp: string }[];
  moduleNames: string[];
  /** V18: link flags y headers externos detectados por decoradores. */
  linkFlags: string[];
  externalHeaders: string[];
  /** V30.6.0: backends runtime que el programa necesita (libuv, curl, tls, io_uring).
   * Detectado mirando el AST, no escaneando includes del cpp (mas fiable). */
  runtimeBackends: RuntimeBackends;
  /** Estadísticas de la caché persistente del frontend. */
  transpilationCache?: { parsedHits: number; parsedMisses: number };
  semanticFingerprints?: ModuleFingerprint[];
}
export interface ModuleLoaderOptions {
  moduleRoots?: string[];
  aliases?: Record<string, string>;
  minimal?: boolean;
  /** V30.6.1: raíz para derivar la identidad estable de módulo (H-01/H-02). */
  baseDirectory?: string;
  /** Directorio opcional para ASTs parseados, indexados por contenido. */
  transpilationCacheDirectory?: string;
  profile?: BuildProfile;
}

export interface ModuleImport { names: string[]; bindings?: {imported:string;local:string}[]; namespace?:string; reexport?:boolean; star?:boolean; resolved?:boolean; dependency: string; line: number }
export interface LoadedModule { file: string; source: string; dependencies: string[]; imports: ModuleImport[]; exports?: LocalExport[]; hash: string }
export interface ModuleGraph {
  entry: string;
  modules: LoadedModule[];
  baseDirectory: string;
  frontendCache?: { syntaxHits: number; syntaxMisses: number };
}

const MODULE_SYNTAX_CACHE_VERSION = 1;
const compilerCacheIdentity = () => `${getTs2cppVersion()}:${getTs2cppRevision() ?? "dev"}`;
async function scanCachedModule(source: string, directory: string | undefined, stats: { syntaxHits: number; syntaxMisses: number }): Promise<ReturnType<typeof scanModuleSyntax>> {
  if (!directory) {
    stats.syntaxMisses++;
    return scanModuleSyntax(source);
  }
  const key = createHash("sha256").update(`module-syntax:${MODULE_SYNTAX_CACHE_VERSION}:${compilerCacheIdentity()}\0`).update(source).digest("hex");
  const syntaxDirectory = resolve(directory, "syntax");
  const cacheFile = resolve(syntaxDirectory, `${key}.json`);
  try {
    const cached = JSON.parse(await readFile(cacheFile, "utf8")) as { version?: number; syntax?: ReturnType<typeof scanModuleSyntax> };
    if (cached.version === MODULE_SYNTAX_CACHE_VERSION && typeof cached.syntax?.source === "string" && Array.isArray(cached.syntax.requests) && Array.isArray(cached.syntax.exports)) {
      stats.syntaxHits++;
      return cached.syntax;
    }
  } catch {
    // Miss normal o entrada incompleta.
  }
  const syntax = scanModuleSyntax(source);
  stats.syntaxMisses++;
  try {
    await mkdir(syntaxDirectory, { recursive: true });
    const temporary = `${cacheFile}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: MODULE_SYNTAX_CACHE_VERSION, syntax }), "utf8");
    await rename(temporary, cacheFile);
  } catch {
    // La caché no forma parte de la semántica del programa.
  }
  return syntax;
}

async function resolveSourceFile(requested: string): Promise<string | undefined> {
  const candidates = extname(requested) ? [requested] : [`${requested}.ts`, `${requested}.ets`];
  for (const candidate of candidates) {
    try { return await realpath(candidate); }
    catch {}
  }
  return undefined;
}

export async function loadModuleGraph(entry: string, options: ModuleLoaderOptions = {}): Promise<ModuleGraph> {
  const ordered: LoadedModule[] = [];
  const visited = new Set<string>();
  const visiting: string[] = [];
  const frontendCache = { syntaxHits: 0, syntaxMisses: 0 };
  // V30.6.1: baseDirectory se usa para derivar la identidad estable de
  // modulo (computeModuleId). Si no se pasa, usamos dirname(entry).
  const baseDirectory = options.baseDirectory ?? dirname(entry);

  const visit = async (requested: string): Promise<string> => {
    const file = await resolveSourceFile(requested);
    if (!file) throw new Error(`No se puede resolver el módulo '${requested}' (se probaron .ts y .ets)`);
    if (visited.has(file)) return file;
    const cycleIndex = visiting.indexOf(file);
    if (cycleIndex >= 0) throw new Error(`Ciclo de imports: ${[...visiting.slice(cycleIndex), file].join(" -> ")}`);
    visiting.push(file);
    const source = await readFile(file, "utf8");
    let syntax:ReturnType<typeof scanModuleSyntax>;
    try {syntax=await scanCachedModule(source, options.transpilationCacheDirectory, frontendCache);}
    catch(error) {if(!(error instanceof DiagnosticError)) throw error;throw new DiagnosticError(error.diagnostics.map(d=>({...d,file,source})));}
    const dependencies:string[]=[], imports:ModuleImport[]=[];
    for(const request of syntax.requests) {
      const {specifier,...metadata}=request;
      let dependency: string | undefined;
      if (specifier.startsWith(".")) dependency = resolve(dirname(file), specifier);
      else {
        const alias = Object.entries(options.aliases ?? {}).sort(([left], [right]) => right.length - left.length).find(([name]) => specifier === name || specifier.startsWith(`${name}/`));
        if (alias) dependency = resolve(alias[1], specifier === alias[0] ? "" : specifier.slice(alias[0].length + 1));
        else {
          for (const root of options.moduleRoots ?? []) {
            const candidate = resolve(root, specifier);
            dependency = await resolveSourceFile(candidate);
            if (dependency) break;
          }
        }
      }
      if (!dependency) throw new Error(`No se puede resolver el import '${specifier}' desde ${file}`);
      const resolvedDependency = await visit(dependency);
      dependencies.push(resolvedDependency);
      imports.push({...metadata,dependency:resolvedDependency});
    }
    const strippedSource=syntax.source;
    // V15: nombre de inicializador estable (basado en el nombre del archivo,
    // no en un hash del source). Así, si un módulo cambia su source, su init
    // mantiene el mismo nombre y main.cpp no se invalida. El init solo cambia
    // si el módulo se RENOMBRA o se AÑADE uno nuevo.
    const moduleHash = createHash("sha256").update(strippedSource).update(JSON.stringify([imports,syntax.exports])).digest("hex").slice(0, 16);
    visiting.pop();
    visited.add(file);
    ordered.push({ file, source: strippedSource, dependencies, imports, exports:syntax.exports, hash: moduleHash });
    return file;
  };

  const resolvedEntry = await visit(resolve(entry));
  return { entry: resolvedEntry, modules: ordered, baseDirectory, frontendCache };
}

const PARSED_AST_CACHE_VERSION = 1;

async function parseCachedModule(module: LoadedModule, directory: string | undefined, stats: { parsedHits: number; parsedMisses: number }): Promise<Program> {
  if (!directory) {
    stats.parsedMisses++;
    return parse(module.source);
  }
  const key = createHash("sha256")
    .update(`parsed-ast:${PARSED_AST_CACHE_VERSION}:${compilerCacheIdentity()}\0`)
    .update(module.source)
    .digest("hex");
  const parsedDirectory = resolve(directory, "ast");
  const cacheFile = resolve(parsedDirectory, `${key}.json`);
  try {
    const cached = JSON.parse(await readFile(cacheFile, "utf8")) as { version?: number; ast?: Program };
    if (cached.version === PARSED_AST_CACHE_VERSION && cached.ast?.kind === "Program" && Array.isArray(cached.ast.statements)) {
      stats.parsedHits++;
      return cached.ast;
    }
  } catch {
    // Un miss o una entrada corrupta nunca debe impedir compilar.
  }
  const ast = parse(module.source);
  stats.parsedMisses++;
  try {
    await mkdir(parsedDirectory, { recursive: true });
    const temporary = `${cacheFile}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: PARSED_AST_CACHE_VERSION, ast }), "utf8");
    await rename(temporary, cacheFile);
  } catch {
    // La caché es una optimización: un filesystem de solo lectura no cambia el resultado.
  }
  return ast;
}

/** Compila un grafo ya cargado. El incremental evita así resolver y escanear imports dos veces. */
export async function compileModuleGraph(graph: ModuleGraph, options: ModuleLoaderOptions = {}): Promise<ModuleCompilationResult> {
  const profile = options.profile ?? new BuildProfile();
  let phaseStart = performance.now();
  const ordered = graph.modules;
  const baseDirectory = graph.baseDirectory;
  const cacheStats = { parsedHits: 0, parsedMisses: 0 };
  const visibilityPrograms = await Promise.all(ordered.map(async module => {
    try { return { module, ast: await parseCachedModule(module, options.transpilationCacheDirectory, cacheStats) }; }
    catch (error) {
      if (!(error instanceof DiagnosticError)) throw error;
      throw new DiagnosticError(error.diagnostics.map(diagnostic => ({ ...diagnostic, file: module.file, source: module.source })));
    }
  }));
  profile.record("restore-or-parse", phaseStart);
  phaseStart = performance.now();
  const surfaces=resolveModuleExports(visibilityPrograms);
  validateModuleVisibility(visibilityPrograms,surfaces);
  profile.record("resolve-exports", phaseStart);
  const semanticFingerprints = profile.measure("fingerprints", () => fingerprintModules(graph, visibilityPrograms, surfaces));
  phaseStart = performance.now();
  const canonical=new Map<string,string>();
  const occupied=new Set(ordered.flatMap(module=>module.source.match(/[A-Za-z_$][\w$]*/g) ?? []));
  let nextBinding=0;
  const key=(file:string,name:string)=>`${file}\0${name}`;
  const allocate=(file:string,name:string):string=>{
    const identity=key(file,name);const previous=canonical.get(identity);if(previous) return previous;
    let result:string;do {result=`ets_import_${nextBinding++}_${name}`;} while(occupied.has(result));
    occupied.add(result);canonical.set(identity,result);return result;
  };
  // Isolate homonymous source bindings before combining module ASTs. Preserve
  // unambiguous names for existing tooling; overloads in one module share an identity.
  const sourceOwners=new Map<string,Set<string>>();
  for(const {module,ast} of visibilityPrograms) for(const statement of ast.statements)
    for(const name of declaredNames(statement)) {
      const owners=sourceOwners.get(name) ?? new Set<string>();
      owners.add(module.file);sourceOwners.set(name,owners);
    }
  for(const [name,owners] of sourceOwners) if(owners.size > 1 || name === "console")
    for(const file of owners) allocate(file,name);
  for(const table of surfaces.values()) for(const [publicName,target] of table) {
    if(target.kind === "binding" && (publicName !== target.name || target.pending)) allocate(target.file,target.name);
    if(target.kind === "namespace") for(const binding of namespaceExports(surfaces,target.file).values()) allocate(binding.file,binding.name);
  }
  for(const module of ordered) for(const entry of module.imports.filter(item=>item.reexport)) {
    if(entry.star || entry.namespace) for(const target of namespaceExports(surfaces,entry.dependency).values()) allocate(target.file,target.name);
    else for(const binding of entry.bindings ?? []) {
      const target=surfaces.get(entry.dependency)!.get(binding.imported)!;
      if(target.kind === "binding") allocate(target.file,target.name);
      else for(const leaf of namespaceExports(surfaces,target.file).values()) allocate(leaf.file,leaf.name);
    }
  }
  for(const module of ordered) for(const entry of module.imports.filter(item=>!item.reexport)) {
    for(const binding of entry.bindings ?? entry.names.map(name=>({imported:name,local:name}))) {
      const target=surfaces.get(entry.dependency)!.get(binding.imported)!;
      if(target.kind === "binding" && binding.local !== target.name) allocate(target.file,target.name);
      if(target.kind === "namespace") for(const leaf of namespaceExports(surfaces,target.file).values()) allocate(leaf.file,leaf.name);
    }
    if(entry.namespace) for(const target of namespaceExports(surfaces,entry.dependency).values()) allocate(target.file,target.name);
  }
  const plans=ordered.map(module=>{
    const own:Record<string,string>=Object.create(null), imports:Record<string,string>=Object.create(null), namespaces:NamespaceBindings=Object.create(null), publications:Record<string,string>=Object.create(null);
    for(const [identity,target] of canonical) if(identity.startsWith(module.file+"\0")) own[identity.slice(module.file.length+1)]=target;
    for(const table of surfaces.values()) for(const target of table.values()) if(target.kind === "binding" && target.pending && target.file === module.file) publications[target.name]=canonical.get(key(target.file,target.name))!;
    const resolvedImports:ModuleImport[]=[];
    const permission=(target:Extract<ExportTarget,{kind:"binding"}>,line:number)=>{
      const name=canonical.get(key(target.file,target.name)) ?? target.name;
      resolvedImports.push({names:[name],dependency:target.file,line,resolved:true});return name;
    };
    const namespace=(local:string,file:string,line:number)=>{
      const members:Record<string,string>=Object.create(null);
      for(const [path,target] of namespaceExports(surfaces,file)) members[path]=permission(target,line);
      namespaces[local]=members;
    };
    for(const entry of module.imports.filter(item=>!item.reexport)) {
      for(const binding of entry.bindings ?? entry.names.map(name=>({imported:name,local:name}))) {
        const target=surfaces.get(entry.dependency)!.get(binding.imported)!;
        if(target.kind === "binding") imports[binding.local]=permission(target,entry.line);
        else namespace(binding.local,target.file,entry.line);
      }
      if(entry.namespace) namespace(entry.namespace,entry.dependency,entry.line);
    }
    return {own,imports,namespaces,publications,resolvedModule:{...module,imports:resolvedImports}};
  });
  visibilityPrograms.forEach(({ast,module},index)=>{
    try {bindModuleNames(ast,plans[index].own,plans[index].imports,plans[index].namespaces,undefined,plans[index].publications);}
    catch(error) {if(!(error instanceof DiagnosticError)) throw error;throw new DiagnosticError(error.diagnostics.map(d=>({...d,file:module.file,source:module.source})));}
  });
  // Preserve original file/span metadata and stop before overload collection
  // or compile-time evaluation can merge unrelated module-local symbols.
  validateModuleSymbolCollisions(visibilityPrograms);
  const ranges: Array<{ file: string; source: string; start: number; end: number; startOffset: number }> = [];
  let nextLine = 1;
  let nextOffset = 0;
  for (const module of ordered) {
    const header = `// module: ${module.file}`;
    nextLine++;
    nextOffset += header.length + 1;
    const count = module.source.split(/\r?\n/).length;
    ranges.push({ file: module.file, source: module.source, start: nextLine, end: nextLine + count - 1, startOffset: nextOffset });
    nextLine += count;
    nextOffset += module.source.length + 1;
  }
  try {
    // Combine the already parsed/normalized ASTs, preserving source offsets.
    // Re-parsing text here would lose export identity and default normalization.
    const combinedModules=visibilityPrograms.map(({ast},index)=>{
      const copy=structuredClone(ast),range=ranges[index];
      const definitionImports=plans[index].resolvedModule.imports.flatMap(entry=>entry.names);
      const shift=(node:any):void=>{
        if(!node || typeof node !== "object") return;
        if(Array.isArray(node)) {node.forEach(shift);return;}
        if(node.span) node.span={...node.span,module:range.file,definitionImports,
          start:{...node.span.start,line:node.span.start.line+range.start-1,offset:node.span.start.offset+range.startOffset},
          end:{...node.span.end,line:node.span.end.line+range.start-1,offset:node.span.end.offset+range.startOffset}};
        for(const [key,value] of Object.entries(node)) if(key !== "span") shift(value);
      };
      shift(copy);return copy;
    });
    const astOriginal:Program={kind:"Program",statements:combinedModules.flatMap(module=>module.statements),span:{start:combinedModules[0].span.start,end:combinedModules.at(-1)!.span.end}};
    const validateGeneratedExports=(program:Program)=>{
      for(const [index,plan] of plans.entries()) for(const [name,emittedName] of Object.entries(plan.publications)) {
        const declaration=program.statements.find((node:any)=>node.name === emittedName && node.exported && node.span.module === ordered[index].file && node.span.generated && node.span.hygiene?.name === name);
        if(declaration) continue;
        const entry=ordered[index].exports!.find(entry=>entry.name === name)!;
        const range=ranges[index];
        throw new DiagnosticError([{phase:"semantic",code:"MODULE_GENERATED_EXPORT_MISSING",message:`La expansión no publicó '${name}' en el nivel superior del módulo`,span:{start:{...entry.span.start,line:entry.span.start.line+range.start-1,offset:entry.span.start.offset+range.startOffset},end:{...entry.span.end,line:entry.span.end.line+range.start-1,offset:entry.span.end.offset+range.startOffset}},hint:"Genera una declaración @etsPublish desde una llamada de nivel superior y conserva export { nombre }."}]);
      }
    };
    profile.record("module-binding", phaseStart);
    const { program: ast, checker } = analyze([astOriginal],{validateExpanded:validateGeneratedExports,profile});
    phaseStart = performance.now();
    // Expanded calls disappear from the AST. Check their retained provenance
    // too, so expansion cannot erase an otherwise invisible generator access.
    for(const source of ast.generatedSources ?? []) {
      const caller=ordered.findIndex(module=>module.file === source.callSpan.module);
      const declaration=ast.statements.find((node:any)=>node.kind === "FunctionDeclaration" && node.name === source.generator);
      if(caller < 0 || source.callSpan.etsgenDefinition || declaration?.span.module === source.callSpan.module) continue;
      if(plans[caller].resolvedModule.imports.some(entry=>entry.names.includes(source.generator))) continue;
      const diagnostic={phase:"semantic" as const,code:"MODULE_GENERATED_CALL_PRIVATE",message:`El generador '${source.generator}' pertenece a otro módulo; debe importarse explícitamente o seleccionarse con etsDefinition`,span:source.callSpan};
      throw new DiagnosticError([withGeneratedSource(diagnostic,ast.generatedSources)]);
    }
    for(const statement of ast.statements) if(statement.kind === "VariableDeclaration" && statement.span.moduleDefault && !statement.declaredType) statement.declaredType=checker.typeOf(statement.initializer);
    const expandedModules=ordered.map((module,index)=>({module:{...plans[index].resolvedModule,imports:plans[index].resolvedModule.imports.map(entry=>({...entry,line:entry.line+ranges[index].start-1}))},ast:{...ast,statements:ast.statements.filter(statement=>statement.span.start.line >= ranges[index].start && statement.span.start.line <= ranges[index].end)}}));
    try {
      validateModuleSymbolCollisions(expandedModules);
      validateModuleVisibility(expandedModules);
    } catch(error) {
      if(!(error instanceof DiagnosticError)) throw error;
      throw new DiagnosticError(error.diagnostics.map(d=>withGeneratedSource(d,ast.generatedSources)));
    }
    // Templates used from another translation unit need their body in the
    // common header, together with declarations of their lexical dependencies.
    const visitedTemplates=new Set<string>();
    while(true) {
      const pending=ast.statements.filter((node:any)=>node.kind === "FunctionDeclaration" && node.typeParameters.length && (node.exported || node.span.etsgenShared) && !visitedTemplates.has(node.name));
      if(!pending.length) break;
      const names=new Set(pending.map((node:any)=>node.name));names.forEach(name=>visitedTemplates.add(name));
      const dependencies=new Set([...referencedGlobals(ast,names).values()].flatMap(refs=>[...refs]));
      for(const declaration of ast.statements) if("name" in declaration && dependencies.has(declaration.name) && ["FunctionDeclaration","VariableDeclaration"].includes(declaration.kind)) declaration.span.etsgenShared=true;
    }
    for(const source of ast.generatedSources ?? []) {
      const range=ranges.find(range=>range.file === source.callSpan.module);
      if(range) source.originalCallSpan={start:{...source.callSpan.start,line:source.callSpan.start.line-range.start+1,offset:source.callSpan.start.offset-range.startOffset},end:{...source.callSpan.end,line:source.callSpan.end.line-range.start+1,offset:source.callSpan.end.offset-range.startOffset}};
    }
    profile.record("validate-expanded-modules", phaseStart);
    phaseStart = performance.now();
    const generator = new CppGenerator(
      expression => checker.typeOf(expression),
      expression => checker.isVariadic(expression),
      expression => checker.typeArgumentsOf(expression),
      name => checker.resolveTypeAliasFromAst(name),
      union => checker.resolveUnionAliasNameFromAst(union),
    );
    // V16: si el usuario quiere minimal, el header `estatic_common.hpp` no
    // incluye `ets_io.hpp`. El usuario es responsable de usar `std::cout`
    // directamente o añadir su propio include.
    generator.minimal = options.minimal ?? false;
    generator.prepareModules(ast);
    profile.record("codegen-prepare", phaseStart);
    const headerName = "estatic_common.hpp";
    const moduleInitializers = ordered.map(module => stableInitName(module.file, baseDirectory));
    const header = profile.measure("codegen-header", () => generator.generateHeader(ast, moduleInitializers));
    // V15: en vez de parsear cada módulo por separado (lo que produce ASTs
  // distintos que el type-checker no reconoce), filtramos el AST combinado
  // por rango de líneas del módulo. Así los nodos que `generateModule`
  // recibe SON los del AST combinado, y `expressionType` (que es un
  // callback al type-checker del AST combinado) los reconoce.
  const modules = ordered.map((module, index) => {
    const range = ranges[index];
    const moduleStatementsFromCombined = (ast.statements as Statement[]).filter(stmt => {
      const line = stmt.span.start.line;
      return line >= range.start && line <= range.end;
    });
    const moduleAst: Program = { kind: "Program", statements: moduleStatementsFromCombined, span: { start: ast.span.start, end: ast.span.end } };
    return {
      name: module.file,
      cpp: profile.measure("codegen-module", () => generator.generateModule(moduleAst, ast, headerName, stableInitName(module.file, baseDirectory), index === ordered.length - 1 ? moduleInitializers : undefined), module.file),
    };
  });
    return { ast, header, modules, moduleNames: ordered.map(m => m.file), linkFlags: generator.linkFlags, externalHeaders: generator.externalHeaders, runtimeBackends: detectRuntimeBackends(ast), transpilationCache: cacheStats, semanticFingerprints };
  } catch (error) {
    if (!(error instanceof DiagnosticError)) throw error;
    const diagnostics: Diagnostic[] = error.diagnostics.map(diagnostic => {
      const range = ranges.find(candidate => diagnostic.span.start.line >= candidate.start && diagnostic.span.start.line <= candidate.end);
      if (!range) return diagnostic;
      const lineOffset = range.start - 1;
      const plan=plans[ranges.indexOf(range)];
      const display=new Map<string,string>();
      for(const [identity,target] of canonical) display.set(target,identity.slice(identity.indexOf("\0")+1));
      for(const [local,target] of Object.entries(plan.imports)) display.set(target,local);
      const originalNames=(message:string)=>message.replace(/\bets_import_[A-Za-z0-9_]+\b/g,name=>display.get(name) ?? name);
      return {
        ...diagnostic, message:originalNames(diagnostic.message), ...(diagnostic.hint ? {hint:originalNames(diagnostic.hint)} : {}), ...(diagnostic.notes ? {notes:diagnostic.notes.map(originalNames)} : {}), ...(diagnostic.generated ? {generated:{...diagnostic.generated,generator:originalNames(diagnostic.generated.generator)}} : {}), file: range.file, source: range.source,
        span: {
          start: { ...diagnostic.span.start, line: diagnostic.span.start.line - lineOffset, offset: diagnostic.span.start.offset - range.startOffset },
          end: { ...diagnostic.span.end, line: diagnostic.span.end.line - lineOffset, offset: diagnostic.span.end.offset - range.startOffset }
        }
      };
    });
    throw new DiagnosticError(diagnostics);
  }
}

export async function compileFile(entry: string, options: ModuleLoaderOptions = {}): Promise<ModuleCompilationResult> {
  return compileModuleGraph(await loadModuleGraph(entry, options), options);
}
