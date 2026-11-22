// Argumentos y salida del proceso, sin el resto de estatic:process (#310):
//
//   import { argument, argumentCount, exitProcess } from "estatic:process/args";
//
// estatic:process los reexporta. Este módulo no arrastra los streams de
// stdin/stdout/stderr (libuv), así que un programa que solo necesita argv
// —el propio compilador— no depende de libuv.

@include("runtime/lib/process/args.hpp")
@cpp_native("ets_process_args_lib::argumentAt") function nativeArgumentAt(index: number): string;
@cpp_native("ets_process_args_lib::argumentTotal") function nativeArgumentTotal(): number;
@cpp_native("ets_process_args_lib::exit") function nativeExit(code: number): void;

/** El argumento `index` de argv de C (0 es el ejecutable); "" fuera de rango. */
export function argument(index: number): string { return nativeArgumentAt(index); }
/** Cuántos argumentos tiene argv de C (el ejecutable incluido). */
export function argumentCount(): number { return nativeArgumentTotal(); }
/** Termina el proceso con el código `code`. */
export function exitProcess(code: number): void { nativeExit(code); }
