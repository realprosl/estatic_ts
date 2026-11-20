// fs de Node como librería del runtime (#292):
//
//   import fs, { readFileSync, readFile } from "estatic:fs";
//   const texto = fs.readFileSync("a.txt");          // Result<string, Error>
//   const r = await fs.readFile("a.txt");             // async, sobre libuv
//   fs.writeFileSync("b.txt", "hola"); fs.existsSync("b.txt");
//   fs.mkdirSync("dir", { recursive: true }); fs.readdirSync("dir");
//   fs.statSync("b.txt")  // Result<Stats, Error>: isFile(), isDirectory(), size, mtimeMs
//
// Sin excepciones: lo que en Node lanza aquí devuelve Result<T, Error>. Son
// bindings al runtime de siempre (runtime/ets_file.hpp, runtime/lib/fs.hpp).

@include("runtime/lib/fs.hpp")
import { Error, BaseError } from "../prelude/error";

@cpp_native("ets_fs_lib::readFileSync") function nativeReadSync(path: string): Result<string, string>;
@cpp_native("ets_fs_lib::writeFileSync") function nativeWriteSync(path: string, data: string): Result<boolean, string>;
@cpp_native("ets_fs_lib::appendFileSync") function nativeAppendSync(path: string, data: string): Result<boolean, string>;
@cpp_native("ets_fs_lib::copyFileSync") function nativeCopySync(from: string, to: string): Result<boolean, string>;
@cpp_native("ets_fs_lib::renameSync") function nativeRenameSync(from: string, to: string): Result<boolean, string>;
@cpp_native("ets_fs_lib::unlinkSync") function nativeUnlinkSync(path: string): Result<boolean, string>;
@cpp_native("ets_fs_lib::existsSync") function nativeExists(path: string): boolean;
@cpp_native("ets_fs_lib::mkdirSync") function nativeMkdir(path: string, recursive: boolean): Result<boolean, string>;
@cpp_native("ets_fs_lib::readdirSync") function nativeReaddir(path: string): Result<string[], string>;
@cpp_native("ets_fs_lib::rmSync") function nativeRm(path: string, recursive: boolean): Result<boolean, string>;
@cpp_native("ets_fs_lib::stat") function nativeStat(path: string): number[];
@cpp_native("ets_fs_lib::readFile") function nativeRead(path: string): Promise<Result<string, string>>;
@cpp_native("ets_fs_lib::writeFile") function nativeWrite(path: string, data: string): Promise<Result<boolean, string>>;
@cpp_native("ets_fs_lib::appendFile") function nativeAppend(path: string, data: string): Promise<Result<boolean, string>>;
@cpp_native("ets_fs_lib::copyFile") function nativeCopy(from: string, to: string): Promise<Result<boolean, string>>;
@cpp_native("ets_fs_lib::rename") function nativeRename(from: string, to: string): Promise<Result<boolean, string>>;
@cpp_native("ets_fs_lib::unlink") function nativeUnlink(path: string): Promise<Result<boolean, string>>;

export interface MakeDirectoryOptions { recursive?: boolean }
export interface RmOptions { recursive?: boolean }

export class Stats {
  size: number; mtimeMs: number; kind: number;
  constructor(kind: number, size: number, mtimeMs: number) { this.kind = kind; this.size = size; this.mtimeMs = mtimeMs; }
  isFile(): boolean { return this.kind == 1; }
  isDirectory(): boolean { return this.kind == 2; }
}

function text(r: Result<string, string>): Result<string, Error> {
  if (r.isOk()) return resultOk<string, Error>(r.value());
  return resultErr<string, Error>(new BaseError(r.error()));
}
function done(r: Result<boolean, string>): Result<boolean, Error> {
  if (r.isOk()) return resultOk<boolean, Error>(true);
  return resultErr<boolean, Error>(new BaseError(r.error()));
}

