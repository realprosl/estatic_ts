// etsc install: librerías desde un repositorio git (#192).
//
//   etsc install <url> [versión] [-g | --global]   descarga, alias y dependencia
//   etsc install                                   vuelve a descargar las que falten
//
// La librería se descarga (etiqueta v<versión>, <versión> o rama) en
// .build/deps/<nombre>@<ref>/ del proyecto, o con -g en la carpeta global
// ($XDG_DATA_HOME o ~/.local/share)/estatic/deps/. En estatic.config.json se
// escribe el alias <nombre> → ruta absoluta y, en `dependencies`, la URL, la
// versión y el commit: con eso `etsc install` sin argumentos la recupera en otra
// máquina y reescribe la ruta. Nunca se ejecuta nada de la librería.
//
// Una librería no tiene punto de entrada: se importa módulo a módulo
// ("<nombre>/<módulo>"). Sus propias `dependencies` se instalan también y se
// apuntan en el proyecto con "indirect": true (como `// indirect` de go.mod),
// así todo el árbol queda fijado en un solo sitio. Una sola versión por nombre:
// manda la directa del proyecto; entre indirectas, la más alta (con aviso).
import { canonicalFile, temporaryDirectory, environment, exists, readText, writeText, rename, directories, currentDirectory, objectKeys, hostError, now } from "../platform/index";
import { PathAlias } from "../modules/index";
import { parseConfig, configStrings } from "./config";
import { parseVersionTags, versionParts, versionBefore, run } from "./update";
import { rootObject, setMember, ensureObject, memberObject } from "./jsonedit";

function packageError(message: string, status: number = 1): void { printError(message); exitProcess(status); }

function absolutePath(path: string): string { let result: string = normalizePath(path.startsWith("/") ? path : currentDirectory() + "/" + path); while (result.length > 1 && result.endsWith("/")) result = result.slice(0, result.length - 1); return result; }
function joinPath(base: string, path: string): string { return normalizePath(path.startsWith("/") ? path : base + "/" + path); }

export function globalDependencies(): string {
  let data: string = environment("XDG_DATA_HOME");
  if (data == "") { const home: string = environment("HOME"); if (home == "") packageError("No se conoce la carpeta personal (HOME) para -g"); data = home + "/.local/share"; }
  return normalizePath(data + "/estatic/deps");
}

// https://github.com/u/estatic-parser.git → estatic-parser
export function nameFromUrl(url: string): string {
  let text: string = url; while (text.endsWith("/")) text = text.slice(0, text.length - 1);
  if (text.endsWith(".git")) text = text.slice(0, text.length - 4);
  let start: number = 0; for (let k: number = 0; k < text.length; k = k + 1) { const c: string = text.charAt(k); if (c == "/" || c == ":") start = k + 1; }
  return text.slice(start, text.length);
}

function remoteRefs(url: string, kind: string, work: string): string[] {
  const file: string = work + "/refs-" + kind.slice(2, kind.length);
  if (run(["git", "ls-remote", kind, url], file, file + ".err") != 0) packageError("No se puede leer el repositorio " + url + "\nayuda: comprueba la URL, tu conexión y que tengas acceso (git ls-remote " + url + ")");
  let names: string[] = []; const prefix: string = kind == "--tags" ? "refs/tags/" : "refs/heads/";
  for (const line of readText(file).split("\n")) { const at: number = line.indexOf(prefix, 0); if (at >= 0) { const name: string = line.slice(at + prefix.length, line.length); if (!name.endsWith("^{}") && !names.includes(name)) names.push(name); } }
  return names;
}

function tagLines(tags: string[]): string { let lines: string[] = []; for (const tag of tags) lines.push("refs/tags/" + tag); return lines.join("\n"); }

