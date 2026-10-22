import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTs2cppRevision,
  getTs2cppVersion,
  getTs2cppVersionLabel,
} from "../../src/core/ts2cpp-version.ts";

const compilerRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");

function cli(flag: "--version" | "-v") {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "src/cli.ts", flag],
    { cwd: compilerRoot, encoding: "utf8" },
  );
}

test("cli version: package y revisión exponen la versión actual", () => {
  assert.equal(getTs2cppVersion(), "1.24.0");
  assert.equal(getTs2cppRevision(), 62);
  assert.equal(getTs2cppVersionLabel(), "estatic 1.24.0 (v62)");
});

for (const flag of ["--version", "-v"] as const) {
  test(`cli version: ${flag}`, () => {
    const result = cli(flag);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "estatic 1.24.0 (v62)");
    assert.equal(result.stderr, "");
  });
}