export function readFileSync(path: string): Result<string, Error> { return text(nativeReadSync(path)); }
export function writeFileSync(path: string, data: string): Result<boolean, Error> { return done(nativeWriteSync(path, data)); }
export function appendFileSync(path: string, data: string): Result<boolean, Error> { return done(nativeAppendSync(path, data)); }
export function copyFileSync(from: string, to: string): Result<boolean, Error> { return done(nativeCopySync(from, to)); }
export function renameSync(from: string, to: string): Result<boolean, Error> { return done(nativeRenameSync(from, to)); }
export function unlinkSync(path: string): Result<boolean, Error> { return done(nativeUnlinkSync(path)); }
export function existsSync(path: string): boolean { return nativeExists(path); }
export function mkdirSync(path: string, options?: MakeDirectoryOptions): Result<boolean, Error> {
  const recursive: boolean = options === undefined ? false : (options.recursive ?? false);
  return done(nativeMkdir(path, recursive));
}
export function rmSync(path: string, options?: RmOptions): Result<boolean, Error> {
  const recursive: boolean = options === undefined ? false : (options.recursive ?? false);
  return done(nativeRm(path, recursive));
}
export function readdirSync(path: string): Result<string[], Error> {
  const r: Result<string[], string> = nativeReaddir(path);
  if (r.isOk()) return resultOk<string[], Error>(r.value());
  return resultErr<string[], Error>(new BaseError(r.error()));
}
export function statSync(path: string): Result<Stats, Error> {
  const info: number[] = nativeStat(path);
  if (info[0] == 0) return resultErr<Stats, Error>(new BaseError("ENOENT: no existe '" + path + "'"));
  return resultOk<Stats, Error>(new Stats(info[0], info[1], info[2]));
}

export async function readFile(path: string): Promise<Result<string, Error>> { return text(await nativeRead(path)); }
export async function writeFile(path: string, data: string): Promise<Result<boolean, Error>> { return done(await nativeWrite(path, data)); }
export async function appendFile(path: string, data: string): Promise<Result<boolean, Error>> { return done(await nativeAppend(path, data)); }
export async function copyFile(from: string, to: string): Promise<Result<boolean, Error>> { return done(await nativeCopy(from, to)); }
export async function rename(from: string, to: string): Promise<Result<boolean, Error>> { return done(await nativeRename(from, to)); }
export async function unlink(path: string): Promise<Result<boolean, Error>> { return done(await nativeUnlink(path)); }

export default class fs {
  static readFileSync(path: string): Result<string, Error> { return readFileSync(path); }
  static writeFileSync(path: string, data: string): Result<boolean, Error> { return writeFileSync(path, data); }
  static appendFileSync(path: string, data: string): Result<boolean, Error> { return appendFileSync(path, data); }
  static copyFileSync(from: string, to: string): Result<boolean, Error> { return copyFileSync(from, to); }
  static renameSync(from: string, to: string): Result<boolean, Error> { return renameSync(from, to); }
  static unlinkSync(path: string): Result<boolean, Error> { return unlinkSync(path); }
  static existsSync(path: string): boolean { return existsSync(path); }
  static mkdirSync(path: string, options?: MakeDirectoryOptions): Result<boolean, Error> { return mkdirSync(path, options); }
  static rmSync(path: string, options?: RmOptions): Result<boolean, Error> { return rmSync(path, options); }
  static readdirSync(path: string): Result<string[], Error> { return readdirSync(path); }
  static statSync(path: string): Result<Stats, Error> { return statSync(path); }
  static readFile(path: string): Promise<Result<string, Error>> { return readFile(path); }
  static writeFile(path: string, data: string): Promise<Result<boolean, Error>> { return writeFile(path, data); }
  static appendFile(path: string, data: string): Promise<Result<boolean, Error>> { return appendFile(path, data); }
  static copyFile(from: string, to: string): Promise<Result<boolean, Error>> { return copyFile(from, to); }
  static rename(from: string, to: string): Promise<Result<boolean, Error>> { return rename(from, to); }
  static unlink(path: string): Promise<Result<boolean, Error>> { return unlink(path); }
}
