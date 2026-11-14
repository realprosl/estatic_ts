// Presentación de diagnósticos al estilo de rustc:
//
//   error[checker]: El tipo 'ProcessReadable' no declara el miembro 'end'
//     --> src/main.ts:12:17
//      |
//   12 |   process.stdin.end();
//      |   ^^^^^^^^^^^^^^^^^
//      |
//      = ayuda: los streams de lectura solo tienen .on(...)
//
// Las posiciones llegan como offsets en unidades UTF-16 (los del lexer); aquí
// se pasan a bytes y a línea:columna, con la columna en caracteres. Un mensaje puede
// llevar líneas extra "\nayuda: ..." o "\nnota: ..." que se muestran debajo.
import {readText,exists,terminal,environment,environmentDefined,currentDirectory} from "../platform/index";

let colorDecided=false;let colorOn=false;
function colors():boolean{
 if(!colorDecided){colorDecided=true;colorOn=terminal()&&!environmentDefined("NO_COLOR")&&environment("TERM")!="dumb";}
 return colorOn;
}
function paint(text:string,code:string):string{return colors()?"["+code+"m"+text+"[0m":text;}

let cachedFile="";let cachedText="";
function sourceText(file:string):string{
 if(file!=cachedFile){cachedFile=file;cachedText=((file!=""&&exists(file))?readText(file):"");}
 return cachedText;
}
function continuation(code:number):boolean{return code>=128&&code<192;}
// Offset en unidades UTF-16 -> índice en bytes UTF-8 (las cadenas son bytes).
function byteIndex(text:string,units:number):number{
 let index=0;let count=0;
 while(index<text.length&&count<units){const c=text.charCodeAt(index);index=index+1;if(continuation(c))continue;count=count+((c>=240)?2:1);}
 while(index<text.length&&continuation(text.charCodeAt(index)))index=index+1;
 return index;
}
function displayPath(file:string):string{
 const cwd=currentDirectory();if(cwd!=""&&file.startsWith(cwd+"/"))return file.slice(cwd.length+1,file.length);return file;
}
// "PARSER_ERROR" -> "parser"; los códigos propios (E4210, IR_INVALID) se dejan.
function codeLabel(code:string):string{
 if(code.endsWith("_ERROR"))return code.slice(0,code.length-6).toLowerCase();return code;
}
function repeat(text:string,count:number):string{let result="";for(let k:number=0;k<count;k=k+1)result=result+text;return result;}

