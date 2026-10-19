import { EtsgenHygiene } from "./etsgen-hygiene.ts";
import type { Program, CallExpression, Expression, FunctionDeclaration } from "../ast/nodes.ts";
import type { Span, GeneratedSource } from "../core/span.ts";
import { DiagnosticError, restoreGeneratedNames, type Diagnostic } from "../core/diagnostic.ts";
import { TypeChecker } from "../semantic/type-checker.ts";

export interface EtsgenFragment {
  call: CallExpression;
  code: string;
  program: Program;
  definitionSpan?: Span;
}

export function etsgenGeneratedError(
  call: CallExpression, code: string, stage: string, message: string, notes: string[] = [],
): DiagnosticError {
  const snippet = code.length > 200 ? code.slice(0, 200) + "..." : code;
  return new DiagnosticError([{
    phase: stage === "codegen" ? "codegen" : "semantic",
    code: `ETSGEN_GENERATED_${stage.toUpperCase()}`,
    message: `@etsgen function '${call.callee}' generated invalid code:\n  generated: ${snippet}\n  ${stage} error: ${message}`,
    span: { start: { ...call.span.start }, end: { ...call.span.end } },
    hint: "revisa el codigo que retorna tu funcion @etsgen y su contexto de llamada",
    notes: [`Código generado por '${call.callee}'`, ...(call.span.generated ? [`Expansión anidada desde ${call.span.generated.id}`] : []), ...notes],
  }]);
}

/** Parse results remain ordinary dialect nodes in the final program.
 * Call nodes serve as temporary expansion markers, never as C++ fragments. */
