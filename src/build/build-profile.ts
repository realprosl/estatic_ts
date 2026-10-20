import { performance } from "node:perf_hooks";

export interface PhaseTiming { phase: string; durationMs: number; module?: string }

/** Measures work executed by this invocation; cached timings are never replayed. */
export class BuildProfile {
  readonly phases: PhaseTiming[] = [];

  record(phase: string, start: number, module?: string): void {
    this.phases.push({ phase, durationMs: performance.now() - start, ...(module ? { module } : {}) });
  }

  measure<T>(phase: string, action: () => T, module?: string): T {
    const start = performance.now();
    try { return action(); }
    finally { this.record(phase, start, module); }
  }

  async measureAsync<T>(phase: string, action: () => Promise<T>, module?: string): Promise<T> {
    const start = performance.now();
    try { return await action(); }
    finally { this.record(phase, start, module); }
  }

  totals(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const { phase, durationMs } of this.phases) result[phase] = (result[phase] ?? 0) + durationMs;
    return result;
  }
}
