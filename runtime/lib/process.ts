// process de Node como librería del runtime (no es global, #292):
//
//   import process from "estatic:process";
//   process.argv, process.argc, process.env, process.platform, process.pid,
//   process.cwd(), process.exit(1),
//   process.stdin.on("data", ...), process.stdout.write("...")
//
// Son bindings al runtime C++ de siempre (runtime/lib/process.hpp). El builtin
// global `process` sigue existiendo mientras compiler/ lo use.

@include("runtime/lib/process.hpp")
@cpp_native("ets_process_lib::argv") function nativeArgv(): string[];
@cpp_native("ets_process_lib::argc") function nativeArgc(): number;
@cpp_native("ets_process_lib::cwd") function nativeCwd(): string;
@cpp_native("ets_process_lib::exit") function nativeExit(code: number): void;
@cpp_native("ets_process_lib::pid") function nativePid(): number;
@cpp_native("ets_process_lib::platform") function nativePlatform(): string;
@cpp_native("ets_process_lib::env") function nativeEnv(): Record<string, string>;
@cpp_native("ets_process_lib::stdinStream") function nativeStdin(): ProcessReadable;
@cpp_native("ets_process_lib::stdoutStream") function nativeStdout(): ProcessWritable;
@cpp_native("ets_process_lib::stderrStream") function nativeStderr(): ProcessWritable;

export class Process {
  argv: string[];
  argc: number;
  env: Record<string, string>;
  platform: string;
  pid: number;
  stdin: ProcessReadable;
  stdout: ProcessWritable;
  stderr: ProcessWritable;
  constructor() {
    this.argv = nativeArgv(); this.argc = nativeArgc(); this.env = nativeEnv();
    this.platform = nativePlatform(); this.pid = nativePid();
    this.stdin = nativeStdin(); this.stdout = nativeStdout(); this.stderr = nativeStderr();
  }
  cwd(): string { return nativeCwd(); }
  exit(code: number = 0): void { nativeExit(code); }
}

const process: Process = new Process();
export default process;

// ── Los mismos nombres que tenían los builtins ────────────────────────────
// El runtime exponía esta API como builtin global (argument, argumentCount,
// exitProcess). Aquí están con el mismo nombre, asi que un
// `import { argument } from "estatic:process"` sombrea al builtin y el
// código que lo usaba no cambia: solo la línea de import.

/** El argumento `index` de la línea de comandos. */
export function argument(index: number): string { return process.argv[index]; }
/** Cuántos argumentos hay en la línea de comandos. */
export function argumentCount(): number { return process.argv.length; }
/** Termina el proceso con el código `code`. */
export function exitProcess(code: number): void { process.exit(code); }
