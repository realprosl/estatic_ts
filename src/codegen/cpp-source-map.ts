import type { Span, GeneratedSource } from "../core/span.ts";
import { CppLineContext } from "./cpp-line-context.ts";

const begin="// @ets-cpp-origin ";
const end="// @ets-cpp-origin-end";
type Origin=NonNullable<Span["generated"]>;
export interface CppSourceMapping { cppStartLine:number; cppEndLine:number; sourceFile:string; origin:Origin }

/** Boundaries survive concatenation into unity output. They are comments until
 * the output path and physical ETS files are known. Never mark expressions:
 * directives may only be inserted between complete C++ lines. */
export function markCppOrigin(span:Span,text:string):string {
  return span.generated ? `\n${begin}${JSON.stringify(span.generated)}\n${text}\n${end}\n` : text;
}

/** Materialize line directives after final layout, so leaving a fragment
 * restores the real C++ filename/physical line, also after unity concatenation.
 * Mapping granularity is the AST statement/declaration; native columns are C++.
 */
export function mapCppSources(cpp:string,cppFile:string,sources:GeneratedSource[],sourceFiles:string[]):{cpp:string;mappings:CppSourceMapping[]} {
  if(sources.length !== sourceFiles.length) throw new Error("Tabla de fuentes ETS incompleta");
  const files=new Map(sources.map((source,index)=>[source.id,sourceFiles[index]]));
  const stack:Origin[]=[];
  const output:string[]=[],mappings:CppSourceMapping[]=[];
  const context=new CppLineContext();
  let anchored=false;
  for(const line of cpp.split("\n")) {
    const trimmed=line.trim();
    if(context.canInsertDirective && trimmed.startsWith(begin)) {
      const origin=JSON.parse(trimmed.slice(begin.length)) as Origin;
      if(!files.has(origin.id) || !Number.isSafeInteger(origin.span?.start.line) || origin.span.start.line < 1) throw new Error("Origen C++ generado inválido");
      stack.push(origin);
      output.push(`#line ${origin.span.start.line} ${JSON.stringify(files.get(origin.id))}`);
      anchored=true;
    } else if(context.canInsertDirective && trimmed === end) {
      if(!stack.length) throw new Error("Cierre de origen C++ sin apertura");
      stack.pop();
      const parent=stack.at(-1);
      output.push(`#line ${parent ? parent.span.start.line : output.length+2} ${JSON.stringify(parent ? files.get(parent.id) : cppFile)}`);
      anchored=true;
    } else {
      const origin=stack.at(-1);
      if(origin && !anchored && trimmed && context.canInsertDirective)
        output.push(`#line ${origin.span.start.line} ${JSON.stringify(files.get(origin.id))}`);
      output.push(line);
      context.consume(line);
      anchored=false;
      if(origin) {
        const previous=mappings.at(-1),physicalLine=output.length;
        if(previous?.origin === origin && previous.cppEndLine === physicalLine-1) previous.cppEndLine=physicalLine;
        else mappings.push({cppStartLine:physicalLine,cppEndLine:physicalLine,sourceFile:files.get(origin.id)!,origin});
      }
    }
  }
  if(stack.length) throw new Error("Origen C++ sin cerrar");
  return {cpp:output.join("\n"),mappings};
}
