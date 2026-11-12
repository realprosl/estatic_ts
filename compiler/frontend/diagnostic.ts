/** Public JSON produced by the native frontend. No rendering or Node dependency. */
export interface DiagnosticPosition { offset: number; line: number; column: number; }
export interface DiagnosticSpan { start: DiagnosticPosition; end: DiagnosticPosition; }
export type NativeDiagnosticPhase = 'loader'|'resolver'|'lexer'|'parser'|'binder'|'checker';
export type NativeDiagnosticSeverity = 'error'|'warning'|'note';
export interface NativeDiagnostic {
  schema: 'ets-diagnostic-1';
  phase: NativeDiagnosticPhase;
  code: string;
  severity: NativeDiagnosticSeverity;
  message: string;
  file: string;
  span: DiagnosticSpan;
  generated: null|{
    sourceId: string;
    span: DiagnosticSpan;
    /** Compatibility aliases for span.start. */
    offset: number; line: number; column: number;
  };
  /** Compatibility aliases for span.start. */
  offset: number; line: number; column: number;
}
