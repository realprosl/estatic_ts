// Código nativo de las librerías (#215, tandas 2 y 3).
//
// Una librería declara en su estatic.config.json:
//
//   "native": {
//     "sources": ["native/*.c", "native/*.cpp"],   // se compilan a un .a
//     "includeDirs": ["native/include"],           // -I al compilar el programa
//     "cflags": ["-O2"], "cxxflags": ["-std=c++20"],
//     "pkgConfig": ["sqlite3"],                    // pkg-config --cflags / --libs
//     "linkLibraries": ["m"],                      // -lm
//     "build": { "command": "make libfoo.a", "outputs": ["libfoo.a"] }
//   }
//
// El .a se compila una vez: vive en <librería>/.estatic-build/<hash>/, con
// hash(fuentes + flags + compilador). Una versión publicada no cambia, así que
// el siguiente build lo reutiliza. Lo mismo con `build`: solo se ejecuta si
// falta alguno de sus `outputs`.
//
// Orden de enlazado: objetos del programa → .a de las librerías → -l del sistema.
import { jsonObjectGet, jsonAsString, jsonIsObject } from "estatic:json";
import { normalizePath } from "estatic:path";
import { exists, readText, files, directories, rename, remove, objectKeys, environment, hostError, contentHash } from "../platform/index";
import { parseConfig, configStrings } from "./config";
import { run } from "./update";
import { dependencyTarget } from "./packages";

export class NativeBuild {
  includeFlags: string[]; archives: string[]; linkFlags: string[]; failed: boolean;
  constructor() { this.includeFlags = []; this.archives = []; this.linkFlags = []; this.failed = false; }
}

function joinPath(base: string, path: string): string { return normalizePath(path.startsWith("/") ? path : base + "/" + path); }

// "native/*.c" → los .c de native/ (ordenados); una ruta sin * → esa ruta.
export function expandSources(base: string, pattern: string): string[] {
  let result: string[] = [];
  const star: number = pattern.indexOf("*");
  if (star < 0) { result.push(joinPath(base, pattern)); return result; }
  const slash: number = pattern.lastIndexOf("/");
  const directory: string = slash < 0 ? base : joinPath(base, pattern.slice(0, slash));
  const mask: string = slash < 0 ? pattern : pattern.slice(slash + 1, pattern.length);
  const prefix: string = mask.slice(0, mask.indexOf("*"));
  const suffix: string = mask.slice(mask.indexOf("*") + 1, mask.length);
  let names: string[] = [];
  for (const name of files(directory)) if (name.startsWith(prefix) && name.endsWith(suffix) && name.length >= prefix.length + suffix.length) names.push(name);
  names.sort();
  for (const name of names) result.push(directory + "/" + name);
  return result;
}

function words(text: string): string[] {
  let result: string[] = [];
  for (const part of text.replaceAll("\n", " ").replaceAll("\t", " ").split(" ")) if (part != "") result.push(part);
  return result;
}

function pkgConfig(packages: string[], option: string, work: string): string[] {
  let command: string[] = ["pkg-config", option];
  for (const name of packages) command.push(name);
  const output: string = work + "/pkg-config.out";
  if (run(command, output, work + "/pkg-config.err") != 0) { printError("pkg-config " + option + " " + packages.join(" ") + " falló:\n" + readText(work + "/pkg-config.err").trim()); return ["!"]; }
  return words(readText(output));
}

// Compila las fuentes de una librería a <dir>/lib<nombre>.a, o reutiliza el que ya exista.
function archive(name: string, target: string, sources: string[], cflags: string[], cxxflags: string[], includes: string[], cc: string, cxx: string): string {
  let identity: string = "estatic-native-1\n" + name + "\n" + cc + "\n" + cxx + "\n" + cflags.join(" ") + "\n" + cxxflags.join(" ") + "\n" + includes.join(" ") + "\n";
  for (const source of sources) identity = identity + source + "\n" + contentHash(readText(source)) + "\n";
  const directory: string = target + "/.estatic-build/" + contentHash(identity).slice(0, 16);
  const result: string = directory + "/lib" + name + ".a";
  if (exists(result)) return result;
  if (!directories(directory)) { printError(hostError()); return ""; }
  let objects: string[] = [];
  for (let k: number = 0; k < sources.length; k = k + 1) {
    const source: string = sources[k]; const object: string = directory + "/" + numberToString(k) + ".o";
    const c: boolean = source.endsWith(".c");
    let command: string[] = [c ? cc : cxx];
    for (const flag of (c ? cflags : cxxflags)) command.push(flag);
    for (const flag of includes) command.push(flag);
    command.push("-c"); command.push(source); command.push("-o"); command.push(object);
    if (run(command, "", directory + "/build.err") != 0) { printError("No se pudo compilar " + source + " (" + name + "):\n" + readText(directory + "/build.err").trim()); return ""; }
    objects.push(object);
  }
  const partial: string = result + ".tmp";
  let command: string[] = ["ar", "rcs", partial];
  for (const object of objects) command.push(object);
  if (run(command, "", directory + "/ar.err") != 0 || !rename(partial, result)) { printError("No se pudo crear " + result + ":\n" + readText(directory + "/ar.err").trim()); return ""; }
  for (const object of objects) remove(object);
  return result;
}

