// Terminal (colores, cursor, tamaño) como librería del runtime (#292):
//
//   import terminal, { color, reset } from "estatic:terminal";
//   color("green"); terminal.writeLine("ok"); reset();
//   terminal.columns(), terminal.isTTY(), terminal.moveTo(0, 0)
//
// Son las mismas operaciones que console.color, console.moveTo... del runtime
// (runtime/ets_terminal.hpp); sin terminal ANSI no escriben secuencias.

@include("runtime/lib/terminal.hpp")
@cpp_native("ets_terminal_lib::write") function nativeWrite(text: string): boolean;
@cpp_native("ets_terminal_lib::writeLine") function nativeWriteLine(text: string): boolean;
@cpp_native("ets_terminal_lib::flush") function nativeFlush(): boolean;
@cpp_native("ets_terminal_lib::isTTY") function nativeIsTTY(): boolean;
@cpp_native("ets_terminal_lib::supportsAnsi") function nativeSupportsAnsi(): boolean;
@cpp_native("ets_terminal_lib::columns") function nativeColumns(): number;
@cpp_native("ets_terminal_lib::rows") function nativeRows(): number;
@cpp_native("ets_terminal_lib::color") function nativeColor(name: string): boolean;
@cpp_native("ets_terminal_lib::background") function nativeBackground(name: string): boolean;
@cpp_native("ets_terminal_lib::style") function nativeStyle(name: string): boolean;
@cpp_native("ets_terminal_lib::reset") function nativeReset(): boolean;
@cpp_native("ets_terminal_lib::clear") function nativeClear(): boolean;
@cpp_native("ets_terminal_lib::clearLine") function nativeClearLine(): boolean;
@cpp_native("ets_terminal_lib::moveTo") function nativeMoveTo(column: number, row: number): boolean;
@cpp_native("ets_terminal_lib::moveBy") function nativeMoveBy(columns: number, rows: number): boolean;
@cpp_native("ets_terminal_lib::hideCursor") function nativeHideCursor(): boolean;
@cpp_native("ets_terminal_lib::showCursor") function nativeShowCursor(): boolean;

// Escribe sin salto de línea.
export function write(text: string): boolean { return nativeWrite(text); }
// Escribe y añade un salto de línea.
export function writeLine(text: string): boolean { return nativeWriteLine(text); }
// Vacía la salida.
export function flush(): boolean { return nativeFlush(); }
// La salida es un terminal.
export function isTTY(): boolean { return nativeIsTTY(); }
// El terminal admite secuencias ANSI.
export function supportsAnsi(): boolean { return nativeSupportsAnsi(); }
// Ancho del terminal (0 si la salida no es un terminal).
export function columns(): number { return nativeColumns(); }
// Alto del terminal (0 si la salida no es un terminal).
export function rows(): number { return nativeRows(); }
// Color del texto ("red", "green"...).
export function color(name: string): boolean { return nativeColor(name); }
// Color de fondo.
export function background(name: string): boolean { return nativeBackground(name); }
// Estilo ("bold", "underline"...).
export function style(name: string): boolean { return nativeStyle(name); }
// Quita colores y estilos.
export function reset(): boolean { return nativeReset(); }
// Borra la pantalla.
export function clear(): boolean { return nativeClear(); }
// Borra la línea actual.
export function clearLine(): boolean { return nativeClearLine(); }
// Mueve el cursor a una posición.
export function moveTo(column: number, row: number): boolean { return nativeMoveTo(column, row); }
// Mueve el cursor en relativo.
export function moveBy(columns: number, rows: number): boolean { return nativeMoveBy(columns, rows); }
// Oculta el cursor.
export function hideCursor(): boolean { return nativeHideCursor(); }
// Muestra el cursor.
export function showCursor(): boolean { return nativeShowCursor(); }

export default class terminal {
  static write(text: string): boolean { return nativeWrite(text); }
  static writeLine(text: string): boolean { return nativeWriteLine(text); }
  static flush(): boolean { return nativeFlush(); }
  static isTTY(): boolean { return nativeIsTTY(); }
  static supportsAnsi(): boolean { return nativeSupportsAnsi(); }
  static columns(): number { return nativeColumns(); }
  static rows(): number { return nativeRows(); }
  static color(name: string): boolean { return nativeColor(name); }
  static background(name: string): boolean { return nativeBackground(name); }
  static style(name: string): boolean { return nativeStyle(name); }
  static reset(): boolean { return nativeReset(); }
  static clear(): boolean { return nativeClear(); }
  static clearLine(): boolean { return nativeClearLine(); }
  static moveTo(column: number, row: number): boolean { return nativeMoveTo(column, row); }
  static moveBy(columns: number, rows: number): boolean { return nativeMoveBy(columns, rows); }
  static hideCursor(): boolean { return nativeHideCursor(); }
  static showCursor(): boolean { return nativeShowCursor(); }
}
