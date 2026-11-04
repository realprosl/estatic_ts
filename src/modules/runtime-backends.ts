// src/modules/runtime-backends.ts
//
// V30.6.0: deteccion declarativa de backends runtime que necesita
// el programa, mirando el AST en vez de escanear includes del
// cpp (heuristica fragil, mantenida por PR #169, #170, #171).
//
// Devuelve un RuntimeBackends que el cli usa para anadir los
// .o correctos y -l<lib> al linker.

import type { Program } from "../ast/nodes.ts";

import { runtimeBackendsForCalls } from "../../shared/runtime/runtime-backends.ts";
export { runtimeBackendsForCalls } from "../../shared/runtime/runtime-backends.ts";
export type { RuntimeBackends } from "../../shared/runtime/runtime-backends.ts";
import type { RuntimeBackends } from "../../shared/runtime/runtime-backends.ts";

/** Detect runtime dependencies for a Stage0 AST program. */
export function detectRuntimeBackends(program: Program): RuntimeBackends {
  const used = new Set<string>();
  for (const stmt of program.statements) collectCalls(stmt, used);
  return runtimeBackendsForCalls(used);
}

/** Recorre recursivamente un nodo del AST recogiendo nombres de funciones llamadas. */
function collectCalls(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const k = (node as { kind?: string }).kind;
  if (!k) return;
  switch (k) {
    case "RawCppExpression": {
      collectCalls((node as { generatedAst?: unknown }).generatedAst, out);
      return;
    }
    case "CallExpression": {
      const n = node as { callee: string };
      if (typeof n.callee === "string") out.add(n.callee);
      const args = (node as { args?: unknown[] }).args;
      if (Array.isArray(args)) for (const a of args) collectCalls(a, out);
      return;
    }
    case "MemberCallExpression": {
      const n = node as { method: string; object?: unknown; args?: unknown[] };
      if (typeof n.method === "string") out.add(n.method);
      collectCalls(n.object, out);
      if (Array.isArray(n.args)) for (const a of n.args) collectCalls(a, out);
      return;
    }
    case "BlockStatement": {
      const stmts = (node as { statements?: unknown[] }).statements;
      if (Array.isArray(stmts)) for (const s of stmts) collectCalls(s, out);
      return;
    }
    case "ExpressionStatement": {
      collectCalls((node as { expression?: unknown }).expression, out);
      return;
    }
    case "IfStatement": {
      const n = node as { condition?: unknown; thenBranch?: unknown; elseBranch?: unknown };
      collectCalls(n.condition, out);
      collectCalls(n.thenBranch, out);
      collectCalls(n.elseBranch, out);
      return;
    }
    case "WhileStatement": {
      const n = node as { condition?: unknown; body?: unknown };
      collectCalls(n.condition, out);
      collectCalls(n.body, out);
      return;
    }
    case "ForStatement": {
      const n = node as { initializer?: unknown; condition?: unknown; increment?: unknown; body?: unknown };
      collectCalls(n.initializer, out);
      collectCalls(n.condition, out);
      collectCalls(n.increment, out);
      collectCalls(n.body, out);
      return;
    }
    case "ForOfStatement": {
      const n = node as { iterable?: unknown; body?: unknown };
      collectCalls(n.iterable, out);
      collectCalls(n.body, out);
      return;
    }
    case "ForInStatement": {
      const n = node as { target?: unknown; body?: unknown };
      collectCalls(n.target, out);
      collectCalls(n.body, out);
      return;
    }
    case "SwitchStatement": {
      const n = node as { discriminant?: unknown; cases?: { body: unknown[] }[]; defaultClause?: { body: unknown[] } };
      collectCalls(n.discriminant, out);
      if (Array.isArray(n.cases)) {
        for (const c of n.cases) {
          if (Array.isArray(c.body)) for (const s of c.body) collectCalls(s, out);
        }
      }
      if (n.defaultClause && Array.isArray(n.defaultClause.body)) {
        for (const s of n.defaultClause.body) collectCalls(s, out);
      }
      return;
    }
    case "ReturnStatement": {
      collectCalls((node as { value?: unknown }).value, out);
      return;
    }
    case "VariableDeclaration": {
      collectCalls((node as { initializer?: unknown }).initializer, out);
      return;
    }
    case "UsingDeclaration": {
      collectCalls((node as { initializer?: unknown }).initializer, out);
      return;
    }
    case "FunctionDeclaration": {
      collectCalls((node as { body?: unknown }).body, out);
      return;
    }
    case "ClassDeclaration": {
      const m = (node as { methods?: { body: unknown }[] }).methods;
      if (Array.isArray(m)) for (const method of m) collectCalls(method.body, out);
      return;
    }
    case "ExportDefaultDeclaration": {
      collectCalls((node as { declaration?: unknown }).declaration, out);
      return;
    }
    case "AwaitExpression": {
      collectCalls((node as { operand?: unknown }).operand, out);
      return;
    }
    case "BinaryExpression": {
      const n = node as { left?: unknown; right?: unknown };
      collectCalls(n.left, out);
      collectCalls(n.right, out);
      return;
    }
    case "UnaryExpression": {
      collectCalls((node as { operand?: unknown }).operand, out);
      return;
    }
    case "AssignmentExpression": {
      collectCalls((node as { value?: unknown }).value, out);
      return;
    }
    case "TernaryExpression": {
      const n = node as { condition?: unknown; then?: unknown; else?: unknown };
      collectCalls(n.condition, out);
      collectCalls(n.then, out);
      collectCalls(n.else, out);
      return;
    }
    case "ArrowFunctionExpression": {
      collectCalls((node as { body?: unknown }).body, out);
      return;
    }
    case "MatchExpression": {
      const n = node as { subject?: unknown; arms?: { result: unknown }[] };
      collectCalls(n.subject, out);
      if (Array.isArray(n.arms)) for (const arm of n.arms) collectCalls(arm.result, out);
      return;
    }
    case "TemplateLiteralExpression": {
      const e = (node as { expressions?: unknown[] }).expressions;
      if (Array.isArray(e)) for (const x of e) collectCalls(x, out);
      return;
    }
    case "MemberExpression": {
      collectCalls((node as { object?: unknown }).object, out);
      return;
    }
    case "ArrayLiteralExpression": {
      const e = (node as { elements?: unknown[] }).elements;
      if (Array.isArray(e)) for (const x of e) collectCalls(x, out);
      return;
    }
    case "ObjectLiteralExpression": {
      const p = (node as { properties?: { value: unknown }[] }).properties;
      if (Array.isArray(p)) for (const x of p) collectCalls(x.value, out);
      return;
    }
    case "IndexExpression": {
      const n = node as { object?: unknown; index?: unknown };
      collectCalls(n.object, out);
      collectCalls(n.index, out);
      return;
    }
    case "NewExpression": {
      const a = (node as { args?: unknown[] }).args;
      if (Array.isArray(a)) for (const x of a) collectCalls(x, out);
      return;
    }
    case "SatisfiesExpression": {
      collectCalls((node as { expression?: unknown }).expression, out);
      return;
    }
    // Hojas: no recursamos.
    case "LiteralExpression":
    case "IdentifierExpression":
    case "GenericIdentifierExpression":
    case "ModuleHeaderDeclaration":
    case "ExportNamedDeclaration":
      return;
    // Por defecto, no recursamos (cubrimos los nodos reales del dialecto).
    default:
      return;
  }
}
