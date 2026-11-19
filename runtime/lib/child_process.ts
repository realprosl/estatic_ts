// child_process de Node como librería del runtime (#292):
//
//   import child_process, { spawnSync, execSync } from "estatic:child_process";
//   const r = spawnSync("ls", ["-l"]);            // { status, stdout, stderr, error }
//   const salida = execSync("echo hola | tr a-z A-Z");   // Result<string, Error>
//   const hijo = child_process.spawn("cat", []);  // async: hijo.stdout.on("data", ...)
//
// spawn es el ChildProcess de siempre del runtime (libuv); spawnSync y
// execSync esperan a que termine el proceso (runtime/lib/child_process.hpp).

@include("runtime/lib/child_process.hpp")
import { Error, BaseError } from "../prelude/error";

@cpp_native("ets_child_process_lib::spawn") function nativeSpawn(command: string, args: string[]): ChildProcess;
@cpp_native("ets_child_process_lib::spawnSync") function nativeSpawnSync(command: string, args: string[], input: string): string[];

export interface SpawnSyncOptions { input?: string }

export class SpawnSyncReturns {
  // Código de salida (128 + señal si murió por una señal); -1 si no arrancó.
  status: number; stdout: string; stderr: string; error: Error | undefined;
  constructor(status: number, stdout: string, stderr: string, error: Error | undefined) { this.status = status; this.stdout = stdout; this.stderr = stderr; this.error = error; }
}

function statusNumber(text: string): number {
  let value: number = 0; let sign: number = 1; let at: number = 0;
  if (text.startsWith("-")) { sign = -1; at = 1; }
  for (; at < text.length; at++) value = value * 10 + (text.charCodeAt(at) - 48);
  return sign * value;
}

export function spawn(command: string, args: string[] = []): ChildProcess { return nativeSpawn(command, args); }

export function spawnSync(command: string, args: string[] = [], options?: SpawnSyncOptions): SpawnSyncReturns {
  const input: string = options === undefined ? "" : (options.input ?? "");
  const parts: string[] = nativeSpawnSync(command, args, input);
  let error: Error | undefined = undefined;
  if (parts[3] != "") error = new BaseError(parts[3]);
  return new SpawnSyncReturns(statusNumber(parts[0]), parts[1], parts[2], error);
}

// Lanza la orden con /bin/sh -c y devuelve su salida; si falla (no arranca o
// sale con código distinto de 0), un Error con el código y su stderr.
export function execSync(command: string, options?: SpawnSyncOptions): Result<string, Error> {
  let args: string[] = ["-c", command];
  const r: SpawnSyncReturns = spawnSync("/bin/sh", args, options);
  if (r.error !== undefined) return resultErr<string, Error>(r.error);
  if (r.status != 0) return resultErr<string, Error>(new BaseError("Command failed: " + command + " (status " + numberToString(r.status) + ")" + (r.stderr == "" ? "" : "\n" + r.stderr)));
  return resultOk<string, Error>(r.stdout);
}

export default class child_process {
  static spawn(command: string, args: string[] = []): ChildProcess { return spawn(command, args); }
  static spawnSync(command: string, args: string[] = [], options?: SpawnSyncOptions): SpawnSyncReturns { return spawnSync(command, args, options); }
  static execSync(command: string, options?: SpawnSyncOptions): Result<string, Error> { return execSync(command, options); }
}
