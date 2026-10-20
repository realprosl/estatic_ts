// Lee la version de Ts2cpp desde package.json del compiler root.
//
// Se cachea despues de la primera lectura (la mayoria de builds son de
// la misma version; no necesitamos leer package.json cada vez).
//
// Usado por V25 Fase 5 para calcular el hash del cache global de
// runtime .o cacheados en ~/.cache/etsc/runtime/<version>/.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// src/core/ts2cpp-version.ts → ../../package.json
const pkgPath = resolve(here, "..", "..", "package.json");

let cached: string | undefined;
let cachedRevision: number | undefined;

interface PackageVersion {
  version?: string;
  estaticRevision?: number;
}

function readPackageVersion(): PackageVersion {
  if (!existsSync(pkgPath)) return {};
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as PackageVersion;
  } catch {
    return {};
  }
}

export function getTs2cppVersion(): string {
  if (cached !== undefined) return cached;
  cached = readPackageVersion().version ?? "unknown";
  return cached;
}

export function getTs2cppRevision(): number | undefined {
  if (cachedRevision !== undefined) return cachedRevision;
  const revision = readPackageVersion().estaticRevision;
  if (typeof revision === "number" && Number.isInteger(revision) && revision > 0) {
    cachedRevision = revision;
    return revision;
  }
  return undefined;
}

export function getTs2cppVersionLabel(): string {
  const version = getTs2cppVersion();
  const revision = getTs2cppRevision();
  return revision === undefined ? `estatic ${version}` : `estatic ${version} (v${revision})`;
}
