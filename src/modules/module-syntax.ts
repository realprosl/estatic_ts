import { Lexer } from "../lexer/lexer.ts";
import { DiagnosticError } from "../core/diagnostic.ts";
import type { Span } from "../core/span.ts";

export interface ModuleRequest {
  specifier:string; names:string[]; bindings?:{imported:string;local:string}[];
  namespace?:string; reexport?:boolean; star?:boolean; line:number;
}
export interface LocalExport {name:string;exported:string;span:Span}

/** Discover module syntax from tokens, not lines. Blanking only the consumed
 * characters preserves original offsets, comments and all newline positions. */
export function scanModuleSyntax(source:string):{source:string;requests:ModuleRequest[];exports:LocalExport[]} {
  const tokens=new Lexer(source).tokenize();
  const requests:ModuleRequest[]=[], exports:LocalExport[]=[];
  const blanks:{start:number;end:number}[]=[];
  let i=0,depth=0;
  const skip=()=>{while(tokens[i]?.kind === "newline") i++;};
  const peek=()=>{skip();return tokens[i];};
  const match=(kind:string)=>{const token=peek();if(token?.kind === kind || (token?.kind === "identifier" && token.lexeme === kind)) {i++;return true;}return false;};
  const fail=(message:string):never=>{throw new DiagnosticError([{phase:"parser",code:"MODULE_SYNTAX",message,span:peek()?.span ?? tokens.at(-1)!.span}]);};
  const name=():string=>{const token=peek();if(token?.kind !== "identifier" && token?.kind !== "default") fail("Se esperaba un nombre de import/export");i++;return token.lexeme;};
  const from=():string=>{
    if(!match("from")) fail("Import no válido: se esperaba 'from' en el import/export");
    const token=peek();if(token?.kind !== "string") fail("Se esperaba un literal de módulo");i++;return token.lexeme;
  };
  const list=()=>{
    const result:{imported:string;local:string;span:Span}[]=[];
    if(!match("{")) fail("Se esperaba '{'");
    while(!match("}")) {
      const start=peek().span;
      // Per-specifier type imports share the dialect's existing type semantics.
      if(peek().lexeme === "type" && tokens[i+1]?.kind === "identifier") i++;
      const imported=name();const local=match("as") ? name() : imported;
      result.push({imported,local,span:start});
      if(match("}")) break;
      if(!match(",")) fail("Import no válido: se esperaba ',' o '}'");
    }
    return result;
  };
  while(i < tokens.length && tokens[i].kind !== "eof") {
    const token=tokens[i];
    if(depth === 0 && (token.kind === "import" || token.kind === "export")) {
      const start=i;const reexport=token.kind === "export";i++;
      if(peek()?.lexeme === "type") {
        let next=i+1;while(tokens[next]?.kind === "newline") next++;
        if(["{","*"].includes(tokens[next]?.kind) || (!reexport && tokens[next]?.kind === "identifier" && tokens[next].lexeme !== "from")) i++;
      }
      if(reexport && !["{","*"].includes(peek()?.kind)) {i=start+1;continue;}
      const bindings:{imported:string;local:string}[]=[];
      let namespace:string|undefined,star=false,specifier:string|undefined;
      if(!reexport && peek()?.kind === "string") {specifier=peek().lexeme;i++;}
      else {
        if(!reexport && peek()?.kind === "identifier" && peek().lexeme !== "type") {
          bindings.push({imported:"default",local:name()});
          if(!match(",")) specifier=from();
        }
        if(!specifier) {
          if(match("*")) {if(match("as")) namespace=name();else if(!reexport) fail("Un import '*' requiere 'as nombre'");else star=true;specifier=from();}
          else if(peek()?.kind === "{") {
            const items=list();bindings.push(...items.map(({imported,local})=>({imported,local})));
            if(reexport && peek()?.lexeme !== "from") exports.push(...items.map(item=>({name:item.imported,exported:item.local,span:item.span})));
            else specifier=from();
          } else fail("Import no válido: se esperaba un binding, namespace o lista de nombres");
        }
      }
      // Only consume a semicolon on this statement, never a following token.
      const endToken=tokens[i-1];let end=endToken.span.end.offset;
      if(tokens[i]?.kind === ";") {end=tokens[i].span.end.offset;i++;}
      blanks.push({start:tokens[start].span.start.offset,end});
      if(!reexport && bindings.some(binding=>binding.local === "default")) fail("'default' no puede ser el nombre local de un import");
      if(specifier !== undefined) requests.push({specifier,names:bindings.map(b=>b.imported),...(bindings.length ? {bindings} : {}),...(namespace ? {namespace} : {}),...(reexport ? {reexport:true} : {}),...(star ? {star:true} : {}),line:token.span.start.line});
      continue;
    }
    if(token.kind === "{") depth++;else if(token.kind === "}") depth--;
    i++;
  }
  let result="",cursor=0;
  for(const blank of blanks) {result+=source.slice(cursor,blank.start)+source.slice(blank.start,blank.end).replace(/[^\r\n]/g," ");cursor=blank.end;}
  result+=source.slice(cursor);
  return {source:result,requests,exports};
}
