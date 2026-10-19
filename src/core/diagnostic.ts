import type { Span, GeneratedSource } from "./span.ts";

declare const process: { env: Record<string, string | undefined>; stdout: { isTTY: boolean } };


export type DiagnosticPhase = "lexer" | "parser" | "semantic" | "codegen";
export type DiagnosticSeverity = "error" | "warning" | "note";

export interface GeneratedDiagnostic { id: string; generator: string; source: string; span: Span }

export interface Diagnostic { generated?: GeneratedDiagnostic; phase: DiagnosticPhase; message: string; span: Span; file?: string; source?: string; severity?: DiagnosticSeverity; notes?: string[]; hint?: string; /** Identificador estable para decisiones y tooling; nunca debe depender del texto traducible. */ code?: string }

/** Diagnostics use source names; fresh names remain available in AST metadata. */
export function restoreGeneratedNames(message: string, sources?: GeneratedSource[]): string {
  const names=new Map(sources?.flatMap(source=>(source.bindings ?? []).map(binding=>[binding.emittedName,binding.name] as const)));
  return message.replace(/\bets_macro_[A-Za-z0-9_]+\b/g,name=>names.get(name) ?? name);
}

/** Keep the caller as the primary location and expose the generated ETS as
 * a separate source, rather than pretending it belongs to the caller file. */
export function withGeneratedSource(diagnostic: Diagnostic, sources?: GeneratedSource[]): Diagnostic {
  const origin = diagnostic.span.generated;
  const source = origin && sources?.find(item => item.id === origin.id);
  if (!origin || !source || diagnostic.generated) return diagnostic;
  return {
    ...diagnostic,
    code: `ETSGEN_GENERATED_${diagnostic.phase.toUpperCase()}`,
    message: `@etsgen '${source.generator}' [${source.id}]: ${restoreGeneratedNames(diagnostic.message,sources)}`,
    generated: { id: source.id, generator: source.generator, source: source.source, span: origin.span },
    notes: [...(diagnostic.notes ?? []), ...(source.parentId ? [`Expansión anidada desde ${source.parentId}`] : []), ...(diagnostic.code ? [`Código original: ${diagnostic.code}`] : [])],
  };
}

export class DiagnosticError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(
      diagnostics
        .map((d) => {
          let line = `${d.span.start.line}:${d.span.start.column} ${d.message}`;
          if (d.hint) line += `\n  = hint: ${d.hint}`;
          return line;
        })
        .join("\n"),
    );
    this.name = "DiagnosticError";
    this.diagnostics = diagnostics;
  }
}

// ANSI color codes. Solo se aplican si stdout es un TTY. Se pueden forzar
// desactivados con la variable de entorno `NO_COLOR` (estándar) o activarlos
// forzadamente con `FORCE_COLOR=1`.
function useColors(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "1") return true;
  return !!process.stdout.isTTY;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

function colorize(text: string, color: string): string { return useColors() ? `${color}${text}${RESET}` : text; }

function phaseColor(phase: DiagnosticPhase): string {
  if (phase === "lexer") return RED;
  if (phase === "parser") return YELLOW;
  if (phase === "semantic") return MAGENTA;
  return BLUE;
}

function severityColor(severity: DiagnosticSeverity): string {
  if (severity === "error") return RED;
  if (severity === "warning") return YELLOW;
  return CYAN;
}

/**
 * Formatea un diagnostic con formato estilo rustc: cabecera con colores,
 * línea de código fuente con `^^^^` apuntando al span, y notas/hints opcionales
 * debajo. Si el span es multilínea, renderiza el rango completo con sangría
 * para mostrar contexto.
 */