// Etiqueta v<versión> o <versión>, o una rama; sin versión, la última vX.Y.Z.
export function resolveReference(url: string, version: string, work: string): string {
  const tags: string[] = remoteRefs(url, "--tags", work);
  if (version == "") {
    const versions: string[] = parseVersionTags(tagLines(tags));
    if (versions.length == 0) packageError(url + " no tiene versiones publicadas (etiquetas vX.Y.Z)\nayuda: indica una etiqueta o una rama: etsc install " + url + " <versión>");
    return versions[versions.length - 1];
  }
  if (!version.startsWith("v") && tags.includes("v" + version)) return "v" + version;
  if (tags.includes(version)) return version;
  if (remoteRefs(url, "--heads", work).includes(version)) return version;
  const versions: string[] = parseVersionTags(tagLines(tags));
  let recent: string[] = []; for (let k: number = versions.length - 1; k >= 0 && recent.length < 5; k = k - 1) recent.push(versions[k]);
  packageError("No existe la versión " + version + " en " + url + (recent.length > 0 ? "\nayuda: versiones recientes: " + recent.join(", ") : "\nayuda: no hay etiquetas vX.Y.Z; indica una etiqueta o una rama existente"));
  return "";
}

export class Downloaded { name: string; path: string; commit: string; constructor(name: string, path: string, commit: string) { this.name = name; this.path = path; this.commit = commit; } }

function libraryName(directory: string, url: string): string {
  const file: string = directory + "/estatic.config.json";
  if (exists(file)) { const name: string = jsonAsString(jsonObjectGet(parseConfig(readText(file)), "name")); if (name != "") return name; }
  return nameFromUrl(url);
}

// Descarga `reference` en <destino>/<nombre>@<reference>; si ya está, la reutiliza.
export function download(url: string, reference: string, destination: string, wanted: string, work: string): Downloaded {
  if (wanted != "") {
    const known: string = destination + "/" + wanted + "@" + reference;
    if (exists(known + "/.estatic-commit")) return new Downloaded(wanted, known, readText(known + "/.estatic-commit").trim());
  }
  if (!directories(destination)) packageError("No se puede crear " + destination + ": " + hostError());
  const staging: string = destination + "/.descarga-" + numberToString(Math.floor(now()));
  if (run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", reference, url, staging], "", work + "/clone.err") != 0) {
    run(["rm", "-rf", staging]); packageError("No se pudo descargar " + url + " (" + reference + ")\n" + readText(work + "/clone.err").trim());
  }
  run(["git", "-C", staging, "rev-parse", "HEAD"], work + "/commit"); const commit: string = readText(work + "/commit").trim();
  run(["rm", "-rf", staging + "/.git"]);
  writeText(staging + "/.estatic-commit", commit + "\n");
  const name: string = wanted != "" ? wanted : libraryName(staging, url);
  const target: string = destination + "/" + name + "@" + reference;
  if (exists(target + "/.estatic-commit")) { run(["rm", "-rf", staging]); return new Downloaded(name, target, readText(target + "/.estatic-commit").trim()); }
  if (exists(target)) run(["rm", "-rf", target]);
  if (!rename(staging, target)) { run(["rm", "-rf", staging]); packageError("No se pudo publicar " + target + ": " + hostError()); }
  return new Downloaded(name, target, commit);
}

// --- Escritura de estatic.config.json y tsconfig.json ----------------------

function edited(text: string, file: string): string {
  if (text == "") packageError("No se puede editar " + file + " automáticamente (JSON con claves entre comillas)\nayuda: añade el alias y la dependencia a mano");
  return text;
}

