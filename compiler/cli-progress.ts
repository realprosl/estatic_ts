import { performance } from "node:perf_hooks";

export type ProgressEvent =
  | { type: "start"; label: string }
  | { type: "finish"; label: string; elapsed: number; failed: boolean }
  | { type: "detail"; text: string }
  | { type: "summary"; elapsed: number; outputs?: string[] }
  | { type: "diagnostic"; text: string };

// Rendering stays on the host thread: native compilation uses blocking tools.
// Never put progress on stdout, which belongs to JSON and the user's program.
export class CliProgress {
  private timer?: ReturnType<typeof setInterval>;
  private draw?: () => void;
  private animated: boolean;
  private current = "";
  private label = "";
  private started = performance.now();
  private color: boolean;
  private verbose: boolean;
  private stream: Pick<NodeJS.WriteStream, "write" | "isTTY">;
  constructor(verbose: boolean, enabled: boolean,
    stream: Pick<NodeJS.WriteStream, "write" | "isTTY"> = process.stderr,
    environment: NodeJS.ProcessEnv = process.env) {
    this.verbose=verbose;this.stream=stream;
    this.animated = enabled && !!stream.isTTY && environment.TERM !== "dumb" &&
      environment.NO_COLOR === undefined && !environment.CI;
    this.color = this.animated;
  }
  private paint(text: string, code: number): string {
    return this.color ? `\x1b[${code}m${text}\x1b[0m` : text;
  }
  get interactive(): boolean { return this.animated; }
  private scope(label: string): string {
    if (/configuración|Leyendo/.test(label)) return "setup";
    if (/Analizando|Verificando/.test(label)) return "check";
    if (/Guardando/.test(label)) return "emit";
    if (/Creando|Actualizando/.test(label)) return "init";
    return "build";
  }
  private tag(label: string): string { return this.paint(`[${this.scope(label)}]`, 35); }
  private duration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
    return `${Math.floor(ms / 60000)} min ${Math.floor(ms % 60000 / 1000)} s`;
  }
  handle(event: ProgressEvent): void {
    if (event.type === "start") {
      this.clear();
      this.current = event.label;
      this.label = event.label;
      this.started = performance.now();
      if (this.animated) {
        const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let frame = 0;
        const draw = () => {
          const columns = (this.stream as Partial<NodeJS.WriteStream>).columns || 80;
          const elapsed = ` · ${this.duration(performance.now() - this.started)}`;
          const prefix = `[${this.scope(this.label)}] `;
          const available = Math.max(1, columns - elapsed.length - prefix.length - 4);
          const clean = this.current.replace(/[\x00-\x1f\x7f]/g, " ");
          const text = Array.from(clean);
          const left = Math.floor((available - 1) / 2), right = available - 1 - left;
          const label = text.length > available ? text.slice(0, left).join("") + "…" + (right ? text.slice(-right).join("") : "") : clean;
          this.stream.write(`\r\x1b[2K${this.tag(this.label)} ${this.paint(frames[frame++ % frames.length], 36)} ${label}${this.paint(elapsed, 2)}`);
        };
        this.draw = draw; draw(); this.timer = setInterval(draw, 80);
      } else if (this.verbose) this.stream.write(`[${this.scope(event.label)}] > ${event.label}\n`);
    } else if (event.type === "finish") {
      this.clear();
      if (this.animated || this.verbose) {
        const marker = event.failed ? "✗" : "✓";
        this.stream.write(`${this.tag(event.label)} ${this.paint(marker, event.failed ? 31 : 32)} ${event.label} (${this.duration(event.elapsed)})\n`);
      }
    } else if (event.type === "detail") {
      if (this.verbose || (this.animated && event.text.startsWith("frontend: "))) {
        if (this.animated) {
          this.current = this.verbose ? event.text : event.text.replace(/^frontend: /, "");
          this.draw?.();
        } else this.stream.write(`  ${event.text}\n`);
      }
    } else if (event.type === "diagnostic") {
      if (this.draw) this.stream.write("\r\x1b[2K");
      this.stream.write(event.text + "\n");
      this.draw?.();
    } else {
      this.clear();
      if (this.animated || this.verbose) {
        this.stream.write(`${this.paint("[etsc]", 35)} ${this.paint("✓", 32)} Compilación completada (${this.duration(event.elapsed)})\n`);
        if (this.animated && !this.verbose) for (const output of event.outputs ?? []) this.stream.write(`${this.paint("       ↳", 2)} ${output.replace(/[\x00-\x1f\x7f]/g, " ")}\n`);
      }
    }
  }
  clear(): void {
    this.draw = undefined;
    if (this.timer) {
      clearInterval(this.timer); this.timer = undefined;
      this.stream.write("\r\x1b[2K");
    }
  }
}

export async function phase<T>(label: string, action: () => T | Promise<T>, report: (event: ProgressEvent) => void): Promise<T> {
  const start = performance.now(); report({ type: "start", label });
  try {
    const result = await action();
    report({ type: "finish", label, elapsed: performance.now() - start, failed: false });
    return result;
  } catch (error) {
    report({ type: "finish", label, elapsed: performance.now() - start, failed: true });
    throw error;
  }
}

// Preserve flag values and everything after --, including program options.
export function presentation(argv: string[]): { args: string[]; verbose: boolean; progress: boolean } {
  const args: string[]=[];let verbose=false,progress=true;
  const values=new Set(["-o","--binary","--config","--emit-ir","--from-ir","--frontend","--cache","--cxx","--root","--cxx-flag","--link-flag","--jobs"]);
  for(let at=0;at<argv.length;at++){
    const arg=argv[at];
    if(arg==="--"){args.push(...argv.slice(at));break;}
    if(arg==="--verbose"){verbose=true;continue;}
    if(arg==="--no-progress"){progress=false;continue;}
    args.push(arg);
    const count=arg==="--alias"?2:values.has(arg)?1:0;
    for(let n=0;n<count&&at+1<argv.length;n++)args.push(argv[++at]);
  }
  return {args,verbose,progress};
}
