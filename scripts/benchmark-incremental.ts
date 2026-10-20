import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { buildIncremental } from "../src/build/incremental-builder.ts";
import type { ResolvedConfig } from "../src/config/project-config.ts";

// No libuv development package needed: the fixture never uses async runtime.
// Optionally pass another checkout to compare the exact same workload.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = process.argv[2] ? resolve(process.argv[2]) : undefined;

async function benchmark(label: string, build: typeof buildIncremental): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "estatic-build-benchmark-"));
  try {
    const compiler = join(directory, "compiler");
    await mkdir(join(compiler, "build"), { recursive: true });
    await mkdir(join(compiler, "runtime"));
    await writeFile(join(compiler, "build/runtime_ets_libuv.o"), "");
    await writeFile(join(compiler, "runtime/ets_runtime.hpp"), `#include ${JSON.stringify(join(root, "runtime/ets_runtime.hpp"))}\n`);
    const library = join(directory, "lib.ets");
    await writeFile(library, "export function answer():number{return 7;}");
    await writeFile(join(directory, "main.ets"), 'import {answer} from "./lib";print(answer());');
    const config: ResolvedConfig = {
      baseDirectory: directory, entry: join(directory, "main.ets"), moduleRoots: [], aliases: {}, linkLibraries: [],
      output: { cpp: join(directory, "build/app.cpp"), binary: join(directory, "build/app") },
      compiler: { enabled: true, command: "g++", flags: ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`], linkFlags: [] },
      incremental: { enabled: true, cacheDirectory: join(directory, "build/cache"), generatedDirectory: join(directory, "build/generated") },
      logging: { enabled: false, file: join(directory, "report.json"), level: "info" },
    };
    for (const scenario of ["cold", "unchanged", "body-edit", "native-flags"] as const) {
      if (scenario === "body-edit") await writeFile(library, "export function answer():number{return 9;}");
      if (scenario === "native-flags") config.compiler.flags.push("-DEST_BENCHMARK=1");
      const result = await build(config, compiler);
      const output = execFileSync(result.binary, { encoding: "utf8" }).trim();
      if (output !== (scenario === "cold" || scenario === "unchanged" ? "7" : "9")) throw new Error(`Unexpected output: ${output}`);
      console.log(JSON.stringify({ label, scenario, durationMs: result.durationMs, compiled: result.compiled.length,
        reused: result.reused.length, transpilationCache: result.transpilationCache, parsedModules: result.parsedModules,
        phasesMs: result.profile?.totalsMs }));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (baseline) {
  const previous = await import(pathToFileURL(join(baseline, "src/build/incremental-builder.ts")).href);
  await benchmark("baseline", previous.buildIncremental);
}
await benchmark("current", buildIncremental);
