import { ParserToken, AstNode, ParseResult } from "../parser/parser";
import { SourceDiagnostic, SourceResult, quoteSource, formatSource, formatDiagnostic } from "../frontend/frontend";
import { canonicalFile, readSnapshot } from "./platform";
import { SyntaxCache, CachedSource, FileRecord } from "./syntax-cache";

export class PathAlias {
  name: string; target: string;
  constructor(name: string, target: string) { this.name = name; this.target = normalizePath(target); }
}
export class LoaderOptions {
  roots: string[]; aliases: PathAlias[]; cacheDirectory: string; syntaxKey: string;
  constructor() { this.roots = []; this.aliases = []; this.cacheDirectory = ""; this.syntaxKey = ""; }
}
export class ModuleRequest {
  specifier: string; node: number; kind: string; typeOnly: boolean; dependency: string;
  constructor(node: AstNode, nodeIndex: number) {
    this.specifier = node.get("source"); this.node = nodeIndex; this.kind = node.kind;
    this.typeOnly = node.get("typeOnly") == "true"; this.dependency = "";
  }
}
export class LoadedFile {
  file: string; cached: CachedSource; requests: ModuleRequest[]; dependencies: string[]; state: number; cursor: number;
  constructor(file: string, cached: CachedSource) {
    this.file = file; this.cached = cached; this.requests = []; this.dependencies = []; this.state = 1; this.cursor = 0;
    if (cached.result.success) {
      // Only direct program declarations create graph edges. Symbol aliases stay
      // in the syntax arena for the later binder; type-only edges still load.
      for (const edge of cached.result.ast.nodes[cached.result.ast.root].edges) {
        const node: AstNode = cached.result.ast.nodes[edge.node];
        if (node.kind == "ImportDeclaration" || node.kind == "ExportNamedDeclaration" || node.kind == "ExportAllDeclaration") {
          let hasSource: boolean = false;
          for (const attr of node.attributes) { if (attr.name == "source") hasSource = true; }
          if (hasSource) this.requests.push(new ModuleRequest(node, edge.node));
        }
      }
    }
  }
}
export class GeneratedSource {
  id: string; module: number; call: number; generatorModule: number; generator: number; parentId: string; source: string; start: ParserToken; end: ParserToken;
  constructor(id: string, module: number, call: number, generatorModule: number, generator: number, parentId: string, source: string, start: ParserToken, end: ParserToken) {
    this.id = id; this.module = module; this.call = call; this.generatorModule = generatorModule; this.generator = generator; this.parentId = parentId; this.source = source; this.start = start; this.end = end;
  }
}
export class ModuleGraph {
  generatedSources: GeneratedSource[]; entry: string; modules: LoadedFile[]; diagnostics: SourceDiagnostic[]; hits: number; misses: number; writes: number; success: boolean;
  constructor(entry: string) {
    this.generatedSources = []; this.entry = entry; this.modules = []; this.diagnostics = []; this.hits = 0; this.misses = 0; this.writes = 0; this.success = true;
  }
}
export function originToken(): ParserToken { return new ParserToken("", "", 0, 1, 1, 0, 1, 1); }
function hasExtension(file: string): boolean {
  let base: number = 0; let dot: number = -1;
  for (let i: number = 0; i < file.length; i = i + 1) {
    if (file.charAt(i) == "/") { base = i + 1; dot = -1; }
    else if (file.charAt(i) == ".") dot = i;
  }
  return dot > base;
}
export function resolveSourceFile(requested: string): string {
  if (hasExtension(requested)) return canonicalFile(requested);
  const ts: string = canonicalFile(requested + ".ts");
  return ts != "" ? ts : canonicalFile(requested + ".ets");
}
function requestedPath(base: string, specifier: string): string {
  if (specifier == "") return normalizePath(base);
  return normalizePath(specifier.startsWith("/") ? specifier : base + "/" + specifier);
}
export function resolveRequest(file: string, specifier: string, options: LoaderOptions): string {
  if (specifier == "") return "";
  if (specifier.startsWith(".") || specifier.startsWith("/")) return resolveSourceFile(requestedPath(pathDirectory(file), specifier));
  let selected: number = -1; let longest: number = -1;
  for (let i: number = 0; i < options.aliases.length; i = i + 1) {
    const name: string = options.aliases[i].name;
    if ((specifier == name || specifier.startsWith(name + "/")) && name.length > longest) { selected = i; longest = name.length; }
  }
  if (selected >= 0) {
    const alias: PathAlias = options.aliases[selected];
    const suffix: string = specifier == alias.name ? "" : specifier.slice(alias.name.length + 1, specifier.length);
    return resolveSourceFile(requestedPath(alias.target, suffix));
  }
  for (const root of options.roots) {
    const resolved: string = resolveSourceFile(requestedPath(root, specifier)); if (resolved != "") return resolved;
  }
  return "";
}
export function readModule(file: string, out graph: ModuleGraph, out cache: SyntaxCache): LoadedFile {
    const snapshot: string[] = readSnapshot(file); const source: string = snapshot[0];
    const error: string = snapshot[1]; const before: string = snapshot[2];
    if (error != "") {
      graph.diagnostics.push(new SourceDiagnostic("loader", error, file, originToken()));
      // No failed I/O or partial read may enter the syntax cache.
      let failed: CachedSource = new CachedSource(new SourceResult(file, [], new ParseResult(-1, [], []), [], false), new FileRecord(file, "", "", ""), false);
      failed.record.syntax = ""; failed.result.success = false;
      return new LoadedFile(file, failed);
    }
    const after: string = snapshot[3];
    if (before == "" || before != after) {
      graph.diagnostics.push(new SourceDiagnostic("loader", "El archivo cambió durante la lectura; vuelve a intentarlo", file, originToken()));
      let unstable: CachedSource = new CachedSource(new SourceResult(file, [], new ParseResult(-1, [], []), [], false), new FileRecord(file, "", "", ""), false);
      unstable.record.syntax = ""; unstable.result.success = false; return new LoadedFile(file, unstable);
    }
    const cached: CachedSource = cache.getOrParseModule(file, source, after);
    for (const diagnostic of cached.result.diagnostics) graph.diagnostics.push(diagnostic);
    return new LoadedFile(file, cached);
  }

