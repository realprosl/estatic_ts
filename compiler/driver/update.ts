// etsc update [versión] [--list] [--dry-run] [-- opciones de install.sh] (#190)
//
// Actualiza la instalación actual (<prefix>/bin/etsc) a la última versión
// publicada o a una concreta. Las versiones son las etiquetas vX.Y.Z del
// repositorio (una por PR fusionada en main). Se descarga esa etiqueta con git
// y se ejecuta su install.sh con el mismo prefijo; install.sh publica en
// lib/estc/releases/<id> y cambia `current` de golpe, así que si algo falla la
// versión anterior sigue funcionando.
import { environment, executable, exists, readText, writeText, remove, temporaryDirectory, launch, poll, pause, hostError } from "../platform/index";
import { jsonObjectGet, jsonAsString, jsonIsObject } from "estatic:json";
import { exitProcess } from "estatic:process/args";

const defaultRepository: string = "https://github.com/realprosl/estatic_ts.git";

function updateError(message: string, status: number = 1): void { printError(message); exitProcess(status); }

function parentPath(path: string): string { let end: number = -1; for (let k: number = 0; k < path.length; k = k + 1) if (path.charAt(k) == "/") end = k; return end <= 0 ? "/" : path.slice(0, end); }

// Ejecuta y espera; la salida va a `output` si se indica.
export function run(command: string[], output: string = "", errors: string = ""): number {
  const pid: number = launch(command, output, errors); if (pid < 0) updateError(hostError());
  let status: number = poll(pid); while (status < 0) { pause(80); status = poll(pid); }
  return status;
}

// "v1.77.0" o "1.77.0" → [1, 77, 0]; [] si no es una versión X.Y.Z.
export function versionParts(text: string): number[] {
  let value: string = text.startsWith("v") ? text.slice(1, text.length) : text;
  const pieces: string[] = value.split("."); let parts: number[] = [];
  if (pieces.length != 3) return parts;
  for (const piece of pieces) {
    if (piece.length == 0) { let none: number[] = []; return none; }
    let digits: number = 0;
    for (let k: number = 0; k < piece.length; k = k + 1) { const c: number = piece.charCodeAt(k); if (c < 48 || c > 57) { let none: number[] = []; return none; } digits = digits * 10 + c - 48; }
    parts.push(digits);
  }
  return parts;
}

// a < b por semver (v1.100.0 va después de v1.99.0).
export function versionBefore(a: string, b: string): boolean {
  const x: number[] = versionParts(a); const y: number[] = versionParts(b);
  for (let k: number = 0; k < 3; k = k + 1) if (x[k] != y[k]) return x[k] < y[k];
  return false;
}

// Etiquetas vX.Y.Z de `git ls-remote --tags --refs`, ordenadas por semver.
export function parseVersionTags(text: string): string[] {
  let versions: string[] = [];
  for (const line of text.split("\n")) {
    const at: number = line.lastIndexOf("refs/tags/"); if (at < 0) continue;
    const tag: string = line.slice(at + 10, line.length);
    if (tag.startsWith("v") && versionParts(tag).length == 3 && !versions.includes(tag)) versions.push(tag);
  }
  for (let i: number = 1; i < versions.length; i = i + 1) {
    const current: string = versions[i]; let j: number = i - 1;
    while (j >= 0 && versionBefore(current, versions[j])) { versions[j + 1] = versions[j]; j = j - 1; }
    versions[j + 1] = current;
  }
  return versions;
}

function installedVersion(home: string): string {
  if (!exists(home + "/installation.json")) return "";
  const info = JSON.parseValue(readText(home + "/installation.json"));
  if (!jsonIsObject(info)) return "";
  const version: string = jsonAsString(jsonObjectGet(info, "packageVersion"));
  return version == "" ? "" : "v" + version;
}

