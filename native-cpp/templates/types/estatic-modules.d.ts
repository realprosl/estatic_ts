// ─── Librerías del runtime (`estatic:*`) ────────────────────────────────
//
// Cada módulo es una librería del runtime y se importa por su nombre:
//
//   import Math from "estatic:math";
//   import { readFile } from "estatic:fs";
//
// Los bloques siguientes están GENERADOS por
// `scripts/generate-estatic-modules-dts.ts` a partir de `runtime/lib/`:
// si cambia una librería, se regenera (`npm run generate:estatic-dts`) y
// `test/unit/estatic-modules-dts.test.ts` falla si el `.d.ts` está viejo.

declare module "estatic:child_process" {
  export interface SpawnSyncOptions { input?: string }
  export class SpawnSyncReturns {
  status: number;
  stdout: string;
  stderr: string;
  error: Error | undefined;
  constructor(status: number, stdout: string, stderr: string, error: Error | undefined);
  }
  export function spawn(command: string, args?: string[]): ChildProcess;
  export function spawnSync(command: string, args?: string[], options?: SpawnSyncOptions): SpawnSyncReturns;
  export function execSync(command: string, options?: SpawnSyncOptions): Result<string, Error>;
  export default class child_process {
  static spawn(command: string, args?: string[]): ChildProcess;
  static spawnSync(command: string, args?: string[], options?: SpawnSyncOptions): SpawnSyncReturns;
  static execSync(command: string, options?: SpawnSyncOptions): Result<string, Error>;
  }
}

