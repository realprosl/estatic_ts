import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";
import { DiagnosticError } from "../../src/core/diagnostic.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const prelude = `type Reader = () => number;
function identity(xs: Reader[]): Reader[] { return xs; }
function make(): Reader[] {
  let value: number = 0;
  const risky: Reader = (): number => { value += 1; return value; };
`;

for (const [name, body] of [
  ["literal", "return [risky];"],
  ["alias", "const xs: Reader[] = [risky]; const ys: Reader[] = xs; return ys;"],
  ["spread", "const xs: Reader[] = [risky]; return [...xs];"],
  ["push", "let xs: Reader[] = []; xs.push(risky); return xs;"],
  ["escritura por indice", "let xs: Reader[] = [(): number => 1]; xs[0] = risky; return xs;"],
  ["slice", "const xs: Reader[] = [risky]; return xs.slice(0, 1);"],
  ["filter", "const xs: Reader[] = [risky]; return xs.filter((f: Reader): boolean => true);"],
  ["concat", "const xs: Reader[] = []; return xs.concat([risky]);"],
  ["identidad", "return identity([risky]);"],
  ["condicional", "return true ? [risky] : [];"],
] as const) {
  test(`closure array safety: rechaza ${name}`, () => {
    assert.throws(() => compile(`${prelude}${body}}`), (error: unknown) => {
      assert.ok(error instanceof DiagnosticError, String(error));
      assert.ok(error.diagnostics.some(item => item.code === "CLOSURE_REFERENCE_RETURN"), error.message);
      return true;
    });
  });
}

for (const [name, body] of [
  ["extraccion", "const xs: Reader[] = [risky]; return xs[0];"],
  ["destructuring", "const xs: Reader[] = [risky]; const [f] = xs; return f;"],
  ["for of", "const xs: Reader[] = [risky]; for (const f of xs) { return f; } return (): number => 1;"],
] as const) {
  test(`closure array safety: rechaza ${name} antes de retornar funcion`, () => {
    const source = `${prelude.replace("function make(): Reader[]", "function make(): Reader")}${body}}`;
    assert.throws(() => compile(source), /E4210/);
  });
}

test("closure array safety: closure que captura array no oculta la referencia", () => {
  assert.throws(() => compile(`${prelude.replace("function make(): Reader[]", "function make(): Reader")}
    const xs: Reader[] = [risky];
    return (): number => { const f: Reader = xs[0]; return f(); };
  }`), /E4210/);
});

test("closure array safety: push valida el tipo del argumento", () => {
  assert.throws(() => compile('let xs: number[] = []; xs.push("bad");'), /number|string/);
});

test("closure array safety: array numerico no hereda riesgo del callback consumidor", () => {
  assert.doesNotThrow(() => compile(`function run(): number[] {
    let value: number = 0;
    return [1, 2].map<number>((n: number): number => { value += n; return value; });
  }`));
});

test("closure array safety native: lectores por valor sobreviven al retorno", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = mkdtempSync(join(tmpdir(), "ets-closure-array-"));
  try {
    const file = join(dir, "main.cpp"); const binary = join(dir, "main");
    writeFileSync(file, compile(`type Reader = () => number;
      function make(value: number): Reader[] {
        let xs: Reader[] = [];
        xs.push((): number => value + 1);
        return xs;
      }
      const readers: Reader[] = make(7);
      const f: Reader = readers[0]; print(f()); print(f());
    `).cpp);
    execFileSync("g++", ["-std=c++20", "-O2", "-pthread", "-fno-exceptions", "-I", root, file, "-o", binary], { timeout: 60_000, stdio: "pipe" });
    assert.equal(execFileSync(binary, { encoding: "utf8", timeout: 10_000 }), "8\n8\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
