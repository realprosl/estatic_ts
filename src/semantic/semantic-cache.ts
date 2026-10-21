import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Program, FunctionDeclaration } from "../ast/nodes.ts";
import type { TypeChecker } from "./type-checker.ts";
import { getTs2cppVersionLabel } from "../core/ts2cpp-version.ts";

export type CheckStage = "source" | "final";
export interface BodyAnnotations {
  /** -1: statement, 0..3: number/string/boolean/void. */
  types: number[];
  runtime: [number, boolean][];
  constants: [number, number | string | boolean | null][];
  selected: [number, number][];
}
interface ModuleEntry { version: number; key: string; stages: Partial<Record<CheckStage, Record<string, BodyAnnotations>>> }
export interface SemanticCacheStats {
  enabled: boolean;
  fallbackReason?: string;
  stages: Record<CheckStage, { reusedBodies: number; checkedBodies: number; reusedModules: string[]; checkedModules: string[] }>;
}

const ANNOTATIONS = new Set(["span", "resolvedType", "resolvedSignature", "resolvedRuntimeType", "fromRuntime", "constValue", "comptimeOnly"]);

/** Stable structural nodes, excluding annotations and locations. No AST back-links. */
export function semanticNodes(value: unknown): any[] {
  const result: any[] = [];
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.kind) result.push(node);
    for (const key of Object.keys(node)) if (!ANNOTATIONS.has(key)) visit(node[key]);
  };
  visit(value); return result;
}

const hash = (value: unknown, neutral = false): string => createHash("sha256").update(JSON.stringify(value,
  neutral ? (key, item) => ANNOTATIONS.has(key) ? undefined : item : undefined)).digest("hex");
const scalar = (type: string | undefined): boolean => type === "number" || type === "string" || type === "boolean";

/** Deliberately closed subset: no lifetimes, closures, static evaluation,
 * inferred function results, overload body effects, classes or type aliases. */
function unsupported(program: Program): string | undefined {
  const functions = program.statements.filter((node): node is FunctionDeclaration => node.kind === "FunctionDeclaration");
  const callees = new Set([...functions.map(node => node.name), "print"]);
  let reason: string | undefined;
  const visit = (node: any, top = false): boolean => {
    if (!node) return true;
    if (node.span?.generated || node.span?.etsgenDefinition || node.decorators?.length) { reason = "static-or-decorated"; return false; }
    switch (node.kind) {
      case "FunctionDeclaration":
        if (!top || node.async || node.typeParameters.length || node.variadicTypeParameters.length ||
          (!scalar(node.returnType) && node.returnType !== "void") || node.params.some((p: any) => !scalar(p.type) || p.out || p.optional || p.variadic || p.passing !== "value")) { reason = "non-scalar-signature"; return false; }
        return node.params.every((p: any) => visit(p.defaultValue)) && visit(node.body);
      case "BlockStatement": return node.statements.every((item: any) => visit(item));
      case "ReturnStatement": return visit(node.value);
      case "IfStatement": return visit(node.condition) && visit(node.thenBranch) && visit(node.elseBranch);
      case "ExpressionStatement": return visit(node.expression);
      case "VariableDeclaration":
        if (node.arrayBindings || node.objectBindings || !(scalar(node.declaredType) || (!node.declaredType && node.initializer.kind === "LiteralExpression" && scalar(node.initializer.literalType)))) { reason = "non-scalar-variable"; return false; }
        return visit(node.initializer);
      case "LiteralExpression": return scalar(node.literalType);
      case "IdentifierExpression": return true;
      case "BinaryExpression": return visit(node.left) && visit(node.right);
      case "TernaryExpression": return visit(node.condition) && visit(node.thenBranch) && visit(node.elseBranch);
      case "UnaryExpression":
        if (!["+", "-", "!", "~"].includes(node.operator)) { reason = "ownership-or-unary-effect"; return false; }
        return visit(node.operand);
      case "CallExpression":
        if (!callees.has(node.callee) || node.typeArguments.length || ["move", "ref", "constRef", "comptime"].includes(node.callee)) { reason = "unmodelled-call"; return false; }
        return node.args.every((item: any) => visit(item));
      default: reason = `unsupported:${node.kind}`; return false;
    }
  };
  if (!program.statements.every(node => visit(node, true))) return reason ?? "non-scalar-expression";
  if (program.generatedSources?.length) return "generated-source";
  return undefined;
}

