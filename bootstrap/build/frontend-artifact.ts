import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Verify external native frontend artifacts before executing or installing them.
// A pinned digest makes the prebuilt bootstrap input explicit and reproducible.
export function verifiedFrontend(path: string, expectedSha256 = process.env.ESTATIC_BOOTSTRAP_FRONTEND_SHA256): string {
  const binary = resolve(path);
  if (!existsSync(binary) || !statSync(binary).isFile()) throw new Error(`Frontend precompilado inexistente o inválido: ${binary}`);
  if (expectedSha256 !== undefined && expectedSha256 !== "") {
    if (!/^[a-f\d]{64}$/i.test(expectedSha256)) throw new Error("ESTATIC_BOOTSTRAP_FRONTEND_SHA256 debe contener 64 dígitos hexadecimales");
    const actual = createHash("sha256").update(readFileSync(binary)).digest("hex");
    if (actual !== expectedSha256.toLowerCase()) throw new Error(`SHA-256 del frontend precompilado no coincide: esperado ${expectedSha256.toLowerCase()}, obtenido ${actual}`);
  }
  return binary;
}