export function recordDependency(configFile: string, name: string, url: string, reference: string, commit: string, shared: boolean, path: string, indirect: boolean = false): void {
  let text: string = readText(configFile); const root: number = rootObject(text); if (root < 0) edited("", configFile);
  text = edited(ensureObject(text, root, "aliases"), configFile);
  text = edited(setMember(text, memberObject(text, root, "aliases"), name, JSON.stringify(path)), configFile);
  text = edited(ensureObject(text, root, "dependencies"), configFile);
  const entry: string = "{ \"url\": " + JSON.stringify(url) + ", \"version\": " + JSON.stringify(reference) + ", \"commit\": " + JSON.stringify(commit) + ", \"global\": " + (shared ? "true" : "false") + (indirect ? ", \"indirect\": true" : "") + " }";
  text = edited(setMember(text, memberObject(text, root, "dependencies"), name, entry), configFile);
  if (!writeText(configFile, text)) packageError(hostError());
}

// Ruta para tsconfig: absoluta tal cual; relativa, con "./" delante.
function tsPath(path: string): string { return path.startsWith("/") || path.startsWith("./") || path.startsWith("../") ? path : "./" + path; }

// aliases de estatic.config.json → compilerOptions.paths de tsconfig.json, para
// que tsserver resuelva los mismos imports. Solo añade o actualiza las entradas
// de los alias (los paths escritos a mano se conservan) y no escribe si no cambia.
export function syncTsconfig(base: string, config: JsonValue): boolean {
  const file: string = base + "/tsconfig.json"; if (!exists(file)) return false;
  const aliases: JsonValue = jsonObjectGet(config, "aliases"); const names: string[] = objectKeys(aliases); if (names.length == 0) return false;
  const original: string = readText(file); let text: string = original;
  const root: number = rootObject(text);
  if (root >= 0) text = ensureObject(text, root, "compilerOptions");
  if (text != "") text = ensureObject(text, memberObject(text, root, "compilerOptions"), "paths");
  for (const name of names) {
    if (text == "") break;
    const target: string = tsPath(jsonAsString(jsonObjectGet(aliases, name)));
    // Una librería solo se importa por módulo ("<nombre>/…"); un alias propio también a secas.
    if (!jsonIsObject(jsonObjectGet(jsonObjectGet(config, "dependencies"), name))) text = setMember(text, memberObject(text, memberObject(text, root, "compilerOptions"), "paths"), name, "[" + JSON.stringify(target) + "]");
    if (text != "") text = setMember(text, memberObject(text, memberObject(text, root, "compilerOptions"), "paths"), name + "/*", "[" + JSON.stringify(target + "/*") + "]");
  }
  if (text == "") { printError("aviso: no se pudo sincronizar los alias con " + file + " (edítalo a mano: compilerOptions.paths)"); return false; }
  if (text == original) return false;
  writeText(file, text); return true;
}

// --- Uso desde build/run/check ---------------------------------------------

function dependencyTarget(config: JsonValue, base: string, name: string): string {
  const alias: string = jsonAsString(jsonObjectGet(jsonObjectGet(config, "aliases"), name));
  return alias == "" ? "" : joinPath(base, alias);
}

// Comprueba que las dependencias (directas e indirectas) estén descargadas y
// devuelve los alias internos de cada librería: los de su estatic.config.json
// con ruta relativa (sus carpetas). Los que apuntan a sus dependencias no hacen
// falta: cada dependencia ya es un alias del proyecto con su propio nombre.
export function dependencyAliases(config: JsonValue, base: string, known: PathAlias[]): PathAlias[] {
  let result: PathAlias[] = []; let names: string[] = []; for (const alias of known) names.push(alias.name);
  const dependencies: JsonValue = jsonObjectGet(config, "dependencies");
  for (const name of objectKeys(dependencies)) {
    const target: string = dependencyTarget(config, base, name); const info: JsonValue = jsonObjectGet(dependencies, name);
    if (target == "" || !exists(target)) packageError("Falta la dependencia '" + name + "' (" + jsonAsString(jsonObjectGet(info, "url")) + " " + jsonAsString(jsonObjectGet(info, "version")) + ")\nayuda: etsc install descarga las dependencias que falten", 1);
    if (!exists(target + "/estatic.config.json")) continue;
    const library: JsonValue = parseConfig(readText(target + "/estatic.config.json")); const aliases: JsonValue = jsonObjectGet(library, "aliases");
    // Ámbito = carpeta real de la librería (los ficheros llegan al loader canónicos).
    const canonicalConfig: string = canonicalFile(target + "/estatic.config.json"); const scope: string = canonicalConfig.slice(0, canonicalConfig.lastIndexOf("/"));
    for (const inner of objectKeys(aliases)) if (!jsonAsString(jsonObjectGet(aliases, inner)).startsWith("/") && !jsonIsObject(jsonObjectGet(jsonObjectGet(library, "dependencies"), inner))) result.push(new PathAlias(inner, joinPath(target, jsonAsString(jsonObjectGet(aliases, inner))), scope));
  }
  return result;
}