/** Persistent cache of successful function-body checks. Declarations and all
 * top-level statements are always rechecked. Keys use the bound source AST,
 * including the full global environment except ordinary function bodies. */
export class SemanticCheckCache {
  readonly stats: SemanticCacheStats;
  private readonly entries = new Map<string, ModuleEntry>();
  private readonly files = new Map<string, string>();
  private readonly dirty = new Set<string>();
  private readonly identities = new Map<string, { module: string; name: string }>();
  private identity(node: FunctionDeclaration): string { return `${node.span.module ?? "entry"}\0${node.name}\0${node.span.start.offset}`; }

  private constructor(reason?: string) {
    const stage = () => ({ reusedBodies: 0, checkedBodies: 0, reusedModules: [] as string[], checkedModules: [] as string[] });
    this.stats = { enabled: !reason, ...(reason ? { fallbackReason: reason } : {}), stages: { source: stage(), final: stage() } };
  }

  static async open(program: Program, directory: string, sourceKeys?: Map<string, string>): Promise<SemanticCheckCache> {
    const cache = new SemanticCheckCache(unsupported(program));
    if (!cache.stats.enabled) return cache;
    const folder = join(directory, "semantic");
    const environment = program.statements.map(node => {
      const normalized = node.kind === "FunctionDeclaration" ? { ...node, body: undefined } : node;
      return { module: node.span.module, declaration: normalized };
    });
    const environmentHash = hash([getTs2cppVersionLabel(), 2, environment], true);
    const groups = new Map<string, FunctionDeclaration[]>();
    program.statements.forEach((node, index) => {
      if (node.kind !== "FunctionDeclaration") return;
      const module = node.span.module ?? "entry";
      const group = groups.get(module) ?? []; group.push(node); groups.set(module, group);
      cache.identities.set(cache.identity(node), { module, name: `${index}:${node.name}` });
    });
    await Promise.all([...groups].map(async ([module, functions]) => {
      const key = hash([environmentHash, module, sourceKeys?.get(module) ?? functions], true);
      const path = join(folder, `${key}.json`);
      cache.files.set(module, path);
      let entry: ModuleEntry = { version: 2, key, stages: {} };
      try {
        const payload = JSON.parse(await readFile(path, "utf8"));
        const stages = payload.entry?.stages;
        if (payload.entry?.version === 2 && payload.entry.key === key && stages && typeof stages === "object" && !Array.isArray(stages)
          && ["source", "final"].every(stage => stages[stage] === undefined || (stages[stage] && typeof stages[stage] === "object" && !Array.isArray(stages[stage])))
          && payload.checksum === hash(payload.entry)) entry = payload.entry;
      } catch {}
      cache.entries.set(module, entry);
    }));
    return cache;
  }

  restore(node: FunctionDeclaration, checker: TypeChecker, stage: CheckStage): boolean {
    const id = this.identities.get(this.identity(node));
    const data = id && this.entries.get(id.module)?.stages[stage]?.[id.name];
    let reused = false;
    try { reused = !!data && checker.restoreBodyAnnotations(node, data); } catch {}
    const stats = this.stats.stages[stage];
    stats[reused ? "reusedBodies" : "checkedBodies"]++;
    const modules = stats[reused ? "reusedModules" : "checkedModules"];
    const module = id?.module ?? node.span.module ?? "entry";
    if (!modules.includes(module)) modules.push(module);
    return reused;
  }

  remember(node: FunctionDeclaration, checker: TypeChecker, stage: CheckStage): void {
    const id = this.identities.get(this.identity(node));
    if (!id || !this.stats.enabled) return;
    const entry = this.entries.get(id.module)!;
    const bodies = entry.stages[stage] ??= {};
    const annotations = checker.captureBodyAnnotations(node);
    // A syntactically scalar body can still reference a function as a value.
    // Do not cache expressions whose resolved type falls outside the subset.
    if (annotations.types.includes(-2)) return;
    bodies[id.name] = annotations;
    this.dirty.add(id.module);
  }

  /** Publish only after both source and final checks succeed. Cache I/O is optional. */
  async commit(): Promise<void> {
    for (const [module, entry] of this.entries) {
      if (!this.dirty.has(module)) continue;
      const path = this.files.get(module)!;
      try {
        await mkdir(join(path, ".."), { recursive: true });
        const temporary = `${path}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
        await writeFile(temporary, JSON.stringify({ entry, checksum: hash(entry) }), "utf8");
        await rename(temporary, path);
      } catch {}
    }
  }
}
