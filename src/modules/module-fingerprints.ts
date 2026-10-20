import { createHash } from "node:crypto";
import type { Program, Statement } from "../ast/nodes.ts";
import type { ModuleGraph } from "./module-loader.ts";
import { namespaceExports, type ExportTables } from "./module-exports.ts";

export interface ModuleFingerprint {
  file: string;
  sourceHash: string;
  interfaceHash: string;
  implementationHash: string;
  compileTimeHash: string;
  dependencies: string[];
}
export interface ModuleChange { file: string; reason: "new" | "implementation" | "interface" | "compile-time" | "dependency" | "removed" }

/** Ignore locations and checker annotations, and sort keys for deterministic hashes. */
function neutral(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(neutral);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["span", "resolvedType", "resolvedSignature", "resolvedRuntimeType", "fromRuntime"].includes(key))
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, neutral(child)]));
}
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(neutral(value))).digest("hex");

function signature(statement: Statement): unknown {
  if (statement.kind === "FunctionDeclaration") {
    const { body, ...declaration } = statement;
    return declaration;
  }
  // Layouts, defaults, constants, inferred exports and class methods are kept
  // conservatively. They may influence types or inline code in consumers.
  return statement;
}

/** Planning metadata only: never used yet to skip semantic checks. */
export function fingerprintModules(graph: ModuleGraph, programs: { module: { file: string }; ast: Program }[], surfaces: ExportTables): ModuleFingerprint[] {
  const byFile = new Map(programs.map(({ module, ast }) => [module.file, ast]));
  return graph.modules.map(module => {
    const ast = byFile.get(module.file)!;
    const implementationHash = digest(ast.statements);
    const publicDeclarations = [...namespaceExports(surfaces, module.file)].sort(([a], [b]) => a.localeCompare(b)).map(([name, target]) => {
      const declarations = byFile.get(target.file)?.statements.filter(statement => "name" in statement && statement.name === target.name) ?? [];
      return { name, file: target.file, binding: target.name, pending: target.pending ?? false, declarations: declarations.map(signature) };
    });
    const hasCompileTime = ast.statements.some(statement => statement.kind === "FunctionDeclaration" &&
      (statement.typeParameters.length > 0 || statement.decorators?.some(decorator => ["comptime", "cppgen", "etsgen"].includes(decorator.name))));
    return {
      file: module.file,
      sourceHash: createHash("sha256").update(module.source).update(JSON.stringify(module.imports)).digest("hex"),
      interfaceHash: digest({ exports: publicDeclarations, localDeclarations: ast.statements.filter(statement =>
        ["VariableDeclaration", "UsingDeclaration", "ClassDeclaration", "InterfaceDeclaration", "TypeAliasDeclaration", "UnionDeclaration", "EnumDeclaration", "ModuleHeaderDeclaration"].includes(statement.kind)) }),
      implementationHash,
      // Whole lexical module: private helpers and captured globals can affect
      // evaluation/templates as much as the exported generator's own body.
      compileTimeHash: hasCompileTime ? implementationHash : digest(null),
      dependencies: [...new Set(module.dependencies)].sort(),
    };
  });
}

export function compareModuleFingerprints(previous: ModuleFingerprint[], current: ModuleFingerprint[]): ModuleChange[] {
  const before = new Map(previous.map(module => [module.file, module]));
  const after = new Map(current.map(module => [module.file, module]));
  const changes = new Map<string, ModuleChange["reason"]>();
  const propagate = new Set<string>();
  for (const module of current) {
    const old = before.get(module.file);
    if (!old) { changes.set(module.file, "new"); propagate.add(module.file); }
    else if (old.interfaceHash !== module.interfaceHash) { changes.set(module.file, "interface"); propagate.add(module.file); }
    else if (old.compileTimeHash !== module.compileTimeHash) { changes.set(module.file, "compile-time"); propagate.add(module.file); }
    else if (old.implementationHash !== module.implementationHash || old.sourceHash !== module.sourceHash || JSON.stringify(old.dependencies) !== JSON.stringify(module.dependencies)) {
      changes.set(module.file, "implementation");
    }
  }
  for (const module of previous) if (!after.has(module.file)) { changes.set(module.file, "removed"); propagate.add(module.file); }
  // Iterate to a fixed point, including through barrels and diamonds. Keep a
  // module's own reason if both it and one of its dependencies changed.
  let grew = true;
  while (grew) {
    grew = false;
    for (const module of current) if (!propagate.has(module.file) && module.dependencies.some(dependency =>
      propagate.has(dependency) || (module.compileTimeHash !== digest(null) && changes.has(dependency)))) {
      propagate.add(module.file); grew = true;
      if (!changes.has(module.file)) changes.set(module.file, "dependency");
    }
  }
  return [...changes].map(([file, reason]) => ({ file, reason }));
}
