import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { compileFile } from "../src/modules/module-loader.ts";
import { BuildProfile } from "../src/build/build-profile.ts";

const dir = await mkdtemp(join(tmpdir(), "estatic-semantic-benchmark-"));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  const imports: string[] = [];
  for (let module = 0; module < 12; module++) {
    const functions: string[] = [];
    for (let index = 0; index < 20; index++) {
      const expression = Array.from({ length: 24 }, (_, term) => `x*${term + 1}`).join("+");
      functions.push(`export function value_${module}_${index}(x:number):number{return ${expression};}`);
    }
    await writeFile(join(dir, `lib${module}.ets`), functions.join("\n"));
    imports.push(`import {value_${module}_0} from "./lib${module}";`);
  }
  await writeFile(join(dir, "main.ets"), imports.join("\n") + "\nfunction run(x:number):number{return value_0_0(x);}print(run(7));");
  const entry = join(dir, "main.ets"), options = { baseDirectory: dir, transpilationCacheDirectory: join(dir, "cache") };
  const samples = { full: [] as number[], cached: [] as number[], fullCheck: [] as number[], cachedCheck: [] as number[] };
  for (let iteration = 0; iteration < 7; iteration++) {
    // Reverse order on alternate iterations to reduce systematic JIT/order bias.
    for (const enabled of iteration % 2 ? [true, false] : [false, true]) {
      const profile = new BuildProfile(), start = performance.now();
      const result = await compileFile(entry, { ...options, semanticCache: enabled, profile });
      const duration = performance.now() - start, times = profile.totals();
      if (iteration > 1) {
        samples[enabled ? "cached" : "full"].push(duration);
        samples[enabled ? "cachedCheck" : "fullCheck"].push((times["check-source"] ?? 0) + (times["check-final"] ?? 0));
      }
      if (iteration === 6 && enabled && result.semanticCache?.stages.final.reusedBodies !== 241) throw new Error("Expected all body checks to be reused");
    }
  }
  console.log(JSON.stringify({ modules: 13, functions: 241, samplesPerMode: 5,
    medianTranspilationMs: { full: median(samples.full), cached: median(samples.cached) },
    medianCheckerMs: { full: median(samples.fullCheck), cached: median(samples.cachedCheck) }, samples }, null, 2));
} finally { await rm(dir, { recursive: true, force: true }); }
