// Compatibility facade: existing bootstrap callers keep their import path.
// Runtime archive construction is owned by runtime/build/runtime-cache.ts.
export { runtimeArchive, runtimeFlags, precompileRuntime } from "../../runtime/build/runtime-cache.ts";
export type { RuntimeUnit } from "../../runtime/build/runtime-cache.ts";