declare module "estatic:date" {
  export function parse(text: string): number;
  export function UTC(year: number, month?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number;
  export function now(): number;
  export default class Date {
  time: number;
  constructor(value?: number | string, month?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number);
  static now(): number;
  static parse(text: string): number;
  static UTC(year: number, month?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number;
  getTime(): number;
  valueOf(): number;
  getTimezoneOffset(): number;
  getUTCFullYear(): number;
  getUTCMonth(): number;
  getUTCDate(): number;
  getUTCDay(): number;
  getUTCHours(): number;
  getUTCMinutes(): number;
  getUTCSeconds(): number;
  getUTCMilliseconds(): number;
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getDay(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
  getMilliseconds(): number;
  setTime(time: number): number;
  setUTCFullYear(year: number, month?: number, date?: number): number;
  setUTCMonth(month: number, date?: number): number;
  setUTCDate(date: number): number;
  setUTCHours(hours: number, minutes?: number, seconds?: number, ms?: number): number;
  setUTCMinutes(minutes: number, seconds?: number, ms?: number): number;
  setUTCSeconds(seconds: number, ms?: number): number;
  setUTCMilliseconds(ms: number): number;
  setFullYear(year: number, month?: number, date?: number): number;
  setMonth(month: number, date?: number): number;
  setDate(date: number): number;
  setHours(hours: number, minutes?: number, seconds?: number, ms?: number): number;
  setMinutes(minutes: number, seconds?: number, ms?: number): number;
  setSeconds(seconds: number, ms?: number): number;
  setMilliseconds(ms: number): number;
  partUTC(part: number, t: number): number;
  toISOString(): string;
  toJSON(): string;
  toDateString(): string;
  toTimeString(): string;
  toString(): string;
  toUTCString(): string;
  }
}

declare module "estatic:dns" {
  export function lookup(host: string): Promise<Result<string, Error>>;
  export default class dns {
  static lookup(host: string): Promise<Result<string, Error>>;
  }
}

declare module "estatic:fetch" {
  export interface RequestInit { method?: string; headers?: Record<string, string>; body?: string }
  export class Headers {
  names: string[];
  values: string[];
  constructor(names: string[], values: string[]);
  get(name: string): string | undefined;
  has(name: string): boolean;
  }
  export class Response {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  body: string;
  constructor(url: string, status: number, headers: Headers, body: string);
  text(): Promise<string>;
  }
  export default function fetch(url: string, init?: RequestInit): Promise<Result<Response, Error>>;
}

declare module "estatic:fs" {
  export interface MakeDirectoryOptions { recursive?: boolean }
  export interface RmOptions { recursive?: boolean }
  export class Stats {
  size: number;
  mtimeMs: number;
  kind: number;
  constructor(kind: number, size: number, mtimeMs: number);
  isFile(): boolean;
  isDirectory(): boolean;
  }
  export function readFileSync(path: string): Result<string, Error>;
  export function writeFileSync(path: string, data: string): Result<boolean, Error>;
  export function appendFileSync(path: string, data: string): Result<boolean, Error>;
  export function copyFileSync(from: string, to: string): Result<boolean, Error>;
  export function renameSync(from: string, to: string): Result<boolean, Error>;
  export function unlinkSync(path: string): Result<boolean, Error>;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: MakeDirectoryOptions): Result<boolean, Error>;
  export function rmSync(path: string, options?: RmOptions): Result<boolean, Error>;
  export function readdirSync(path: string): Result<string[], Error>;
  export function statSync(path: string): Result<Stats, Error>;
  export function readFile(path: string): Promise<Result<string, Error>>;
  export function writeFile(path: string, data: string): Promise<Result<boolean, Error>>;
  export function appendFile(path: string, data: string): Promise<Result<boolean, Error>>;
  export function copyFile(from: string, to: string): Promise<Result<boolean, Error>>;
  export function rename(from: string, to: string): Promise<Result<boolean, Error>>;
  export function unlink(path: string): Promise<Result<boolean, Error>>;
  export default class fs {
  static readFileSync(path: string): Result<string, Error>;
  static writeFileSync(path: string, data: string): Result<boolean, Error>;
  static appendFileSync(path: string, data: string): Result<boolean, Error>;
  static copyFileSync(from: string, to: string): Result<boolean, Error>;
  static renameSync(from: string, to: string): Result<boolean, Error>;
  static unlinkSync(path: string): Result<boolean, Error>;
  static existsSync(path: string): boolean;
  static mkdirSync(path: string, options?: MakeDirectoryOptions): Result<boolean, Error>;
  static rmSync(path: string, options?: RmOptions): Result<boolean, Error>;
  static readdirSync(path: string): Result<string[], Error>;
  static statSync(path: string): Result<Stats, Error>;
  static readFile(path: string): Promise<Result<string, Error>>;
  static writeFile(path: string, data: string): Promise<Result<boolean, Error>>;
  static appendFile(path: string, data: string): Promise<Result<boolean, Error>>;
  static copyFile(from: string, to: string): Promise<Result<boolean, Error>>;
  static rename(from: string, to: string): Promise<Result<boolean, Error>>;
  static unlink(path: string): Promise<Result<boolean, Error>>;
  }
}

declare module "estatic:http" {
    interface RequestInit { method?: string; headers?: Record<string, string>; body?: string }
    class Headers {
    names: string[];
    values: string[];
    constructor(names: string[], values: string[]);
    get(name: string): string | undefined;
    has(name: string): boolean;
    }
    class FetchResponse {
    status: number;
    ok: boolean;
    url: string;
    headers: Headers;
    body: string;
    constructor(url: string, status: number, headers: Headers, body: string);
    text(): Promise<string>;
    }
  export function createServer(): Server;
  export function param(request: Request, name: string): string;
  export function query(request: Request, name: string): string;
  export function header(request: Request, name: string): string;
  export function fetch(url: string, init?: RequestInit): Promise<Result<FetchResponse, Error>>;
  export default class http {
  static createServer(): Server;
  static param(request: Request, name: string): string;
  static query(request: Request, name: string): string;
  static header(request: Request, name: string): string;
  static fetch(url: string, init?: RequestInit): Promise<Result<FetchResponse, Error>>;
  }
}

declare module "estatic:http/drogon" {
    interface RequestInit { method?: string; headers?: Record<string, string>; body?: string }
    class Headers {
    names: string[];
    values: string[];
    constructor(names: string[], values: string[]);
    get(name: string): string | undefined;
    has(name: string): boolean;
    }
    class FetchResponse {
    status: number;
    ok: boolean;
    url: string;
    headers: Headers;
    body: string;
    constructor(url: string, status: number, headers: Headers, body: string);
    text(): Promise<string>;
    }
  export function createServer(): Server;
  export function param(request: Request, name: string): string;
  export function query(request: Request, name: string): string;
  export function header(request: Request, name: string): string;
  export function fetch(url: string, init?: RequestInit): Promise<Result<FetchResponse, Error>>;
  export default class http {
  static createServer(): Server;
  static param(request: Request, name: string): string;
  static query(request: Request, name: string): string;
  static header(request: Request, name: string): string;
  static fetch(url: string, init?: RequestInit): Promise<Result<FetchResponse, Error>>;
  }
}

declare module "estatic:json" {
  export function stringify<T>(value: T, replacer?: string[], space?: number | string): string;
  export function parse<T = JsonValue>(text: string): Result<T, Error>;
  export function objectGet(value: JsonValue, key: string): JsonValue;
  export function objectKeys(value: JsonValue): string[];
  export function arrayGet(value: JsonValue, index: number): JsonValue;
  export function arrayLength(value: JsonValue): number;
  export function asString(value: JsonValue): string;
  export function asNumber(value: JsonValue): number;
  export function asBool(value: JsonValue): boolean;
  export function isObject(value: JsonValue): boolean;
  export function isArray(value: JsonValue): boolean;
  export function isString(value: JsonValue): boolean;
  export function isNumber(value: JsonValue): boolean;
  export function isBool(value: JsonValue): boolean;
  export function isNull(value: JsonValue): boolean;
  export function escape(text: string): string;
  export default class JSON {
  }
}

declare module "estatic:math" {
  export const E: number;
  export const LN10: number;
  export const LN2: number;
  export const LOG10E: number;
  export const LOG2E: number;
  export const PI: number;
  export const SQRT1_2: number;
  export const SQRT2: number;
  export function round(x: number): number;
  export function sign(x: number): number;
  export function pow(x: number, y: number): number;
  export function min(...values: number[]): number;
  export function max(...values: number[]): number;
  export function hypot(...values: number[]): number;
  export default class Math {
  static E: number;
  static LN10: number;
  static LN2: number;
  static LOG10E: number;
  static LOG2E: number;
  static PI: number;
  static SQRT1_2: number;
  static SQRT2: number;
  static abs(x: number): number;
  static acos(x: number): number;
  static acosh(x: number): number;
  static asin(x: number): number;
  static asinh(x: number): number;
  static atan(x: number): number;
  static atan2(y: number, x: number): number;
  static atanh(x: number): number;
  static cbrt(x: number): number;
  static ceil(x: number): number;
  static clz32(x: number): number;
  static cos(x: number): number;
  static cosh(x: number): number;
  static exp(x: number): number;
  static expm1(x: number): number;
  static floor(x: number): number;
  static fround(x: number): number;
  static hypot(...values: number[]): number;
  static imul(a: number, b: number): number;
  static log(x: number): number;
  static log10(x: number): number;
  static log1p(x: number): number;
  static log2(x: number): number;
  static max(...values: number[]): number;
  static min(...values: number[]): number;
  static pow(x: number, y: number): number;
  static random(): number;
  static round(x: number): number;
  static sign(x: number): number;
  static sin(x: number): number;
  static sinh(x: number): number;
  static sqrt(x: number): number;
  static tan(x: number): number;
  static tanh(x: number): number;
  static trunc(x: number): number;
  }
}

declare module "estatic:net" {
  export class Socket {
  connection: TcpConnection;
  constructor(connection: TcpConnection);
  read(maxBytes?: number): Promise<Result<string, Error>>;
  write(data: string): Promise<Result<number, Error>>;
  end(): void;
  }
  export class Server {
  listener: TcpListener;
  constructor(listener: TcpListener);
  accept(): Promise<Result<Socket, Error>>;
  close(): void;
  }
  export function listen(port: number, host?: string): Result<Server, Error>;
  export function connect(port: number, host?: string): Promise<Result<Socket, Error>>;
  export default class net {
  static listen(port: number, host?: string): Result<Server, Error>;
  static connect(port: number, host?: string): Promise<Result<Socket, Error>>;
  }
}

declare module "estatic:number" {
  export const NaN: number;
  export const Infinity: number;
  export function toFixed(x: number, digits?: number): string;
  export function toExponential(x: number, digits?: number): string;
  export function toPrecision(x: number, precision?: number): string;
  export function toString(x: number, radix?: number): string;
  export function isNaN(x: number): boolean;
  export function isFinite(x: number): boolean;
  export function isInteger(x: number): boolean;
  export function isSafeInteger(x: number): boolean;
  export function parseFloat(text: string): number;
  export function parseInt(text: string, radix?: number): number;
  export default class Number {
  static EPSILON: number;
  static MAX_SAFE_INTEGER: number;
  static MIN_SAFE_INTEGER: number;
  static MAX_VALUE: number;
  static MIN_VALUE: number;
  static POSITIVE_INFINITY: number;
  static NEGATIVE_INFINITY: number;
  static NaN: number;
  static isNaN(x: number): boolean;
  static isFinite(x: number): boolean;
  static isInteger(x: number): boolean;
  static isSafeInteger(x: number): boolean;
  static parseFloat(text: string): number;
  static parseInt(text: string, radix?: number): number;
  }
}

declare module "estatic:path" {
  export const sep: string;
  export const delimiter: string;
  export interface ParsedPath { root: string; dir: string; base: string; ext: string; name: string }
  export function isAbsolute(path: string): boolean;
  export function normalize(path: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function parse(path: string): ParsedPath;
  export function format(parts: ParsedPath): string;
  export default class path {
  static sep: string;
  static delimiter: string;
  static isAbsolute(p: string): boolean;
  static normalize(p: string): string;
  static join(...paths: string[]): string;
  static resolve(...paths: string[]): string;
  static relative(from: string, to: string): string;
  static dirname(p: string): string;
  static basename(p: string, ext?: string): string;
  static extname(p: string): string;
  static parse(p: string): ParsedPath;
  static format(parts: ParsedPath): string;
  }
}

declare module "estatic:process" {
  export class Process {
  argv: string[];
  argc: number;
  env: Record<string, string>;
  platform: string;
  pid: number;
  stdin: ProcessReadable;
  stdout: ProcessWritable;
  stderr: ProcessWritable;
  constructor();
  cwd(): string;
  exit(code?: number): void;
  }
  const process: Process;
  export default process;
}

declare module "estatic:regexp" {
  export default class RegExp {
  source: string;
  flags: string;
  lastIndex: number;
  global: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  sticky: boolean;
  lastMatchIndex: number;
  constructor(pattern: string, flags?: string);
  exec(text: string): string[] | undefined;
  test(text: string): boolean;
  toString(): string;
  }
}

declare module "estatic:terminal" {
  export function write(text: string): boolean;
  export function writeLine(text: string): boolean;
  export function flush(): boolean;
  export function isTTY(): boolean;
  export function supportsAnsi(): boolean;
  export function columns(): number;
  export function rows(): number;
  export function color(name: string): boolean;
  export function background(name: string): boolean;
  export function style(name: string): boolean;
  export function reset(): boolean;
  export function clear(): boolean;
  export function clearLine(): boolean;
  export function moveTo(column: number, row: number): boolean;
  export function moveBy(columns: number, rows: number): boolean;
  export function hideCursor(): boolean;
  export function showCursor(): boolean;
  export default class terminal {
  static write(text: string): boolean;
  static writeLine(text: string): boolean;
  static flush(): boolean;
  static isTTY(): boolean;
  static supportsAnsi(): boolean;
  static columns(): number;
  static rows(): number;
  static color(name: string): boolean;
  static background(name: string): boolean;
  static style(name: string): boolean;
  static reset(): boolean;
  static clear(): boolean;
  static clearLine(): boolean;
  static moveTo(column: number, row: number): boolean;
  static moveBy(columns: number, rows: number): boolean;
  static hideCursor(): boolean;
  static showCursor(): boolean;
  }
}

declare module "estatic:tls" {
  export interface TlsOptions { cert: string; key: string }
  export class TlsSocket {
  connection: TlsConnection;
  constructor(connection: TlsConnection);
  read(maxBytes?: number, timeout?: number): Promise<Result<string, Error>>;
  write(data: string, timeout?: number): Promise<Result<number, Error>>;
  end(): void;
  }
  export class TlsServer {
  context: TlsContext;
  listener: Optional<TcpListener>;
  constructor(context: TlsContext);
  listen(port: number, host?: string): Result<boolean, Error>;
  accept(timeout?: number): Promise<Result<TlsSocket, Error>>;
  close(): void;
  }
  export function createServer(options: TlsOptions): Result<TlsServer, Error>;
  export default class tls {
  static createServer(options: TlsOptions): Result<TlsServer, Error>;
  }
}
