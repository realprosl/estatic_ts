import { isNumericName, isFloat } from "../types/numeric-semantics.ts";
// V30.41: comptime() — evaluador estático para expresiones que se
// resuelven en tiempo de transpilación. El dialecto expone
// `comptime(fn)` como builtin: el codegen detecta la llamada, ejecuta
// el cuerpo de la arrow function en este evaluador controlado, y
// sustituye la llamada por un LiteralExpression con el valor
// calculado. Esto permite que bucles, condicionales y expresiones
// aritméticas que solo se usan para inicializar constantes se
// resuelvan en compile-time, sin coste en runtime.
//
// RESTRICCIONES (validamos con un DiagnosticError claro si no se cumplen):
//   - comptime() recibe exactamente 1 argumento.
//   - El argumento es un ArrowFunctionExpression SIN parámetros.
//   - El ArrowFunctionExpression NO es async.
//   - El cuerpo se evalúa con un AST walker. NO usamos eval() ni
//     new Function() para ejecutar código arbitrario.
//
// OPERACIONES SOPORTADAS:
//   - Literales (number, string, boolean).
//   - Identifiers locales (const/let) del scope de la arrow.
//   - Arrays literales con push/index/length.
//   - Object literals con acceso a propiedades.
//   - Operadores aritméticos, comparación, lógicos, unarios.
//   - Condicionales (if/else, ternario).
//   - Bucles (for, while, do-while).
//   - return.
//   - Llamadas a funciones del mismo archivo (FunctionDeclaration).
//   - Llamadas recursivas con límite de profundidad.
//
// LÍMITES:
//   - maxInstructions: 10000 instrucciones por evaluacion raiz.
//   - maxRecursion: 100 niveles de call stack.
//   - maxValueBytes: 1MB de valores estimados por raiz, no memoria viva real.
// Las llamadas anidadas comparten los contadores de su evaluacion raiz.

import type {
  Program,
  Statement,
  Expression,
  BlockStatement,
  Parameter,
  FunctionDeclaration,
  ArrowFunctionExpression,
  LiteralExpression,
  IdentifierExpression,
  ArrayLiteralExpression,
  ObjectLiteralExpression,
  UnaryExpression,
  BinaryExpression,
  AssignmentExpression,
  TemplateLiteralExpression,
  TernaryExpression,
  IndexExpression,
  MemberExpression,
  CallExpression,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  VariableDeclaration,
  ExpressionStatement,
} from "../ast/nodes.ts";
import { DiagnosticError, type Diagnostic } from "../core/diagnostic.ts";
import type { Span } from "../core/span.ts";
import { Buffer } from "node:buffer";
import { evalInteger64Binary, evalInteger64Unary, floatValue } from "./comptime-integer64.ts";
import { isIntegerCast, evalIntegerCast } from "./comptime-integer-cast.ts";
import { fixedArrayElement, toResolvedType, type ResolvedType } from "../types/type-system.ts";
import { selectComptimeFunction, hasComptimeDecorator, type ComptimeFunctions, type ComptimeFunctionResolver } from "./comptime-functions.ts";

/** Wrapper para lanzar errores comptime con un solo mensaje y span.
 * El DiagnosticError normal espera un array de `Diagnostic`, pero
 * para errores puntuales del evaluador es más cómodo pasar un string.
 * Devuelve `never` para que TS sepa que el control no continúa. */
type ComptimeSpan = Span;
const COMPTIME_VALUE_UNAVAILABLE = "COMPTIME_VALUE_UNAVAILABLE";

function comptimeError(
  message: string,
  span: ComptimeSpan,
  hint?: string,
  code?: string,
): never {
  // Preserve parser coordinates. Offsets are not columns, especially after
  // newlines or when the combined module AST is remapped to its source file.
  const fullSpan: Span = { start: { ...span.start }, end: { ...span.end } };
  const diag: Diagnostic = { phase: "semantic", message, span: fullSpan };
  if (hint) diag.hint = hint;
  if (code) diag.code = code;
  throw new DiagnosticError([diag]);
}

function isComptimeValueUnavailable(error: unknown): boolean {
  return error instanceof DiagnosticError &&
    error.diagnostics.length > 0 &&
    error.diagnostics.every((diagnostic) => diagnostic.code === COMPTIME_VALUE_UNAVAILABLE);
}

/** Tipos de valores que puede devolver un evaluador comptime. */
export type ComptimeValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | undefined
  | ComptimeArray
  | ComptimeObject;

export interface ComptimeArray extends Array<ComptimeValue> { __comptime: "array" }
export interface ComptimeObject {
  __comptime: "object";
  fields: Map<string, ComptimeValue>;
}

/** Opciones del evaluador (límites configurables). */
export interface ComptimeLimits {
  maxInstructions: number;
  maxRecursion: number;
  maxValueBytes: number;
}

const DEFAULT_LIMITS: ComptimeLimits = {
  maxInstructions: 10000,
  maxRecursion: 100,
  maxValueBytes: 1024 * 1024,
};

/** Resultado de una evaluación comptime. */
export interface ComptimeResult {
  value: ComptimeValue;
  /** El AST del ArrowFunctionExpression evaluado (para reports de error). */
  span: Span;
}

/** Ambito lexico: declaraciones locales y asignaciones al binding mas cercano. */
class ComptimeScope extends Map<string, ComptimeValue> {
  private readonly parent: Map<string, ComptimeValue>;
  private readonly uninitialized = new Set<string>();
  private readonly unavailable = new Set<string>();
  constructor(parent: Map<string, ComptimeValue>) { super(); this.parent = parent; }

  override has(name: string): boolean { return super.has(name) || this.parent.has(name); }
  override get(name: string): ComptimeValue {
    return super.has(name) ? super.get(name) : this.parent.get(name);
  }
  // Una asignacion actualiza el binding mas cercano. Una declaracion, en
  // cambio, debe usar define() para poder sombrear un nombre del padre.
  override set(name: string, value: ComptimeValue): this {
    if (!super.has(name) && this.parent.has(name)) this.parent.set(name, value);
    else {
      super.set(name, value);
      this.uninitialized.delete(name);
      this.unavailable.delete(name);
    }
    return this;
  }
  declare(name: string): this {
    super.set(name, undefined);
    this.uninitialized.add(name);
    this.unavailable.delete(name);
    return this;
  }
  define(name: string, value: ComptimeValue): this {
    super.set(name, value);
    this.uninitialized.delete(name);
    this.unavailable.delete(name);
    return this;
  }
  markUnavailable(name: string): this {
    super.set(name, undefined);
    this.uninitialized.delete(name);
    this.unavailable.add(name);
    return this;
  }
  isUninitialized(name: string): boolean {
    if (super.has(name)) return this.uninitialized.has(name);
    return this.parent instanceof ComptimeScope && this.parent.isUninitialized(name);
  }
  isUnavailable(name: string): boolean {
    if (super.has(name)) return this.unavailable.has(name);
    return this.parent instanceof ComptimeScope && this.parent.isUnavailable(name);
  }
}

function defineComptimeBinding(scope: Map<string, ComptimeValue>, name: string, value: ComptimeValue): void {
  if (scope instanceof ComptimeScope) scope.define(name, value);
  else scope.set(name, value);
}

function variableBindingNames(decl: VariableDeclaration): string[] {
  if (decl.arrayBindings?.length) return decl.arrayBindings.map((binding) => binding.name);
  if (decl.objectBindings?.length) return decl.objectBindings.map((binding) => binding.name);
  return decl.name ? [decl.name] : [];
}

function predeclareComptimeBinding(scope: Map<string, ComptimeValue>, decl: VariableDeclaration): void {
  if (!(scope instanceof ComptimeScope)) return;
  for (const name of variableBindingNames(decl)) scope.declare(name);
}

function markComptimeBindingUnavailable(scope: Map<string, ComptimeValue>, decl: VariableDeclaration): void {
  if (!(scope instanceof ComptimeScope)) return;
  for (const name of variableBindingNames(decl)) scope.markUnavailable(name);
}

function assertComptimeBindingInitialized(
  scope: Map<string, ComptimeValue>,
  name: string,
  span: ComptimeSpan,
): void {
  if (scope instanceof ComptimeScope && scope.isUninitialized(name)) {
    comptimeError(
      `comptime: '${name}' esta en la zona muerta temporal`,
      span,
      `El binding existe en este bloque, pero no puede leerse ni escribirse antes de su declaracion.`,
    );
  }
}

function assertComptimeBindingAvailable(
  scope: Map<string, ComptimeValue>,
  name: string,
  span: ComptimeSpan,
): void {
  if (scope instanceof ComptimeScope && scope.isUnavailable(name)) {
    comptimeError(
      `comptime: '${name}' no es comptime-compatible`,
      span,
      `El binding ya fue declarado, pero su valor no puede resolverse durante la transpilacion.`,
      COMPTIME_VALUE_UNAVAILABLE,
    );
  }
}

type ComptimeControl = {
  __comptime: "early-return" | "break" | "continue";
  value: ComptimeValue;
  span: ComptimeSpan;
};

function isComptimeControl(value: ComptimeValue | ComptimeControl): value is ComptimeControl {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { __comptime?: string }).__comptime;
  return kind === "early-return" || kind === "break" || kind === "continue";
}

/** Estado mutable del intérprete (instrumenta contadores + scope chain). */
class ComptimeInterpreter {
  private instructions = 0;
  private recursionDepth = 0;
  private bytesUsed = 0;
  private evaluationDepth = 0;
  private readonly limits: ComptimeLimits;
  /** Todas las sobrecargas del archivo; nunca se sobrescriben por nombre. */
  private readonly functions: ComptimeFunctions;
  /** Selección semántica por call site, compartida con el mini-evaluador. */
  private readonly resolveFunction?: ComptimeFunctionResolver;
  constructor(
    limits: ComptimeLimits,
    functions: ComptimeFunctions,
    resolveFunction?: ComptimeFunctionResolver,
  ) {
    this.limits = limits;
    this.functions = functions;
    this.resolveFunction = resolveFunction;
  }

  private returnType: string | ResolvedType | undefined;

