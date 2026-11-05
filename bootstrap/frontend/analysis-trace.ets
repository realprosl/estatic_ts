// Diagnostic markers only: no graph/AST arguments, clocks or mutable globals.
// Consumers timestamp stderr externally. POINT marks boundaries without adding
// temporaries (and therefore value copies) just to observe a return expression.
export function traceAnalysis(enabled: boolean, phase: string, event: string): void {
  if (enabled) printError("TRACE analyze." + phase + " " + event);
}
