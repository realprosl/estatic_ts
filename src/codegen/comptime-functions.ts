import type { CallExpression, FunctionDeclaration } from "../ast/nodes.ts";
import { DiagnosticError } from "../core/diagnostic.ts";

/** The semantic checker, not runtime JS values, decides which overload runs.
 * Kept out of the AST to avoid cycles through declarations and recursive calls. */
export type ComptimeFunctionResolver = (call: CallExpression) => FunctionDeclaration | undefined;
export type ComptimeFunctions = Map<string, FunctionDeclaration[]>;

export function selectComptimeFunction(
  call: CallExpression,
  functions: ComptimeFunctions,
  resolve?: ComptimeFunctionResolver,
): FunctionDeclaration | undefined {
  const candidates = functions.get(call.callee);
  if (!candidates?.length) return undefined;
  const selected = resolve?.(call);
  if (selected) return selected;
  if (candidates.length === 1) return candidates[0];
  throw new DiagnosticError([{
    phase: "semantic",
    code: "COMPTIME_OVERLOAD_UNRESOLVED",
    message: `comptime: la sobrecarga de '${call.callee}' necesita resolución semántica`,
    span: call.span,
    hint: "Usa compile/compileFile o proporciona la selección del TypeChecker al evaluador. No se elige una función por orden de declaración.",
  }]);
}

export function hasComptimeDecorator(
  call: CallExpression,
  name: string,
  functions: ComptimeFunctions,
  resolve?: ComptimeFunctionResolver,
): boolean {
  if (!functions.get(call.callee)?.some(fn => fn.decorators?.some(decorator => decorator.name === name))) return false;
  return !!selectComptimeFunction(call, functions, resolve)?.decorators?.some(decorator => decorator.name === name);
}