  private evalTypedBody(node: BlockStatement | Expression, scope: Map<string, ComptimeValue>, type?: string | ResolvedType, countEntry = false): ComptimeValue {
    if (countEntry) this.tick(node.span);
    const previous = this.returnType;
    this.returnType = type;
    try {
      if (node.kind === "BlockStatement") return this.evalBlock(node, scope);
      return convertIntegerBinding(this.evalExpression(node, scope), type, node);
    } finally {
      this.returnType = previous;
    }
  }

  /** Evalúa una arrow function. Punto de entrada.
   *  V30.42: acepta un `outerScope` opcional para captura de
   *  variables del call site. Las variables que el arrow necesita
   *  (free variables) se buscan primero en el scope local del
   *  arrow y luego en el `outerScope`. */
  evalArrow(arrow: ArrowFunctionExpression, at: Span, outerScope?: Map<string, ComptimeValue>): ComptimeResult {
    return this.withEvaluation(() => {
      const result = this.evalArrowBody(arrow, at, outerScope);
      this.boundCheck(result.value, at);
      return result;
    });
  }

  private evalArrowBody(arrow: ArrowFunctionExpression, at: Span, outerScope?: Map<string, ComptimeValue>): ComptimeResult {
    if ((arrow as { isAsync?: boolean }).isAsync || (arrow as { async?: boolean }).async) {
      comptimeError(
        `comptime() no soporta arrow functions async`,
        at,
        `Las arrow functions comptime se ejecutan en tiempo de transpilacion (no hay event loop disponible). Si necesitas async, mueve esa logica a runtime usando una funcion normal (sin comptime).`,
      );
    }
    if (arrow.params.length > 0) {
      comptimeError(
        `comptime() solo acepta arrow functions sin parametros; esta tiene ${arrow.params.length}`,
        at,
        `Las arrow functions comptime no reciben parametros — todo lo que necesitan se captura del scope exterior. Si necesitas calcular algo parametrizado, declara una @comptime function con los parametros que necesites.`,
      );
    }
    // El scope del arrow empieza vacio; las free variables se
    // resuelven a traves del outerScope pasado al evalExpression
    // (ver `evalIdentifier`).
    const scope = new Map<string, ComptimeValue>();
    return this.withCapturedScope(outerScope ?? null, () => {
      const value = this.evalTypedBody(arrow.body, scope, arrow.resolvedType?.kind === "function" ? arrow.resolvedType.result : arrow.returnType, true);
      return { value, span: at };
    });
  }

  /** V30.42: scope externo para captura de variables. Se setea
   *  durante evalArrow y durante evalComptimeFunction. */
  private capturedScope: Map<string, ComptimeValue> | null = null;

  /** Instala un scope capturado durante una entrada al interprete y restaura
   *  exactamente el anterior. Esto hace seguras las entradas anidadas: una
   *  llamada interior no puede borrar las capturas de su caller al volver. */
  private withCapturedScope<T>(scope: Map<string, ComptimeValue> | null, run: () => T): T {
    const previous = this.capturedScope;
    this.capturedScope = scope;
    try {
      return run();
    } finally {
      this.capturedScope = previous;
    }
  }

  /** El decorador se consulta en la firma elegida, no en un mapa por nombre. */
  isComptimeFunction(call: CallExpression): boolean {
    return hasComptimeDecorator(call, "comptime", this.functions, this.resolveFunction);
  }

  /** V30.47: evalúa una llamada a una función `@cppgen`. Retorna el string
   *  generado (que el codegen inyecta tal cual en el output). */
  isCppgenFunction(call: CallExpression): boolean {
    return hasComptimeDecorator(call, "cppgen", this.functions, this.resolveFunction);
  }

  /** V30.48: detecta llamadas a funciones @etsgen. */
  isEtsgenFunction(call: CallExpression): boolean {
    return hasComptimeDecorator(call, "etsgen", this.functions, this.resolveFunction);
  }

  /** V30.48: evalúa una función @etsgen y retorna su string de salida
   *  (código del dialecto, no C++ literal). */
  evalEtsgenFunction(
    call: CallExpression,
    outerScope: Map<string, ComptimeValue>,
    at: Span,
  ): ComptimeValue {
    return this.withEvaluation(() => {
      const result = this.evalEtsgenFunctionBody(call, outerScope, at);
      this.boundCheck(result, at);
      return result;
    });
  }

  private evalEtsgenFunctionBody(
    call: CallExpression,
    outerScope: Map<string, ComptimeValue>,
    at: Span,
  ): ComptimeValue {
    const { callee, args } = call;
    const fn = this.isEtsgenFunction(call) ? selectComptimeFunction(call, this.functions, this.resolveFunction) : undefined;
    if (!fn) {
      comptimeError(`comptime: '${callee}' no es una funcion @etsgen`, at);
    }
    this.recursionDepth++;
    if (this.recursionDepth > this.limits.maxRecursion) {
      comptimeError(
        `comptime: profundidad de recursion excede ${this.limits.maxRecursion}`,
        at,
        `Si tu funcion es inherentemente recursiva (e.g. factorial, fibonacci), considera aumentar el limite.`,
      );
    }
    try {
      if (fn.params.length !== args.length) {
        comptimeError(
          `comptime: '${callee}' espera ${fn.params.length} args, recibio ${args.length}`,
          at,
        );
      }
      const fnScope = new Map<string, ComptimeValue>();
      for (let i = 0; i < fn.params.length; i++) {
        const value = convertIntegerBinding(this.evalExpression(args[i]!, outerScope), fn.params[i]!.resolvedType ?? fn.params[i]!.type, args[i]!);
        this.boundCheck(value, args[i]!.span);
        fnScope.set(fn.params[i]!.name, value);
      }
      return this.withCapturedScope(outerScope, () => {
        if (fn.body.kind === "BlockStatement") {
          const v = this.evalTypedBody(fn.body, fnScope, fn.returnType);
          if (v && (v as { __comptime?: string }).__comptime === "early-return") {
            return (v as { value: ComptimeValue }).value;
          }
          return v as ComptimeValue;
        }
        return this.evalTypedBody(fn.body, fnScope, fn.returnType);
      });
    } finally {
      this.recursionDepth--;
    }
  }

  /** V30.47: evalúa una función @cppgen y retorna su string de salida. */
  evalCppgenFunction(
    call: CallExpression,
    outerScope: Map<string, ComptimeValue>,
    at: Span,
  ): ComptimeValue {
    return this.withEvaluation(() => {
      const result = this.evalCppgenFunctionBody(call, outerScope, at);
      this.boundCheck(result, at);
      return result;
    });
  }

  private evalCppgenFunctionBody(
    call: CallExpression,
    outerScope: Map<string, ComptimeValue>,
    at: Span,
  ): ComptimeValue {
    const { callee, args } = call;
    const fn = this.isCppgenFunction(call) ? selectComptimeFunction(call, this.functions, this.resolveFunction) : undefined;
    if (!fn) {
      comptimeError(`comptime: '${callee}' no es una funcion @cppgen`, at);
    }
    this.recursionDepth++;
    if (this.recursionDepth > this.limits.maxRecursion) {
      comptimeError(
        `comptime: profundidad de recursion excede ${this.limits.maxRecursion}`,
        at,
        `Si tu funcion es inherentemente recursiva (e.g. factorial, fibonacci), considera aumentar el limite. Tambien puedes dividir la recursion en multiples llamadas @comptime mas pequenas, o pre-calcular el valor con comptime() en lugar de @comptime.`,
      );
    }
    try {
      if (fn.params.length !== args.length) {
        comptimeError(
          `comptime: '${callee}' espera ${fn.params.length} args, recibio ${args.length}`,
          at,
        );
      }
      const fnScope = new Map<string, ComptimeValue>();
      for (let i = 0; i < fn.params.length; i++) {
        const value = convertIntegerBinding(this.evalExpression(args[i]!, outerScope), fn.params[i]!.resolvedType ?? fn.params[i]!.type, args[i]!);
        this.boundCheck(value, args[i]!.span);
        fnScope.set(fn.params[i]!.name, value);
      }
      return this.withCapturedScope(outerScope, () => {
        if (fn.body.kind === "BlockStatement") {
          const v = this.evalTypedBody(fn.body, fnScope, fn.returnType);
          if (v && (v as { __comptime?: string }).__comptime === "early-return") {
            return (v as { value: ComptimeValue }).value;
          }
          return v as ComptimeValue;
        }
        return this.evalTypedBody(fn.body, fnScope, fn.returnType);
      });
    } finally {
      this.recursionDepth--;
    }
  }

  evalComptimeFunction(
    call: CallExpression,
    outerScope: Map<string, ComptimeValue>,
    at: Span,
  ): ComptimeValue {
    return this.withEvaluation(() => {
      const result = this.evalComptimeFunctionBody(call, outerScope, at);
      this.boundCheck(result, at);
      return result;
    });
  }

  private evalComptimeFunctionBody(
    call: CallExpression,
    outerScope: Map<string, ComptimeValue>,
    at: Span,
  ): ComptimeValue {
    const { callee, args } = call;
    const fn = this.isComptimeFunction(call) ? selectComptimeFunction(call, this.functions, this.resolveFunction) : undefined;
    if (!fn) {
      // El visitor solo entra aqui si la firma elegida tiene el decorador.
      comptimeError(`comptime: '${callee}' no es una funcion @comptime`, at);
    }
    this.recursionDepth++;
    if (this.recursionDepth > this.limits.maxRecursion) {
      comptimeError(
        `comptime: profundidad de recursion excede ${this.limits.maxRecursion}`,
        at,
      );
    }
    try {
      if (fn.params.length !== args.length) {
        comptimeError(
          `comptime: '${callee}' espera ${fn.params.length} args, recibio ${args.length}`,
          at,
        );
      }
      const fnScope = new Map<string, ComptimeValue>();
      for (let i = 0; i < fn.params.length; i++) {
        const value = convertIntegerBinding(this.evalExpression(args[i]!, outerScope), fn.params[i]!.resolvedType ?? fn.params[i]!.type, args[i]!);
        this.boundCheck(value, args[i]!.span);
        fnScope.set(fn.params[i]!.name, value);
      }
      // Para recursión, los call sites internos usan fnScope (no
      // el outerScope directo, porque la recursión pasa los
      // argumentos via call). Pero el `capturedScope` debe seguir
      // siendo outerScope para que las free variables se resuelvan.
      return this.withCapturedScope(outerScope, () => {
        if (fn.body.kind === "BlockStatement") {
          const v = this.evalTypedBody(fn.body, fnScope, fn.returnType);
          if (v && (v as { __comptime?: string }).__comptime === "early-return") {
            return (v as { value: ComptimeValue }).value;
          }
          return v as ComptimeValue;
        }
        return this.evalTypedBody(fn.body, fnScope, fn.returnType);
      });
    } finally {
      this.recursionDepth--;
    }
  }

