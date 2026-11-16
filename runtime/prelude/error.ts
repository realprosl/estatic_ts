// Error de TypeScript sin excepciones (prelude del runtime, #165).
//
// El dialecto no tiene herencia ni throw: `Error` es una interfaz y cada clase
// de error (TypeError, RangeError…) implementa sus mismos miembros, así que
// cabe donde se espera un Error (p. ej. Result<T, Error>). `new Error(…)`
// construye un BaseError con name = "Error".

export interface Error {
  name: string;
  message: string;
  cause: Error | undefined;
  toString(): string;
}

export interface ErrorOptions {
  cause?: Error;
}

function describe(name: string, message: string): string {
  return message == "" ? name : name + ": " + message;
}

export class BaseError {
  name: string = "Error"; message: string; cause: Error | undefined;
  constructor(message?: string, options?: ErrorOptions) { this.message = message ?? ""; this.cause = options === undefined ? undefined : options.cause; }
  toString(): string { return describe(this.name, this.message); }
}
export class TypeError {
  name: string = "TypeError"; message: string; cause: Error | undefined;
  constructor(message?: string, options?: ErrorOptions) { this.message = message ?? ""; this.cause = options === undefined ? undefined : options.cause; }
  toString(): string { return describe(this.name, this.message); }
}
export class RangeError {
  name: string = "RangeError"; message: string; cause: Error | undefined;
  constructor(message?: string, options?: ErrorOptions) { this.message = message ?? ""; this.cause = options === undefined ? undefined : options.cause; }
  toString(): string { return describe(this.name, this.message); }
}
export class SyntaxError {
  name: string = "SyntaxError"; message: string; cause: Error | undefined;
  constructor(message?: string, options?: ErrorOptions) { this.message = message ?? ""; this.cause = options === undefined ? undefined : options.cause; }
  toString(): string { return describe(this.name, this.message); }
}
export class ReferenceError {
  name: string = "ReferenceError"; message: string; cause: Error | undefined;
  constructor(message?: string, options?: ErrorOptions) { this.message = message ?? ""; this.cause = options === undefined ? undefined : options.cause; }
  toString(): string { return describe(this.name, this.message); }
}
export class EvalError {
  name: string = "EvalError"; message: string; cause: Error | undefined;
  constructor(message?: string, options?: ErrorOptions) { this.message = message ?? ""; this.cause = options === undefined ? undefined : options.cause; }
  toString(): string { return describe(this.name, this.message); }
}
export class URIError {
  name: string = "URIError"; message: string; cause: Error | undefined;
  constructor(message?: string, options?: ErrorOptions) { this.message = message ?? ""; this.cause = options === undefined ? undefined : options.cause; }
  toString(): string { return describe(this.name, this.message); }
}
