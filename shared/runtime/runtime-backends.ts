// Shared runtime backend selection contract, independent of Stage0 AST.
/** Que backends externos necesita el programa. */
export interface RuntimeBackends {
  /** V30.1+: setTimeout, setInterval, cancelTimer, watchFs, etc. */
  libuv: boolean;
  /** V30.3+: http.get/post, httpClientGet, etc. (wrapper sobre libcurl). */
  curl: boolean;
  /** V30.5+: createTlsServer, acceptTls, readTls, etc. (wrapper sobre openssl). */
  tls: boolean;
  /** io_uring (experimental, opcional). */
  ioUring: boolean;
}

// Funciones cuyo uso requiere linkear contra libuv.
// Mantener en sync con `etsNetworkCalleeMap` y el codegen de timers/fs.
const LIBUV_CALLEES = new Set<string>([
  // V30.3+: tcp network (libuv event loop)
  "listenTcp", "acceptTcp", "acceptTcpUntil",
  "readTcp", "readTcpUntil", "writeTcp", "writeTcpUntil", "closeTcp",
  // V30.1: timers (libuv timers)
  "setTimeout", "setInterval", "cancelTimer",
  // V30.2: filesystem watchers (libuv fs_event)
  "watchFs", "unwatchFs",
  // V30.4: DNS resolution (libuv getaddrinfo)
  "resolveDns", "resolveDns4", "resolveDns6",
]);

// Funciones que ademas requieren linkear contra openssl.
const TLS_CALLEES = new Set<string>([
  "createTlsServer", "acceptTls", "readTls", "writeTls", "closeTls",
]);

// Funciones que requieren linkear contra libcurl.
const CURL_CALLEES = new Set<string>([
  "httpClientGet", "httpClientPost", "httpClientGetAsync",
]);

// Funciones que requieren linkear contra io_uring.
const IOURING_CALLEES = new Set<string>([
  "asyncIoUringRead", "asyncIoUringWrite",
  "ioUringRead", "ioUringWrite",
]);

/** Shared by AST and IR consumers; input is resolved runtime function names. */
export function runtimeBackendsForCalls(callees: Iterable<string>): RuntimeBackends {
  const used=new Set(callees);
  return {
    libuv:   [...LIBUV_CALLEES].some(c => used.has(c)),
    curl:    [...CURL_CALLEES].some(c => used.has(c)),
    tls:     [...TLS_CALLEES].some(c => used.has(c)),
    ioUring: [...IOURING_CALLEES].some(c => used.has(c)),
  };
}