export class ModuleLoader {
  options: LoaderOptions; cache: SyntaxCache;
  constructor(options: LoaderOptions) { this.options = options; this.cache = new SyntaxCache(options.cacheDirectory, options.syntaxKey); }
  load(entry: string): ModuleGraph {
    let cache: SyntaxCache = this.cache; cache.resetStats(); const canonical: string = resolveSourceFile(normalizePath(entry)); let graph: ModuleGraph = new ModuleGraph(canonical);
    if (canonical == "") {
      graph.diagnostics.push(new SourceDiagnostic("loader", "No se puede resolver el módulo '" + entry + "' (se probaron .ts y .ets)", normalizePath(entry), originToken()));
      graph.success = false; this.cache = cache; return graph;
    }
    let discovered: LoadedFile[] = [readModule(canonical, graph, cache)]; let stack: number[] = [0];
    // An explicit DFS stack handles deep graphs without recursive native calls.
    // Discovery/dedup is separate from grey-node cycle detection.
    while (stack.length > 0) {
      const index: number = stack[stack.length - 1]; let module: LoadedFile = discovered[index];
      if (module.cursor >= module.requests.length) {
        module.state = 2; discovered[index] = module; module.cached.record.dependencies = module.dependencies;
        cache.save(module.cached.record); graph.modules.push(module); stack.pop();
      } else {
        let request: ModuleRequest = module.requests[module.cursor]; module.cursor = module.cursor + 1;
        // Deliberately re-probe paths each load: new higher-priority candidates,
        // removals, aliases, roots and symlinks invalidate routes, never syntax.
        const dependency: string = resolveRequest(module.file, request.specifier, this.options);
        const token: ParserToken = module.cached.result.ast.nodes[request.node].start;
        discovered[index] = module;
        if (dependency == "") {
          graph.diagnostics.push(new SourceDiagnostic("resolver", "No se puede resolver el import '" + request.specifier + "' desde " + module.file, module.file, token));
        } else {
          request.dependency = dependency; module.requests[module.cursor - 1] = request;
          if (!module.dependencies.includes(dependency)) module.dependencies.push(dependency);
          discovered[index] = module;
          let existing: number = -1;
          for (let i: number = 0; i < discovered.length; i = i + 1) { if (discovered[i].file == dependency) { existing = i; break; } }
          if (existing < 0) { discovered.push(readModule(dependency, graph, cache)); stack.push(discovered.length - 1); }
          else if (discovered[existing].state == 1) {
            let cycle: string[] = []; let started: boolean = false;
            for (const active of stack) {
              if (active == existing) started = true;
              if (started) cycle.push(discovered[active].file);
            }
            cycle.push(dependency);
            graph.diagnostics.push(new SourceDiagnostic("resolver", "Ciclo de imports: " + cycle.join(" -> "), module.file, token));
          }
        }
      }
    }
    graph.hits = cache.hits; graph.misses = cache.misses; graph.writes = cache.writes;
    graph.success = graph.diagnostics.length == 0; this.cache = cache; return graph;
  }
}
export function formatGraph(graph: ModuleGraph): string {
  let parts: string[] = ["{\"entry\":" + quoteSource(graph.entry) + ",\"success\":" + (graph.success ? "true" : "false")
    + ",\"cache\":{\"hits\":" + numberToString(graph.hits) + ",\"misses\":" + numberToString(graph.misses) + ",\"writes\":" + numberToString(graph.writes) + "},\"modules\":["];
  let separator: string = "";
  for (const module of graph.modules) {
    parts.push(separator + "{\"file\":" + quoteSource(module.file) + ",\"hash\":" + quoteSource(module.cached.record.hash)
      + ",\"metadata\":" + quoteSource(module.cached.record.metadata) + ",\"reused\":" + (module.cached.reused ? "true" : "false") + ",\"dependencies\":[");
    let comma: string = "";
    for (const dependency of module.dependencies) { parts.push(comma + quoteSource(dependency)); comma = ","; }
    parts.push("],\"requests\":["); comma = "";
    for (const request of module.requests) {
      parts.push(comma + "{\"specifier\":" + quoteSource(request.specifier) + ",\"kind\":" + quoteSource(request.kind)
        + ",\"typeOnly\":" + (request.typeOnly ? "true" : "false") + ",\"node\":" + numberToString(request.node) + ",\"dependency\":" + quoteSource(request.dependency) + "}"); comma = ",";
    }
    parts.push("],\"source\":" + formatSource(module.cached.result) + "}"); separator = ",";
  }
  parts.push("],\"diagnostics\":["); separator = "";
  for (const diagnostic of graph.diagnostics) {
    parts.push(separator + formatDiagnostic(diagnostic)); separator = ",";
  }
  parts.push("]}"); return parts.join("");
}
