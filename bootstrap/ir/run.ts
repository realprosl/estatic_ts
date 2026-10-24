// Host build/I/O adapter only. Lowering and verification execute in ETS.
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildLoader, root } from "../modules/build.ts";
const binary = await buildLoader(join(root, "build/bootstrap/ir"), "bootstrap/ir/demo.ets", true);
const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