// --- Catálogo de mensajes (messages/<idioma>.json) ------------------------
// Idioma: ESTC_LANG (es, en...), por defecto español. Si falta una entrada en
// ese idioma se usa la española, y si no hay catálogo, el texto que escribió
// la fase (siempre en español).
let catalogRoot="";let catalogLoaded=false;
let catalog:JsonValue=JSON.parseValue("{}");let fallbackCatalog:JsonValue=JSON.parseValue("{}");
export function setDiagnosticCatalog(root:string):void{catalogRoot=root;catalogLoaded=false;}
export function diagnosticLanguage():string{const lang=environment("ESTC_LANG");return lang==""?"es":lang;}
function loadCatalog():void{
 if(catalogLoaded)return;catalogLoaded=true;if(catalogRoot=="")return;
 const spanish=catalogRoot+"/messages/es.json";if(exists(spanish))fallbackCatalog=JSON.parseValue(readText(spanish));
 const chosen=catalogRoot+"/messages/"+diagnosticLanguage()+".json";catalog=(exists(chosen)?JSON.parseValue(readText(chosen)):fallbackCatalog);
}
function hasEntry(key:string):boolean{loadCatalog();return jsonIsObject(jsonObjectGet(catalog,key))||jsonIsObject(jsonObjectGet(fallbackCatalog,key));}
// Campo de una entrada: primero en el idioma elegido, después en español.
function catalogText(key:string,field:string):string{
 loadCatalog();const own=jsonObjectGet(jsonObjectGet(catalog,key),field);if(jsonIsString(own))return jsonAsString(own);
 const spanish=jsonObjectGet(jsonObjectGet(fallbackCatalog,key),field);if(jsonIsString(spanish))return jsonAsString(spanish);return "";
}
function uiText(field:string,fallback:string):string{const text=catalogText("_ui",field);return text==""?fallback:text;}
// "tok:<tipo>:<lexema>" -> descripción del token en el idioma ("el final del fichero"...).
function describeToken(value:string):string{
 const rest=value.slice(4,value.length);const colon=rest.indexOf(":",0);const kind=colon<0?rest:rest.slice(0,colon);const lexeme=colon<0?"":rest.slice(colon+1,rest.length);
 let template=catalogText("_tokens",kind);if(template=="")template=catalogText("_tokens","lexeme");if(template=="")return "'"+lexeme+"'";
 return template.split("{0}").join(lexeme);
}
function fill(template:string,names:string[],values:string[]):string{
 let text=template;for(let k:number=0;k<names.length;k=k+1){const value=values[k].startsWith("tok:")?describeToken(values[k]):values[k];text=text.split("{"+names[k]+"}").join(value);}
 return text;
}
// Códigos con explicación larga vistos en esta compilación (para el resumen).
let explainable:string[]=[];
// Explicación larga para `etsc --explain CÓDIGO`.
export function explainCode(code:string):string{
 const text=catalogText(code,"explicacion");if(text!="")return code+": "+catalogText(code,"mensaje")+"\n\n"+text;
 return uiText("sin_explicacion","No hay explicación para '{codigo}'.").split("{codigo}").join(code);
}
export function renderDiagnostic(code:string,message:string,file:string,start:number,end:number):string{
 // Mensaje: primera línea, anotaciones ("ayuda: ...", "nota: ...") y datos
 // para el catálogo ("\tnombre=valor", nunca se muestran).
 const parts=message.split("\n");let notes:string[]=[];let names:string[]=[];let values:string[]=[];let variant="";
 for(let k:number=1;k<parts.length;k=k+1){
  const line=parts[k];if(line=="")continue;
  if(line.startsWith("\t")){const equal=line.indexOf("=",0);if(equal<0)continue;const name=line.slice(1,equal);const value=line.slice(equal+1,line.length);if(name=="_variante")variant=value;else{names.push(name);values.push(value);}continue;}
  notes.push(line);
 }
 let headline=parts[0];const key=variant==""?code:code+"/"+variant;
 if(catalogText(key,"mensaje")!=""){
  // Mensaje del catálogo: sustituye al texto de la fase y a sus anotaciones.
  headline=fill(catalogText(key,"mensaje"),names,values);notes=[];
  if(catalogText(key,"ayuda")!="")notes.push("ayuda: "+fill(catalogText(key,"ayuda"),names,values));
  if(catalogText(key,"nota")!="")notes.push("nota: "+fill(catalogText(key,"nota"),names,values));
 }else{
  // Sin mensaje en el catálogo (p. ej. los E4xxx): se conserva el texto y se
  // añaden la ayuda o la nota del código, si las hay.
  if(catalogText(code,"ayuda")!="")notes.push("ayuda: "+catalogText(code,"ayuda"));
  if(catalogText(code,"nota")!="")notes.push("nota: "+catalogText(code,"nota"));
 }
 if(catalogText(code,"explicacion")!=""&&!explainable.includes(code))explainable.push(code);
 let rendered=paint(uiText("error","error")+"["+codeLabel(code)+"]","1;31")+paint(": "+headline,"1");
 const text=sourceText(file);
 if(text!=""&&start>=0){const from=byteIndex(text,start);end=((end>start)?byteIndex(text,end):from);start=from;}
 if(text==""||start<0||start>text.length){
  if(file!="")rendered=rendered+"\n  "+paint("-->","1;34")+" "+displayPath(file);
  for(const note of notes)rendered=rendered+"\n  "+paint("=","1;34")+" "+noteText(note);
  return rendered;
 }
 // Línea y columna (1-based; la columna en caracteres).
 let line=1;let lineStart=0;
 for(let k:number=0;k<start;k=k+1)if(text.charCodeAt(k)==10){line=line+1;lineStart=k+1;}
 let lineEnd=lineStart;while(lineEnd<text.length&&text.charCodeAt(lineEnd)!=10)lineEnd=lineEnd+1;
 let column=1;for(let k:number=lineStart;k<start;k=k+1)if(!continuation(text.charCodeAt(k)))column=column+1;
 // Subrayado: del inicio al final del error, sin pasar del final de la línea.
 let stop=(end>start)?end:start+1;if(stop>lineEnd)stop=lineEnd;
 let pad="";for(let k:number=lineStart;k<start;k=k+1){const c=text.charCodeAt(k);if(c==9)pad=pad+"\t";else if(!continuation(c))pad=pad+" ";}
 let width=0;for(let k:number=start;k<stop;k=k+1)if(!continuation(text.charCodeAt(k)))width=width+1;if(width<1)width=1;
 const lineLabel=numberToString(line);const gutter=repeat(" ",lineLabel.length);
 rendered=rendered+"\n"+gutter+paint("--> ","1;34")+displayPath(file)+":"+lineLabel+":"+numberToString(column);
 rendered=rendered+"\n"+gutter+" "+paint("|","1;34");
 rendered=rendered+"\n"+paint(lineLabel+" |","1;34")+" "+text.slice(lineStart,lineEnd);
 rendered=rendered+"\n"+gutter+" "+paint("|","1;34")+" "+pad+paint(repeat("^",width),"1;31");
 if(notes.length>0){rendered=rendered+"\n"+gutter+" "+paint("|","1;34");for(const note of notes)rendered=rendered+"\n"+gutter+" "+paint("=","1;34")+" "+noteText(note);}
 return rendered;
}
// "ayuda: texto" -> etiqueta en el idioma elegido y en negrita.
function noteText(note:string):string{
 const colon=note.indexOf(":",0);if(colon<0)return note;let label=note.slice(0,colon);
 if(label=="ayuda")label=uiText("ayuda","ayuda");else if(label=="nota")label=uiText("nota","nota");
 return paint(label+":","1")+note.slice(colon+1,note.length);
}
// Resumen final: "error: no se pudo compilar por 3 errores".
export function renderSummary(count:number):string{
 const summary=count==1?uiText("resumen_uno","no se pudo compilar por un error"):uiText("resumen_varios","no se pudo compilar por {n} errores").split("{n}").join(numberToString(count));
 let rendered=paint(uiText("error","error"),"1;31")+paint(": "+summary,"1");
 // Copia local: el bucle llama a funciones que leen el catálogo global y el
 // checker de memoria no admite recorrer un global prestado mientras tanto.
 const label=uiText("nota","nota");const template=uiText("explicar","para más detalles: etsc --explain {codigo}");
 let codes:string[]=[];for(let k:number=0;k<explainable.length;k=k+1)codes.push(explainable[k]);
 for(const code of codes)rendered=rendered+"\n"+paint(label+":","1")+" "+template.split("{codigo}").join(code);
 return rendered;
}
