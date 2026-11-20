// path de Node (variante POSIX) como librería del runtime (#292):
//
//   import path, { join, resolve } from "estatic:path";
//   path.join("a", "b/../c")    // "a/c"
//   path.resolve("x")           // cwd + "/x"
//   path.relative("/a/b", "/a/c/d"), path.parse("/x/y.ts"), path.sep
//
// Es Estatic puro (mismo algoritmo que path.posix de Node); solo resolve()
// pregunta el directorio actual al runtime.

@include("runtime/lib/path.hpp")
@cpp_native("ets_path_lib::cwd") function currentDirectory(): string;
@cpp_native("ets_path_lib::normalizePath") function nativeNormalizePath(path: string): string;
@cpp_native("ets_path_lib::pathDirectory") function nativePathDirectory(path: string): string;

export const sep: string = "/";
export const delimiter: string = ":";

/** Ruta absoluta y normalizada (lexical). Distinto de `normalize`: esta hace
 *  absoluta la ruta, como el builtin `normalizePath` del runtime. */
export function normalizePath(path: string): string { return nativeNormalizePath(path); }
/** El directorio de la ruta. */
export function pathDirectory(path: string): string { return nativePathDirectory(path); }

export interface ParsedPath { root: string; dir: string; base: string; ext: string; name: string }

// Quita "." y "..", y las barras repetidas (normalizeString de Node).
function normalizeString(path: string, allowAboveRoot: boolean): string {
  let res: string = ""; let lastSegmentLength: number = 0; let lastSlash: number = -1; let dots: number = 0;
  for (let i = 0; i <= path.length; i++) {
    let code: number = 47;
    if (i < path.length) code = path.charCodeAt(i);
    if (code == 47) {
      if (lastSlash == i - 1 || dots == 1) {
        // segmento vacío o "."
      } else if (dots == 2) {
        if (res.length < 2 || lastSegmentLength != 2 || res.charCodeAt(res.length - 1) != 46 || res.charCodeAt(res.length - 2) != 46) {
          if (res.length > 2) {
            const lastSlashIndex: number = res.lastIndexOf("/");
            if (lastSlashIndex == -1) { res = ""; lastSegmentLength = 0; }
            else { res = res.slice(0, lastSlashIndex); lastSegmentLength = res.length - 1 - res.lastIndexOf("/"); }
            lastSlash = i; dots = 0; continue;
          } else if (res.length != 0) { res = ""; lastSegmentLength = 0; lastSlash = i; dots = 0; continue; }
        }
        if (allowAboveRoot) { res = res.length > 0 ? res + "/.." : ".."; lastSegmentLength = 2; }
      } else {
        if (res.length > 0) res = res + "/" + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i; dots = 0;
    } else if (code == 46 && dots != -1) dots++;
    else dots = -1;
  }
  return res;
}

export function isAbsolute(path: string): boolean { return path.length > 0 && path.charCodeAt(0) == 47; }

export function normalize(path: string): string {
  if (path.length == 0) return ".";
  const absolute: boolean = isAbsolute(path);
  const trailing: boolean = path.charCodeAt(path.length - 1) == 47;
  let result: string = normalizeString(path, !absolute);
  if (result.length == 0) { if (absolute) return "/"; return trailing ? "./" : "."; }
  if (trailing) result = result + "/";
  return absolute ? "/" + result : result;
}

export function join(...paths: string[]): string {
  let joined: string = "";
  for (const part of paths) if (part.length > 0) joined = joined.length == 0 ? part : joined + "/" + part;
  if (joined.length == 0) return ".";
  return normalize(joined);
}

export function resolve(...paths: string[]): string {
  let resolved: string = ""; let absolute: boolean = false;
  for (let i = paths.length - 1; i >= -1 && !absolute; i--) {
    const path: string = i >= 0 ? paths[i] : currentDirectory();
    if (path.length == 0) continue;
    resolved = path + "/" + resolved;
    absolute = path.charCodeAt(0) == 47;
  }
  resolved = normalizeString(resolved, !absolute);
  if (absolute) return "/" + resolved;
  return resolved.length > 0 ? resolved : ".";
}

export function relative(from: string, to: string): string {
  if (from == to) return "";
  const fromPath: string = resolve(from); const toPath: string = resolve(to);
  if (fromPath == toPath) return "";
  const fromStart: number = 1; const fromLen: number = fromPath.length - fromStart;
  const toStart: number = 1; const toLen: number = toPath.length - toStart;
  const length: number = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep: number = -1; let i: number = 0;
  for (; i < length; i++) {
    const fromCode: number = fromPath.charCodeAt(fromStart + i);
    if (fromCode != toPath.charCodeAt(toStart + i)) break;
    else if (fromCode == 47) lastCommonSep = i;
  }
  if (i == length) {
    if (toLen > length) {
      if (toPath.charCodeAt(toStart + i) == 47) return toPath.slice(toStart + i + 1, toPath.length);
      if (i == 0) return toPath.slice(toStart + i, toPath.length);
    } else if (fromLen > length) {
      if (fromPath.charCodeAt(fromStart + i) == 47) lastCommonSep = i;
      else if (i == 0) lastCommonSep = 0;
    }
  }
  let out: string = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromPath.length; ++i) {
    if (i == fromPath.length || fromPath.charCodeAt(i) == 47) out = out.length == 0 ? ".." : out + "/..";
  }
  return out + toPath.slice(toStart + lastCommonSep, toPath.length);
}