  private evalBlock(block: BlockStatement, scope: Map<string, ComptimeValue>): ComptimeValue {
    const result = this.evalScopedBlock(block, scope);
    if (isComptimeControl(result)) {
      if (result.__comptime === "early-return") return result.value;
      // Un control de bucle no puede atravesar el limite de una funcion o
      // callback y terminar por accidente un bucle del caller.
      comptimeError(`comptime: '${result.__comptime}' fuera de un bucle`, result.span);
    }
    return result as ComptimeValue;
  }

  // Solo los limites de funcion/arrow extraen el valor de return. Un bloque
  // interior debe propagar la señal completa hacia sus padres.
  private evalScopedBlock(block: BlockStatement, parent: Map<string, ComptimeValue>): ReturnType<typeof this.evalStatement> {
    const scope = new ComptimeScope(parent);
    for (const stmt of block.statements) {
      if (stmt.kind === "VariableDeclaration") predeclareComptimeBinding(scope, stmt);
    }
    let lastValue: ComptimeValue = undefined;
    for (const stmt of block.statements) {
      const v = this.evalStatement(stmt, scope);
      if (isComptimeControl(v)) {
        return v;
      }
      lastValue = v as ComptimeValue;
    }
    return lastValue;
  }

  private evalStatement(stmt: Statement, scope: Map<string, ComptimeValue>): ComptimeValue | ComptimeControl {
    this.tick(stmt.span);
    switch (stmt.kind) {
      case "ReturnStatement": {
        const value = stmt.value ? convertIntegerBinding(this.evalExpression(stmt.value, scope), this.returnType, stmt.value) : undefined;
        return { __comptime: "early-return", value, span: stmt.span };
      }
      case "VariableDeclaration": {
        if (stmt.initializer) {
          const v = convertIntegerBinding(this.evalExpression(stmt.initializer, scope), stmt.declaredType, stmt.initializer);
          this.boundCheck(v, stmt.span);
          if (stmt.arrayBindings && stmt.arrayBindings.length > 0) {
            // Destructuring: const [a, b] = arr;
            if (!Array.isArray(v)) {
              comptimeError(`comptime: solo se soporta destructuring de arrays`, stmt.span);
            }
            stmt.arrayBindings.forEach((binding, i) => {
              defineComptimeBinding(scope, binding.name, (v as ComptimeValue[])[i] ?? undefined);
            });
          } else if (stmt.objectBindings && stmt.objectBindings.length > 0) {
            // Destructuring: const {a, b} = obj;
            if (!this.isObject(v)) {
              comptimeError(`comptime: solo se soporta destructuring de objects`, stmt.span);
            }
            stmt.objectBindings.forEach((binding) => {
              const key = binding.property ?? binding.name;
              defineComptimeBinding(scope, binding.name, v.fields.get(key) ?? undefined);
            });
          } else {
            defineComptimeBinding(scope, stmt.name, v);
          }
        } else {
          defineComptimeBinding(scope, stmt.name, undefined);
        }
        return undefined;
      }
      case "ExpressionStatement":
        return this.evalExpression(stmt.expression, scope);
      case "IfStatement": {
        const cond = this.evalExpression(stmt.condition, scope);
        if (this.truthy(cond)) return this.evalStatement(stmt.thenBranch, scope);
        if (stmt.elseBranch) return this.evalStatement(stmt.elseBranch, scope);
        return undefined;
      }
      case "WhileStatement": {
        let last: ComptimeValue = undefined;
        let iter = 0;
        while (this.truthy(this.evalExpression(stmt.condition, scope))) {
          this.tick(stmt.span);
          iter++;
          if (iter > this.limits.maxInstructions) {
            comptimeError(`comptime: bucle while excedio ${this.limits.maxInstructions} iteraciones`, stmt.span);
          }
          const v = this.evalStatement(stmt.body, scope);
          if (isComptimeControl(v)) {
            if (v.__comptime === "early-return") return v;
            if (v.__comptime === "break") break;
            // continue vuelve a comprobar la condicion del while.
          } else last = v;
        }
        return last;
      }
      case "DoWhileStatement": {
        let last: ComptimeValue = undefined;
        let iter = 0;
        do {
          this.tick(stmt.span);
          iter++;
          if (iter > this.limits.maxInstructions) {
            comptimeError(`comptime: bucle do-while excedio ${this.limits.maxInstructions} iteraciones`, stmt.span);
          }
          const v = this.evalStatement(stmt.body, scope);
          if (isComptimeControl(v)) {
            if (v.__comptime === "early-return") return v;
            if (v.__comptime === "break") break;
          } else last = v;
        } while (this.truthy(this.evalExpression(stmt.condition, scope)));
        return last;
      }
      case "ForStatement": {
        // El contador declarado pertenece al for, no a su padre. El cuerpo
        // tiene ademas un bloque nuevo por iteracion; las asignaciones a
        // acumuladores exteriores siguen llegando al binding original.
        const loopScope = new ComptimeScope(scope);
        let last: ComptimeValue = undefined;
        if (stmt.initializer) {
          // `for (let i: number = 0; ...; ...)` — el initializer
          // es un VariableDeclaration (Statement). Lo evaluamos
          // como statement, no como expression.
          if (stmt.initializer.kind === "VariableDeclaration") {
            predeclareComptimeBinding(loopScope, stmt.initializer);
          }
          this.evalStatement(stmt.initializer, loopScope);
        }
        let iter = 0;
        while (!stmt.condition || this.truthy(this.evalExpression(stmt.condition, loopScope))) {
          this.tick(stmt.span);
          iter++;
          if (iter > this.limits.maxInstructions) {
            comptimeError(`comptime: bucle for excedio ${this.limits.maxInstructions} iteraciones`, stmt.span);
          }
          const v = this.evalStatement(stmt.body, loopScope);
          if (isComptimeControl(v)) {
            if (v.__comptime === "early-return") return v;
            if (v.__comptime === "break") break;
            // continue NO omite el incremento del for.
          } else last = v;
          if (stmt.increment) this.evalExpression(stmt.increment, loopScope);
        }
        return last;
      }
      case "BlockStatement":
        return this.evalScopedBlock(stmt, scope);
      case "BreakStatement":
        return { __comptime: "break", value: undefined, span: stmt.span };
      case "ContinueStatement":
        return { __comptime: "continue", value: undefined, span: stmt.span };
      default:
        comptimeError(`comptime: sentencia de tipo '${stmt.kind}' no soportada`, stmt.span);
    }
  }

