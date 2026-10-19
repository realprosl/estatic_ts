import { Buffer } from "node:buffer";
import { DiagnosticError } from "../core/diagnostic.ts";
import type { Span } from "../core/span.ts";
import type { ComptimeLimits } from "./comptime-evaluator.ts";

export interface EtsgenLimits extends ComptimeLimits {
  /** UTF-8 bytes of generated dialect text, checked before parsing it. */
  maxGeneratedBytes: number;
}

const DEFAULT_LIMITS: Readonly<EtsgenLimits> = Object.freeze({
  maxInstructions: 10000,
  maxRecursion: 100,
  maxValueBytes: 1024 * 1024,
  maxGeneratedBytes: 1024 * 1024,
});

export class EtsgenBudget {
  private readonly limits: EtsgenLimits;
  private instructions = 0;
  private valueBytes = 0;
  private expressionDepth = 0;
  private roots = 0;

  constructor(options: Partial<EtsgenLimits>, span: Span) {
    this.limits = { ...DEFAULT_LIMITS, ...options };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        this.fail("ETSGEN_INVALID_LIMIT", `@etsgen: '${name}' debe ser un entero seguro no negativo`, span);
      }
    }
  }

  root<T>(run: () => T): T {
    if (this.roots === 0) this.reset();
    this.roots++;
    try { return run(); }
    finally {
      this.roots--;
      if (this.roots === 0) this.reset();
    }
  }

  expression(span: Span, run: () => string | number | null): string | number | null {
    this.instructions++;
    if (this.instructions > this.limits.maxInstructions) {
      this.fail("ETSGEN_INSTRUCTION_LIMIT", `@etsgen: excedio el limite de ${this.limits.maxInstructions} instrucciones`, span);
    }
    this.expressionDepth++;
    try {
      if (this.expressionDepth > this.limits.maxRecursion) {
        this.fail("ETSGEN_RECURSION_LIMIT", `@etsgen: excedio la profundidad de evaluacion ${this.limits.maxRecursion}`, span);
      }
      const result = run();
      if (result !== null) this.value(result, span);
      return result;
    } finally { this.expressionDepth--; }
  }

  value(value: string | number, span: Span): void {
    const bytes = 8 + (typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0);
    this.assertValueFits(bytes, span);
    this.valueBytes += bytes;
  }

  concatenate(parts: string[], span: Span): string {
    let bytes = 8;
    for (const part of parts) bytes += Buffer.byteLength(part, "utf8");
    // The expression wrapper charges the result once. Check before joining
    // so excessive text is not allocated first and rejected afterwards.
    this.assertValueFits(bytes, span);
    return parts.join("");
  }

  generated(text: string, span: Span): void {
    if (Buffer.byteLength(text, "utf8") > this.limits.maxGeneratedBytes) {
      this.fail("ETSGEN_GENERATED_LIMIT", `@etsgen: codigo generado excede ${this.limits.maxGeneratedBytes} bytes UTF-8`, span);
    }
  }

  private assertValueFits(bytes: number, span: Span): void {
    if (this.valueBytes + bytes > this.limits.maxValueBytes) {
      this.fail("ETSGEN_VALUE_LIMIT", `@etsgen: excedio el limite de ${this.limits.maxValueBytes} bytes de valores`, span);
    }
  }

  private reset(): void {
    this.instructions = 0;
    this.valueBytes = 0;
    this.expressionDepth = 0;
  }

  private fail(code: string, message: string, span: Span): never {
    throw new DiagnosticError([{
      phase: "semantic", code, message,
      span: { start: { ...span.start }, end: { ...span.end } },
    }]);
  }
}