export function dirname(path: string): string {
  if (path.length == 0) return ".";
  const hasRoot: boolean = path.charCodeAt(0) == 47;
  let end: number = -1; let matchedSlash: boolean = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) == 47) { if (!matchedSlash) { end = i; break; } }
    else matchedSlash = false;
  }
  if (end == -1) return hasRoot ? "/" : ".";
  if (hasRoot && end == 1) return "//";
  return path.slice(0, end);
}

// Con ext, la quita del final si coincide (como basename(p, ".ts") en Node).
export function basename(path: string, ext: string = ""): string {
  let start: number = 0; let end: number = -1; let matchedSlash: boolean = true;
  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) == 47) { if (!matchedSlash) { start = i + 1; break; } }
    else if (end == -1) { matchedSlash = false; end = i + 1; }
  }
  if (end == -1) return "";
  const base: string = path.slice(start, end);
  if (ext.length > 0 && ext.length < base.length && base.endsWith(ext)) return base.slice(0, base.length - ext.length);
  if (ext.length > 0 && ext == base) return base;
  return base;
}

export function extname(path: string): string {
  let startDot: number = -1; let startPart: number = 0; let end: number = -1; let matchedSlash: boolean = true; let preDotState: number = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code: number = path.charCodeAt(i);
    if (code == 47) { if (!matchedSlash) { startPart = i + 1; break; } continue; }
    if (end == -1) { matchedSlash = false; end = i + 1; }
    if (code == 46) { if (startDot == -1) startDot = i; else if (preDotState != 1) preDotState = 1; }
    else if (startDot != -1) preDotState = -1;
  }
  if (startDot == -1 || end == -1 || preDotState == 0 || (preDotState == 1 && startDot == end - 1 && startDot == startPart + 1)) return "";
  return path.slice(startDot, end);
}

export function parse(path: string): ParsedPath {
  let root: string = ""; if (isAbsolute(path)) root = "/";
  const base: string = basename(path); const ext: string = extname(path);
  let dir: string = dirname(path);
  if (dir == "." && !(path.startsWith("./") || path == ".")) dir = "";
  return { root: root, dir: dir, base: base, ext: ext, name: base.slice(0, base.length - ext.length) };
}

export function format(parts: ParsedPath): string {
  const dir: string = parts.dir.length > 0 ? parts.dir : parts.root;
  const base: string = parts.base.length > 0 ? parts.base : parts.name + parts.ext;
  if (dir.length == 0) return base;
  return dir == parts.root ? dir + base : dir + "/" + base;
}

export default class path {
  static sep: string = "/";
  static delimiter: string = ":";
  static isAbsolute(p: string): boolean { return isAbsolute(p); }
  static normalize(p: string): string { return normalize(p); }
  static join(...paths: string[]): string { return join(...paths); }
  static resolve(...paths: string[]): string { return resolve(...paths); }
  static relative(from: string, to: string): string { return relative(from, to); }
  static dirname(p: string): string { return dirname(p); }
  static basename(p: string, ext: string = ""): string { return basename(p, ext); }
  static extname(p: string): string { return extname(p); }
  static parse(p: string): ParsedPath { return parse(p); }
  static format(parts: ParsedPath): string { return format(parts); }
}
