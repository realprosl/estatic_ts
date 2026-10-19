import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../../src/compiler.ts";

test("comptime semantic order: rechaza tipo local incorrecto antes de borrar el arrow", () => {
  assert.throws(
    () => compile(`const result: number = comptime((): number => { let hidden: string = 1; return 7; });`),
    /Se esperaba string, pero se obtuvo number/,
  );
});

test("comptime semantic order: rechaza asignacion a const dentro del arrow", () => {
  assert.throws(
    () => compile(`const result: number = comptime((): number => { const x = 1; x = 2; return x; });`),
    /No se puede modificar una constante/,
  );
});

test("comptime semantic order: valida elementos de arrays que luego desaparecen", () => {
  assert.throws(
    () => compile(`const result: number = comptime((): number => { const xs: number[] = [1, "bad"]; return 1; });`),
    /number|string/,
  );
});

test("comptime semantic order: valida argumentos de helpers llamados solo en comptime", () => {
  assert.throws(
    () => compile(`function identity(n: number): number { return n; }
      const result: string = comptime((): string => identity("bad"));`),
    /number|string/,
  );
});

test("comptime semantic order: valida callbacks internos antes de evaluarlos", () => {
  assert.throws(
    () => compile(`const result: number = comptime((): number => {
      const xs: number[] = [1, 2];
      const ys: string[] = xs.map<string>((x: number): string => x + 1);
      return 1;
    });`),
    /string|number/,
  );
});

test("comptime semantic order: un programa valido conserva el literal generado", () => {
  const result = compile(`const result: number = comptime((): number => {
    const xs: number[] = [1, 2, 3];
    let total: number = 0;
    xs.forEach((x: number): void => { total += x; });
    return total;
  });`).ast.statements.find(s => s.kind === "VariableDeclaration" && s.name === "result");
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal(result.initializer.kind, "LiteralExpression");
  assert.equal((result.initializer as { value: unknown }).value, 6);
});

test("comptime semantic order: alias de tipo sigue disponible para comptime", () => {
  const result = compile(`type Count = number;
    const result: Count = comptime((): Count => { const value: Count = 4; return value * 2; });`).ast.statements.find(
      s => s.kind === "VariableDeclaration" && s.name === "result",
    );
  assert.ok(result && result.kind === "VariableDeclaration");
  assert.equal((result.initializer as { value: unknown }).value, 8);
});
