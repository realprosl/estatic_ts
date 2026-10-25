import { precompileRuntime } from "./runtime-cache.ts";
try { for(const archive of precompileRuntime())console.log(archive); }
catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
