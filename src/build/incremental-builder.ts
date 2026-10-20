import { writeGeneratedSources, writeMappedCpp } from "../codegen/etsgen-sources.ts";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResolvedConfig } from "../config/project-config.ts";
import { compileModuleGraph, loadModuleGraph, type ModuleCompilationResult, type ModuleGraph } from "../modules/module-loader.ts";
import { computeModuleId, assertUniqueIdentities } from "../modules/module-identity.ts";
import { getTs2cppRevision, getTs2cppVersion } from "../core/ts2cpp-version.ts";
import type { GeneratedSource } from "../core/span.ts";
import { performance } from "node:perf_hooks";
import { BuildProfile, type PhaseTiming } from "./build-profile.ts";
import { compareModuleFingerprints, type ModuleFingerprint, type ModuleChange } from "../modules/module-fingerprints.ts";

declare const process: { stderr: { write: (data: string) => void }; env: Record<string, string | undefined>; stdout: { write: (data: string) => void } };
declare const Buffer: { byteLength: (data: string) => number };
declare const setTimeout: (callback: () => void, ms: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

/**
 * Resultado del pipeline incremental.
 *
 * - `compiled`  módulos cuyo `.cpp` cambió y se recompilaron.
 * - `reused`    módulos cuyo hash coincide con la caché y se reutilizaron tal cual.
 * - `linked`    `true` si se ha vuelto a enlazar el binario en esta ejecución;
 *               `false` si el binario de la caché sigue siendo válido.
 * - `binary`    ruta absoluta del binario producido o reutilizado.
 * - `header`    ruta absoluta de la cabecera común (`estatic_common.hpp`)
 *               que todos los módulos incluyen.
 */
export interface IncrementalBuildResult {
  compiled: string[];
  reused: string[];
  linked: boolean;
  binary: string;
  header: string;
  /** Tiempo total del build en milisegundos. */
  durationMs: number;
  /** Resultado de la caché: 'hit' (todo reutilizado), 'miss' (regenerado), 'partial' (algunos módulos). */
  cacheResult: "hit" | "miss" | "partial";
  /** Reutilización previa a C++: snapshot completa o ASTs de módulos sin cambios. */
  transpilationCache: "hit" | "partial" | "miss";
  parsedModules: { reused: number; parsed: number };
  profile: { phases: PhaseTiming[]; totalsMs: Record<string, number>; report: string };
  moduleChanges: ModuleChange[];
}

/** Opciones del build incremental. */
export interface IncrementalBuildOptions {
  /** Si es true, imprime cada fase con su tiempo al stderr (estilo cargo). */
  verbose?: boolean;
}

/**
 * Reporter de progreso del build. Cuando verbose=true emite mensajes con
 * timing a stderr; cuando verbose=false es silencioso. Los tiempos se
 * pueden consultar externamente vía `lastElapsed()`.
 */
// V30.10: usa `cli-ui` para spinners/colores cuando stderr es TTY.
// En modo silencioso (no-TTY, CI) cae a texto plano.
import { phase, progressBar, info as uiInfo, warn as uiWarn, error as uiError, ok as uiOk, dim as uiDim, banner as uiBanner, useColors } from "../core/cli-ui.ts";
class BuildProgress {
  private readonly verbose: boolean;
  private phaseStart: number;
  private readonly startTime: number;
  private readonly colored: boolean;
  constructor(verbose: boolean) {
    this.verbose = verbose;
    this.startTime = Date.now();
    this.phaseStart = this.startTime;
    this.colored = useColors(process.stderr);
  }
  beginPhase(name: string): void {
    if (!this.verbose) return;
    const elapsed = ((Date.now() - this.phaseStart) / 1000).toFixed(2);
    const prefix = this.colored ? `\x1b[36m       \x1b[90m→\x1b[0m` : "       →";
    const nameColored = this.colored ? `\x1b[36m${name}\x1b[0m` : name;
    const elapsedColored = this.colored ? `\x1b[90m${elapsed}s\x1b[0m` : `${elapsed}s`;
    process.stderr.write(`${prefix} ${nameColored}... ${elapsedColored}\n`);
    this.phaseStart = Date.now();
  }
  log(message: string): void {
    if (!this.verbose) return;
    const indent = this.colored ? `\x1b[90m       ${message}\x1b[0m` : `       ${message}`;
    process.stderr.write(`${indent}\n`);
  }
  warn(message: string): void { uiWarn(`build: ${message}`); }
  error(message: string): void { uiError(`build: ${message}`); }
  totalElapsed(): number { return Date.now() - this.startTime; }
}

/**
 * Digest de los componentes globales al build:
 * flags del compilador y del linker, comando, linkLibraries y runtime.
 * Cambia ⇒ toda la caché se invalida.
 */
function globalDigest(config: ResolvedConfig, runtimeDigest: string): string {
  const hash = createHash("sha256");
  hash.update(`ts2cpp:${getTs2cppVersion()}:${getTs2cppRevision() ?? "dev"}\x00`);
  for (const flag of [...config.compiler.flags].sort()) hash.update("C:" + flag + "\x00");
  for (const flag of [...config.compiler.linkFlags].sort()) hash.update("L:" + flag + "\x00");
  for (const lib of [...config.linkLibraries].sort()) hash.update("lib:" + lib + "\x00");
  hash.update("cpp-source-maps:2\x00");
  hash.update(`compiler:${config.compiler.command}\x00`);
  hash.update("runtime:" + runtimeDigest + "\x00");
  return hash.digest("hex").slice(0, 16);
}

/**
 * Huella ligera del runtime: SHA-256 + longitud de cada cabecera y
 * .cpp del runtime, recursivo en subdirectorios. Si cambia cualquier
 * archivo de runtime/ (incluyendo runtime/libuv/, runtime/ast/,
 * runtime/external/), el digest cambia y la caché se invalida.
 *
 * V30.6.1 (H-04): antes enumeraba 10 cabeceras hardcodeadas; ahora
 * itera todos los *.hpp/*.h/*.cpp del directorio runtime/ en orden
 * estable.
 *
 * V30.6.2 (P-04): recursion en subdirectorios + si readdir falla,
 * lanzamos error explicito (mejor fallar que aceptar un digest
 * parcial silencioso). El caller decide si el error es fatal o no.
 */
async function digestRuntime(compilerRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const runtimeDir = join(compilerRoot, "runtime");
  const entries: string[] = [];
  // Recorrido recursivo best-effort: si un subdirectorio no se puede
  // leer, lo saltamos y dejamos que el error se propague arriba.
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // subdirectorio no legible, lo saltamos
    }
    for (const item of items) {
      const name = item.name;
      if (name === "build" || name === "node_modules" || name === ".git") continue;
      const abs = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (item.isDirectory()) {
        await walk(abs, rel);
      } else if (item.isFile() && (name.endsWith(".hpp") || name.endsWith(".h") || name.endsWith(".cpp"))) {
        entries.push(rel);
      }
    }
  };
  try {
    await walk(runtimeDir, "");
  } catch (error) {
    // P-04: el informe seniala que el fallback debil (lista
    // hardcodeada de 10) es un riesgo. Lanzamos error explicito
    // para que el caller sepa que el digest no es fiable.
    throw new Error(
      `digestRuntime: no se pudo leer ${runtimeDir}: ${error instanceof Error ? error.message : String(error)}. ` +
      `Esto impide calcular un digest fiable del runtime; abortando build.`
    );
  }
  if (entries.length === 0) {
    throw new Error(
      `digestRuntime: ${runtimeDir} no contiene ningun archivo .hpp/.h/.cpp. ` +
      `Verifica que runtime/ este correctamente poblado.`
    );
  }
  // Orden estable (lexicografico) para que la huella sea determinista.
  entries.sort();
  for (const rel of entries) {
    try {
      const content = await readFile(join(runtimeDir, rel), "utf8");
      hash.update(rel + ":" + content.length + ":" + createHash("sha256").update(content).digest("hex") + "\x00");
    } catch {
      hash.update(rel + ":missing\x00");
    }
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * Compila (o enlaza) con el comando nativo. Captura stderr/stdout para
 * incluirlos en el error si algo falla.
 *
 * V30.6.1 (H-07): cap de 1 MiB en stdout y stderr cada uno (los ultimos
 * 1 MiB; lo anterior se descarta para evitar OOM si el compilador
 * emite diagnosticos masivos). Anade timeout por defecto de 5 minutos
 * para evitar que un build se cuelgue indefinidamente.
 */
const RUN_NATIVE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
const RUN_NATIVE_OUTPUT_CAP = 1024 * 1024; // 1 MiB
function runNative(command: string, args: string[], options: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? RUN_NATIVE_TIMEOUT_MS;
  return new Promise((fulfill, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stdoutDropped = 0;
    let stderrDropped = 0;
    const trimTo = (current: string, dropped: number, chunk: string): { kept: string; dropped: number } => {
      const combined = current + chunk;
      if (combined.length <= RUN_NATIVE_OUTPUT_CAP) return { kept: combined, dropped };
      // Mantener los ultimos RUN_NATIVE_OUTPUT_CAP bytes.
      const sliced = combined.slice(combined.length - RUN_NATIVE_OUTPUT_CAP);
      return { kept: sliced, dropped: dropped + (combined.length - RUN_NATIVE_OUTPUT_CAP) };
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} excedio el timeout de ${timeoutMs}ms y fue terminado`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { const r = trimTo(stdout, stdoutDropped, chunk); stdout = r.kept; stdoutDropped = r.dropped; });
    child.stderr.on("data", (chunk: string) => { const r = trimTo(stderr, stderrDropped, chunk); stderr = r.kept; stderrDropped = r.dropped; });
    child.once("error", (error: Error) => { clearTimeout(timer); reject(error); });
    child.once("exit", code => {
      clearTimeout(timer);
      if (code === 0) fulfill();
      else {
        const dropped = (n: number) => n > 0 ? ` (+${n.toLocaleString()} bytes descartados por cap de ${RUN_NATIVE_OUTPUT_CAP.toLocaleString()})` : "";
        reject(new Error(`${command} salió con código ${code}\n${stderr || stdout}${dropped(stdoutDropped + stderrDropped)}`));
      }
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

const TRANSPILATION_CACHE_VERSION = 2;
interface CachedTranspilation {
  version: number;
  header: string;
  modules: { name: string; cpp: string }[];
  moduleNames: string[];
  linkFlags: string[];
  externalHeaders: string[];
  runtimeBackends: ModuleCompilationResult["runtimeBackends"];
  generatedSources: GeneratedSource[];
  semanticFingerprints: ModuleFingerprint[];
}

function transpilationFingerprint(graph: ModuleGraph): string {
  const hash = createHash("sha256");
  hash.update(`transpilation-cache:${TRANSPILATION_CACHE_VERSION}\0`);
  hash.update(`compiler:${getTs2cppVersion()}:${getTs2cppRevision() ?? "dev"}\0`);
  hash.update(`base:${graph.baseDirectory}\0entry:${graph.entry}\0`);
  for (const module of graph.modules) {
    hash.update(`module:${module.file}\0${module.hash}\0${module.source}\0`);
    hash.update(JSON.stringify(module.imports) + "\0");
  }
  return hash.digest("hex");
}

function validCachedTranspilation(value: unknown, graph: ModuleGraph): value is CachedTranspilation {
  if (!value || typeof value !== "object") return false;
  const cached = value as Partial<CachedTranspilation>;
  return cached.version === TRANSPILATION_CACHE_VERSION
    && typeof cached.header === "string"
    && Array.isArray(cached.modules)
    && Array.isArray(cached.moduleNames)
    && cached.moduleNames.length === graph.modules.length
    && cached.moduleNames.every((name, index) => name === graph.modules[index]?.file)
    && cached.modules.every(module => typeof module?.name === "string" && typeof module?.cpp === "string")
    && Array.isArray(cached.linkFlags)
    && Array.isArray(cached.externalHeaders)
    && Array.isArray(cached.generatedSources)
    && Array.isArray(cached.semanticFingerprints)
    && !!cached.runtimeBackends
    && ["libuv", "curl", "tls", "ioUring"].every(name => typeof (cached.runtimeBackends as unknown as Record<string, unknown>)[name] === "boolean");
}

async function publishJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, path);
}

/**
 * Construye (o reutiliza) un proyecto Estatic de forma incremental.
 *
 * El grafo comparte análisis semántico, pero cada módulo emite su propia
 * unidad C++ y objeto. Las cachés de sintaxis/AST, snapshot de transpilación
 * y objetos son independientes. Las interfaces registradas planifican futuras
 * invalidaciones; todavía no se usan para omitir el checker global.
 */
export async function buildIncremental(config: ResolvedConfig, compilerRoot: string, options: IncrementalBuildOptions = {}): Promise<IncrementalBuildResult> {
  const progress = new BuildProgress(options.verbose ?? false);
  const profile = new BuildProfile();
  if (options.verbose) process.stderr.write(`   Cargando grafo de módulos...\n`);
  const generatedDir = config.incremental.generatedDirectory;
  const cacheDir = config.incremental.cacheDirectory;
  const transpilationDir = join(cacheDir, "transpilation");
  const profilePath = join(cacheDir, "build-profile.json");
  const semanticPath = join(cacheDir, "module-interfaces.json");
  await mkdir(generatedDir, { recursive: true });
  await mkdir(transpilationDir, { recursive: true });
  const finish = async (result: Omit<IncrementalBuildResult, "profile">): Promise<IncrementalBuildResult> => {
    const measured = { phases: profile.phases, totalsMs: profile.totals(), report: profilePath };
    await publishJsonAtomic(profilePath, { version: 1, ...result, profile: measured });
    if (options.verbose) for (const [name, duration] of Object.entries(measured.totalsMs)) progress.log(`${name}: ${duration.toFixed(2)}ms`);
    return { ...result, profile: measured };
  };

  // V30.6.0: el pre-compile de los .o del runtime ahora lo hace
  // `scripts/postinstall.sh` (llamado por `npm install` automaticamente).
  // El incremental ya no intenta compilar nada del runtime — eso es
  // responsabilidad del postinstall. Si los .o no existen, fallamos
  // rapido con un mensaje claro en vez de intentar compilarlos aqui
  // (lo cual era fragil y duplicaba logica).
  const runtimeObjDir = join(compilerRoot, "build");
  if (!existsSync(runtimeObjDir) || !existsSync(join(runtimeObjDir, "runtime_ets_libuv.o"))) {
    throw new Error(
      `Los .o del runtime no se encontraron en ${runtimeObjDir}/.\n` +
      `Esto ocurre tras un clone fresco. Ejecuta 'npm install' en ${compilerRoot}\n` +
      `para compilar el runtime, o 'bash scripts/postinstall.sh --skip-sysdeps' si\n` +
      `ya tienes libuv-dev/libcurl-dev/libssl-dev instalados.`
    );
  }
  // 1) Cargamos el grafo (esto también valida resolución de imports y
  // visibilidad nominal). Cualquier error aquí aborta antes de tocar la
  // caché.
  const graph = await profile.measureAsync("load-graph", () => loadModuleGraph(config.entry, {
    moduleRoots: config.moduleRoots,
    aliases: config.aliases,
    baseDirectory: config.baseDirectory,
    transpilationCacheDirectory: transpilationDir,
  }));
  if (options.verbose) progress.log(`${graph.modules.length} módulo(s) cargado(s); sintaxis: ${graph.frontendCache?.syntaxHits ?? 0} hit(s), ${graph.frontendCache?.syntaxMisses ?? 0} miss(es)`);
  const transpilationKey = transpilationFingerprint(graph);
  const transpilationPath = join(transpilationDir, `${transpilationKey}.json`);

  // 2) Digests: el del runtime depende del árbol runtime/ del compilador,
  // y el global mezcla flags + runtime. Cambia ⇒ toda la caché se invalida.
  progress.beginPhase("Calculando digests (runtime + flags)");
  const runtimeDigest = await profile.measureAsync("digest-runtime", () => digestRuntime(compilerRoot));
  const digest = globalDigest(config, runtimeDigest);
  if (options.verbose) progress.log(`runtime digest: ${runtimeDigest}, global digest: ${digest}`);

  const cppPath = config.output.cpp;
  const binaryPath = config.output.binary;
  const manifestPath = join(cacheDir, `app.manifest`);
  const globalManifestPath = join(cacheDir, `global.manifest`);
  const headerPath = join(generatedDir, "estatic_common.hpp");
  const mapManifestPath=join(cacheDir,"cpp-source-maps.manifest.json");

  // El antiguo PCH se generaba pero no se pasaba al compilador. Omitir
  // trabajo nativo sin consumidores reduce el coste de builds en frío.

  // Si el digest global (runtime + flags + comando) cambió desde el último
  // build, hay que invalidar TODO el cache. Lo persistimos en
  // `global.manifest` SOLO al final del build exitoso (P-01 del informe
  // de revision, 2026-10-12). Ademas, publicamos atómicamente: escribimos
  // a `global.manifest.tmp` y luego renombramos, para que un crash
  // durante la escritura no deje el manifest a medias.
  const previousGlobalDigest = await readFile(globalManifestPath, "utf8").catch(() => "");
  const globalDigestChanged = previousGlobalDigest !== digest;
  if (globalDigestChanged && previousGlobalDigest) {
    progress.warn(`Cache global invalidado (runtime/flags cambiaron: ${previousGlobalDigest.slice(0, 8)}... → ${digest.slice(0, 8)}...)`);
  }

  // Conservar el header canónico en un hit; si falta se restaura del snapshot.

  // 3) Huella del programa: contenido de cada módulo en orden topológico.
  // Cambio en cualquier fuente (o en el orden) ⇒ huella nueva.
  const programHash = createHash("sha256");
  for (const module of graph.modules) {
    programHash.update("file:" + module.file + "\x00");
    programHash.update(module.source + "\x00" + module.hash + "\x00");
  }
  programHash.update("global:" + digest + "\x00");
  const programFingerprint = programHash.digest("hex").slice(0, 16);

  const previousManifest = await readFile(manifestPath, "utf8").catch(() => "");
  // V15: el cache hit ahora es "todos los .o reutilizados". Si llegamos aquí
  // con `globalDigestChanged=false` y el `app.manifest` (huella de programa)
  // coincide, podemos reutilizar TODOS los .o sin recompilar nada. En otro
  // caso, seguimos al pipeline principal que compara por-módulo.
  if (!globalDigestChanged && previousManifest === programFingerprint) {
    // V30.6.1 (H-03): antes de devolver cache hit, verificar que el
    // binario y los .o de los modulos todavia existen en disco. Si se
    // borro el binario (o un .o) conservando el manifest, la compilacion
    // se declaraba exitosa sin generar ejecutable. Ahora regeneramos.
    const binaryStillExists = await fileExists(binaryPath);
    let allObjectsPresent = true;
    for (const module of graph.modules) {
      const identity = computeModuleId(module.file, config.baseDirectory);
      const objPath = join(cacheDir, `${identity.moduleBase}.o`);
      if (!(await fileExists(objPath))) { allObjectsPresent = false; break; }
    }
    // V30.6.2 (P-05): ademas de existir, el binario debe tener
    // tamano > 0. Un binario truncado o corrupto no es valido aunque
    // exista. Tambien exigimos que el moduleManifest coincida con
    // la forma nueva (cppHash|globalDigest); manifests del formato
    // anterior (sin |) son incompatibles.
    let binarySize = 0;
    try { binarySize = (await stat(binaryPath)).size; } catch { /* binario no existe */ }
    const binaryIntact = binaryStillExists && binarySize > 0;
    let mapArtifactsPresent=false;
    try {
      const artifacts=JSON.parse(await readFile(mapManifestPath,"utf8"));
      mapArtifactsPresent=Array.isArray(artifacts) && (await Promise.all(artifacts.map(path=>typeof path === "string" ? fileExists(path) : false))).every(Boolean);
    } catch {}
    if (binaryIntact && allObjectsPresent && mapArtifactsPresent && await fileExists(headerPath)) {
      if (options.verbose) progress.log(`Cache hit: huella del programa coincide, todos los .o reutilizados`);
      return finish({
        compiled: [],
        reused: graph.modules.map(m => m.file),
        linked: false,
        binary: binaryPath,
        header: headerPath,
        durationMs: progress.totalElapsed(),
        cacheResult: "hit",
        transpilationCache: "hit",
        parsedModules: { reused: graph.modules.length, parsed: 0 },
        moduleChanges: [],
      });
    }
    if (options.verbose) progress.warn(`Cache hit pero artefactos ausentes (binary=${binaryStillExists}/${binarySize}B, objects=${allObjectsPresent}); regenerando`);
  }

  // Diagnóstico claro cuando la caché falla por una razón concreta.
  if (previousManifest && previousManifest !== programFingerprint) {
    progress.warn(`Cache miss: huella del programa cambió (anterior ${previousManifest.slice(0, 8)}..., nueva ${programFingerprint.slice(0, 8)}...)`);
  }

  // 4) Restaurar la instantánea de transpilación o ejecutar el frontend.
  // La instantánea está separada de los `.o`: cambiar flags/runtime obliga a
  // recompilar C++, pero no a repetir parse, type-check, comptime ni codegen.
  // En un miss, compileModuleGraph reutiliza por contenido los AST de todos
  // los módulos que no cambiaron y no vuelve a cargar/resolver el grafo.
  let cachedTranspilation: CachedTranspilation | undefined;
  const snapshotStart = performance.now();
  try {
    const candidate: unknown = JSON.parse(await readFile(transpilationPath, "utf8"));
    if (validCachedTranspilation(candidate, graph)) cachedTranspilation = candidate;
  } catch {
    // Miss normal o entrada corrupta: se reconstruye y reemplaza.
  }
  profile.record("restore-snapshot", snapshotStart);
  let result: ModuleCompilationResult;
  let transpilationCache: IncrementalBuildResult["transpilationCache"];
  let parsedModules: IncrementalBuildResult["parsedModules"];
  if (cachedTranspilation) {
    progress.beginPhase("Restaurando snapshot de transpilación");
    const origin = { offset: 0, line: 1, column: 1 };
    result = {
      ...cachedTranspilation,
      ast: { kind: "Program", statements: [], span: { start: origin, end: origin }, generatedSources: cachedTranspilation.generatedSources },
      transpilationCache: { parsedHits: graph.modules.length, parsedMisses: 0 },
    };
    transpilationCache = "hit";
    parsedModules = { reused: graph.modules.length, parsed: 0 };
    if (options.verbose) progress.log(`Snapshot hit: parse, type-check, comptime y codegen reutilizados`);
  } else {
    progress.beginPhase("Regenerando .cpp (frontend incremental + type-check + codegen)");
    result = await compileModuleGraph(graph, {
      moduleRoots: config.moduleRoots,
      aliases: config.aliases,
      baseDirectory: config.baseDirectory,
      transpilationCacheDirectory: transpilationDir,
      profile,
    });
    const stats = result.transpilationCache ?? { parsedHits: 0, parsedMisses: graph.modules.length };
    parsedModules = { reused: stats.parsedHits, parsed: stats.parsedMisses };
    transpilationCache = stats.parsedHits > 0 ? "partial" : "miss";
    const artifact: CachedTranspilation = {
      version: TRANSPILATION_CACHE_VERSION,
      header: result.header,
      modules: result.modules,
      moduleNames: result.moduleNames,
      linkFlags: result.linkFlags,
      externalHeaders: result.externalHeaders,
      runtimeBackends: result.runtimeBackends,
      generatedSources: result.ast.generatedSources ?? [],
      semanticFingerprints: result.semanticFingerprints ?? [],
    };
    await publishJsonAtomic(transpilationPath, artifact);
    if (options.verbose) progress.log(`AST cache: ${stats.parsedHits} reutilizado(s), ${stats.parsedMisses} parseado(s)`);
  }
  let previousInterfaces: ModuleFingerprint[] = [];
  try {
    const previous = JSON.parse(await readFile(semanticPath, "utf8"));
    if (previous.version === 1 && Array.isArray(previous.modules)) previousInterfaces = previous.modules;
  } catch {}
  const semanticFingerprints = result.semanticFingerprints ?? [];
  const moduleChanges = profile.measure("compare-interfaces", () => compareModuleFingerprints(previousInterfaces, semanticFingerprints));
  if (options.verbose) for (const change of moduleChanges) progress.log(`Cambio ${change.reason}: ${change.file}`);
  await mkdir(dirname(cppPath), { recursive: true });
  // V15: escribimos el header común + un `.cpp` por módulo (modo multi).
  const generatedSources=result.ast.generatedSources ?? [];
  const sourceDirectory=join(generatedDir,"etsgen");
  if(generatedSources.length) await profile.measureAsync("write-artifacts", () => writeGeneratedSources(generatedSources,sourceDirectory));
  const mappedHeader = await profile.measureAsync("write-artifacts", () => writeMappedCpp(result.header,headerPath,generatedSources,sourceDirectory));
  const headerHash = createHash("sha256").update(mappedHeader).digest("hex").slice(0, 16);
  const mapArtifacts=generatedSources.length ? [headerPath,headerPath+".map.json",join(sourceDirectory,"manifest.json"),...generatedSources.map((_,index)=>join(sourceDirectory,`etsgen-${index}.ets`))] : [];
  const compiled: string[] = [];
  const reused: string[] = [];
  // Cacheamos un .o por módulo. La ruta del cache depende SOLO del hash del
  // módulo (.cpp generado), no del digest global. Si runtime/flags cambian,
  // invalidamos TODOS los caches abajo (`globalDigestChanged`).
  // V30.6.1 (H-01): nombre estable derivado de la ruta completa + hash,
  // no del basename. Antes `src/users/index.ts` y `src/admin/index.ts`
  // colisionaban en `index.cpp/index.o/index.manifest`.
  const moduleIdentities = result.modules.map(m => computeModuleId(m.name, config.baseDirectory));
  assertUniqueIdentities(moduleIdentities);
  const moduleIdByName = new Map(moduleIdentities.map(id => [id.file, id]));
  for (const module of result.modules) {
    const identity = moduleIdByName.get(module.name);
    if (!identity) throw new Error(`Identidad no encontrada para ${module.name}`);
    const moduleBase = identity.moduleBase;
    const moduleCppPath = join(dirname(cppPath), `${moduleBase}.cpp`);
    const moduleObjectPath = join(cacheDir, `${moduleBase}.o`);
    const moduleManifestPath = join(cacheDir, `${moduleBase}.manifest`);
    const mappedCpp=await profile.measureAsync("write-artifacts", () => writeMappedCpp(module.cpp,moduleCppPath,generatedSources,sourceDirectory), module.name);
    if(generatedSources.length) mapArtifacts.push(moduleCppPath,moduleCppPath+".map.json");
    if (options.verbose) progress.log(`${moduleBase}.cpp escrito (${Buffer.byteLength(module.cpp).toLocaleString()} bytes)`);
    const moduleCppHash = createHash("sha256").update(mappedCpp).digest("hex").slice(0, 16);
    // V30.6.2 (P-01): el manifest por modulo incluye el cpp hash Y el
    // digest global. Asi, si el manifest global se corrompe o se
    // escribe antes de tiempo, un objeto viejo no se reutiliza bajo
    // una nueva configuracion (el cpp hash y el digest van juntos).
    const moduleManifestValue = `${moduleCppHash}|${headerHash}|${digest}`;
    const previousModuleManifest = await readFile(moduleManifestPath, "utf8").catch(() => "");
    const objectExists = await fileExists(moduleObjectPath);
    // Reutilizamos el .o SOLO si (a) el hash del .cpp no cambió Y (b) el
    // digest global no cambió. Si runtime o flags cambiaron, todo a la basura.
    if (!globalDigestChanged && previousModuleManifest === moduleManifestValue && objectExists) {
      reused.push(module.name);
      if (options.verbose) progress.log(`Reutilizado ${moduleBase}.o (manifest coincide)`);
      continue;
    }
    // Compilamos este módulo a .o.
    progress.beginPhase(`Compilando ${moduleBase}.cpp → ${moduleBase}.o`);
    const compileArgs = [
      ...config.compiler.flags,
      `-I${config.baseDirectory}`,
      `-I${compilerRoot}`,
      `-I${dirname(headerPath)}`,
      "-c",
      moduleCppPath,
      "-o",
      moduleObjectPath,
    ];
    try { await profile.measureAsync("native-compile", () => runNative(config.compiler.command, compileArgs), module.name); }
    catch (error) { throw new Error(`Falló la compilación de ${moduleCppPath} a objeto:\n${error instanceof Error ? error.message : String(error)}\nSugerencia: revisa que las flags de compilación en estatic.config.ts sean correctas y que runtime/ esté accesible.`); }
    await writeFile(moduleManifestPath, moduleManifestValue, "utf8");
    compiled.push(module.name);
  }
  if (options.verbose) progress.log(`${compiled.length} módulo(s) compilado(s), ${reused.length} reutilizado(s)`);

  // 5) Enlazar TODOS los .o al binario. Si ya tenemos un binario cacheado
  // válido (mismo fingerprint del programa entero), podríamos reusarlo, pero
  // por simplicidad siempre re-enlazamos cuando hay cambios.
  const linkFlagsChanged = previousManifest !== "" && previousManifest !== programFingerprint;
  let linked = false;
  const binaryExists = await fileExists(binaryPath);
  const allObjects = result.modules.map(module => {
    const identity = moduleIdByName.get(module.name);
    if (!identity) throw new Error(`Identidad no encontrada para ${module.name} (link)`);
    return join(cacheDir, `${identity.moduleBase}.o`);
  });
  if (!binaryExists || linkFlagsChanged || compiled.length > 0) {
    progress.beginPhase(`Enlazando binario (${config.compiler.command})`);
    // V30.6.0: deteccion declarativa desde el AST, no escaneo de
    // includes del cpp. Cubre libuv, tls y curl con una sola fuente de
    // verdad (runtime-backends.ts) y elimina la heuristica fragil.
    const needsLibuv = result.runtimeBackends.libuv;
    const needsTls   = result.runtimeBackends.tls;
    const needsCurl  = result.runtimeBackends.curl;
    const tlsLibraries  = needsTls  ? ["-lssl", "-lcrypto"] : [];
    const curlLibraries = needsCurl ? ["-lcurl"] : [];
    const runtimeObjDir = join(compilerRoot, "build");
    const libuvObjectPaths = [
      join(runtimeObjDir, "runtime_ets_libuv.o"),
      join(runtimeObjDir, "runtime_ets_net_libuv.o"),
    ];
    const libuvObjects = needsLibuv ? libuvObjectPaths.filter(p => existsSync(p)) : [];
    const libuvLinkArgs = libuvObjects.length > 0 ? [...libuvObjects, "-luv"] : (needsLibuv ? ["-luv"] : []);
    const linkArgs = [
      ...config.compiler.flags.filter(flag => flag !== "-c" && flag !== "-flto" && !flag.startsWith("-Wl,")),
      ...allObjects,
      "-o", binaryPath,
      ...config.compiler.linkFlags,
      ...config.linkLibraries.map(lib => lib.startsWith("-") ? lib : `-l${lib}`),
      ...tlsLibraries,
      ...curlLibraries,
      ...libuvLinkArgs,
    ];
    await mkdir(dirname(binaryPath), { recursive: true });
    try { await profile.measureAsync("native-link", () => runNative(config.compiler.command, linkArgs)); }
    catch (error) { throw new Error(`Falló el enlazado de ${binaryPath}:\n${error instanceof Error ? error.message : String(error)}\nSugerencia: revisa linkFlags y linkLibraries en estatic.config.ts.`); }
    linked = true;
  } else if (options.verbose) {
    progress.log(`Enlace reutilizado (binario ${binaryPath} ya válido)`);
  }

  await writeFile(mapManifestPath,JSON.stringify(mapArtifacts),"utf8");
  await writeFile(manifestPath, programFingerprint, "utf8");
  await publishJsonAtomic(semanticPath, { version: 1, modules: semanticFingerprints });

  // V30.6.2 (P-01): publicar el digest global atomicamente, SOLO
  // despues de un build exitoso (manifest + binario + todos los
  // moduleManifest ya escritos). Si el linker fallo arriba, el catch
  // del caller propaga la excepcion y NUNCA llegamos aqui, asi que
  // el manifest global no se actualiza con builds a medias.
  // La atomicidad se logra escribiendo a `.tmp` y renombrando
  // (rename es atomico en POSIX: el lector siempre ve la version vieja
  // o la nueva, nunca a medias).
  const globalManifestTmp = globalManifestPath + ".tmp";
  await writeFile(globalManifestTmp, digest, "utf8");
  await rename(globalManifestTmp, globalManifestPath);

  // Resumen final con tamaño del binario.
  let binarySize = 0;
  try { binarySize = (await stat(binaryPath)).size; } catch { /* binario no existe */ }
  if (options.verbose) progress.log(`Binario: ${binaryPath} (${binarySize.toLocaleString()} bytes)`);

  return finish({
    compiled,
    reused,
    linked,
    binary: binaryPath,
    header: headerPath,
    durationMs: progress.totalElapsed(),
    cacheResult: compiled.length === 0 && !linked ? "hit" : (reused.length > 0 ? "partial" : "miss"),
    transpilationCache,
    parsedModules,
    moduleChanges,
  });
}