export function formatDiagnostic(file: string, source: string, diagnostic: Diagnostic): string {
  file = diagnostic.file ?? file;
  source = diagnostic.source ?? source;
  const severity = diagnostic.severity ?? "error";
  const header = colorize(`${severity}`, severityColor(severity)) + colorize(`[${diagnostic.phase}]`, phaseColor(diagnostic.phase)) + `: ` + colorize(diagnostic.message, BOLD);
  const location = colorize(`  --> ${file}:${diagnostic.span.start.line}:${diagnostic.span.start.column}`, DIM);
  const lines = source.split(/\r?\n/);
  const startLine = diagnostic.span.start.line;
  const endLine = diagnostic.span.end.line;
  const startColumn = diagnostic.span.start.column;
  const endColumn = diagnostic.span.end.column;
  const rendered: string[] = [`${header}`, location];
  if (startLine === endLine) {
    const line = lines[startLine - 1] ?? "";
    const gutterWidth = String(startLine).length;
    const lineNumber = colorize(String(startLine).padStart(gutterWidth), DIM) + colorize(" |", DIM);
    const caretLine = " ".repeat(Math.max(0, startColumn - 1)) + colorize("^".repeat(Math.max(1, endColumn - startColumn)), severityColor(severity));
    rendered.push(`${lineNumber} ${line}`);
    rendered.push(`${colorize(" ".repeat(gutterWidth), DIM)}${colorize(" |", DIM)} ${caretLine}`);
  } else {
    // Span multilínea: mostramos la primera y última línea con sangría `^^^^`.
    const firstLine = lines[startLine - 1] ?? "";
    const lastLine = lines[endLine - 1] ?? "";
    const gutterWidth = String(endLine).length;
    rendered.push(`${colorize(String(startLine).padStart(gutterWidth), DIM)}${colorize(" |", DIM)} ${firstLine}`);
    rendered.push(`${colorize(" ".repeat(gutterWidth), DIM)}${colorize(" |", DIM)} ${colorize("^".repeat(Math.max(1, firstLine.length - startColumn + 1)), severityColor(severity))}`);
    if (endLine - startLine > 1) rendered.push(colorize(` ${"…".padStart(gutterWidth)} |\n`, DIM));
    rendered.push(`${colorize(String(endLine).padStart(gutterWidth), DIM)}${colorize(" |", DIM)} ${lastLine}`);
    rendered.push(`${colorize(" ".repeat(gutterWidth), DIM)}${colorize(" |", DIM)} ${colorize("^".repeat(Math.max(1, endColumn)), severityColor(severity))}`);
  }
  if (diagnostic.generated) {
    const generated = diagnostic.generated;
    const at = generated.span.start;
    const line = generated.source.split(/\r?\n/)[at.line - 1] ?? "";
    const from = Math.max(0, at.column - 81);
    const snippet = (from ? "…" : "") + line.slice(from, from + 180) + (line.length > from + 180 ? "…" : "");
    const column = Math.max(0, at.column - 1 - from) + (from ? 1 : 0);
    const width = Math.min(80, Math.max(1, generated.span.end.line === at.line ? generated.span.end.column - at.column : line.length - at.column + 1));
    rendered.push(`  ::: fragmento @etsgen '${generated.generator}' [${generated.id}.ets]:${at.line}:${at.column}`);
    rendered.push(`${at.line} | ${snippet}`);
    rendered.push(`${" ".repeat(String(at.line).length)} | ${" ".repeat(column)}${"^".repeat(width)}`);
  }
  if (diagnostic.notes) for (const note of diagnostic.notes) rendered.push(colorize(`  = note: ${note}`, CYAN));
  if (diagnostic.hint) rendered.push(colorize(`  = hint: ${diagnostic.hint}`, CYAN));
  return rendered.join("\n");
}

/**
 * Formatea múltiples diagnostics, separados por una línea en blanco. Si hay
 * errores de la misma fase en el mismo archivo, los agrupa visualmente.
 */
export function formatDiagnostics(file: string, source: string, diagnostics: Diagnostic[]): string {
  return diagnostics.map(d => formatDiagnostic(file, source, d)).join("\n\n");
}