  private evalExpression(expr: Expression, scope: Map<string, ComptimeValue>): ComptimeValue {
    this.tick(expr.span);
    switch (expr.kind) {
      case "LiteralExpression": {
        const lit = expr as LiteralExpression;
        if (lit.exactInteger !== undefined) return BigInt(lit.exactInteger);
        if (lit.literalType === "null") return null;
        if (lit.literalType === "undefined") return undefined;
        if (typeof lit.value === "number") return lit.value;
        if (typeof lit.value === "string") return lit.value;
        if (typeof lit.value === "boolean") return lit.value;
        comptimeError(`comptime: literal de tipo ${lit.literalType} no soportado`, expr.span);
      }
      case "IdentifierExpression": {
        const id = expr as IdentifierExpression;
        if (id.name === "undefined") return undefined;
        if (id.name === "NaN") return NaN;
        if (id.name === "Infinity") return Infinity;
        // V30.42: primero buscamos en el scope local; si no esta,
        // buscamos en el capturedScope (variables del call site).
        assertComptimeBindingInitialized(scope, id.name, expr.span);
        assertComptimeBindingAvailable(scope, id.name, expr.span);
        if (scope.has(id.name)) return scope.get(id.name)!;
        if (this.capturedScope && this.capturedScope.has(id.name)) {
          assertComptimeBindingInitialized(this.capturedScope, id.name, expr.span);
          assertComptimeBindingAvailable(this.capturedScope, id.name, expr.span);
          return this.capturedScope.get(id.name)!;
        }
        comptimeError(
          `comptime: identificador '${id.name}' no esta definido en este scope`,
          expr.span,
          `Las variables que comptime() puede capturar son las declaradas con 'let' o 'const' en el scope del archivo (top-level o dentro de la arrow). Las variables locales de funciones runtime, los parametros de funciones, y los identificadores globales (Math, Number, etc.) no son comptime-compatibes. Si necesitas usar una variable de un function body, marcala con @comptime.`,
          COMPTIME_VALUE_UNAVAILABLE,
        );
        return undefined;
      }
      case "ArrayLiteralExpression": {
        const result: ComptimeArray = [] as ComptimeArray;
        for (const el of (expr as ArrayLiteralExpression).elements) {
          this.tick(el.span);
          if (el.kind === "SpreadElement") {
            const values = this.evalExpression(el.expression, scope);
            if (!Array.isArray(values)) comptimeError(`comptime: spread requiere un array`, expr.span);
            for (let index = 0; index < values.length; index++) {
              result.push(convertIntegerBinding(values[index], aggregateElementType(expr, result.length), el.expression, aggregateElementType(el.expression, index)));
            }
          } else {
            const value = this.evalExpression(el, scope);
            result.push(convertIntegerBinding(value, aggregateElementType(expr, result.length), el));
          }
        }
        Object.defineProperty(result, "__comptime", { value: "array" });
        this.boundCheck(result, expr.span);
        return result;
      }
      case "ObjectLiteralExpression": {
        const obj = (expr as ObjectLiteralExpression).properties;
        const fields = new Map<string, ComptimeValue>();
        for (const prop of obj) {
          this.tick(expr.span);
          if (prop.spread) {
            const v = this.evalExpression(prop.spread, scope);
            if (!this.isObject(v)) {
              comptimeError(`comptime: spread en object requiere un objeto`, expr.span);
            }
            for (const [k, val] of v.fields) fields.set(k, val);
          } else {
            const v = convertIntegerBinding(this.evalExpression(prop.value, scope), prop.destinationType, prop.value);
            fields.set(prop.key, v);
          }
        }
        const result: ComptimeObject = { __comptime: "object", fields };
        this.boundCheck(result, expr.span);
        return result;
      }
      case "UnaryExpression": {
        const u = expr as UnaryExpression;
        if (u.exactInteger !== undefined) return BigInt(u.exactInteger);
        const v = this.evalExpression(u.operand, scope);
        const integer = evalInteger64Unary(u.operator, v, expr);
        if (integer !== undefined) return integer;
        switch (u.operator) {
          case "-": return -this.toNumber(v, expr);
          case "+": return +this.toNumber(v, expr);
          case "!": return !this.truthy(v);
          case "~": return ~this.toNumber(v, expr);
          default:
            comptimeError(`comptime: operador unario '${u.operator}' no soportado`, expr.span);
        }
      }
      case "BinaryExpression": {
        const b = expr as BinaryExpression;
        const l = this.evalExpression(b.left, scope);
        // Decidir antes de evaluar el AST derecho. Hacerlo en evalBinary es
        // demasiado tarde: los efectos y errores de r ya se habrian ejecutado.
        if (b.operator === "&&" && !this.truthy(l)) return l;
        if (b.operator === "||" && this.truthy(l)) return l;
        if (b.operator === "??" && l !== undefined && l !== null) return l;
        const r = this.evalExpression(b.right, scope);
        return this.evalBinary(b.operator, l, r, expr);
      }
      case "AssignmentExpression": {
        const a = expr as AssignmentExpression;
        if (a.target.kind === "IdentifierExpression") {
          const v = convertIntegerBinding(this.evalExpression(a.value, scope), a.target.resolvedType, a.value);
          const name = (a.target as IdentifierExpression).name;
          assertComptimeBindingInitialized(scope, name, a.span);
          this.boundCheck(v, a.span);
          scope.set(name, v);
          return v;
        }
        if (a.target.kind === "IndexExpression") {
          const idx = a.target as IndexExpression;
          const target = this.evalExpression(idx.object, scope);
          const index = this.evalExpression(idx.index, scope);
          const value = convertIntegerBinding(this.evalExpression(a.value, scope), a.target.resolvedType, a.value);
          if (!Array.isArray(target)) {
            comptimeError(`comptime: index assignment solo soportado en arrays`, a.span);
          }
          const numericIndex = this.toNumber(index, a);
          if (!Number.isInteger(numericIndex) || numericIndex < 0 || numericIndex > 4294967294) {
            comptimeError("comptime: el indice de asignacion debe ser un entero de array valido", a.span, undefined, "COMPTIME_INVALID_INDEX");
          }
          // Charge holes before assigning: a sparse index must not hide an
          // enormous logical array or require walking millions of holes.
          if (numericIndex >= target.length) this.chargeValueBytes(8 * (numericIndex - target.length), a.span);
          this.boundCheck(value, a.span, new Set([target]));
          (target as ComptimeValue[])[numericIndex] = value;
          return value;
        }
        if (a.target.kind === "MemberExpression") {
          const mem = a.target as MemberExpression;
          const target = this.evalExpression(mem.object, scope);
          if (!this.isObject(target)) {
            comptimeError(`comptime: member assignment solo soportado en objects`, a.span);
          }
          const value = convertIntegerBinding(this.evalExpression(a.value, scope), a.target.resolvedType, a.value);
          if (!target.fields.has(mem.member)) this.chargeValueBytes(Buffer.byteLength(mem.member, "utf8"), a.span);
          this.boundCheck(value, a.span, new Set([target]));
          target.fields.set(mem.member, value);
          return value;
        }
        comptimeError(`comptime: assignment target de tipo '${a.target.kind}' no soportado`, a.span);
      }
      case "CompoundAssignmentExpression": {
        const a = expr as { kind: "CompoundAssignmentExpression"; target: Expression; operator: string; value: Expression; span: Span };
        if (a.target.kind !== "IdentifierExpression") {
          comptimeError(`comptime: compound assignment solo soportado en identifiers`, a.span);
        }
        const name = (a.target as IdentifierExpression).name;
        assertComptimeBindingInitialized(scope, name, a.span);
        const cur = scope.get(name);
        const rhs = this.evalExpression(a.value, scope);
        const newVal = convertIntegerBinding(this.evalBinary(a.operator.slice(0, -1), cur, rhs, a), a.target.resolvedType, expr);
        scope.set(name, newVal);
        return newVal;
      }
      case "TemplateLiteralExpression": {
        const t = expr as TemplateLiteralExpression;
        const chunks: string[] = [];
        for (let i = 0; i < t.parts.length; i++) {
          chunks.push(t.parts[i]!);
          if (i < t.expressions.length) {
            const v = this.evalExpression(t.expressions[i]!, scope);
            chunks.push(this.toString(v));
          }
        }
        return this.joinStrings(chunks, "", expr.span);
      }
      case "TernaryExpression": {
        const t = expr as TernaryExpression;
        return this.truthy(this.evalExpression(t.condition, scope))
          ? this.evalExpression(t.thenBranch, scope)
          : this.evalExpression(t.elseBranch, scope);
      }
      case "IndexExpression": {
        const i = expr as IndexExpression;
        const target = this.evalExpression(i.object, scope);
        const index = this.evalExpression(i.index, scope);
        if (Array.isArray(target)) return (target as ComptimeValue[])[this.toNumber(index, expr)] ?? undefined;
        if (this.isObject(target)) return target.fields.get(String(index)) ?? undefined;
        if (typeof target === "string") return (target as string)[this.toNumber(index, expr)] ?? "";
        comptimeError(`comptime: index access no soportado en tipo '${typeof target}'`, expr.span);
      }
      case "MemberExpression": {
        const m = expr as MemberExpression;
        const target = this.evalExpression(m.object, scope);
        // Arrays are not ComptimeObject wrappers: handle length before the
        // object-only guard, otherwise the documented branch is unreachable.
        if (Array.isArray(target) && m.member === "length") return target.length;
        if (!this.isObject(target)) {
          comptimeError(`comptime: member access solo soportado en objects`, expr.span);
        }
        return target.fields.get(m.member) ?? undefined;
      }
      case "CallExpression": {
        if ((expr.callee === "f32" || expr.callee === "f64") && expr.args.length === 1) {
          return floatValue(this.evalExpression(expr.args[0], scope), expr.callee, expr);
        }
        if (isIntegerCast(expr.callee) && expr.args.length === 1) {
          return evalIntegerCast(this.evalExpression(expr.args[0], scope), expr.callee, expr);
        }
        const c = expr as CallExpression;
        if (c.callee === "comptime") {
          comptimeError(
            `comptime() no se puede llamar dentro de otra comptime()`,
            expr.span,
            `El evaluador comptime ya es un entorno totalmente controlado — no necesitas anidar. Si la operacion interior no se puede evaluar estaticamente (e.g. usa un parametro de la funcion exterior), la exterior tampoco podra. Refactoriza para que solo la operacion comptime-evaluable este dentro de comptime().`,
          );
        }
        if (c.callee === "Math") {
          // No deberia llegar aqui como CallExpression; lo manejamos en MemberCallExpression.
          comptimeError(`comptime: llamada a Math.${c.args[0]?.kind} no soportada`, expr.span);
        }
        // Builtin de array: .push(x) (llega como MemberCallExpression, ver abajo).
        // Llamada a funcion del archivo.
        const fn = selectComptimeFunction(c, this.functions, this.resolveFunction);
        if (!fn) {
          const available = Array.from(this.functions.keys()).sort();
          const availableList = available.length > 5
            ? `${available.slice(0, 5).join(", ")}, ... (+${available.length - 5} mas)`
            : available.join(", ") || "(ninguna)";
          comptimeError(
            `comptime: funcion '${c.callee}' no encontrada (solo se permiten funciones del mismo archivo)`,
            expr.span,
            `Funciones disponibles en este archivo: ${availableList}. Si '${c.callee}' es un builtin (e.g. numberToString), no es comptime-evaluable: usa solo para formatear el resultado de comptime().`,
          );
        }
        this.recursionDepth++;
        if (this.recursionDepth > this.limits.maxRecursion) {
          comptimeError(
            `comptime: profundidad de recursion excede ${this.limits.maxRecursion}`,
            expr.span,
            `Si tu funcion es inherentemente recursiva (e.g. factorial, fibonacci), considera aumentar el limite. Tambien puedes dividir la recursion en multiples llamadas @comptime mas pequenas, o pre-calcular el valor con comptime() en lugar de @comptime.`,
          );
        }
        try {
          if (fn.params.length !== c.args.length) {
            comptimeError(
              `comptime: '${c.callee}' espera ${fn.params.length} args, recibio ${c.args.length}`,
              expr.span,
            );
          }
          const fnScope = new Map<string, ComptimeValue>();
          for (let i = 0; i < fn.params.length; i++) {
            const value = convertIntegerBinding(this.evalExpression(c.args[i]!, scope), fn.params[i]!.resolvedType ?? fn.params[i]!.type, c.args[i]!);
            this.boundCheck(value, c.args[i]!.span);
            fnScope.set(fn.params[i]!.name, value);
          }
          let result: ComptimeValue = undefined;
          if (fn.body.kind === "BlockStatement") {
            const v = this.evalTypedBody(fn.body, fnScope, fn.returnType);
            if (v && (v as { __comptime?: string }).__comptime === "early-return") {
              result = (v as { value: ComptimeValue }).value;
            } else {
              result = v as ComptimeValue;
            }
          } else {
            result = this.evalTypedBody(fn.body, fnScope, fn.returnType);
          }
          this.boundCheck(result, expr.span);
          return result;
        } finally {
          this.recursionDepth--;
        }
      }
      case "MemberCallExpression": {
        const mc = expr as MemberCallExpression;
        // V30.44: shortcut para Math.* (Math no esta en el scope
        // del comptime, asi que lo detectamos directamente).
        if (mc.object.kind === "IdentifierExpression" && (mc.object as IdentifierExpression).name === "Math") {
          return this.evalMathBuiltin(mc.method, mc.args, scope, expr);
        }
        // Builtin de arrays: arr.push(x), arr.indexOf(x), arr.includes(x), arr.length
        if (mc.object.kind === "IdentifierExpression" || true) {
          const target = this.evalExpression(mc.object, scope);
          if (Array.isArray(target)) {
            const result = this.evalArrayBuiltin(target, mc.method, mc.args, scope, expr);
            this.boundCheck(result, expr.span);
            return result;
          }
          if (target === Math) {
            return this.evalMathBuiltin(mc.method, mc.args, scope, expr);
          }
          if (this.isObject(target)) {
            return this.evalCallOnObject(target, mc.method, mc.args, scope, expr);
          }
        }
        comptimeError(`comptime: member call no soportado`, expr.span);
      }
      case "ArrowFunctionExpression":
        comptimeError(`comptime: arrow functions anidadas no soportadas`, expr.span);
      case "SpreadElement":
        comptimeError(`comptime: spread fuera de array/object literal no soportado`, expr.span);
      case "NewExpression":
        comptimeError(`comptime: 'new' no soportado en comptime`, expr.span);
      case "AwaitExpression":
        comptimeError(`comptime: 'await' no soportado`, expr.span);
      case "MatchExpression":
        comptimeError(`comptime: 'match' no soportado`, expr.span);
      default:
        comptimeError(`comptime: expression de tipo '${expr.kind}' no soportada`, expr.span);
    }
  }