// linkFlags y linkLibraries que declaran las librerías (p. ej. -lsqlite3).
export function dependencyLinkFlags(config: JsonValue, base: string): string[] {
  let flags: string[] = []; const dependencies: JsonValue = jsonObjectGet(config, "dependencies");
  for (const name of objectKeys(dependencies)) {
    const target: string = dependencyTarget(config, base, name);
    if (target == "" || !exists(target + "/estatic.config.json")) continue;
    const library: JsonValue = parseConfig(readText(target + "/estatic.config.json"));
    for (const flag of configStrings(jsonObjectGet(jsonObjectGet(library, "compiler"), "linkFlags"))) if (!flags.includes(flag)) flags.push(flag);
    for (const name2 of configStrings(jsonObjectGet(library, "linkLibraries"))) if (!flags.includes("-l" + name2)) flags.push("-l" + name2);
  }
  return flags;
}

// --- etsc install ----------------------------------------------------------------

export function installCommand(args: string[]): void {
  const work: string = temporaryDirectory(); if (work == "") packageError(hostError());
  let url: string = ""; let version: string = ""; let globalFlag: boolean = false; let configFile: string = "estatic.config.json";
  for (let k: number = 1; k < args.length; k = k + 1) {
    const arg: string = args[k];
    if (arg == "-g" || arg == "--global") globalFlag = true;
    else if (arg == "--config") { k = k + 1; if (k >= args.length) packageError("Falta un valor para --config", 2); configFile = args[k]; }
    else if (arg.startsWith("-")) packageError("Uso: etsc install <url-git> [versión] [-g | --global]\n       etsc install                 descarga las dependencias que falten", 2);
    else if (url == "") url = arg; else if (version == "") version = arg;
    else packageError("Uso: etsc install <url-git> [versión] [-g | --global]", 2);
  }
  if (!exists(configFile)) packageError("No hay " + configFile + " en esta carpeta\nayuda: ejecuta etsc install desde la raíz del proyecto (o crea uno con etsc init)");
  const base: string = absolutePath(configFile.lastIndexOf("/") >= 0 ? configFile.slice(0, configFile.lastIndexOf("/")) : ".");
  const config: JsonValue = parseConfig(readText(configFile));
  const dependencies: JsonValue = jsonObjectGet(config, "dependencies");
  if (url == "") {
    // Recuperar lo que falte (otra máquina, carpeta borrada, otro usuario).
    let fetched: number = 0;
    for (const name of objectKeys(dependencies)) {
      const info: JsonValue = jsonObjectGet(dependencies, name); const target: string = dependencyTarget(config, base, name);
      if (target != "" && exists(target)) continue;
      const depUrl: string = jsonAsString(jsonObjectGet(info, "url")); const reference: string = jsonAsString(jsonObjectGet(info, "version"));
      const isGlobal: boolean = jsonIsBool(jsonObjectGet(info, "global")) && jsonAsBool(jsonObjectGet(info, "global"));
      if (depUrl == "" || reference == "") packageError("La dependencia '" + name + "' no tiene url y version en " + configFile);
      print("Descargando " + name + " " + reference);
      const got: Downloaded = download(depUrl, reference, isGlobal ? globalDependencies() : base + "/.build/deps", name, work);
      const indirect: boolean = jsonIsBool(jsonObjectGet(info, "indirect")) && jsonAsBool(jsonObjectGet(info, "indirect"));
      recordDependency(configFile, name, depUrl, reference, got.commit, isGlobal, got.path, indirect); fetched = fetched + 1;
    }
    syncTsconfig(base, parseConfig(readText(configFile)));
    run(["rm", "-rf", work]);
    print(fetched == 0 ? "Todas las dependencias están descargadas" : "✓ " + numberToString(fetched) + " dependencia(s) descargada(s)");
    return;
  }
  const reference: string = resolveReference(url, version, work);
  print("Descargando " + nameFromUrl(url) + " " + reference);
  const got: Downloaded = download(url, reference, globalFlag ? globalDependencies() : base + "/.build/deps", "", work);
  // Un alias propio con el mismo nombre no se pisa.
  if (jsonAsString(jsonObjectGet(jsonObjectGet(config, "aliases"), got.name)) != "" && !jsonIsObject(jsonObjectGet(dependencies, got.name)))
    packageError("Ya hay un alias '" + got.name + "' en " + configFile + " que no es una dependencia\nayuda: renómbralo o bórralo antes de añadir la librería");
  recordDependency(configFile, got.name, url, reference, got.commit, globalFlag, got.path);
  installIndirect(configFile, base, got.name, got.path, globalFlag, work);
  syncTsconfig(base, parseConfig(readText(configFile)));
  run(["rm", "-rf", work]);
  print("✓ " + got.name + " " + reference + " → " + got.path + "\n  import { … } from \"" + got.name + "/<módulo>\"");
}