export function validateAndExpandEtsgen(program: Program, fragments: EtsgenFragment[], deferCallerErrors=false): Program {
  if (!fragments.length) return program;
  const byCall = new Map(fragments.map(fragment => [fragment.call, fragment]));
  const origins = new WeakMap<Span, EtsgenFragment>();
  const generatedSources: GeneratedSource[] = fragments.map((fragment, index) => ({
    id: `etsgen:${(program.generatedSources?.length ?? 0) + index}`, kind: "etsgen" as const,
    generator: fragment.call.callee, source: fragment.code, callSpan: fragment.call.span,
    definitionModule: fragment.definitionSpan?.module, definitionImports: fragment.definitionSpan?.definitionImports, definitionAliases:fragment.definitionSpan?.definitionAliases,
    ...(fragment.call.span.generated ? {parentId:fragment.call.span.generated.id} : {}),
  }));
  const sourceByFragment = new Map(fragments.map((fragment,index)=>[fragment,generatedSources[index]]));
  const bodyOf = (fragment: EtsgenFragment) => {
    const fn = fragment.program.statements[0] as FunctionDeclaration;
    return fn.body;
  };
  const record = (node: unknown, fragment: EtsgenFragment): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(item => record(item, fragment)); return; }
    const obj = node as Record<string, unknown>;
    if (obj.span) origins.set(obj.span as Span, fragment);
    for (const [key, value] of Object.entries(obj)) if (key !== "span" && key !== "parent") record(value, fragment);
  };
  fragments.forEach(fragment => record(fragment.program, fragment));
  const hygiene = new EtsgenHygiene(program,fragments.map(bodyOf));
  const statementFragment = (node: unknown): EtsgenFragment | undefined => {
    if (!node || typeof node !== "object") return undefined;
    const statement = node as { kind?: string; expression?: Expression };
    return statement.kind === "ExpressionStatement" && statement.expression ? byCall.get(statement.expression as CallExpression) : undefined;
  };
  const contextual = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.flatMap(item => {
      const fragment = statementFragment(item);
      // Splice hygienically renamed declarations without hiding the caller
      // behind an artificial block scope.
      return fragment ? bodyOf(fragment).statements : [contextual(item)];
    });
    const fragment = statementFragment(node);
    if (fragment) return { ...bodyOf(fragment), span: fragment.call.span };
    const rawFragment = byCall.get(node as CallExpression);
    if (rawFragment) throw etsgenGeneratedError(rawFragment.call, rawFragment.code, "context", "la generación de sentencias requiere un ExpressionStatement");
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      result[key] = ["span", "parent", "resolvedType", "resolvedSignature", "resolvedRuntimeType"].includes(key) ? value : contextual(value);
    }
    return result;
  };
  let validation: Program;
  try {
    fragments.forEach(fragment=>hygiene.apply(bodyOf(fragment),sourceByFragment.get(fragment)!,span=>generatedEtsSpan(span,fragment.code)));
    fragments.forEach(fragment=>record(fragment.program,fragment));
    validation = contextual(program) as Program;
  } catch (error) {
    if (!(error instanceof DiagnosticError)) throw error;
    throw new DiagnosticError(error.diagnostics.map(diagnostic=>{
      const fragment = origins.get(diagnostic.span);
      if (!fragment) return diagnostic;
      return {...diagnostic, span:fragment.call.span, generated:{id:sourceByFragment.get(fragment)!.id,generator:fragment.call.callee,source:fragment.code,span:generatedEtsSpan(diagnostic.span,fragment.code)}};
    }));
  }
  validation.generatedSources = [...(program.generatedSources ?? []), ...generatedSources];
  const generatorNames=new Set(validation.statements.filter(s=>s.kind === "FunctionDeclaration" && s.decorators?.some(d=>d.name === "etsgen")).map(s=>(s as FunctionDeclaration).name));
  const pendingCalls:CallExpression[]=[];
  const findPending=(node:any):void=>{
    if(!node || typeof node !== "object") return;
    if(Array.isArray(node)) {node.forEach(findPending);return;}
    if(node.kind === "FunctionDeclaration" && node.decorators?.some((d:any)=>d.name === "etsgen")) return;
    if(node.kind === "CallExpression" && generatorNames.has(node.callee)) pendingCalls.push(node);
    for(const [key,value] of Object.entries(node)) if(!["span","parent","generatedSources","resolvedType","resolvedSignature","resolvedRuntimeType"].includes(key)) findPending(value);
  };
  findPending(validation);
  const checker = new TypeChecker();
  try { checker.check(validation); }
  catch (error) {
    if (!(error instanceof DiagnosticError)) throw error;
    const diagnostics: Diagnostic[] = error.diagnostics.map(diagnostic => {
      const fragment = origins.get(diagnostic.span);
      if (!fragment) return diagnostic;
      const generatedLine = Math.max(1, diagnostic.span.start.line - 1);
      const generated = etsgenGeneratedError(fragment.call, fragment.code, "semantic", restoreGeneratedNames(diagnostic.message,validation.generatedSources), [
        `Ubicación en código generado: línea ${generatedLine}, columna ${diagnostic.span.start.column}`,
        ...(diagnostic.hint ? [diagnostic.hint] : []), ...(diagnostic.notes ?? []),
      ]).diagnostics[0];
      generated.generated = { id: sourceByFragment.get(fragment)!.id, generator: fragment.call.callee, source: fragment.code, span: generatedEtsSpan(diagnostic.span, fragment.code) };
      return generated;
    });
    const fatal=deferCallerErrors ? diagnostics.filter((_,index)=>{
      const original=error.diagnostics[index];
      if(!origins.has(original.span)) return false;
      if(!pendingCalls.length) return true;
      return pendingCalls.some(call=>origins.get(call.span) === origins.get(original.span) && original.span.start.offset >= call.span.start.offset && original.span.end.offset <= call.span.end.offset);
    }) : diagnostics;
    if(fatal.length) throw new DiagnosticError(fatal);
  }
  // Attribute generated nodes to their expansion site for module ownership,
  // closure analysis and later diagnostics. Generated-source coordinates were
  // used above for precise semantic errors before this rebase.
  const rebase = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(rebase); return; }
    const obj = node as Record<string, unknown>;
    const origin = obj.span ? origins.get(obj.span as Span) : undefined;
    if (origin) obj.span = {
      start: { ...origin.call.span.start }, end: { ...origin.call.span.end },
      ...((obj.span as Span).etsgenScope ? {etsgenScope:(obj.span as Span).etsgenScope} : {}),
      ...((obj.span as Span).etsgenNamespaces ? {etsgenNamespaces:(obj.span as Span).etsgenNamespaces} : {}),
      ...((obj.span as Span).etsgenExports ? {etsgenExports:(obj.span as Span).etsgenExports} : {}),
      ...((obj.span as Span).etsgenBindings ? {etsgenBindings:(obj.span as Span).etsgenBindings} : {}),
      ...((obj.span as Span).hygiene ? {hygiene:(obj.span as Span).hygiene} : {}),
      ...((obj.span as Span).etsgenDefinition ? {etsgenDefinition:true} : {}),
      ...(origin.call.span.module ? {module:origin.call.span.module} : {}),
      generated: { id: sourceByFragment.get(origin)!.id, span: generatedEtsSpan(obj.span as Span, origin.code) },
    };
    for (const [key,value] of Object.entries(obj)) if (!["span","parent","resolvedType","resolvedSignature","resolvedRuntimeType","generatedSources"].includes(key)) rebase(value);
  };
  rebase(validation);
  return validation;
}

/** Convert wrapper coordinates to the actual generated .ets source. */
export function generatedEtsSpan(span: Span, source: string): Span {
  const prefix = "function main(): void {\n".length;
  const position = (offset: number) => {
    offset = Math.max(0, Math.min(source.length, offset - prefix));
    const before = source.slice(0, offset);
    return { offset, line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
  };
  return { start: position(span.start.offset), end: position(span.end.offset) };
}