  private evalBinary(op: string, l: ComptimeValue, r: ComptimeValue, node: Expression): ComptimeValue {
    const integer = evalInteger64Binary(op, l, r, node);
    if (integer !== undefined) return integer;
    // Seleccion de valores logicos. El short-circuit del AST se hace antes,
    // en evalExpression; aqui los operandos recibidos ya estan evaluados.
    if (op === "&&") return this.truthy(l) ? r : l;
    if (op === "||") return this.truthy(l) ? l : r;
    if (op === "??") return l !== undefined && l !== null ? l : r;

    // Comparaciones
    if (op === "===") return l === r;
    if (op === "!==") return l !== r;
    if (op === "==") return l == r;
    if (op === "!=") return l != r;
    if (op === "<") return this.toNumber(l, node) < this.toNumber(r, node);
    if (op === ">") return this.toNumber(l, node) > this.toNumber(r, node);
    if (op === "<=") return this.toNumber(l, node) <= this.toNumber(r, node);
    if (op === ">=") return this.toNumber(l, node) >= this.toNumber(r, node);

    // Aritmetica
    if (op === "+") {
      // String concat si alguno es string.
      if (typeof l === "string" || typeof r === "string") {
        return this.joinStrings([this.toString(l), this.toString(r)], "", node.span);
      }
      return this.toNumber(l, node) + this.toNumber(r, node);
    }
    if (op === "-") return this.toNumber(l, node) - this.toNumber(r, node);
    if (op === "*") return this.toNumber(l, node) * this.toNumber(r, node);
    if (op === "/") {
      const r2 = this.toNumber(r, node);
      if (r2 === 0) comptimeError(
        `comptime: division por cero`,
        node.span,
        `El evaluador de comptime rechaza la division por cero para evitar Infinity silencioso (que podria propagarse y causar bugs en runtime). Si esperas cero como denominador valido, usa un condicional (if (b !== 0) a / b) o refactoriza la operacion.`,
      );
      return this.toNumber(l, node) / r2;
    }
    if (op === "%") return this.toNumber(l, node) % this.toNumber(r, node);
    if (op === "**") return this.toNumber(l, node) ** this.toNumber(r, node);
    if (op === "&") return (this.toNumber(l, node) & this.toNumber(r, node)) | 0;
    if (op === "|") return (this.toNumber(l, node) | this.toNumber(r, node)) | 0;
    if (op === "^") return (this.toNumber(l, node) ^ this.toNumber(r, node)) | 0;
    if (op === "<<") return (this.toNumber(l, node) << this.toNumber(r, node)) | 0;
    if (op === ">>") return (this.toNumber(l, node) >> this.toNumber(r, node)) | 0;
    if (op === ">>>") return (this.toNumber(l, node) >>> this.toNumber(r, node)) | 0;

    comptimeError(`comptime: operador binario '${op}' no soportado`, node.span);
  }

  private evalArrayBuiltin(
    arr: ComptimeValue[],
    method: string,
    args: Expression[],
    scope: Map<string, ComptimeValue>,
    node: Expression,
  ): ComptimeValue {
    switch (method) {
      case "push": {
        for (const a of args) {
          const value = this.evalExpression(a, scope);
          // Only account the inserted value, not a snapshot of the whole
          // growing array on every push. Reject cycles before mutation.
          this.boundCheck(value, a.span, new Set([arr]));
          arr.push(value);
        }
        return arr.length;
      }
      case "pop": return arr.pop();
      case "length": return arr.length;
      case "indexOf": {
        const needle = this.evalExpression(args[0]!, scope);
        return arr.findIndex((v) => v === needle);
      }
      case "includes": return arr.some((v) => v === this.evalExpression(args[0]!, scope));
      case "slice": {
        const start = args[0] ? this.toNumber(this.evalExpression(args[0], scope), args[0]) : 0;
        const end = args[1] ? this.toNumber(this.evalExpression(args[1], scope), args[1]) : arr.length;
        return arr.slice(start, end);
      }
      case "concat": {
        const other = this.evalExpression(args[0]!, scope);
        if (!Array.isArray(other)) comptimeError(`comptime: concat requiere un array`, node.span);
        return [...arr, ...(other as ComptimeValue[])];
      }
      case "map": return arr.map((v, i) => convertIntegerBinding(
        this.evalCallback(args[0]!, v, i, arr, scope, node), aggregateElementType(node, 0), args[0]!, callbackResultType(args[0]!),
      ));
      case "flatMap": return arr.flatMap((v, i) => {
        const values = this.evalCallback(args[0]!, v, i, arr, scope, node);
        if (!Array.isArray(values)) comptimeError("comptime: flatMap requiere un callback que devuelve un array", node.span);
        return values;
      });
      case "filter": return arr.filter((v, i) => this.truthy(this.evalCallback(args[0]!, v, i, arr, scope, node)));
      case "forEach": {
        arr.forEach((v, i) => this.evalCallback(args[0]!, v, i, arr, scope, node));
        return undefined;
      }
      case "find": return arr.find((v, i) => this.truthy(this.evalCallback(args[0]!, v, i, arr, scope, node))) ?? undefined;
      case "findIndex": {
        return arr.findIndex((v, i) => this.truthy(this.evalCallback(args[0]!, v, i, arr, scope, node)));
      }
      case "some": return arr.some((v, i) => this.truthy(this.evalCallback(args[0]!, v, i, arr, scope, node)));
      case "every": return arr.every((v, i) => this.truthy(this.evalCallback(args[0]!, v, i, arr, scope, node)));
      case "reduce": {
        let acc = convertIntegerBinding(this.evalExpression(args[0]!, scope), node.resolvedType, args[0]!);
        for (let i = 0; i < arr.length; i++) {
          acc = convertIntegerBinding(this.evalReduceCallback(args[1]!, acc, arr[i]!, i, arr, scope, node), node.resolvedType, args[1]!, callbackResultType(args[1]!));
        }
        return acc;
      }
      case "join": {
        const sep = args[0] ? String(this.evalExpression(args[0], scope)) : ",";
        return this.joinStrings(arr.map((v) => this.toString(v)), sep, node.span);
      }
      case "reverse": {
        arr.reverse();
        return arr;
      }
      case "sort": {
        const cb = args[0];
        if (!cb) return arr.sort();
        const element = node.kind === "MemberCallExpression" ? aggregateElementType(node.object, 0) : undefined;
        arr.sort((a, b) => {
          const value = this.evalTypedCallback(cb, [a, b], [element, element], scope);
          return this.toNumber(value, node);
        });
        return arr;
      }
      default:
        comptimeError(`comptime: array.${method}() no soportado`, node.span);
    }
  }

  private evalMathBuiltin(method: string, args: Expression[], scope: Map<string, ComptimeValue>, node: { span: Span }): ComptimeValue {
    const num = (e: Expression) => this.toNumber(this.evalExpression(e, scope), e);
    const M = globalThis.Math;
    switch (method) {
      case "abs": { const v = num(args[0]!); return v < 0 ? -v : v; }
      case "floor": { const v = num(args[0]!); return M.floor(v); }
      case "ceil": { const v = num(args[0]!); return M.ceil(v); }
      case "round": { const v = num(args[0]!); return M.round(v); }
      case "min": {
        const vals = args.map((a) => num(a));
        let m = vals[0]!;
        for (let i = 1; i < vals.length; i++) if (vals[i]! < m) m = vals[i]!;
        return m;
      }
      case "max": {
        const vals = args.map((a) => num(a));
        let m = vals[0]!;
        for (let i = 1; i < vals.length; i++) if (vals[i]! > m) m = vals[i]!;
        return m;
      }
      case "sqrt": { const v = num(args[0]!); return M.sqrt(v); }
      case "pow": { const b = num(args[0]!); const e2 = num(args[1]!); return b ** e2; }
      case "log": { const v = num(args[0]!); return M.log(v); }
      case "sin": { const v = num(args[0]!); return M.sin(v); }
      case "cos": { const v = num(args[0]!); return M.cos(v); }
      case "tan": { const v = num(args[0]!); return M.tan(v); }
      case "PI": return 3.141592653589793;
      case "E": return 2.718281828459045;
      default:
        comptimeError(
          `comptime: Math.${method} no soportado`,
          node.span,
          `Los metodos de Math soportados son: abs, floor, ceil, round, min, max, sqrt, pow, log, sin, cos, tan, PI, E. Si necesitas otro metodo (e.g. Math.random), pre-calcula el valor con comptime() o muevelo a runtime.`,
        );
    }
  }

