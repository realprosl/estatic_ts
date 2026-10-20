import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compileFile, type ModuleCompilationResult } from "../../src/modules/module-loader.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
async function project(run: (dir: string, compile: () => Promise<ModuleCompilationResult>) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "estatic-semantic-cache-"));
  const options = { baseDirectory: dir, transpilationCacheDirectory: join(dir, "cache") };
  try { await run(dir, () => compileFile(join(dir, "main.ets"), options)); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const write = (dir: string, path: string, source: string) => writeFileSync(join(dir, path), source);
const setup = (dir: string) => {
  write(dir, "lib.ets", "export function add(x:number):number{return x+1;}");
  write(dir, "main.ets", 'import {add} from "./lib";function run(x:number):number{return add(x);}print(run(7));');
};
const stages = ["source", "final"] as const;

test("semantic cache: cold, warm and body edit reuse consumers in both checks", async () => project(async (dir, compile) => {
  setup(dir);
  const cold = await compile();
  for (const stage of stages) assert.equal(cold.semanticCache!.stages[stage].checkedBodies, 2);
  const warm = await compile();
  for (const stage of stages) { assert.equal(warm.semanticCache!.stages[stage].reusedBodies, 2); assert.equal(warm.semanticCache!.stages[stage].checkedBodies, 0); }
  write(dir, "lib.ets", "export function add(x:number):number{return x+20;}");
  const changed = await compile();
  for (const stage of stages) {
    assert.equal(changed.semanticCache!.stages[stage].reusedBodies, 1);
    assert.deepEqual(changed.semanticCache!.stages[stage].reusedModules, [join(dir, "main.ets")]);
    assert.deepEqual(changed.semanticCache!.stages[stage].checkedModules, [join(dir, "lib.ets")]);
  }
  const fresh = await compileFile(join(dir, "main.ets"), { baseDirectory: dir });
  assert.deepEqual(changed.modules, fresh.modules); assert.equal(changed.header, fresh.header);
}));

test("semantic cache native: restored overload selection and expression types emit identical executable", async () => project(async (dir, compile) => {
  write(dir, "lib.ets", 'export function add(x:number):number{return x+1;}export function add(x:string):string{return x+"!";}');
  write(dir, "main.ets", 'import {add as plus} from "./lib";function run(x:string):string{const console:string=plus(x);return console;}print(run("ok"));');
  await compile(); const warm = await compile(); assert.equal(warm.semanticCache!.stages.final.reusedBodies, 3);
  writeFileSync(join(dir, "estatic_common.hpp"), warm.header);
  const files = warm.modules.map((module, index) => { const file = join(dir, `module-${index}.cpp`); writeFileSync(file, module.cpp); return file; });
  const binary = join(dir, "app");execFileSync("g++", ["-std=c++20", "-O0", "-pthread", "-fno-exceptions", `-I${root}`, ...files, "-o", binary]);
  assert.equal(execFileSync(binary, { encoding: "utf8" }), "ok!\n");
}));

test("semantic cache: signature edit rejects stale consumer with original file and line", async () => project(async (dir, compile) => {
  setup(dir); await compile();
  write(dir, "lib.ets", 'export function add(x:string):string{return x+"!";}');
  await assert.rejects(compile, (error: any) => {
    assert.ok(error.diagnostics.some((d: any) => d.file === join(dir, "main.ets")));
    assert.match(error.message, /number|string/); return true;
  });
}));

test("semantic cache: unchanged signature does not hide new body errors or cache failures", async () => project(async (dir, compile) => {
  setup(dir);await compile();
  write(dir, "lib.ets", 'export function add(x:number):number{return "wrong";}');
  await assert.rejects(compile, /number|string/);await assert.rejects(compile, /number|string/);
  write(dir, "lib.ets", 'export function add(x:number):number{return x+2;}');
  const repaired = await compile();assert.equal(repaired.semanticCache!.stages.source.checkedBodies, 1);
}));

test("semantic cache: global environment edits invalidate body checks", async () => project(async (dir, compile) => {
  write(dir, "main.ets", 'const seed:number=1;function run():number{return seed;}print(run());');await compile();
  write(dir, "main.ets", 'const seed:string="bad";function run():number{return seed;}print(run());');
  await assert.rejects(compile, /number|string/);
}));

test("semantic cache: shifted module offsets keep current source locations", async () => project(async (dir, compile) => {
  setup(dir);await compile();write(dir, "lib.ets", '// extra\n\nexport function add(x:number):number{return x+2;}');
  const restored = await compile();assert.equal(restored.semanticCache!.stages.source.reusedBodies, 1);
  const fresh = await compileFile(join(dir, "main.ets"), { baseDirectory: dir });
  assert.deepEqual(JSON.parse(JSON.stringify(restored.ast)), JSON.parse(JSON.stringify(fresh.ast)));assert.deepEqual(restored.modules, fresh.modules);
}));

test("semantic cache: corrupt entries fall back to fresh checks", async () => project(async (dir, compile) => {
  setup(dir);await compile();
  const folder = join(dir, "cache/semantic");for (const file of readdirSync(folder)) writeFileSync(join(folder, file), '{"entry":');
  const rebuilt = await compile();for (const stage of stages) assert.equal(rebuilt.semanticCache!.stages[stage].checkedBodies, 2);
  const warm = await compile();assert.equal(warm.semanticCache!.stages.final.reusedBodies, 2);
}));

test("semantic cache: persists across independent Node processes", async () => project(async dir => {
  setup(dir);
  const script = `import {compileFile} from ${JSON.stringify(join(root, "src/modules/module-loader.ts"))};const r=await compileFile(${JSON.stringify(join(dir, "main.ets"))},{transpilationCacheDirectory:${JSON.stringify(join(dir,"cache"))}});console.log(JSON.stringify(r.semanticCache));`;
  const run = () => JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { encoding: "utf8" }));
  assert.equal(run().stages.source.checkedBodies, 2);assert.equal(run().stages.source.reusedBodies, 2);
}));

