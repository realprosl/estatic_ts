import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileFile } from "../../src/modules/module-loader.ts";

test("module visibility: permite importar un enum exportado", async () => {
  const dir = mkdtempSync(join(tmpdir(), "estatic-enum-export-"));
  try {
    writeFileSync(join(dir, "model.ets"), "export enum Priority { Low, Medium, High }\n");
    writeFileSync(join(dir, "main.ets"), [
      'import { Priority } from "./model.ets";',
      "function acceptPriority(value: Priority): void {}",
      "let priority: Priority = Priority.High;",
      "acceptPriority(priority);",
      "print(numberToString(priority));",
      "",
    ].join("\n"));
    const result = await compileFile(join(dir, "main.ets"));
    assert.match(result.header, /enum class Priority/);
    assert.ok(result.modules.some(module => module.cpp.includes("Priority::High")));
    assert.ok(result.modules.some(module => module.cpp.includes("acceptPriority(priority)")));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("module visibility: rechaza importar un enum privado", async () => {
  const dir = mkdtempSync(join(tmpdir(), "estatic-enum-private-"));
  try {
    writeFileSync(join(dir, "model.ets"), "enum Priority { Low, High }\n");
    writeFileSync(join(dir, "main.ets"), 'import { Priority } from "./model.ets";\nlet priority: Priority = Priority.High;\n');
    await assert.rejects(() => compileFile(join(dir, "main.ets")), /es privado y no puede importarse/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