  private evalCallOnObject(obj: ComptimeObject, method: string, args: Expression[], scope: Map<string, ComptimeValue>, node: { span: Span }): ComptimeValue {
    const fn = obj.fields.get(method);
    if (typeof fn !== "function") {
      comptimeError(`comptime: object.${method} no es una funcion`, node.span);
    }
    return (fn as (...a: ComptimeValue[]) => ComptimeValue)(...args.map((a) => this.evalExpression(a, scope)));
  }

  private evalTypedCallback(cb: Expression, values: ComptimeValue[], types: (ResolvedType | undefined)[], scope: Map<string, ComptimeValue>): ComptimeValue {
    if (cb.kind !== "ArrowFunctionExpression") comptimeError(`comptime: callback debe ser arrow function`, cb.span);
    const cbScope = new ComptimeScope(scope);
    cb.params.forEach((param, index) => {
      const value = convertIntegerBinding(values[index], param.resolvedType ?? param.type, cb, types[index]);
      this.boundCheck(value, cb.span);
      cbScope.define(param.name, value);
    });
    return this.evalTypedBody(cb.body, cbScope, cb.resolvedType?.kind === "function" ? cb.resolvedType.result : cb.returnType, true);
  }

  private evalCallback(cb: Expression, value: ComptimeValue, index: number, arr: ComptimeValue[], scope: Map<string, ComptimeValue>, node: Expression): ComptimeValue {
    const arrayType = node.kind === "MemberCallExpression" ? node.object.resolvedType : undefined;
    const element = node.kind === "MemberCallExpression" ? aggregateElementType(node.object, 0) : undefined;
    return this.evalTypedCallback(cb, [value, index, arr], [element, {kind:"primitive", name:"number"}, arrayType], scope);
  }

  private evalReduceCallback(cb: Expression, acc: ComptimeValue, value: ComptimeValue, index: number, arr: ComptimeValue[], scope: Map<string, ComptimeValue>, node: Expression): ComptimeValue {
    const arrayType = node.kind === "MemberCallExpression" ? node.object.resolvedType : undefined;
    const element = node.kind === "MemberCallExpression" ? aggregateElementType(node.object, 0) : undefined;
    return this.evalTypedCallback(cb, [acc, value, index, arr], [node.resolvedType, element, {kind:"primitive", name:"number"}, arrayType], scope);
  }

  // --- Helpers ---

  /** One budget per root, shared by all nested helpers/callbacks. Speculative
   * initializer evaluation is a separate root, even when it fails. */
  private withEvaluation<T>(run: () => T): T {
    if (this.evaluationDepth === 0) this.resetBudget();
    this.evaluationDepth++;
    try {
      return run();
    } finally {
      this.evaluationDepth--;
      if (this.evaluationDepth === 0) this.resetBudget();
    }
  }

  private resetBudget(): void {
    this.instructions = 0;
    this.bytesUsed = 0;
    this.recursionDepth = 0;
  }

  evalTopLevelExpression(expr: Expression, scope: Map<string, ComptimeValue>): ComptimeValue {
    return this.withEvaluation(() => {
      const result = this.evalExpression(expr, scope);
      this.boundCheck(result, expr.span);
      return result;
    });
  }

  private isObject(v: ComptimeValue): v is ComptimeObject {
    return typeof v === "object" && v !== null && !Array.isArray(v) && (v as { __comptime?: string }).__comptime === "object";
  }

  private tick(span: Span): void {
    this.instructions++;
    if (this.instructions > this.limits.maxInstructions) {
      comptimeError(
        `comptime: excedio el limite de ${this.limits.maxInstructions} instrucciones`,
        span,
      );
    }
  }

  private chargeValueBytes(bytes: number, span: ComptimeSpan): void {
    this.bytesUsed += bytes;
    if (this.bytesUsed > this.limits.maxValueBytes) {
      comptimeError(
        `comptime: excedio el limite de ${this.limits.maxValueBytes} bytes de valores`,
        span,
        undefined,
        "COMPTIME_VALUE_LIMIT",
      );
    }
  }

  /** Charge UTF-8 payload before concatenating, including join separators. */
  private joinStrings(parts: string[], separator: string, span: ComptimeSpan): string {
    let bytes = 8 + Buffer.byteLength(separator, "utf8") * (parts.length > 0 ? parts.length - 1 : 0);
    for (const part of parts) bytes += Buffer.byteLength(part, "utf8");
    this.chargeValueBytes(bytes, span);
    return parts.join(separator);
  }

  private boundCheck(v: ComptimeValue, span: ComptimeSpan, active = new Set<object>()): void {
    const visit = (x: ComptimeValue): void => {
      if (typeof x === "object" && x !== null) {
        if (active.has(x)) {
          comptimeError("comptime: los valores ciclicos no pueden convertirse en literales", span, undefined, "COMPTIME_CYCLIC_VALUE");
        }
        active.add(x);
        try {
          this.chargeValueBytes(8, span);
          if (Array.isArray(x)) {
            for (const e of x) visit(e);
          } else if (this.isObject(x)) {
            for (const [key, val] of x.fields) {
              this.chargeValueBytes(Buffer.byteLength(key, "utf8"), span);
              visit(val);
            }
          }
        } finally {
          active.delete(x);
        }
      } else {
        this.chargeValueBytes(8 + (typeof x === "string" ? Buffer.byteLength(x, "utf8") : 0), span);
      }
    };
    visit(v);
  }

  private truthy(v: ComptimeValue): boolean {
    if (v === undefined || v === null) return false;
    if (v === false || v === 0 || v === 0n || v === "") return false;
    if (typeof v === "number" && Number.isNaN(v)) return false;
    return true;
  }

  private toNumber(v: ComptimeValue, node: { span: Span }): number {
    if (typeof v === "bigint") {
      const n = Number(v);
      if (!Number.isSafeInteger(n)) comptimeError("comptime: conversión de entero exacto a number perdería precisión", node.span, undefined, "COMPTIME_INTEGER_PRECISION");
      return n;
    }
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isNaN(n)) comptimeError(`comptime: no se puede convertir '${v}' a number`, node.span);
      return n;
    }
    if (v === null) return 0;
    if (v === undefined) return NaN;
    comptimeError(`comptime: no se puede convertir ${typeof v} a number`, node.span);
  }

  private toString(v: ComptimeValue): string {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (Array.isArray(v)) return v.map((x) => this.toString(x)).join(",");
    if (this.isObject(v)) {
      const parts: string[] = [];
      for (const [k, val] of v.fields) parts.push(`${k}: ${this.toString(val)}`);
      return `{${parts.join(", ")}}`;
    }
    return String(v);
  }
}

/** Sentinel que representa el global `Math` en el evaluador. */
const Math: unique symbol = Symbol.for("Math") as unknown as unique symbol;

/**
 * Recorre el AST buscando llamadas a `comptime(arrowFn)`, las evalúa, y
 * sustituye cada llamada por un LiteralExpression con el valor calculado.
 * Devuelve una versión transformada del programa (NO muta el original).
 *
 * Si la arrow function no es comptime-compatible, lanza DiagnosticError
 * con la ubicación y motivo.
 */
