import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { root } from "../root.ts";
import { buildLoader } from "./build-loader.ts";
// Adaptador histórico: caché y construcción inicial del frontend con Stage0.
// El frontend nativo instalado no necesita importar este módulo.
export async function buildStage0Frontend(
  directory: string,
): Promise<string> {
  const hash = createHash("sha256")
    .update(root)
    .update(process.platform)
    .update(process.arch)
    .update(process.env.CXX ?? "g++");
  for (const folder of [
    "src",
    "bootstrap",
    "runtime",
    "shared",
    "backend",
  ]) {
    const files = readdirSync(join(root, folder), {
      recursive: true,
    })
      .map(String)
      .filter(
        (file) =>
          /\.(ts|ets|hpp|cpp)$/.test(file) &&
          !file.endsWith(".test.ts"),
      )
      .sort();
    for (const file of files) {
      hash
        .update(folder + "/" + file)
        .update(readFileSync(join(root, folder, file)));
    }
  }
  hash.update(readFileSync(join(root, "package.json")));
  const identity = hash.digest("hex");
  const stamp = join(directory, "frontend.sha256");
  const binary = join(directory, "modules-demo");
  if (
    existsSync(binary) &&
    existsSync(stamp) &&
    readFileSync(stamp, "utf8") === identity
  ) {
    return binary;
  }
  const built = await buildLoader(
    directory,
    "bootstrap/ir/demo.ets",
    true,
  );
  writeFileSync(stamp, identity);
  return built;
}
