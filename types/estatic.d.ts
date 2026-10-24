// Declaraciones canónicas del dialecto Estatic.
// `etsc init` y `etsc update-types` copian este archivo sin mantener una
// segunda plantilla. Cargado por tsconfig.json para que el
// editor conozca los built-ins del dialecto y los helpers del runtime
// sin contaminar el código con imports.

declare global {

  /** Helpers internos de pruebas de transporte síncrono. */
  function etsNetSyncEcho(host: string, port: number, request: string, maxBytes: number): string;
  function etsNetSyncLarge(host: string, port: number, payloadBytes: number): string;

  // ─── Tipos numéricos concretos (V3) ──────────────────────────────────
  // El dialecto distingue anchos de bits. Para el editor son alias de
  // 'number'; el transpilador enforce los rangos al compilar.
  type i8 = number;
  type i16 = number;
  type i32 = number;
  type i64 = number;
  type u8 = number;
  type u16 = number;
  type u32 = number;
  type u64 = number;
  type f32 = number;
  type f64 = number;

  // Intrínsecos de conversión; el compilador valida rango y signo.
  // La sintaxis de llamada no implica que sean funciones runtime capturables.
  function i8(value: number): i8;
  function u8(value: number): u8;
  function i16(value: number): i16;
  function u16(value: number): u16;
  function i32(value: number): i32;
  function u32(value: number): u32;
  function i64(value: number): i64;
  function u64(value: number): u64;
  function f32(value: number): f32;
  function f64(value: number): f64;

  // ─── Modificadores de memoria (V22 Memory Model v2) ──────────────────
  // Los 4 modificadores controlan explícitamente cómo se pasa un valor
  // entre funciones / métodos y cómo se almacenan los datos. El codegen
  // los traduce así (ver src/codegen/cpp-types.ts:cppMemoryType):
  //   ptrT       → std::unique_ptrT        (ownership exclusivo mutable)
  //   constPtrT  → std::unique_ptr<const T>  (ownership exclusivo readonly)
  //   refT       → T&                       (préstamo mutable no-null)
  //   constRefT  → const T&                 (préstamo readonly no-null)
  // Para el editor son alias de T; el type-checker enforce la
  // semántica (no fields refT, no retornos refT, no borrows en async,
  // move() solo sobre ptrT, etc.). Ver docs/memory-model.md.
  //
  // constPtr<T> y constRef<T> se proyectan como readonly profundos para
  // que el LSP muestre los miembros de T como readonly en hover. Asi
  // cuando el usuario escribe constRef sobre una clase Foo, el editor
  // le dice que foo.bar es readonly. Esto NO cambia el codegen (sigue
  // siendo T&) ni la semantica que enforce el type-checker (mensajes
  // E4203..E4207); solo afecta a lo que muestra el editor.
  // Fuente: src/project/init-project.ts:constRefType
  type constPtr<T> = T extends (...args: any[]) => any
    ? T
    : T extends object
      ? { readonly [K in keyof T]: constPtr<T[K]> }
      : T;
  type constRef<T> = T extends (...args: any[]) => any
    ? T
    : T extends object
      ? { readonly [K in keyof T]: constRef<T[K]> }
      : T;
  // ptr<T> y ref<T> son alias de T (mismo tipo que T). El type-checker
  // enforce la semantica de ownership/borrowing (E4100..E4103, E4206..E4210).
  // Distinguirlos como tipos separados seria ideal (para que el LSP marque
  // error si pasas un ptr<T> donde se espera un ref<T>), pero romperia la
  // ergonomia del dialecto (no podrias asignar un T literal a un ptr<T>).
  // Asi que son alias puros. Si necesitas distinguirlos, haz un type guard
  // con isPtr<T>(x) o usa los E4xxx del type-checker.
  type ptr<T> = T;
  type ref<T> = T;
  /** Préstamos explícitos; el checker exige un lvalue y comprueba su duración. */
  function ref<T>(value: T): ref<T>;
  function constRef<T>(value: T): constRef<T>;
  /** Marcar el tipo de un valor con un fantasma (phantom) para distinguir
   *  ptr<Foo> de un Foo crudo en APIs que lo necesitan. NO cambia el
   *  codegen. Usar solo si sabes lo que haces. */
  type Phantom<T, Brand extends string> = T;

  // ─── Inmutabilidad (existente desde antes de V22) ────────────────────
  // 'readonlyT' marca inmutabilidad. En el dialecto el checker rechaza
  // reasignaciones; aquí es alias cosmético para que el editor no marque
  // error de tipo inexistente.
  type readonly<T> = T;

  // ─── Guards del LSP: bloquear herencia y excepciones ──────────────────
  // Truco: declaramos un símbolo único con tipo never y un campo privado
  // opcional en cada "raíz" que NO debe poder extenderse. El LSP
  // (tsserver, typescript-language-server) marca error en rojo cuando
  // el usuario intenta heredar de una clase sellada o lanzar una
  // excepcion, antes incluso de compilar. El type-checker de Estatic
  // ya rechaza estas cosas a nivel parser, pero con estos guards el
  // feedback es instantáneo (el editor se queja mientras escribes).

  /** Simbolo fantasma que, al aparecer en la firma de un tipo, hace que
   *  TS rechace cualquier intento de extends. NO se puede importar. */
  declare const __noExtend: unique symbol;
  /** Simbolo fantasma que, al aparecer en la firma de un tipo, hace que
   *  TS rechace cualquier intento de 'throw new X()'. NO se puede importar. */
  declare const __noThrow: unique symbol;

  // Helper para que las clases declaradas mas abajo (Map, Set, Optional,
  // Result, Promise, Task) sean sealed. El type-checker de Estatic ya
  // rechaza la herencia en el parser, pero este sello cierra la puerta
  // tambien en el LSP antes de compilar.
  type Sealed = { readonly [__noExtend]?: never };

  // Helper equivalente para throw. Definir una clase 'class MyError extends Error'
  // ya no seria lanzable en el dialecto, aunque Estatic no tiene throw: lo
  // declaramos para que el LSP marque error en cuanto el usuario escribe
  // 'throw new ...'. El type-checker emitira E4xxx equivalente.
  type NonThrowable = { readonly [__noThrow]?: never };

  // Alias de Error y Exception que el dialecto no soporta. Si el usuario
  // intenta usar 'Error', 'Exception' o hacer 'throw new ...', el LSP le
  // marcara rojo inmediatamente. Estatic no tiene excepciones: los
  // errores se modelan con 'Result<T, E>'.
  type Error = NonThrowable & { name: "Error"; message: string };

  // ─── Envoltorios genéricos del runtime ────────────────────────────────
  // Mapean a ets::Optional / Task / Result / Map / Set en runtime/ets_*.hpp.
  // Los métodos de instancia reflejan lo que el type-checker reconoce
  // (ver src/semantic/type-checker.ts: ARRAY_METHODS, MAP_METHODS,
  // SET_METHODS, OPTIONAL_HELPERS y las ramas de Result.isOk/value/error).
  // Sin esto, el editor marca r.isOk() como error porque no está
  // declarado en ninguna parte.
  //
  // V22 eliminó 'UnqT' (era el unique_ptr pre-V22) y deprecó 'RcT'.
  // Ambos se sustituyen por 'ptrT' / 'constPtrT'; un reemplazo de
  // 'RcT' (shared) está planeado en un PR futuro basado en 'weakT'.
  // Por eso ya NO aparecen en esta plantilla.
  //
  // Todas las clases del runtime llevan Sealed para que el LSP bloquee
  // extends. El type-checker de Estatic tambien lo rechaza en parser.
  class Optional<T> extends Sealed {
    _brand: string;
    static some<T>(value: T): Optional<T>;
    static none<T>(): Optional<T>;
    // Métodos de instancia (helpers globales en runtime):
    isPresent(): boolean;
    isEmpty(): boolean;
    value(): T;
    valueOr(defaultValue: T): T;
    map<U>(callback: (value: T) => U): Optional<U>;
    andThen<U>(callback: (value: T) => Optional<U>): Optional<U>;
    orElse(other: Optional<T>): Optional<T>;
  }
  class Result<T, E = string> extends Sealed {
    readonly kind: "Ok" | "Err";
    readonly ok: boolean;
    private readonly _brand: symbol;
    // El dialecto trata Result<T, E> como tagged union sintética; los
    // métodos isOk/value/error se infieren desde el tag 'ok'. Ver
    // type-checker.ts:2100-2108.
    isOk(): boolean;
    value(): T;
    error(): E;
  }
  // Lector de archivos por descriptor (streaming, sin copiar el archivo
  // entero en memoria). Vive en runtime/ets_file.hpp. La API permite
  // recorrer un archivo caracter a caracter o linea a linea, manteniendo
  // el fd del OS abierto durante toda la lectura.
  //
  // Patron de uso:
  //   let r: FileReader = openFileReader("/var/log/app.log")
  //   while (!r.eof()) {
  //     let line: string | null = r.readLine()
  //     if (line != null) process(line)
  //   }
  //   r.close()
  //
  // Si el archivo no existe, la funcion aborta con un mensaje de error.
  // Para error handling explicito, hacer el check con fileExists() antes.
  function openFileReader(path: string): FileReader;
  class FileReader extends Sealed {
    private readonly _brand: symbol;
    // Lee un byte y avanza el cursor. Devuelve -1 en EOF.
    readChar(): number;
    // Mira el siguiente byte SIN avanzar el cursor. Devuelve -1 en EOF.
    // Util para parsers que necesitan ver antes de consumir.
    peekChar(): number;
    // Mira los siguientes n bytes SIN avanzar el cursor. Devuelve hasta
    // n bytes (menos si EOF antes). Ideal para detectar BOMs, prefijos,
    // o firmas de archivos.
    peek(n: number): string;
    // Lee hasta n bytes desde el cursor. Si n es 0 o no se pasa, lee
    // hasta EOF. "" indica EOF.
    read(n?: number): string;
    // Lee hasta el proximo newline (incluido) y lo devuelve. Si el
    // archivo no termina en newline, la ultima linea se devuelve sin
    // el terminador. Devuelve string vacio cuando ya no hay mas
    // datos; usa eof() para distinguir EOF de una linea vacia valida.
    readLine(): string;
    // ¿Estamos al final del archivo?
    eof(): boolean;
    // Cierra el descriptor. Despues de esto el reader ya no es usable.
    close(): void;
  }
  class Promise<T> extends Sealed {
    private readonly _brand: symbol;
  }
  /** Handle de un timer de libuv. */
  interface Timer {
    valid(): boolean;
  }
  /** Handle movible de un watcher del filesystem. */
  interface FsWatcher {
    valid(): boolean;
  }
  /** Evento entregado por watchFs. */
  interface FsEvent {
    path(): string;
    flags(): number;
  }
  /** Tipos opacos del runtime de red, TLS y cancelación. */
  interface TcpListener { readonly __tcpListenerBrand: unique symbol; }
  interface TcpConnection { readonly __tcpConnectionBrand: unique symbol; }
  interface TlsContext { readonly __tlsContextBrand: unique symbol; }
  interface TlsConnection { readonly __tlsConnectionBrand: unique symbol; }
  interface CancellationSource { readonly __cancellationSourceBrand: unique symbol; }
  interface CancellationToken { readonly __cancellationTokenBrand: unique symbol; }
  class Map<K, V> extends Sealed {
    private readonly _brand: symbol;
    // MAP_METHODS en type-checker.ts:199-205.
    get(key: K): V | void;
    set(key: K, value: V): void;
    has(key: K): boolean;
    delete(key: K): boolean;
    clear(): void;
    forEach(visitor: (value: V, key: K) => void): void;
    readonly size: number;
  }
  class Set<T> extends Sealed {
    private readonly _brand: symbol;
    // SET_METHODS en type-checker.ts:211-214.
    add(value: T): boolean;
    has(value: T): boolean;
    delete(value: T): boolean;
    clear(): void;
    forEach(visitor: (value: T) => void): void;
    readonly size: number;
  }
  // ArrayT es la representación genérica. La forma canónica en el
  // dialecto es T[] (chequea isArrayType en type-checker.ts), pero
  // también se acepta ArrayT como sinónimo. Declaramos ambos.
  interface ArrayLike<T> {
    // ARRAY_METHODS en type-checker.ts:227-254.
    filter<U extends T>(predicate: (value: T) => boolean): T[];
    map<U>(mapper: (value: T) => U): U[];
    reduce<U>(initial: U, reducer: (acc: U, value: T) => U): U;
    forEach(visitor: (value: T) => void): void;
    push(value: T): void;
    find(predicate: (value: T) => boolean): Optional<T>;
    some(predicate: (value: T) => boolean): boolean;
    every(predicate: (value: T) => boolean): boolean;
    slice(start: number, end?: number): T[];
    sort(comparator?: (a: T, b: T) => number): T[];
    flatMap<U>(mapper: (value: T) => U[]): U[];
    includes(value: T): boolean;
    readonly length: number;
  }
  // Tipo opaco para JSON.parseValue. Se manipula vía helpers globales
  // (jsonIsString, jsonAsString, ...).
  type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

  // ─── Helpers de runtime (runtime/ets_core.hpp) ──────────────────────
  /** Imprime los valores en stdout separados por espacios, seguidos de newline. */
  function print(...values: unknown[]): void;
  /** Escribe valores en stdout sin salto de línea. */
  function write(...values: unknown[]): void;
  /** Imprime valores en stderr seguidos de newline. */
  function printError(...values: unknown[]): void;
  /** Escribe valores en stderr sin salto de línea. */
  function writeError(...values: unknown[]): void;
  /** Evalúa una función durante la transpilación y materializa su resultado. */
  function comptime<T>(callback: () => T): T;
  /** Convierte un numero a su representacion en string. */
  function numberToString(n: number): string;
  function length(value: string): number;
  function charAt(value: string, index: number): string;
  function substring(value: string, start: number, end: number): string;
  function indexOf(value: string, search: string, start: number): number;
  function startsWith(value: string, prefix: string): boolean;
  function trim(value: string): string;
  function lineCount(value: string): number;
  function lineAt(value: string, index: number): string;
  /** Sale del proceso con el codigo dado. NUNCA retorna (decorado con @noreturn). */
  function exitProcess(code: number): never;
  /** Reporta un mensaje de error via out-param (estilo C). Usado por el runtime. */
  function fail(message: string, error: string): boolean;
  /** Limpia el buffer de error. */
  function clearError(error: string): void;
  /** true si hay un mensaje de error pendiente. */
  function hasError(error: string): boolean;
  /** Devuelve el numero de argumentos pasados al programa (equivalente a process.argv.length - 1). */
  function argumentCount(): number;
  function argument(index: number): string;
  function jsonEscape(value: string): string;
  function normalizePath(path: string): string;
  function compilerRoot(): string;
  function resolveImportPath(from: string, specifier: string): string;
  function pathDirectory(path: string): string;
  function resolveProjectPath(root: string, path: string): string;
  /** Asegura que el directorio padre del path existe. Crea los directorios necesarios. */
  function ensureParentDirectory(path: string, error: string): boolean;
  function compileCpp(source: string, output: string, compiler: string, flags: string, linkFlags: string, error: string): boolean;
  function validateSyntax(source: string, error: string): boolean;
  function syntaxTreeJson(source: string, output: string, error: string): boolean;
  function syntaxTreeRecords(source: string, output: string, error: string): boolean;
  function estaticAstRecords(source: string, output: string, error: string): boolean;
  function estaticTypedAstJson(source: string, output: string, error: string): boolean;
  function estaticTypedAstRecords(source: string, output: string, error: string): boolean;

  // ─── Transferencia de ownership (V22 Memory Model v2) ───────────────
  // move(x) es la única forma de transferir ownership de un 'ptrT' sin
  // copia. El argumento debe ser un identificador declarado como ptrT
  // o constPtrT (de lo contrario el type-checker emite E4100). Tras
  // la llamada, el uso de 'x' es diagnóstico E4102 (uso moved) o E4103
  // (uso maybe-moved, p.ej. dentro de una rama if sin else).
  function move<T>(x: ptr<T>): ptr<T>;
  function move<T>(x: constPtr<T>): constPtr<T>;

  // ─── Match intrinsics (V23 — unica forma valida en V30) ────────────
  // El dialecto expone una API declarativa para pattern matching
  // compatible con TypeScript. match(value, [when(pattern, callback),
  // ...]) se compila a un if/else chain (no a una llamada a funcion);
  // los intrinsics when/whenType/otherwise SOLO son validos dentro del
  // array de cases de match.
  //
  // V30 elimino la forma V2 destructurada (match(r) { case { kind: "X",
  // x }: ...; case _: ... }) porque NO era TS-compatible: el LSP de TS
  // subrayaba 'match', 'case', y '{ kind: ... }' con errores rojos.
  // Estas declaraciones son la UNICA forma de match valida.
  //
  // whenType<T> estrecha la alternativa y entrega el valor al callback.
  interface MatchValueCase<P, R> {
    readonly __matchKind: "value";
    readonly __pattern: P;
    readonly __result: R;
  }
  interface MatchTypeCase<T, R> {
    readonly __matchKind: "type";
    readonly __type: T;
    readonly __result: R;
  }
  interface MatchDefaultCase<R> {
    readonly __matchKind: "default";
    readonly __result: R;
  }
  type MatchCase =
    | MatchValueCase<any, any>
    | MatchTypeCase<any, any>
    | MatchDefaultCase<any>;
  type MatchCaseResult<C> =
    C extends MatchValueCase<any, infer R> ? R
    : C extends MatchTypeCase<any, infer R> ? R
    : C extends MatchDefaultCase<infer R> ? R
    : never;
  type MatchResult<Cases extends readonly MatchCase[]> =
    MatchCaseResult<Cases[number]>;
  function when<const P, R>(
    pattern: P,
    callback: (value: P) => R
  ): MatchValueCase<P, R>;
  function whenType<T, R>(
    callback: (value: T) => R
  ): MatchTypeCase<T, R>;
  function otherwise<R>(
    callback: (value: any) => R
  ): MatchDefaultCase<R>;
  function match<
    T,
    const Cases extends readonly MatchCase[]
  >(
    value: T,
    cases: Cases
  ): MatchResult<Cases>;
  function match<
    T,
    const Cases extends readonly MatchCase[]
  >(
    value: T,
    discriminator: string,
    cases: Cases
  ): MatchResult<Cases>;

  // ─── Helpers async (ASYNC_HELPERS + ASYNC_PRIMITIVE_HELPERS) ────────
  // sleep y spawn son funciones globales del runtime. Los combinadores
  // esperan tareas y conservan el tipo de su resultado.
  function sleep(ms: number): Promise<void>;
  function spawn(task: Promise<void>): void;
  function all<T>(tasks: Promise<T>[]): T[];
  function race<T>(tasks: Promise<T>[]): T;
  function promiseAll<T>(tasks: Promise<T>[]): Promise<T[]>;
  function promiseRace<T>(tasks: Promise<T>[]): Promise<T>;
  function timeout<T>(task: Promise<T>, ms: number, sentinel: T): Promise<T>;
  function retry<T>(factory: () => Promise<T>, times: number, delayMs: number, sentinel: T): Promise<T>;

  // Timers, watchers y DNS asíncrono sobre libuv.
  function setTimeout(callback: () => void, ms: number): Timer;
  function setInterval(callback: () => void, ms: number): Timer;
  function cancelTimer(timer: Timer): void;
  function watchFs(path: string, callback: (event: FsEvent) => void, recursive?: boolean): FsWatcher;
  function unwatchFs(watcher: FsWatcher): void;
  function stopLoop(): void;
  function resolveDns(host: string): Promise<string>;

  // ─── Helpers de OptionalT ─────────────────────────────────────────
  function optionalSome<T>(value: T): Optional<T>;
  function optionalNone<T>(): Optional<T>;
  function optionalIsPresent<T>(value: Optional<T>): boolean;
  function optionalMap<T, U>(value: Optional<T>, callback: (value: T) => U): Optional<U>;
  function optionalAndThen<T, U>(value: Optional<T>, callback: (value: T) => Optional<U>): Optional<U>;
  function optionalValueOr<T>(value: Optional<T>, fallback: T): T;
  function optionalOrElse<T>(value: Optional<T>, fallback: Optional<T>): Optional<T>;
  function resultOk<T, E = string>(value: T): Result<T, E>;
  function resultErr<T, E = string>(error: E): Result<T, E>;
  function resultIsOk<T, E = string>(value: Result<T, E>): boolean;
  function resultValueOr<T, E = string>(value: Result<T, E>, fallback: T): T;

  // ─── Helpers de filesystem (runtime/ets_file.hpp) ──────────────────
  function fileRead(path: string): string;
  function fileWrite(path: string, content: string): boolean;
  function fileAppend(path: string, content: string): boolean;
  function fileExists(path: string): boolean;
  function fileCopy(src: string, dst: string): boolean;
  function fileMove(src: string, dst: string): boolean;
  function fileRemove(path: string): boolean;

  // API de filesystem actual. Las sobrecargas con parámetros de salida se
  // conservan para el dialecto; las formas Result son las recomendadas.
  function readFile(path: string): Result<string>;
  function readFile(path: string, contents: string, error: string): boolean;
  function writeFile(path: string, contents: string): Result<boolean>;
  function writeFile(path: string, contents: string, error: string): boolean;
  function appendFile(path: string, contents: string): Result<boolean>;
  function appendFile(path: string, contents: string, error: string): boolean;
  function copyFile(source: string, destination: string): Result<boolean>;
  function copyFile(source: string, destination: string, error: string): boolean;
  function moveFile(source: string, destination: string): Result<boolean>;
  function moveFile(source: string, destination: string, error: string): boolean;
  function removeFile(path: string): Result<boolean>;
  function removeFile(path: string, error: string): boolean;

  function readFileAsync(path: string): Promise<Result<string>>;
  function writeFileAsync(path: string, contents: string): Promise<Result<boolean>>;
  function appendFileAsync(path: string, contents: string): Promise<Result<boolean>>;
  function fileExistsAsync(path: string): Promise<Result<boolean>>;
  function copyFileAsync(source: string, destination: string): Promise<Result<boolean>>;
  function moveFileAsync(source: string, destination: string): Promise<Result<boolean>>;
  function removeFileAsync(path: string): Promise<Result<boolean>>;

  function readFileUntil(path: string, timeoutMs: number, token: CancellationToken): Promise<Result<string>>;
  function writeFileUntil(path: string, contents: string, timeoutMs: number, token: CancellationToken): Promise<Result<boolean>>;
  function appendFileUntil(path: string, contents: string, timeoutMs: number, token: CancellationToken): Promise<Result<boolean>>;
  function copyFileUntil(source: string, destination: string, timeoutMs: number, token: CancellationToken): Promise<Result<boolean>>;
  function moveFileUntil(source: string, destination: string, timeoutMs: number, token: CancellationToken): Promise<Result<boolean>>;
  function removeFileUntil(path: string, timeoutMs: number, token: CancellationToken): Promise<Result<boolean>>;

  function ioUringAvailable(): boolean;
  function ioUringRead(path: string): Result<string>;
  function ioUringWrite(path: string, contents: string): Result<boolean>;
  function asyncIoUringRead(path: string): Promise<Result<string>>;
  function asyncIoUringWrite(path: string, contents: string): Promise<Result<boolean>>;

  // ─── Helpers de networking (runtime/ets_net_sync.hpp) ──────────────
  function tcpListen(host: string, port: number): number;
  function tcpAccept(listenerFd: number): number;
  function tcpConnect(host: string, port: number): number;
  function tcpRead(fd: number, maxBytes: number): string;
  function tcpWrite(fd: number, data: string): boolean;
  function tcpClose(fd: number): void;

  // API async de red, cancelación y TLS.
  function listenTcp(host: string, port: number): Result<TcpListener>;
  function acceptTcp(listener: TcpListener): Promise<Result<TcpConnection>>;
  function readTcp(connection: TcpConnection, maxBytes: number): Promise<Result<string>>;
  function writeTcp(connection: TcpConnection, data: string): Promise<Result<number>>;
  function closeTcp(listener: TcpListener): void;
  function closeTcp(connection: TcpConnection): void;
  function createCancellation(): CancellationSource;
  function cancellationToken(source: CancellationSource): CancellationToken;
  function cancel(source: CancellationSource): void;
  function isCancelled(token: CancellationToken): boolean;
  function acceptTcpUntil(listener: TcpListener, timeoutMs: number, token: CancellationToken): Promise<Result<TcpConnection>>;
  function readTcpUntil(connection: TcpConnection, maxBytes: number, timeoutMs: number, token: CancellationToken): Promise<Result<string>>;
  function writeTcpUntil(connection: TcpConnection, data: string, timeoutMs: number, token: CancellationToken): Promise<Result<number>>;
  function createTlsServer(certificate: string, privateKey: string): Result<TlsContext>;
  function acceptTls(listener: TcpListener, context: TlsContext, timeoutMs: number, token: CancellationToken): Promise<Result<TlsConnection>>;
  function readTls(connection: TlsConnection, maxBytes: number, timeoutMs: number, token: CancellationToken): Promise<Result<string>>;
  function writeTls(connection: TlsConnection, data: string, timeoutMs: number, token: CancellationToken): Promise<Result<number>>;
  function closeTls(connection: TlsConnection): void;
  function ok<T>(value: T): Result<T>;
  function err<T>(message: string): Result<T>;

  // ─── Cliente HTTP/1.1 (runtime/ets_http.hpp) ──────────────────────────
  // Cliente HTTP plano (sin HTTPS todavia). Usa getaddrinfo para DNS y
  // sockets POSIX bloqueantes. Lee el body completo (sin streaming).
  //
  // Limitaciones:
  //   - HTTP/1.1 plano (puerto 80). HTTPS requiere TLS client que aun
  //     no esta implementado en runtime/ets_tls.hpp (solo server).
  //   - Sin redirecciones automaticas. Si status es 3xx, el caller
  //     decide si hace otra peticion.
  //   - Sin timeout por defecto.
  //   - Sin cookies, gzip, autenticacion.
  //
  // Caso de uso: integraciones simples, health checks, webhooks, fetch
  // de JSON publico.
  // ─── API de string estilo TypeScript (V28) ─────────────────────────
  // string es un primitivo del dialecto pero la API estilo metodo
  // (s.charAt(i), s.length) vive documentada en una interface para
  // que el LSP autocomplete tenga una pista. La interface se llama
  // StringInstance (no String) porque el LSP de TS confunde
  // String con el wrapper global de JS. La validacion real la hace
  // STRING_METHODS en src/semantic/type-checker.ts y el codegen
  // traduce 1:1 a ets::string_* (runtime/ets_string.hpp).
  interface StringInstance {
    /** Numero de bytes (= std::string::size). */
    readonly length: number;
    /** Byte en posicion i como string (1 byte), o "" si fuera de rango. */
    charAt(i: number): string;
    /** Byte en posicion i como double (0-255), o -1 si fuera de rango. */
    charCodeAt(i: number): number;
    /** Primera posicion de search desde start (defecto 0), o -1. */
    indexOf(search: string, start?: number): number;
    /** Ultima posicion de search, o -1. */
    lastIndexOf(search: string): number;
    /** True si search aparece desde start. */
    includes(search: string, start?: number): boolean;
    /** True si value empieza por prefix. */
    startsWith(prefix: string): boolean;
    /** True si value termina por suffix. */
    endsWith(suffix: string): boolean;
    /** Substring desde start hasta end (acepta negativos desde el final). */
    slice(start: number, end?: number): string;
    /** Substring clampeado a [0, length]; intercambia start/end. */
    substring(start: number, end?: number): string;
    /** Substring desde start con length (defecto hasta el final). */
    substr(start: number, length?: number): string;
    /** Vector de partes separadas por separator. */
    split(separator: string): string[];
    /** Quita espacios al principio y al final. */
    trim(): string;
    /** Quita espacios al principio. */
    trimStart(): string;
    /** Quita espacios al final. */
    trimEnd(): string;
    /** ASCII lower-case (byte-level). */
    toLowerCase(): string;
    /** ASCII upper-case (byte-level). */
    toUpperCase(): string;
    /** Repite el string count veces. */
    repeat(count: number): string;
    /** Rellena al inicio hasta targetLength con pad. */
    padStart(targetLength: number, pad: string): string;
    /** Rellena al final hasta targetLength con pad. */
    padEnd(targetLength: number, pad: string): string;
    /** Reemplaza la primera ocurrencia de search por replacement. */
    replace(search: string, replacement: string): string;
    /** Reemplaza todas las ocurrencias. */
    replaceAll(search: string, replacement: string): string;
    /** -1 si a<b, 0 si a==b, 1 si a>b (byte-level). */
    localeCompare(other: string): number;
    /** Identidad. */
    toString(): string;
  }

  // ─── Servidor HTTP ───────────────────────────────────────────────
  // API de routing sobre cpp-httplib por defecto, o Drogon con @cpp_drogon.
  // Implementaciones: runtime/ets_http_httplib.hpp y ets_http_drogon.hpp.
  //
  // Cada handler es una funcion sincrona (req, res) => void. El server
  // parsea el request antes de invocar al handler y serializa la
  // response al volver. Una tarea en background no puede conservar prestamos
  // a req/res ni completar la respuesta despues de que vuelva el handler.
  //
  // Limitaciones: HTTP/1.1 plano, sin HTTPS, sin middlewares, sin
  // streaming, sin cookies, sin compresion.
  // Los nombres "Request" y "Response" pertenecen al namespace "http" para
  // evitar choques con cualquier otra cosa del usuario. Se accede a ellos
  // como http.Request y http.Response en los handlers.
  namespace http {
    /** Request HTTP pre-parseado. El server rellena los campos antes de invocar al handler. */
    interface Request {
      /** "GET", "POST", "PUT", "PATCH", "DELETE". */
      readonly method: string;
      /** Path sin query string. "/api/users". */
      readonly path: string;
      /** Query string cruda. "id=42&name=alice". Vacia si no hay. */
      readonly rawQuery: string;
      /** Cuerpo del request (POST/PUT/PATCH). Vacio si no hay body. */
      readonly body: string;
    }

    /** Response HTTP. El handler la muta encadenando status/header/send/json. */
    interface Response {
      /** Cambia el status code. Encadenable. */
      status(code: number): Response;
      /** Anyade un header. Encadenable. Si el header ya existe, lo sobreescribe. */
      header(name: string, value: string): Response;
      /** Envia un body de texto. Auto-set Content-Type: text/plain si no se dio uno. */
      send(body: string): Response;
      /** Envia un body JSON. Auto-set Content-Type: application/json. */
      json(jsonString: string): Response;
    }

    /** Respuesta HTTP del cliente. Resultado de http.get() / http.post(). */
    interface HttpClientResponse {
      /** Status code (200, 404, 500, ...). */
      status(): number;
      /** Cuerpo de la respuesta. */
      body(): string;
      /** Valor del header name (case-insensitive), o "" si no existe. */
      header(name: string): string;
    }

    /** Crea un nuevo Server listo para registrar handlers. */
    function createServer(): Server;
    /** Devuelve el path param name del request, o "" si no existe. */
    function param(req: Request, name: string): string;
    /** Devuelve el query string value de name, o "" si no existe. URL-decoded. */
    function query(req: Request, name: string): string;
    /** Devuelve el header name del request (case-insensitive), o "" si no existe. */
    function header(req: Request, name: string): string;
    /** GET HTTP asíncrono. */
    function get(url: string): Promise<Result<HttpClientResponse, string>>;
    /** POST HTTP asíncrono. contentType por defecto: "application/json". */
    function post(url: string, body: string, contentType?: string): Promise<Result<HttpClientResponse, string>>;
  }

  // El checker también acepta estos nombres planos en firmas ETS.
  type Request = http.Request;
  type Response = http.Response;
  type HttpClientResponse = http.HttpClientResponse;

  // Los handlers reciben (req: http.Request, res: http.Response).
  //
  // V28: decorator "cpp_drogon" (escribir como @cpp_drogon en el .ets)
  // para activar el backend Drogon (alto rendimiento) en lugar del
  // default cpp-httplib. Ejemplo:
  //   @cpp_drogon
  //   const api = http.createServer()
  // El nombre es libre; el tipo Server puede ser explicito o inferido.
  // Selecciona un backend para todos los Server del programa, no por instancia.
  // Requiere libdrogon-dev instalado. Compilacion: ver docs §17.
  class Server extends Sealed {
    /** Registra un handler para method + path. path puede tener :params. */
    get(path: string, handler: (req: http.Request, res: http.Response) => void): void;
    post(path: string, handler: (req: http.Request, res: http.Response) => void): void;
    put(path: string, handler: (req: http.Request, res: http.Response) => void): void;
    patch(path: string, handler: (req: http.Request, res: http.Response) => void): void;
    delete(path: string, handler: (req: http.Request, res: http.Response) => void): void;
    /** Arranca el server en 0.0.0.0:port. Bloquea hasta SIGINT. */
    listen(port: number): void;
  }

  // ─── Helpers de JsonValue ──────────────────────────────────────────
  function jsonIsString(v: JsonValue): boolean;
  function jsonIsNumber(v: JsonValue): boolean;
  function jsonIsBool(v: JsonValue): boolean;
  function jsonIsArray(v: JsonValue): boolean;
  function jsonIsObject(v: JsonValue): boolean;
  function jsonIsNull(v: JsonValue): boolean;
  function jsonAsString(v: JsonValue): string;
  function jsonAsNumber(v: JsonValue): number;
  function jsonAsBool(v: JsonValue): boolean;
  function jsonArrayLength(v: JsonValue): number;
  function jsonArrayGet(v: JsonValue, index: number): JsonValue;
  function jsonObjectGet(v: JsonValue, key: string): JsonValue;

  // ─── Built-in globals (RUNTIME_GLOBAL_NAMES en type-checker) ───────
  // Tipo estructural del objeto global. Permite conservar handles y usar
  // `Console` como tipo de parámetro o retorno en código ETS.
  interface Console {
    write(text: string): boolean;
    writeLine(text: string): boolean;
    flush(): boolean;
    isTTY(): boolean;
    supportsAnsi(): boolean;
    columns(): number;
    rows(): number;
    color(name: string): boolean;
    background(name: string): boolean;
    style(name: string): boolean;
    reset(): boolean;
    clear(): boolean;
    clearLine(): boolean;
    moveTo(row: number, column: number): boolean;
    moveBy(rows: number, columns: number): boolean;
    hideCursor(): boolean;
    showCursor(): boolean;
    log(...values: unknown[]): void;
    info(...values: unknown[]): void;
    debug(...values: unknown[]): void;
    trace(...values: unknown[]): void;
    warn(...values: unknown[]): void;
    error(...values: unknown[]): void;
    assert(value: unknown, message?: string): void;
  }
  namespace console {
    function write(text: string): boolean;
    function writeLine(text: string): boolean;
    function flush(): boolean;
    function isTTY(): boolean;
    function supportsAnsi(): boolean;
    function columns(): number;
    function rows(): number;
    function color(name: string): boolean;
    function background(name: string): boolean;
    function style(name: string): boolean;
    function reset(): boolean;
    function clear(): boolean;
    function clearLine(): boolean;
    function moveTo(row: number, column: number): boolean;
    function moveBy(rows: number, columns: number): boolean;
    function hideCursor(): boolean;
    function showCursor(): boolean;

    function log(...values: unknown[]): void;
    function info(...values: unknown[]): void;
    function debug(...values: unknown[]): void;
    function trace(...values: unknown[]): void;
    function warn(...values: unknown[]): void;
    function error(...values: unknown[]): void;
    /** Lanza AssertionError si value es falsy. */
    function assert(value: unknown, message?: string): void;
  }
  /** Funciones matematicas basicas estilo JavaScript (envoltorio de <cmath>). */
  namespace Math {
    function floor(value: number): number;
    function ceil(value: number): number;
    function round(value: number): number;
    function abs(value: number): number;
    function sqrt(value: number): number;
    function pow(base: number, exponent: number): number;
    function min(a: number, b: number): number;
    function max(a: number, b: number): number;
  }
  /** API minima estilo JavaScript para tiempo. */
  namespace Date {
    /** ms desde epoch (1970-01-01T00:00:00Z). */
    function now(): number;
    /** ms UTC desde epoch para (year, month, day). month es 0-based. */
    function utc(year: number, month: number, day: number): number;
  }
  namespace fs {
    // Versiones *Sync (devuelven Result<...> o boolean). Cobertura mínima:
    // las versiones async (que devuelven Promise<...>) se omiten por scope.
    function readFileSync(path: string): Result<string>;
    function writeFileSync(path: string, data: string): Result<boolean>;
    function appendFileSync(path: string, data: string): Result<boolean>;
    function copyFileSync(src: string, dst: string): Result<boolean>;
    function renameSync(oldPath: string, newPath: string): Result<boolean>;
    function unlinkSync(path: string): Result<boolean>;
    function existsSync(path: string): boolean;
  }
  namespace path {
    function dirname(p: string): string;
    function basename(p: string): string;
    function extname(p: string): string;
    function isAbsolute(p: string): boolean;
    function normalize(p: string): string;
    function join(parts: string[]): string;
    function resolve(parts: string[]): string;
  }
  namespace process {
    const argc: number;
    const argv: string[];
    function cwd(): string;
    function exit(code: number): void;
  }
  namespace JSON {
    function stringify(value: string): string;
    function stringifyNumber(value: number): string;
    function stringifyBool(value: boolean): string;
    function stringifyValue(value: JsonValue): string;
    function parse(text: string): string;
    function parseValue(text: string): JsonValue;
  }
}

export {};