export function evaluateComptime(program: Program, limits: ComptimeLimits = DEFAULT_LIMITS, resolveFunction?: ComptimeFunctionResolver): Program {
  // Recolectar funciones del archivo para que comptime() pueda llamarlas.
  const functions: ComptimeFunctions = new Map();
  for (const stmt of program.statements) {
    if (stmt.kind === "FunctionDeclaration") {
      const group = functions.get(stmt.name) ?? [];
      group.push(stmt);
      functions.set(stmt.name, group);
    }
  }

  const interp = new ComptimeInterpreter(limits, functions, resolveFunction);

  // V30.46: pre-walk para recolectar TODAS las variables top-level
  // del AST combinado. Esto es necesario para cross-module @comptime:
  // si `bounded` (en math.ets) referencia `limit` (tambien en
  // math.ets, top-level), el eval de `bounded(100)` desde main.ets
  // debe poder resolver `limit` aunque la llamada venga de otro modulo.
  // Sin este pre-walk, `limit` solo estaria en el scope del modulo
  // que lo declara, y los call sites cross-module no lo verian.
  const globalScope = new Map<string, ComptimeValue>();
  const collectTopLevelVars = (stmts: Statement[]): void => {
    for (const stmt of stmts) {
      if (stmt.kind === "VariableDeclaration" && stmt.initializer) {
        // V30.46: si el initializer es comptime-evaluable, lo
        // evaluamos y lo agregamos al scope. Si no, lo dejamos
        // fuera (no podemos capturar valores que no se conocen en
        // transpilacion).
        try {
          const v = convertIntegerBinding(interp.evalTopLevelExpression(stmt.initializer, globalScope), stmt.declaredType, stmt.initializer);
          if (v !== undefined) {
            globalScope.set(stmt.name, v);
          }
        } catch {
          // No se puede evaluar estaticamente (e.g. requiere
          // input runtime). Lo dejamos fuera del scope.
        }
      }
      // V30.46: tambien buscamos let/const dentro de ExportNamedDeclaration
      // y otros wrappers. El dialecto puede envolver la declaracion
      // en `export let ...`, `export const ...`, etc.
      if (stmt.kind === "ExportNamedDeclaration" && stmt.declaration?.kind === "VariableDeclaration" && stmt.declaration.initializer) {
        try {
          const v = convertIntegerBinding(interp.evalTopLevelExpression(stmt.declaration.initializer, globalScope), stmt.declaration.declaredType, stmt.declaration.initializer);
          if (v !== undefined) {
            globalScope.set(stmt.declaration.name, v);
          }
        } catch {
          // Ignorar.
        }
      }
    }
  };
  collectTopLevelVars(program.statements);

  // V30.43: comprueba si un kind es de expression.
  const isExpressionKind = (kind: string): boolean => {
    return kind.endsWith("Expression") || kind === "LiteralExpression" || kind === "IdentifierExpression" || kind === "CallExpression" || kind === "MemberExpression" || kind === "ArrowFunctionExpression";
  };

  // V30.43: comprueba si un kind es de statement.
  const isStatementKind = (kind: string): boolean => {
    return kind.endsWith("Statement") || kind === "VariableDeclaration" || kind === "ExpressionStatement" || kind === "ReturnStatement";
  };

  // V30.42: visitExpr ahora recibe el scope del call site para que
  // el arrow de comptime() pueda capturar variables del scope
  // (subproducto de la integracion con @comptime functions).
  // V30.43: tambien recibe `inComptimeBody` para saber si esta
  // dentro del body de una funcion @comptime.
  const visitExpr = (node: Expression, scope: Map<string, ComptimeValue>, inComptimeBody: boolean): Expression => {
    if (node.kind === "CallExpression" && (node as CallExpression).callee === "comptime") {
      // Comptime call: sustituimos por el literal y NO descendemos
      // a los args (ya fueron evaluados por evalComptimeCall).
      return evalComptimeCall(node as CallExpression, interp, scope);
    }
    // V30.47: si la llamada es a una funcion @cppgen, evaluarla
    // estaticamente. El retorno (un string) se inyecta como
    // RawCppExpression en el output. A diferencia de @comptime,
    // @cppgen se procesa igual en body @comptime que en runtime
    // (siempre es comptime-evaluable: sus args son strings,
    // numbers, etc. y el output es C++ literal).
    if (node.kind === "CallExpression" && interp.isCppgenFunction(node as CallExpression)) {
      return evalCppgenFunctionCall(node as CallExpression, interp, scope);
    }
    // V30.43: si la llamada es a una funcion @comptime, evaluarla
    // estaticamente SOLO si los args son comptime-compatibles.
    // En runtime contexts (inComptimeBody=false), un arg puede NO
    // ser comptime-compatibe (e.g. un parametro de una funcion
    // runtime). En ese caso, dejamos el call site como esta y sera
    // una llamada runtime cuando la funcion @comptime se emita.
    if (node.kind === "CallExpression" && interp.isComptimeFunction(node as CallExpression)) {
      // Tanto en runtime como al recorrer la definicion de otra funcion
      // @comptime puede haber parametros o locales cuyo valor solo existira
      // cuando se invoque la funcion exterior. En ese caso conservamos el AST
      // de la llamada; el interprete la resolvera con el scope real del call
      // site. Los errores genuinos de limites o evaluacion se propagan.
      try {
        return evalComptimeFunctionCall(node as CallExpression, interp, scope);
      } catch (e) {
        if (isComptimeValueUnavailable(e)) {
          // Args no comptime-compatibles (e.g. un parametro
          // local). Dejamos el call site como esta para runtime.
          return node;
        }
        // Error real (limite excedido, etc.) — propagar.
        throw e;
      }
    }
    // V30.43: para el resto de expressions, descendemos a los
    // hijos SOLO si NO estamos dentro del body de una funcion
    // @comptime.
    if (inComptimeBody) return node;
    return visitExprChildren(node, scope, inComptimeBody);
  };

  /** V30.43: desciende a los hijos de una expression buscando
   *  comptime()/@comptime anidados. Llamado por visitExpr para
   *  expressions que no son comptime calls. */
  const visitExprChildren = (node: Expression, scope: Map<string, ComptimeValue>, inComptimeBody: boolean): Expression => {
    const e = node as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      const value = e[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const v = value[i] as unknown;
          if (v && typeof v === "object" && "kind" in (v as object)) {
            const kind = (v as { kind: string }).kind;
            if (isExpressionKind(kind)) {
              value[i] = visitExpr(v as Expression, scope, inComptimeBody);
            } else if (isStatementKind(kind)) {
              value[i] = walkStatement(v as Statement, visitExpr, scope, inComptimeBody);
            }
          }
        }
      } else if (value && typeof value === "object" && "kind" in (value as object)) {
        const kind = (value as { kind: string }).kind;
        if (isExpressionKind(kind)) {
          e[key] = visitExpr(value as Expression, scope, inComptimeBody);
        } else if (isStatementKind(kind)) {
          e[key] = walkStatement(value as Statement, visitExpr, scope, inComptimeBody);
        }
      }
    }
    return node;
  };

  const visitStmt = (stmt: Statement, scope: Map<string, ComptimeValue>, inComptimeBody: boolean): Statement => {
    // V30.42: delegamos toda la logica a walkStatement, que tambien
    // hace scope-tracking para captura de variables.
    if (stmt.kind === "FunctionDeclaration") {
      // V30.43: procesamos el body de TODAS las funciones (no solo
      // @comptime) para encontrar comptime() calls que puedan estar
      // dentro. El flag inComptimeBody distingue:
      //   - @comptime body: inComptimeBody=true (las subexpressions
      //     se evaluan al llamar a la funcion, no en el visitor)
      //   - runtime body: inComptimeBody=false (las subexpressions
      //     NO se evaluan, solo se procesan comptime() calls)
      // V30.46: el body hereda el scope del padre (que ya tiene
      // las variables globales del pre-walk) mas las variables
      // locales de la funcion. Antes era `new Map()` lo que rompia
      // cross-module @comptime (las funciones importadas no podian
      // capturar variables del archivo importador).
      const isComptime = !!(stmt.decorators && stmt.decorators.some((d) => d.name === "comptime"));
      const newBody = walkBlock(stmt.body, visitExpr, new Map(scope), isComptime);
      if (newBody.kind === "BlockStatement") return { ...stmt, body: newBody };
      return stmt;
    }
    if (stmt.kind === "ClassDeclaration") {
      const newMethods = stmt.methods.map((method) => {
        const isMethodComptime = !!(method.decorators && method.decorators.some((d) => d.name === "comptime"));
        const newBody = walkBlock(method.body, visitExpr, new Map(scope), isMethodComptime);
        if (newBody.kind === "BlockStatement") return { ...method, body: newBody };
        return method;
      });
      return { ...stmt, methods: newMethods };
    }
    return walkStatement(stmt, visitExpr, scope, inComptimeBody);
  };

  // El scope visible durante el recorrido conserva los valores globales del
  // pre-walk como fallback, pero reserva primero todos los nombres top-level.
  // Asi una llamada comptime anterior no puede observar una declaracion
  // posterior, aunque el pre-walk ya haya calculado su valor.
  const programScope = new ComptimeScope(globalScope);
  for (const stmt of program.statements) {
    if (stmt.kind === "VariableDeclaration") predeclareComptimeBinding(programScope, stmt);
    if (stmt.kind === "ExportNamedDeclaration" && stmt.declaration?.kind === "VariableDeclaration") {
      predeclareComptimeBinding(programScope, stmt.declaration);
    }
  }

  const visitedStatements: Statement[] = [];
  for (const stmt of program.statements) {
    visitedStatements.push(visitStmt(stmt, programScope, false));
    const decl = stmt.kind === "VariableDeclaration"
      ? stmt
      : stmt.kind === "ExportNamedDeclaration" && stmt.declaration?.kind === "VariableDeclaration"
        ? stmt.declaration
        : undefined;
    if (!decl) continue;
    for (const name of variableBindingNames(decl)) {
      if (globalScope.has(name)) defineComptimeBinding(programScope, name, globalScope.get(name)!);
    }
  }

  return {
    ...program,
    statements: markComptimeOnlyFunctions(visitedStatements),
  };
}

/** V30.43: para cada FunctionDeclaration con `@comptime`, comprueba
 *  si tiene alguna call site FUERA de su propio body. Si no la
 *  tiene, marca `comptimeOnly: true` (el codegen no la emite).
 *  Recursivamente: la recursion interna de la funcion @comptime
 *  cuenta como "dentro de si misma", no como uso externo. */
export function markComptimeOnlyFunctions(statements: Statement[]): Statement[] {
  // V30.47: encontrar todas las funciones comptime-evaluables
  // (decoradas con @comptime O @cppgen). Ambos tipos se evaluan
  // estaticamente y, si solo se usan en call sites estaticos, no
  // necesitan emitirse como funciones runtime.
  const comptimeFns = new Map<string, FunctionDeclaration>();
  for (const stmt of statements) {
    if (stmt.kind === "FunctionDeclaration" && stmt.decorators?.some((d) => d.name === "comptime" || d.name === "cppgen" || d.name === "etsgen")) {
      comptimeFns.set(stmt.name, stmt);
    }
  }
  if (comptimeFns.size === 0) return statements;
  // Para cada fn comptime-evaluable, contar calls externas (fuera
  // de su body). Si 0, marcarla comptimeOnly.
  const result: Statement[] = [];
  for (const stmt of statements) {
    if (stmt.kind === "FunctionDeclaration" && comptimeFns.has(stmt.name)) {
      const externalCalls = countExternalCalls(statements, stmt.name, stmt);
      if (externalCalls === 0) {
        result.push({ ...stmt, comptimeOnly: true });
      } else {
        result.push(stmt);
      }
    } else {
      result.push(stmt);
    }
  }
  return result;
}

/** V30.43: cuenta las calls a `name` en `statements` que NO estan
 *  dentro del body de la funcion `excludeBody`. */
function countExternalCalls(statements: Statement[], name: string, excludeBody: FunctionDeclaration): number {
  let count = 0;
  for (const stmt of statements) {
    if (stmt === excludeBody) continue; // No contar las calls internas de la propia funcion.
    count += countCallsInNode(stmt, name);
  }
  return count;
}

/** V30.43: cuenta las calls a `name` en un nodo (recursivo). */
function countCallsInNode(node: unknown, name: string): number {
  if (!node || typeof node !== "object") return 0;
  if (Array.isArray(node)) {
    let total = 0;
    for (const item of node) total += countCallsInNode(item, name);
    return total;
  }
  const n = node as { kind?: string; callee?: string };
  if (n.kind === "CallExpression" && n.callee === name) {
    return 1 + countCallsInNode((node as { args?: unknown[] }).args, name);
  }
  let total = 0;
  for (const value of Object.values(node)) {
    total += countCallsInNode(value, name);
  }
  return total;
}

/** V30.42: convierte un LiteralExpression (o Array/Object) a
 *  ComptimeValue para meterlo en el scope. */
