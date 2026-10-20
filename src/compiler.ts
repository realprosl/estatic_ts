import { Buffer } from "node:buffer";
import { Lexer } from "./lexer/lexer.ts";
import { Parser } from "./parser/parser.ts";
import { TypeChecker } from "./semantic/type-checker.ts";
import { DiagnosticError, withGeneratedSource } from "./core/diagnostic.ts";
import { CppGenerator } from "./codegen/cpp-generator.ts";
import { evaluateComptime, markComptimeOnlyFunctions } from "./codegen/comptime-evaluator.ts";
import { selectComptimeFunction, hasComptimeDecorator, type ComptimeFunctions, type ComptimeFunctionResolver } from "./codegen/comptime-functions.ts";
import { EtsgenBudget, type EtsgenLimits } from "./codegen/etsgen-budget.ts";
import { validateAndExpandEtsgen, etsgenGeneratedError, type EtsgenFragment, generatedEtsSpan } from "./codegen/etsgen-fragments.ts";
import type { Program, Statement, CallExpression, Expression } from "./ast/nodes.ts";
import { BuildProfile } from "./build/build-profile.ts";
import type { SemanticCheckCache } from "./semantic/semantic-cache.ts";

export interface CompilationResult { ast: Program; cpp: string }
/** V15: resultado del pipeline por módulos. El header contiene todas las
 * declaraciones que cualquier módulo puede necesitar (forward declarations
 * de clases, firmas de funciones exportadas, etc.). Cada entry de `modules`
 * es el `.cpp` que contiene SOLO el código de ese módulo (incluye el header). */
export interface ModuleCompilation {
  header: string;
  modules: { name: string; cpp: string }[];
}

export function parse(source: string): Program {
  return new Parser(new Lexer(source).tokenize()).parseProgram();
}

/** Procesa @etsgen: Estatic generado -> parser -> AST contextual -> checker.
 *  El AST expandido continúa por el emisor ordinario, sin extracción de C++.
 *
 *  @etsgen es más poderoso que @cppgen porque el codigo generado
 *  puede usar el dialecto completo (control flow, funciones, etc.),
 *  no solo C++ literal. El costo: hay que parsear y compilar el
 *  string, lo que puede ser lento si se hace en bucles grandes.
 *
 *  La fase expande también las llamadas generadas, con límites por árbol
 *  raíz. Cada pasada resuelve sobrecargas antes de la siguiente expansión. */
type ExpansionState = {roots:Map<string,string>;depths:Map<string,number>;usage:Map<string,{count:number;bytes:number}>};
/** Intermediate checks may encounter names a later expansion publishes. Only
 * generation-call errors are fatal here: those argument nodes will disappear.
 * Every remaining source node is checked strictly before comptime evaluation. */
function checkForExpansion(program:Program):TypeChecker {
  const checker=new TypeChecker();
  try { checker.check(program); }
  catch(error) {
    if(!(error instanceof DiagnosticError)) throw error;
    const names=new Set(program.statements.filter(s=>s.kind === "FunctionDeclaration" && s.decorators?.some(d=>d.name === "etsgen")).map(s=>(s as {name:string}).name));
    const calls:CallExpression[]=[];
    const walk=(node:any):void=>{
      if(!node || typeof node !== "object") return;
      if(Array.isArray(node)) {node.forEach(walk);return;}
      if(node.kind === "CallExpression" && names.has(node.callee)) calls.push(node);
      for(const [key,value] of Object.entries(node)) if(!["span","parent","generatedSources","resolvedType","resolvedSignature","resolvedRuntimeType"].includes(key)) walk(value);
    };
    walk(program);
    if(!names.size) throw error;
    const fatal=error.diagnostics.filter(d=>calls.some(c=>{
      const call=c.span.generated?.span ?? c.span;
      const diagnostic=d.span.generated?.span ?? d.span;
      return c.span.generated?.id === d.span.generated?.id && diagnostic.start.offset >= call.start.offset && diagnostic.end.offset <= call.end.offset;
    }));
    if(fatal.length) throw new DiagnosticError(fatal);
  }
  return checker;
}
export function evalEtsgenCalls(program: Program, resolveFunction?: ComptimeFunctionResolver, limits: Partial<EtsgenLimits> = {}, validateExpanded?:(program:Program)=>void): Program {
  const state:ExpansionState={roots:new Map(),depths:new Map(),usage:new Map()};
  let current=program;
  let resolve=resolveFunction;
  while(true) {
    const before=current.generatedSources?.length ?? 0;
    const expanded=evalEtsgenPass(current,resolve,limits,state);
    if((expanded.generatedSources?.length ?? 0) === before) { validateExpanded?.(expanded);new TypeChecker().check(expanded); return expanded; }
    current=expanded;
    const checker=checkForExpansion(current);
    resolve=call=>checker.functionOf(call);
  }
}