export function updateCommand(args: string[]): void {
  let target: string = ""; let list: boolean = false; let dry: boolean = false; let installArgs: string[] = [];
  for (let k: number = 1; k < args.length; k = k + 1) {
    if (args[k] == "--") { for (let m: number = k + 1; m < args.length; m = m + 1) installArgs.push(args[m]); break; }
    if (args[k] == "--list") list = true;
    else if (args[k] == "--dry-run") dry = true;
    else if (args[k].startsWith("-") || target != "") updateError("Uso: etsc update [versión] [--list | --dry-run] [-- opciones de install.sh]", 2);
    else target = args[k];
  }
  if (target != "" && versionParts(target).length != 3) updateError("Versión no válida: '" + target + "' (formato X.Y.Z, p. ej. 1.77.0)", 2);
  // La instalación es <prefix>/bin/etsc + <prefix>/lib/estc/current.
  const prefix: string = parentPath(parentPath(executable())); const home: string = prefix + "/lib/estc/current";
  if (!exists(home + "/runtime/ets_runtime.hpp")) updateError("etsc update solo funciona con un etsc instalado (<prefix>/bin/etsc y <prefix>/lib/estc/current)");
  let repository: string = environment("ESTC_REPO"); if (repository == "") repository = defaultRepository;
  const installed: string = installedVersion(home);
  const work: string = temporaryDirectory(); if (work == "") updateError(hostError());
  const status: number = run(["git", "ls-remote", "--tags", "--refs", repository], work + "/tags", work + "/tags.err");
  if (status != 0) { run(["rm", "-rf", work]); updateError("No se pudieron consultar las versiones de " + repository + "\nayuda: comprueba que tienes git y conexión, o usa ESTC_REPO para otro repositorio"); }
  const versions: string[] = parseVersionTags(readText(work + "/tags"));
  if (versions.length == 0) { run(["rm", "-rf", work]); updateError("No hay versiones publicadas (etiquetas vX.Y.Z) en " + repository); }
  if (list) {
    for (const version of versions) print(version + (version == installed ? "  (instalada)" : ""));
    run(["rm", "-rf", work]); return;
  }
  const wanted: string = target == "" ? versions[versions.length - 1] : (target.startsWith("v") ? target : "v" + target);
  if (!versions.includes(wanted)) {
    let recent: string[] = []; for (let k: number = versions.length - 1; k >= 0 && recent.length < 5; k = k - 1) recent.push(versions[k]);
    run(["rm", "-rf", work]); updateError("No existe la versión " + wanted + "\nayuda: versiones recientes: " + recent.join(", ") + " (etsc update --list para verlas todas)");
  }
  if (wanted == installed) { print("etsc ya está en " + wanted); run(["rm", "-rf", work]); return; }
  if (dry) { print("etsc " + (installed == "" ? "(versión desconocida)" : installed) + " → " + wanted); run(["rm", "-rf", work]); exitProcess(1); }
  // Comprobar permisos antes de descargar nada.
  const probe: string = prefix + "/lib/estc/.etsc-update-" + wanted;
  if (!writeText(probe, "")) { run(["rm", "-rf", work]); updateError("Sin permisos para escribir en " + prefix + "\nayuda: sudo etsc update " + (target == "" ? "" : target)); }
  remove(probe);
  print("Actualizando etsc " + (installed == "" ? "" : installed + " ") + "→ " + wanted);
  if (run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", wanted, repository, work + "/estatic_ts"]) != 0) { run(["rm", "-rf", work]); updateError("No se pudo descargar " + wanted + " de " + repository); }
  let install: string[] = ["bash", work + "/estatic_ts/install.sh", "--prefix", prefix]; for (const arg of installArgs) install.push(arg);
  const installed2: number = run(install);
  run(["rm", "-rf", work]);
  if (installed2 != 0) updateError("La instalación de " + wanted + " falló; se conserva la versión anterior" + (installed == "" ? "" : " (" + installed + ")"), installed2);
  print("✓ etsc actualizado a " + wanted);
}