// Prepara el código nativo de las dependencias. Si algo falla, lo informa y marca failed.
export function nativeDependencies(config: JsonValue, base: string, cxx: string): NativeBuild {
  let result = new NativeBuild();
  const cc: string = environment("CC") != "" ? environment("CC") : "cc";
  const dependencies: JsonValue = jsonObjectGet(config, "dependencies");
  for (const name of objectKeys(dependencies)) {
    const target: string = dependencyTarget(config, base, name);
    if (target == "" || !exists(target + "/estatic.config.json")) continue;
    const library: JsonValue = parseConfig(readText(target + "/estatic.config.json"));
    const native: JsonValue = jsonObjectGet(library, "native");
    if (!jsonIsObject(native)) continue;
    let includes: string[] = [];
    for (const dir of configStrings(jsonObjectGet(native, "includeDirs"))) includes.push("-I" + joinPath(target, dir));
    const packages: string[] = configStrings(jsonObjectGet(native, "pkgConfig"));
    let packageLibs: string[] = [];
    if (packages.length > 0) {
      if (!directories(target + "/.estatic-build")) { printError(hostError()); result.failed = true; return result; }
      const packageFlags: string[] = pkgConfig(packages, "--cflags", target + "/.estatic-build");
      packageLibs = pkgConfig(packages, "--libs", target + "/.estatic-build");
      if (packageFlags.includes("!") || packageLibs.includes("!")) { result.failed = true; return result; }
      for (const flag of packageFlags) includes.push(flag);
    }
    for (const flag of includes) if (!result.includeFlags.includes(flag)) result.includeFlags.push(flag);
    let sources: string[] = [];
    for (const pattern of configStrings(jsonObjectGet(native, "sources"))) for (const source of expandSources(target, pattern)) {
      if (!exists(source)) { printError("Fuente nativa inexistente en " + name + ": " + source); result.failed = true; return result; }
      if (!sources.includes(source)) sources.push(source);
    }
    if (sources.length > 0) {
      const built: string = archive(name, target, sources, configStrings(jsonObjectGet(native, "cflags")), configStrings(jsonObjectGet(native, "cxxflags")), includes, cc, cxx);
      if (built == "") { result.failed = true; return result; }
      result.archives.push(built);
    }
    const build: JsonValue = jsonObjectGet(native, "build");
    if (jsonIsObject(build)) {
      const outputs: string[] = configStrings(jsonObjectGet(build, "outputs"));
      let missing: boolean = false;
      for (const output of outputs) if (!exists(joinPath(target, output))) missing = true;
      const command: string = jsonAsString(jsonObjectGet(build, "command"));
      if (missing && command != "") {
        if (!directories(target + "/.estatic-build")) { printError(hostError()); result.failed = true; return result; }
        if (run(["sh", "-c", "cd '" + target.replaceAll("'", "'\\''") + "' && " + command], "", target + "/.estatic-build/command.err") != 0) { printError("Falló el build nativo de " + name + " (" + command + "):\n" + readText(target + "/.estatic-build/command.err").trim()); result.failed = true; return result; }
      }
      for (const output of outputs) {
        const path: string = joinPath(target, output);
        if (!exists(path)) { printError("El build nativo de " + name + " no creó " + output); result.failed = true; return result; }
        result.archives.push(path);
      }
    }
    for (const flag of packageLibs) if (!result.linkFlags.includes(flag)) result.linkFlags.push(flag);
    for (const library of configStrings(jsonObjectGet(native, "linkLibraries"))) if (!result.linkFlags.includes("-l" + library)) result.linkFlags.push("-l" + library);
  }
  return result;
}
