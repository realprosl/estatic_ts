import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Also resolves inside an installed, relocatable compiler distribution.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