function evalEtsgenPass(program:Program, resolveFunction:ComptimeFunctionResolver|undefined, limits:Partial<EtsgenLimits>, state:ExpansionState):Program {
  // Agrupar todas las firmas para distinguir decoradores por sobrecarga,
  // incluidas las firmas runtime que comparten nombre con una @etsgen.
  const etsgenFns: ComptimeFunctions = new Map();
  for (const stmt of program.statements) {
    if (stmt.kind === "FunctionDeclaration") {
      const group = etsgenFns.get(stmt.name) ?? [];
      group.push(stmt);
      etsgenFns.set(stmt.name, group);
    }
  }
  if (![...etsgenFns.values()].some(group => group.some(fn => fn.decorators?.some(d => d.name === "etsgen")))) return program;
  const budget = new EtsgenBudget(limits, program.span);
  const fragments: EtsgenFragment[] = [];
  const selectEtsgen = (call: CallExpression) => {
    if (!hasComptimeDecorator(call, "etsgen", etsgenFns, resolveFunction)) return undefined;
    const fn = selectComptimeFunction(call, etsgenFns, resolveFunction)!;
    return { body: fn.body, params: fn.params.map(parameter => parameter.name), span: fn.span };
  };

  // Paso 1.5: declarar el mini-evaluador primero (lo usan tanto
  // el globalScope pre-walk como el evalBody).
  // Mini-evaluador de expressions simples (string concat, template literals, etc.).
  // Esto es un subset del comptime-evaluator; solo lo necesario para @etsgen.
  const evalSimpleExpr = (expr: Expression, scope: Map<string, unknown>): string | number | null => {
    return budget.expression(expr.span, () => evalSimpleExprBody(expr, scope));
  };
  const evalSimpleExprBody = (expr: Expression, scope: Map<string, unknown>): string | number | null => {
    if ((expr.kind === "LiteralExpression" || expr.kind === "UnaryExpression") && expr.exactInteger !== undefined) {
      const exact = BigInt(expr.exactInteger);
      if (!Number.isSafeInteger(Number(exact))) throw new DiagnosticError([{
        phase: "semantic", code: "ETSGEN_INTEGER_PRECISION", span: expr.span,
        message: "@etsgen: el mini-evaluador todavía no admite enteros fuera del rango seguro de JS",
      }]);
      return Number(exact);
    }
    if (expr.kind === "LiteralExpression") {
      const v = (expr as { value: unknown }).value;
      if (typeof v === "string" || typeof v === "number") return v;
      return null;
    }
    if (expr.kind === "TemplateLiteralExpression") {
      const tpl = expr as { parts: string[]; expressions: Expression[] };
      const chunks: string[] = [];
      for (let i = 0; i < tpl.parts.length; i++) {
        chunks.push(tpl.parts[i]!);
        if (i < tpl.expressions.length) {
          const sub = evalSimpleExpr(tpl.expressions[i]!, scope);
          if (sub === null) return null;
          chunks.push(String(sub));
        }
      }
      return budget.concatenate(chunks, expr.span);
    }
    if (expr.kind === "BinaryExpression") {
      const bin = expr as { left: Expression; right: Expression; operator: string };
      const l = evalSimpleExpr(bin.left, scope);
      const r = evalSimpleExpr(bin.right, scope);
      if (l === null || r === null) return null;
      if (typeof l === "number" && typeof r === "number") {
        switch (bin.operator) {
          case "+": return l + r;
          case "-": return l - r;
          case "*": return l * r;
          case "/": return l / r;
          default: return null;
        }
      }
      return budget.concatenate([String(l), String(r)], expr.span);
    }
    if (expr.kind === "IdentifierExpression") {
      const name = (expr as { name: string }).name;
      const v = scope.get(name);
      if (v === undefined) return null;
      if (typeof v === "bigint") throw new DiagnosticError([{
        phase: "semantic", code: "ETSGEN_INTEGER_PRECISION", span: expr.span,
        message: "@etsgen: el mini-evaluador todavía no admite este entero exacto",
      }]);
      return v as string | number;
    }
    if (expr.kind === "CallExpression") {
      const c = expr as CallExpression;
      const fn = selectEtsgen(c);
      if (!fn) return null;
      const evaluatedArgs = c.args.map((a) => evalSimpleExpr(a, scope));
      if (evaluatedArgs.some((v) => v === null)) return null;
      const innerScope = new Map<string, unknown>();
      for (let i = 0; i < fn.params.length; i++) {
        innerScope.set(fn.params[i]!, evaluatedArgs[i]);
      }
      const returnStmt = (fn.body as { statements?: Statement[] }).statements?.[0];
      if (!returnStmt || returnStmt.kind !== "ReturnStatement" || !returnStmt.value) return null;
      return evalSimpleExpr(returnStmt.value as Expression, innerScope);
    }
    return null;
  };

  // Paso 1.5: extraer las variables globales del archivo (top-level
  // let/const) para que el mini-eval de @etsgen pueda capturarlas.
  // Solo soportamos valores comptime-compatibles (literal string/number).
  const globalScope = new Map<string, string | number>();
  for (const stmt of program.statements) {
    if (stmt.kind === "VariableDeclaration" && stmt.initializer) {
      const init = stmt.initializer;
      if (init.kind === "LiteralExpression") {
        if (init.exactInteger !== undefined && !Number.isSafeInteger(Number(init.exactInteger))) {
          globalScope.set(stmt.name, BigInt(init.exactInteger)); continue;
        }
        const v = (init as { value: unknown }).value;
        if (typeof v === "string" || typeof v === "number") {
          globalScope.set(stmt.name, v);
        }
      } else if (init.kind === "BinaryExpression") {
        const v = budget.root(() => evalSimpleExpr(init as Expression, globalScope));
        if (typeof v === "string" || typeof v === "number") {
          globalScope.set(stmt.name, v);
        }
      }
    }
  }

  // Paso 2: implementar un mini-evaluador para los bodies de @etsgen.
  // Los args siempre son comptime-compatibles (el codegen los pone
  // como literales o identificadores). Si un arg no se puede evaluar,
  // dejamos el call site como esta para runtime.
  const evalBody = (fn: { body: Statement; params: string[] }, args: CallExpression["args"]): string | null => {
    // Solo soportamos bodies simples: un return string o una expression
    // statement que es un template literal / string concatenation.
    // Para empezar, implementamos solo el caso "return string".
    const returnStmt = (fn.body as { statements?: Statement[] }).statements?.[0];
    if (!returnStmt || returnStmt.kind !== "ReturnStatement" || !returnStmt.value) return null;
    // Evaluamos la expression con un scope que tiene los args como
    // variables locales + las variables globales del archivo (captura).
    const scope = new Map<string, unknown>(globalScope);
    for (let i = 0; i < fn.params.length; i++) {
      const arg = args[i]!;
      // Aceptamos literal string/number, identifier (no soportado — necesitamos
      // un scope), o expresiones comptime-compatibles (BinaryExpression con
      // operandos comptime-compatibles, UnaryExpression, Parenthesized).
      // Para empezar, soportamos solo LiteralExpression. Para BinaryExpression
      // evaluamos recursivamente con evalSimpleExpr (sin scope, sin identifiers).
      if (arg.kind === "LiteralExpression" && typeof (arg as { value: unknown }).value === "string") {
        budget.value((arg as { value: string }).value, arg.span);
        scope.set(fn.params[i]!, (arg as { value: string }).value);
      } else if (arg.kind === "LiteralExpression" && typeof (arg as { value: unknown }).value === "number") {
        const value = evalSimpleExpr(arg, new Map());
        budget.value(value, arg.span);
        scope.set(fn.params[i]!, value);
      } else if (arg.kind === "BinaryExpression" || arg.kind === "UnaryExpression") {
        // Evaluar la expresion con un mini-eval que solo soporta literales
        // y operaciones basicas (+, -, *, /).
        const value = evalSimpleExpr(arg as Expression, new Map());
        if (value === null) return null;
        if (typeof value !== "string" && typeof value !== "number") return null;
        scope.set(fn.params[i]!, value);
      } else {
        return null;  // arg no comptime-compatible
      }
    }
    // Evaluamos la expression de retorno. Si retorna un number, lo
    // convertimos a string (los @etsgen siempre retornan string).
    const result = evalSimpleExpr(returnStmt.value as Expression, scope);
    if (result === null) return null;
    return String(result);
  };

  // Paso 3: recoger el Estatic generado y sustituir sus llamadas por AST.
  const visit = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(visit);
    const obj = node as Record<string, unknown>;
    // Helpers compose text in the mini-evaluator. Never expand their bodies
    // as if they were runtime callers.
    if (obj.kind === "FunctionDeclaration" && (obj.decorators as {name:string}[]|undefined)?.some(d=>d.name === "etsgen")) return node;
    // Sustituir la call si es a una @etsgen function.
    if (obj.kind === "CallExpression" && typeof obj.callee === "string" && hasComptimeDecorator(obj as unknown as CallExpression, "etsgen", etsgenFns, resolveFunction)) {
      const call = obj as unknown as CallExpression;
      const fn = selectEtsgen(call)!;
      const etsCode = budget.root(() => {
        const code = evalBody(fn, call.args);
        if (code !== null) budget.generated(code, call.span);
        return code;
      });
      if (etsCode === null) {
        // Args no comptime-compatibles. Dejamos la call como esta
        // (se emitira como llamada runtime, pero @etsgen no se filtra
        // automaticamente — habria que añadirlo).
        return node;
      }
      const id=`etsgen:${(program.generatedSources?.length ?? 0)+fragments.length}`;
      const parent=call.span.generated?.id;
      const root=parent ? state.roots.get(parent) ?? parent : id;
      const depth=parent ? (state.depths.get(parent) ?? 0)+1 : 0;
      const usage=state.usage.get(root) ?? {count:0,bytes:0};
      usage.count++; usage.bytes+=Buffer.byteLength(etsCode,"utf8");
      state.roots.set(id,root);state.depths.set(id,depth);state.usage.set(root,usage);
      const limitError=(code:string,message:string):never=>{throw new DiagnosticError([{...withGeneratedSource({phase:"semantic",code,message,span:call.span,notes:parent ? [`Expansión anidada desde ${parent}`] : undefined},program.generatedSources),code}]);};
      if(depth >= (limits.maxRecursion ?? 100)) limitError("ETSGEN_RECURSION_LIMIT","@etsgen: profundidad de expansión anidada excedida");
      if(usage.count > (limits.maxInstructions ?? 10000)) limitError("ETSGEN_EXPANSION_LIMIT","@etsgen: presupuesto de expansiones del árbol agotado");
      if(usage.bytes > (limits.maxGeneratedBytes ?? 1024*1024)) limitError("ETSGEN_GENERATED_LIMIT","@etsgen: bytes acumulados de la expansión raíz excedidos");
      // Parseamos el Estatic generado. La función sintética solo permite
      // parsear un fragmento de sentencias; su cuerpo se inserta como AST.
      const wrappedCode = `function main(): void {\n${etsCode}\n}`;
      let etsAst: Program;
      try {
        etsAst = parse(wrappedCode);
      } catch (e) {
        const message = e instanceof DiagnosticError ? e.diagnostics.map(d => d.message).join("\n") : (e as Error).message || String(e);
        const error = etsgenGeneratedError(call, etsCode, "parse", message);
        if (e instanceof DiagnosticError && e.diagnostics[0]) error.diagnostics[0].generated = {
          id: `etsgen:${(program.generatedSources?.length ?? 0) + fragments.length}`, generator: call.callee, source: etsCode,
          span: generatedEtsSpan(e.diagnostics[0].span, etsCode),
        };
        throw error;
      }
      fragments.push({ call, code: etsCode, program: etsAst, definitionSpan:fn.span });
      return call; // Temporary expansion marker; removed before checking.
    }
    // Recursión: visitar todos los campos.
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "parent" || k === "resolvedType") {
        result[k] = v;
      } else {
        result[k] = visit(v);
      }
    }
    return result;
  };
  return validateAndExpandEtsgen(visit(program) as Program, fragments, true);
}

