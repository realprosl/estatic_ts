import type { ArrowFunctionExpression, Expression } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { Span } from "../core/span.ts";
import { arrayElement, isArrayType, isFunctionType } from "../types/type-system.ts";

/** Funciones y arrays dinámicos anidados de funciones, no clases opacas. */
export function isClosureReturnCarrier(type: string): boolean {
  while (isArrayType(type)) type = arrayElement(type);
  return isFunctionType(type);
}

/** Protección parcial de retornos de funciones y arrays dinámicos de funciones.
 * No es escape analysis: no modela memoria de objetos ni callbacks retenidos.
 */
export class ClosureReturnSafety {
  private readonly dependents = new Map<object, Set<object>>();
  private readonly seeds = new Set<ArrowFunctionExpression>();
  private readonly returns = new Map<Expression, { span: Span }>();

  flow(target: object | undefined, source: object | undefined): void {
    if (!target || !source) return;
    let edges = this.dependents.get(source);
    if (!edges) this.dependents.set(source, edges = new Set());
    edges.add(target);
  }

  referenceClosure(node: ArrowFunctionExpression): void { this.seeds.add(node); }
  returned(value: Expression, site: { span: Span }): void { this.returns.set(value, site); }

  diagnostics(): Diagnostic[] {
    // Punto fijo por worklist: cada vértice se visita una vez, incluso con
    // aliases cíclicos. Basta un origen para explicar cada retorno inseguro.
    const origins = new Map<object, ArrowFunctionExpression>();
    const pending: object[] = [];
    for (const seed of this.seeds) { origins.set(seed, seed); pending.push(seed); }
    for (let i = 0; i < pending.length; i++) {
      const source = pending[i];
      for (const target of this.dependents.get(source) ?? []) {
        if (origins.has(target)) continue;
        origins.set(target, origins.get(source)!);
        pending.push(target);
      }
    }
    const diagnostics: Diagnostic[] = [];
    for (const [value, site] of this.returns) {
      const origin = origins.get(value);
      if (!origin) continue;
      diagnostics.push({
        phase: "semantic",
        code: "CLOSURE_REFERENCE_RETURN",
        message: "E4210: no se puede retornar una closure o array con capturas por referencia de lifetime no demostrado",
        span: site.span,
        hint: "mantén la closure dentro del ámbito de sus capturas o devuelve una closure de solo lectura por valor",
        notes: [
          `captura por referencia originada en ${origin.span.start.line}:${origin.span.start.column}: ${(origin.capturedSymbols ?? []).join(", ")}`,
          "protección parcial: modela funciones y arrays dinámicos, no campos, otros contenedores ni callbacks retenidos",
        ],
      });
    }
    return diagnostics;
  }
}
