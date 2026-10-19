import type { Program, Statement } from "../ast/nodes.ts";
import { DiagnosticError, type Diagnostic } from "../core/diagnostic.ts";
import type { LoadedModule } from "./module-loader.ts";

/** Defensive check after source bindings have been normalized by the loader.
 * In particular, unannounced generated publications can still introduce a
 * cross-module homonym. Never let the combined AST merge those declarations. */
export function validateModuleSymbolCollisions(programs: { module: LoadedModule; ast: Program }[]): void {
  const owners = new Map<string, { module: LoadedModule; statement: Statement }>();
  const diagnostics: Diagnostic[] = [];
  for (const { module, ast } of programs) {
    const seen = new Set<string>();
    for (const statement of ast.statements) {
      for (const name of declaredNames(statement)) {
        // Same-module overloads remain the checker's responsibility. Only
        // module boundaries introduce the ambiguity guarded here.
        if (seen.has(name)) continue;
        seen.add(name);
        const previous = owners.get(name);
        if (!previous) {
          owners.set(name, { module, statement });
        } else if (previous.module.file !== module.file) {
          diagnostics.push({
            phase: "semantic",
            code: "MODULE_SYMBOL_COLLISION",
            message: `El símbolo '${name}' se declara en más de un módulo; el AST combinado no puede aislarlo`,
            span: statement.span,
            file: module.file,
            source: module.source,
            notes: [`Primera declaración: ${previous.module.file}:${previous.statement.span.start.line}:${previous.statement.span.start.column}`],
            hint: "Renombra la publicación o anuncia su identidad con export { nombre } antes de generarla.",
          });
        }
      }
    }
  }
  if (diagnostics.length) throw new DiagnosticError(diagnostics);
}

export function declaredNames(statement: Statement): string[] {
  switch (statement.kind) {
    case "VariableDeclaration":
      // The parser's synthetic destructuring temporary is not a user binding.
      if (statement.arrayBindings) return statement.arrayBindings.map(binding => binding.name).filter(Boolean);
      if (statement.objectBindings) return statement.objectBindings.map(binding => binding.name).filter(Boolean);
      return [statement.name];
    case "UsingDeclaration":
    case "FunctionDeclaration":
    case "InterfaceDeclaration":
    case "ClassDeclaration":
    case "TypeAliasDeclaration":
    case "EnumDeclaration":
    case "UnionDeclaration":
      return [statement.name];
    case "ExportDefaultDeclaration":
      return declaredNames(statement.declaration as Statement);
    default:
      return [];
  }
}