export function analyze(programs: Program[], options:{validateExpanded?:(program:Program)=>void; profile?: BuildProfile; semanticCache?: SemanticCheckCache}={}): { program: Program; checker: TypeChecker } {
  const profile = options.profile ?? new BuildProfile();
  if (!programs.length) throw new Error("No hay módulos para analizar");
  const combined: Program = { kind: "Program", statements: programs.flatMap(module => module.statements), span: { start: programs[0].span.start, end: programs.at(-1)!.span.end } };
  // Validamos primero el AST original. Sin esta pasada, el evaluator podia
  // borrar junto con el arrow errores de tipos, mutabilidad o resolucion de
  // nombres que solo existian dentro de comptime(). La llamada conserva el
  // tipo de retorno del arrow; el literal concreto se valida despues.
  let sourceChecker = new TypeChecker();
  let prepared=combined;
  try { profile.measure("check-source", () => sourceChecker.check(combined, options.semanticCache ? { cache: options.semanticCache, stage: "source" } : undefined)); }
  catch(error) {
    if(!(error instanceof DiagnosticError)) throw error;
    if(!combined.statements.some(s=>s.kind === "FunctionDeclaration" && s.decorators?.some(d=>d.name === "etsgen"))) throw error;
    sourceChecker=profile.measure("check-expansion-context", () => checkForExpansion(combined));
    prepared=profile.measure("etsgen", () => evalEtsgenCalls(combined,call=>sourceChecker.functionOf(call),{},options.validateExpanded));
    sourceChecker=new TypeChecker(); profile.measure("check-expanded-source", () => sourceChecker.check(prepared));
  }

  // V30.41: despues de validar el AST fuente, evaluamos comptime(). Una segunda
  // pasada semantica comprueba los literales y nodos sinteticos resultantes.
  // Lo hacemos aqui (no en compile) para que `compileFile`, que usa `analyze`
  // directamente para proyectos multi-archivo, siga el mismo pipeline.
  // V30.48: despues de comptime, procesamos las calls a @etsgen.
  // Estas funciones generan Estatic que se parsea y se incorpora al AST.
  // Después de evalEtsgenCalls las llamadas expandidas ya son sentencias
  // ordinarias, así que markComptimeOnlyFunctions puede filtrar
  // las funciones @etsgen que solo se usaban estaticamente.
  const resolveFunction: ComptimeFunctionResolver = call => sourceChecker.functionOf(call);
  const evaluated = profile.measure("comptime", () => evaluateComptime(prepared, undefined, resolveFunction));
  const afterEtsgen = profile.measure("etsgen", () => evalEtsgenCalls(evaluated, resolveFunction,{},options.validateExpanded));
  const program: Program = { ...afterEtsgen, statements: markComptimeOnlyFunctions(afterEtsgen.statements) };
  const checker = new TypeChecker();
  profile.measure("check-final", () => checker.check(program, options.semanticCache ? { cache: options.semanticCache, stage: "final" } : undefined));
  return { program, checker };
}

export function compile(source: string): CompilationResult {
  const ast = parse(source);
  // V30.41: comptime() se evalua dentro de `analyze` para que
  // tanto el flujo `compile` como `compileFile` (multi-archivo)
  // lo apliquen en el mismo sitio. Devolvemos el AST del checker
  // (con comptime sustituido por literales) para que el codegen
  // no vea comptime calls.
  const { program, checker } = analyze([ast]);
  return { ast: program, cpp: new CppGenerator(expression => checker.typeOf(expression), expression => checker.isVariadic(expression), expression => checker.typeArgumentsOf(expression), name => checker.resolveTypeAliasFromAst(name), union => checker.resolveUnionAliasNameFromAst(union)).generate(program) };
}
