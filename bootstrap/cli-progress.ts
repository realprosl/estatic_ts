import { performance } from "node:perf_hooks";

export type ProgressEvent =
  | { type: "start"; label: string }
  | { type: "finish"; label: string; elapsed: number; failed: boolean }
  | { type: "detail"; text: string }
  | { type: "summary"; elapsed: number }
  | { type: "diagnostic"; text: string };

// Rendering stays on the host thread: native compilation uses blocking tools.
// Never put progress on stdout, which belongs to JSON and the user's program.
export class CliProgress {
  private timer?: ReturnType<typeof setInterval>;
  private draw?: () => void;
  private animated: boolean;
  private current = "";
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
  handle(event: ProgressEvent): void {
    if (event.type === "start") {
      this.clear();
      this.current = event.label;
      this.started = performance.now();
      if (this.animated) {
        const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let frame = 0;
        const draw = () => {
          const columns = (this.stream as Partial<NodeJS.WriteStream>).columns || 80;
          const elapsed = ` · ${((performance.now() - this.started) / 1000).toFixed(1)} s`;
          const available = Math.max(1, columns - elapsed.length - 4);
          const clean = this.current.replace(/[\x00-\x1f\x7f]/g, " ");
          const text = Array.from(clean);
          const left = Math.floor((available - 1) / 2), right = available - 1 - left;
          const label = text.length > available ? text.slice(0, left).join("") + "…" + (right ? text.slice(-right).join("") : "") : clean;
          this.stream.write(`\r\x1b[2K${this.paint(frames[frame++ % frames.length], 36)} ${label}${elapsed}`);
        };
        this.draw = draw; draw(); this.timer = setInterval(draw, 80);
      } else if (this.verbose) this.stream.write(`> ${event.label}\n`);
    } else if (event.type === "finish") {
      this.clear();
      if (this.animated || this.verbose) {
        const marker = event.failed ? "✗" : "✓";
        this.stream.write(`${this.paint(marker, event.failed ? 31 : 32)} ${event.label} (${Math.round(event.elapsed)} ms)\n`);
      }
    } else if (event.type === "detail") {
      if (this.verbose) {
        if (this.animated) {
          this.current = event.text;
          this.draw?.();
        } else this.stream.write(`  ${event.text}\n`);
      }
    } else if (event.type === "diagnostic") {
      if (this.draw) this.stream.write("\r\x1b[2K");
      this.stream.write(event.text + "\n");
      this.draw?.();
    } else {
      this.clear();
      if (this.animated || this.verbose) this.stream.write(`${this.paint("✓", 32)} Compilación completada (${Math.round(event.elapsed)} ms)\n`);
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
  const values=new Set(["-o","--binary","--config","--emit-ir","--from-ir","--frontend","--cache","--cxx","--root","--cxx-flag","--link-flag"]);
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
