// test/unit/runtime-backends.test.ts
//
// V30.6.0: tests unitarios para la deteccion declarativa de
// backends runtime (libuv, curl, tls, io_uring) desde el AST.
//
// Se compilan snippets .ets a travès de la pipeline real (parser +
// type-checker + detectRuntimeBackends) y se verifica el resultado.
// Asi testeamos que el AST traversal recoge todas las llamadas
// correctamente (incluyendo las que estan dentro de lambdas,
// bloques, condicionales, awaits, etc.).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "../../src/compiler.ts";
import { detectRuntimeBackends } from "../../src/modules/runtime-backends.ts";
import { analyze } from "../../src/compiler.ts";

function detect(source: string) {
  // Solo parseamos (sin type-check). La deteccion de backends solo
  // necesita el AST, no los tipos. Si hicieramos analyze fallaria con
  // tipos `any` o funciones que no conoce, pero el AST ya tiene la
  // info que necesitamos (CallExpression.callee, etc).
  const ast = parse(source);
  return detectRuntimeBackends(ast);
}

test("runtime-backends: programa vacio no necesita nada", () => {
  const r = detect(`let x: number = 1;`);
  assert.equal(r.libuv, false);
  assert.equal(r.curl, false);
  assert.equal(r.tls, false);
  assert.equal(r.ioUring, false);
});

test("runtime-backends: readTcp marca libuv", () => {
  const r = detect(`
    async function f(c: any): Promise<void> {
      const r = await readTcp(c, 1024);
    }
  `);
  assert.equal(r.libuv, true);
  assert.equal(r.curl, false);
  assert.equal(r.tls, false);
});

test("runtime-backends: setTimeout marca libuv", () => {
  const r = detect(`
    function f(): void {
      setTimeout(() => { print("x"); }, 100);
    }
  `);
  assert.equal(r.libuv, true);
});

test("runtime-backends: watchFs marca libuv", () => {
  const r = detect(`
    function f(): void {
      const w = watchFs("/tmp", (ev: any) => {});
    }
  `);
  assert.equal(r.libuv, true);
});

test("runtime-backends: resolveDns marca libuv", () => {
  const r = detect(`
    async function f(): Promise<string> {
      const ip = await resolveDns("example.com");
      return ip;
    }
  `);
  assert.equal(r.libuv, true);
});

test("runtime-backends: createTlsServer marca tls (y no libuv por si mismo)", () => {
  // createTlsServer esta en TLS_CALLEES pero NO en LIBUV_CALLEES:
  // la implementacion actual no requiere el event loop libuv (V30.5
  // usa el bundle). Esto es importante porque si lo pusieramos en
  // LIBUV_CALLEES por error, programas solo con TLS (sin tcp/timers)
  // linkarian libuv innecesariamente.
  const r = detect(`
    function f(): void {
      createTlsServer({ cert: "c", key: "k" }, (c: any): void => {});
    }
  `);
  assert.equal(r.tls, true);
  assert.equal(r.curl, false);
  assert.equal(r.libuv, false);
});

test("runtime-backends: httpClientGet marca curl", () => {
  const r = detect(`
    async function f(): Promise<string> {
      const r = await httpClientGet("https://example.com");
      return r;
    }
  `);
  assert.equal(r.libuv, false);
  assert.equal(r.curl, true);
  assert.equal(r.tls, false);
});

test("runtime-backends: ioUringRead marca ioUring", () => {
  const r = detect(`
    async function f(): Promise<void> {
      const r = await asyncIoUringRead(0, new Uint8Array(16));
    }
  `);
  assert.equal(r.ioUring, true);
});

test("runtime-backends: llamadas dentro de lambdas se detectan", () => {
  const r = detect(`
    function f(): void {
      [1, 2, 3].forEach((n: number) => {
        setTimeout(() => { print(n); }, 100);
      });
    }
  `);
  assert.equal(r.libuv, true);
});

test("runtime-backends: llamadas dentro de if/else se detectan", () => {
  const r = detect(`
    async function f(b: boolean, c: any): Promise<void> {
      if (b) {
        const r = await readTcp(c, 1024);
      } else {
        setTimeout(() => {}, 0);
      }
    }
  `);
  assert.equal(r.libuv, true);
});

test("runtime-backends: llamadas dentro de bucles se detectan", () => {
  const r = detect(`
    function f(): void {
      for (let i: number = 0; i < 10; i = i + 1) {
        setTimeout(() => {}, 100);
      }
    }
  `);
  assert.equal(r.libuv, true);
});

test("runtime-backends: MemberCallExpression (.method) se detecta", () => {
  // Una llamada estilo `obj.method()` no es un CallExpression sino un
  // MemberCallExpression. Aqui simulamos un escenario donde se llama
  // un metodo que mapea a libuv via member call.
  // (No usamos setTimeout porque es CallExpression, no MemberCallExpression.
  //  Un MemberCallExpression seria p.ej. `console.log(...)` pero eso no
  //  es libuv. Asi que testeamos que MemberCallExpression no causa crash
  //  y que NO marca libuv si el method no esta en LIBUV_CALLEES.)
  const r = detect(`
    function f(): void {
      console.log("hello");
    }
  `);
  assert.equal(r.libuv, false);
  assert.equal(r.curl, false);
  assert.equal(r.tls, false);
});