for (const [label, source] of [
  ["comptime", '@comptime function value():number{return 7;}print(value());'],
  ["etsgen", '@etsgen function emit():string{return "print(7);";}emit();'],
  ["generic", 'function value<T>(x:T):T{return x;}print(value<number>(7));'],
  ["closure", 'const value=(x:number):number=>x+1;print(value(7));'],
  ["class", 'class Box {value:number;}const box:Box=new Box(7);print(box.value);'],
] as const) {
  test(`semantic cache: safe full-check fallback for ${label}`, async () => project(async (dir, compile) => {
    write(dir, "main.ets", source);const cold = await compile();const warm = await compile();
    assert.equal(cold.semanticCache!.enabled, false);assert.ok(cold.semanticCache!.fallbackReason);
    assert.equal(warm.semanticCache!.stages.source.reusedBodies, 0);
    assert.deepEqual(warm.modules, cold.modules);
  }));
}

test("semantic cache: local const annotations are restored without stale AST locations", async () => project(async (dir, compile) => {
  write(dir,"main.ets", 'function value(x:number):number{const n:number=7;if(x>0){return n+x;}return n;}print(value(1));');
  await compile();const restored=await compile();const fresh=await compileFile(join(dir,"main.ets"));
  assert.equal(restored.semanticCache!.stages.final.reusedBodies,1);assert.deepEqual(JSON.parse(JSON.stringify(restored.ast)),JSON.parse(JSON.stringify(fresh.ast)));
  // A function identifier used as a value has a non-scalar resolved type.
  // The enclosing body must keep taking the complete check path.
  write(dir,"main.ets", 'function value():number{return 7;}function run():void{value;}run();');
  await compile();const callable=await compile();assert.equal(callable.semanticCache!.stages.source.checkedBodies,1);assert.equal(callable.semanticCache!.stages.source.reusedBodies,1);
}));