function literalToValue(expr: Expression): ComptimeValue {
  if (expr.kind === "LiteralExpression") {
    if (expr.exactInteger !== undefined) return BigInt(expr.exactInteger);
    return (expr as { value: number | string | boolean | null }).value;
  }
  if (expr.kind === "ArrayLiteralExpression") {
    return (expr as { elements: Expression[] }).elements.map((el, index) => convertIntegerBinding(literalToValue(el), aggregateElementType(expr, index), el));
  }
  if (expr.kind === "ObjectLiteralExpression") {
    const fields = new Map<string, ComptimeValue>();
    for (const p of expr.properties) {
      fields.set(p.key, convertIntegerBinding(literalToValue(p.value), p.destinationType, p.value));
    }
    return { __comptime: "object", fields } as ComptimeObject;
  }
  return undefined;
}

/** V30.42: evalúa una llamada a una función @comptime. */
function evalComptimeFunctionCall(
  call: CallExpression,
  interp: ComptimeInterpreter,
  scope: Map<string, ComptimeValue>,
): Expression {
  const result = interp.evalComptimeFunction(call, scope, call.span);
  return valueToLiteral(result, call.span, call.resolvedType);
}

/** V30.47: evalúa una llamada a una función @cppgen. El resultado
 *  es un string que el codegen inyecta tal cual en el output C++.
 *  Retornamos un RawCppExpression (nodo sintético) que el codegen
 *  reconoce. */
function evalCppgenFunctionCall(
  call: CallExpression,
  interp: ComptimeInterpreter,
  scope: Map<string, ComptimeValue>,
): Expression {
  const result = interp.evalCppgenFunction(call, scope, call.span);
  if (typeof result !== "string") {
    comptimeError(
      `comptime: @cppgen function '${call.callee}' debe retornar un string (retorno ${typeof result})`,
      call.span,
      `Las funciones @cppgen generan codigo C++ que se inyecta en el output. El valor de retorno debe ser un string (el codigo C++ a emitir). Si quieres retornar un valor (number, object, etc.), usa @comptime en vez de @cppgen.`,
    );
  }
  return { kind: "RawCppExpression", value: result, span: call.span };
}

function evalComptimeCall(call: CallExpression, interp: ComptimeInterpreter, outerScope?: Map<string, ComptimeValue>): Expression {
  if (call.args.length !== 1) {
    comptimeError(
      `comptime() espera exactamente 1 argumento; recibio ${call.args.length}`,
      call.span,
    );
  }
  const arg = call.args[0]!;
  if (arg.kind !== "ArrowFunctionExpression") {
    comptimeError(
      `comptime() espera una arrow function como argumento; recibio '${arg.kind}'`,
      call.span,
    );
  }
  const result = interp.evalArrow(arg as ArrowFunctionExpression, call.span, outerScope);
  return valueToLiteral(result.value, call.span, call.resolvedType);
}

/** Convierte un ComptimeValue a un LiteralExpression (o expresión compleja). */
function valueToLiteral(value: ComptimeValue, span: Span, type?: ResolvedType): Expression {
  if (typeof value === "bigint") {
    const integerType = type?.kind === "primitive" && (type.name === "i64" || type.name === "u64")
      ? type.name : value > (1n << 63n) - 1n ? "u64" : "i64";
    return { kind: "LiteralExpression", value: Number(value), literalType: "number", exactInteger: value.toString(), integerType, span };
  }
  if (value === null) {
    return { kind: "LiteralExpression", value: null, literalType: "null", span } as LiteralExpression;
  }
  if (value === undefined) {
    // No tenemos LiteralExpression para undefined. Usamos identifier.
    return { kind: "IdentifierExpression", name: "undefined", span };
  }
  if (typeof value === "boolean") {
    return { kind: "LiteralExpression", value, literalType: "boolean", span } as LiteralExpression;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) comptimeError("comptime: resultado flotante no finito no representable como literal", span, undefined, "COMPTIME_FLOAT_RANGE");
    return { kind: "LiteralExpression", value, literalType: "number", span } as LiteralExpression;
  }
  if (typeof value === "string") {
    return { kind: "LiteralExpression", value, literalType: "string", span } as LiteralExpression;
  }
  if (Array.isArray(value)) {
    return {
      kind: "ArrayLiteralExpression",
      elements: (value as ComptimeValue[]).map((v) => valueToLiteral(v, span, type?.kind === "array" ? type.element : undefined)),
      span,
    };
  }
  if (typeof value === "object" && (value as ComptimeObject).__comptime === "object") {
    const obj = value as ComptimeObject;
    // ObjectLiteralExpression (V1.4) tiene `properties: {key, value, ...}[]`.
    return {
      kind: "ObjectLiteralExpression",
      properties: Array.from(obj.fields, ([k, v]) => ({
        key: k,
        value: valueToLiteral(v, span),
        shorthand: false,
        computed: false,
      })),
      span,
    } as unknown as Expression;
  }
  comptimeError(`comptime: tipo de valor no soportado en conversion a literal`, span);
}

/** Recorre un statement complejo (if/while/for) buscando comptime() en expressions.
 *  V30.42: tambien hace scope-tracking para que comptime() dentro
 *  de un function body pueda capturar variables. */
function walkStatement(stmt: Statement, visitExpr: (e: Expression, scope: Map<string, ComptimeValue>, inComptimeBody: boolean) => Expression, scope: Map<string, ComptimeValue>, inComptimeBody: boolean): Statement {
  if (stmt.kind === "IfStatement") {
    return {
      ...stmt,
      condition: visitExpr(stmt.condition, scope, inComptimeBody),
      thenBranch: walkBlock(stmt.thenBranch, visitExpr, scope, inComptimeBody),
      elseBranch: stmt.elseBranch ? walkBlock(stmt.elseBranch, visitExpr, scope, inComptimeBody) : undefined,
    } as Statement;
  }
  if (stmt.kind === "WhileStatement") {
    return { ...stmt, condition: visitExpr(stmt.condition, scope, inComptimeBody), body: walkBlock(stmt.body, visitExpr, scope, inComptimeBody) } as Statement;
  }
  if (stmt.kind === "ForStatement") {
    const loopScope = new ComptimeScope(scope);
    if (stmt.initializer?.kind === "VariableDeclaration") {
      predeclareComptimeBinding(loopScope, stmt.initializer);
    }
    return {
      ...stmt,
      initializer: stmt.initializer ? walkStatement(stmt.initializer, visitExpr, loopScope, inComptimeBody) : undefined,
      condition: stmt.condition ? visitExpr(stmt.condition, loopScope, inComptimeBody) : undefined,
      increment: stmt.increment ? visitExpr(stmt.increment, loopScope, inComptimeBody) : undefined,
      body: walkBlock(stmt.body, visitExpr, loopScope, inComptimeBody),
    } as Statement;
  }
  if (stmt.kind === "BlockStatement") {
    return walkBlock(stmt, visitExpr, scope, inComptimeBody) as BlockStatement;
  }
  if (stmt.kind === "ReturnStatement" && stmt.value) {
    return { ...stmt, value: visitExpr(stmt.value, scope, inComptimeBody) } as Statement;
  }
  if (stmt.kind === "ExpressionStatement") {
    return { ...stmt, expression: visitExpr(stmt.expression, scope, inComptimeBody) } as Statement;
  }
  if (stmt.kind === "VariableDeclaration" && stmt.initializer) {
    const newInit = visitExpr(stmt.initializer, scope, inComptimeBody);
    if (newInit.kind === "LiteralExpression" || newInit.kind === "ObjectLiteralExpression" || newInit.kind === "ArrayLiteralExpression") {
      const value = convertIntegerBinding(literalToValue(newInit), stmt.declaredType, newInit);
      if (stmt.arrayBindings?.length && Array.isArray(value)) {
        stmt.arrayBindings.forEach((binding, i) => defineComptimeBinding(scope, binding.name, value[i]));
      } else if (stmt.objectBindings?.length && typeof value === "object" && value !== null && !Array.isArray(value)) {
        const object = value as ComptimeObject;
        stmt.objectBindings.forEach((binding) => {
          defineComptimeBinding(scope, binding.name, object.fields.get(binding.property ?? binding.name));
        });
      } else if (stmt.name) {
        defineComptimeBinding(scope, stmt.name, value);
      }
    } else {
      markComptimeBindingUnavailable(scope, stmt);
    }
    return { ...stmt, initializer: newInit } as Statement;
  }
  return stmt;
}

function walkBlock(
  block: BlockStatement | Expression,
  visitExpr: (e: Expression, scope: Map<string, ComptimeValue>, inComptimeBody: boolean) => Expression,
  scope: Map<string, ComptimeValue>,
  inComptimeBody: boolean,
): BlockStatement | Expression {
  if (block.kind !== "BlockStatement") return visitExpr(block, scope, inComptimeBody);
  const blockScope = new ComptimeScope(scope);
  for (const stmt of block.statements) {
    if (stmt.kind === "VariableDeclaration") predeclareComptimeBinding(blockScope, stmt);
  }
  return { ...block, statements: block.statements.map((s) => walkStatement(s, visitExpr, blockScope, inComptimeBody)) };
}

/** Destination conversion is independent of expression arithmetic/promotions. */
function convertIntegerBinding(value: ComptimeValue, type: string | ResolvedType | undefined, source: Expression, sourceType = source.resolvedType): ComptimeValue {
  const name = typeof type === "string" ? type : type?.kind === "primitive" ? type.name : undefined;
  if (!name || value === undefined) return value;
  if (isNumericName(name) && isFloat(name)) return floatValue(value, name, source);
  if (!isIntegerCast(name)) return value;
  return evalIntegerCast(value, name, source, sourceType);
}

function aggregateElementType(expr: Expression, index: number): ResolvedType | undefined {
  const type = expr.resolvedType;
  if (type?.kind === "array") return type.element;
  if (type?.kind === "tuple") return type.elements[index];
  if (type?.kind === "class") return toResolvedType(fixedArrayElement(type.name) ?? undefined);
  return undefined;
}

function callbackResultType(cb: Expression): ResolvedType | undefined {
  return cb.resolvedType?.kind === "function" ? cb.resolvedType.result : undefined;
}