test("runtime-backends: programa solo con print no marca nada", () => {
  const r = detect(`
    function main(): void {
      print("hello world");
    }
    main();
  `);
  assert.equal(r.libuv, false);
  assert.equal(r.curl, false);
  assert.equal(r.tls, false);
  assert.equal(r.ioUring, false);
});

test("libuv lifetime: handles usan almacenamiento estable", () => {
  const header = readFileSync("runtime/ets_event_loop_libuv_api.hpp", "utf8");
  assert.match(header, /std::list<std::unique_ptr<TimerEntry>>\s+timers_/);
  assert.match(header, /std::unordered_map<int,\s*std::unique_ptr<PollState>>\s+polls_/);
  assert.match(header, /std::list<PollEntry>\s+entries/);
  assert.doesNotMatch(header, /std::deque<TimerEntry>/);
  assert.doesNotMatch(header, /std::vector<PollEntry>/);
});

test("libuv lifetime: timer y poll se liberan desde uv_close callback", () => {
  const source = readFileSync("runtime/runtime_ets_libuv.cpp", "utf8");
  assert.match(source, /uv_close\([^;]+onTimerClosed\)/s);
  assert.match(source, /uv_close\([^;]+onPollClosed\)/s);
  assert.match(source, /onTimerClosed[\s\S]+eraseClosedTimer/);
  assert.match(source, /onPollClosed[\s\S]+eraseClosedPoll/);
  assert.doesNotMatch(source, /timers_\.clear\(\)/);
  assert.doesNotMatch(source, /polls_\.clear\(\)/);
});

test("race lifetime: transfiere al event loop los frames perdedores", () => {
  const source = readFileSync("runtime/ets_async.hpp", "utf8");
  assert.match(source, /auto handle = tasks\[loser\]\.release\(\)/);
  assert.match(source, /defaultEventLoop\.detach\(handle\)/);
  assert.doesNotMatch(source, /T race\(const std::vector<Task<T>>& tasks\)/);
});

test("timeout: construye candidatos validos y devuelve el resultado de race", () => {
  const source = readFileSync("runtime/ets_async.hpp", "utf8");
  assert.match(source, /std::vector<Task<T>> candidates/);
  assert.match(source, /candidates\.push_back\(std::move\(task\)\)/);
  assert.match(source, /co_return race<T>\(candidates\)/);
  assert.doesNotMatch(source, /Task<T> winner = race<T>/);
});

test("Drogon: http_query usa lookup sin cache persistente", () => {
  const source = readFileSync("runtime/ets_http_drogon.hpp", "utf8");
  assert.match(source, /return detail::rawQueryValue\(req\.rawQuery, name\)/);
  assert.doesNotMatch(source, /thread_local/);
});

test("HTTP query: lookup nativo conserva semantica con 100000 queries", () => {
  const directory = mkdtempSync(join(tmpdir(), "ets-http-query-"));
  try {
    const binary = join(directory, "test_http_query");
    execFileSync(process.env.CXX || "g++", [
      "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror", "-fno-exceptions",
      "-I.", "runtime/tests/test_http_query.cpp", "-pthread", "-o", binary,
    ], { timeout: 30000 });
    const output = execFileSync(binary, { encoding: "utf8", timeout: 30000 });
    assert.match(output, /http-query: OK \(100000 queries, 4 threads\)/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("HTTP limits: defaults aplican cola, payload y timeouts antes de listen", () => {
  const source = readFileSync("runtime/ets_http_httplib.hpp", "utf8");
  assert.match(source, /limits\.workers, limits\.workers, limits\.queuedConnections/);
  assert.match(source, /set_payload_max_length\(limits\.bodyBytes\)/);
  assert.match(source, /set_read_timeout\(limits\.readTimeoutSeconds\)/);
  assert.match(source, /set_write_timeout\(limits\.writeTimeoutSeconds\)/);
  assert.match(source, /set_keep_alive_timeout\(limits\.keepAliveTimeoutSeconds\)/);
  assert.match(source, /set_keep_alive_max_count\(limits\.keepAliveRequests\)/);
  assert.match(source, /if \(!limits\.valid\(\)\) std::abort\(\)/);
});

test("HTTP routing: los nombres de parametros son locales a cada ruta", () => {
  const source = readFileSync("runtime/ets_http_httplib.hpp", "utf8");
  assert.match(source, /std::vector<std::string> names;\s*std::string regex = pathToRegex\(path, &names\)/);
  assert.doesNotMatch(source, /paramNames_/);
});

test("HTTP headers: lookup normaliza el nombre igual que el adaptador", () => {
  const source = readFileSync("runtime/ets_http_httplib.hpp", "utf8");
  const helper = source.slice(source.indexOf("inline std::string http_header"));
  assert.match(helper, /tolower\(static_cast<unsigned char>\(c\)\)/);
  assert.match(helper, /req\.headers\.find\(lower\)/);
});