// Instala las `dependencies` del estatic.config.json de una librería (y las de
// éstas) y las apunta en el proyecto como indirectas.
function installIndirect(configFile: string, base: string, owner: string, library: string, shared: boolean, work: string): void {
  if (!exists(library + "/estatic.config.json")) return;
  const wanted: JsonValue = jsonObjectGet(parseConfig(readText(library + "/estatic.config.json")), "dependencies");
  for (const name of objectKeys(wanted)) {
    const info: JsonValue = jsonObjectGet(wanted, name);
    const depUrl: string = jsonAsString(jsonObjectGet(info, "url")); const version: string = jsonAsString(jsonObjectGet(info, "version"));
    if (depUrl == "" || version == "") packageError("La dependencia '" + name + "' de " + owner + " no tiene url y version en su estatic.config.json");
    const current: JsonValue = jsonObjectGet(jsonObjectGet(parseConfig(readText(configFile)), "dependencies"), name);
    if (jsonIsObject(current)) {
      const have: string = jsonAsString(jsonObjectGet(current, "version"));
      const tag: string = versionParts(version).length == 3 && !version.startsWith("v") ? "v" + version : version;
      if (have == tag || have == version) continue;
      const direct: boolean = !(jsonIsBool(jsonObjectGet(current, "indirect")) && jsonAsBool(jsonObjectGet(current, "indirect")));
      const newer: boolean = versionParts(have).length == 3 && versionParts(tag).length == 3 && versionBefore(have, tag);
      if (direct || !newer) { printError("aviso: " + owner + " pide " + name + " " + version + "; se usa " + have + (direct ? " (instalada directamente)" : "")); continue; }
      printError("aviso: " + owner + " pide " + name + " " + version + "; se cambia " + have + " por esa versión");
    }
    const reference: string = resolveReference(depUrl, version, work);
    print("Descargando " + name + " " + reference + " (dependencia de " + owner + ")");
    const got: Downloaded = download(depUrl, reference, shared ? globalDependencies() : base + "/.build/deps", name, work);
    recordDependency(configFile, name, depUrl, reference, got.commit, shared, got.path, true);
    installIndirect(configFile, base, name, got.path, shared, work);
  }
}
