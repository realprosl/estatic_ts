export interface Position { offset: number; line: number; column: number }
export interface Span { start: Position; end: Position; module?: string; moduleDefault?: boolean; definitionImports?: string[]; definitionAliases?: Record<string,string>; etsgenNamespaces?: Record<string,Record<string,string>>; etsgenExports?: Record<string,string>; etsgenBindings?: Record<string,string>; etsgenDefinition?: boolean; etsgenShared?: boolean; etsgenScope?: Record<string, string>; hygiene?: { id?: string; name: string; role: "binding" | "reference" | "capture" | "external" }; generated?: { id: string; span: { start: Position; end: Position } } }
export interface GeneratedSource { id: string; kind: "etsgen"; generator: string; source: string; callSpan: Span; originalCallSpan?: Span; parentId?: string; definitionModule?: string; definitionImports?: string[]; definitionAliases?: Record<string,string>; bindings?: { id: string; name: string; emittedName: string; kind: string; span: Span }[]; captures?: { name: string; emittedName?: string; explicit: boolean; kind: string; span: Span }[] }

export function span(start: Position, end: Position): Span {
  return { start: { ...start }, end: { ...end } };
}
