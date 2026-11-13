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
import {readText,exists,terminal,environment,environmentDefined,currentDirectory} from "./host";

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

// Explicación corta de cada código del modelo de memoria: qué significa y cómo
// se suele arreglar. Se añade como "nota:" debajo del mensaje.
function codeNote(code:string):string{
 if(code=="E4001")return "nota: E4001 · la variable se usa antes de tener un valor en todos los caminos; dale un valor inicial al declararla";
 if(code=="E4100")return "nota: E4100 · un valor con ownership (ptr<T>, recursos) debe inicializarse y transferirse con move(variable)";
 if(code=="E4101")return "nota: E4101 · los valores con ownership no se copian: transfiérelos con move(x) o préstalos con T& / const T&";
 if(code=="E4102")return "nota: E4102 · el valor ya se transfirió con move(); después de un move no se puede volver a usar";
 if(code=="E4103")return "nota: E4103 · en algún camino el valor ya se transfirió con move(); asegúrate de no usarlo después en ninguna rama";
 if(code=="E4104")return "nota: E4104 · etsc no puede demostrar que esta operación es segura para la memoria; simplifícala (variables locales, sin callbacks opacos)";
 if(code=="E4203")return "nota: E4203 · un préstamo (T&, const T&) no puede guardarse en un campo ni devolverse: vive solo mientras dura la llamada";
 if(code=="E4204")return "nota: E4204 · un préstamo no puede seguir vivo a través de un await ni dentro de una tarea async; copia el valor o pásalo por valor";
 if(code=="E4206")return "nota: E4206 · la misma variable se presta a la vez como mutable y compartida; usa préstamos que no se solapen";
 if(code=="E4207")return "nota: E4207 · se accede a la variable mientras está prestada; termina el préstamo antes de volver a usarla";
 if(code=="E4208")return "nota: E4208 · solo se presta algo con nombre y del tipo adecuado: para T& hace falta una variable declarada con let; un literal o un temporal guárdalo antes en una variable";
 if(code=="E4209")return "nota: E4209 · un closure no puede capturar un préstamo u owner si etsc no puede demostrar que vive lo suficiente";
 if(code=="E4210")return "nota: E4210 · un closure que sobrevive a la función no puede modificar variables locales; usa variables del nivel superior del fichero o pásale el valor";
 if(code=="E4300")return "nota: E4300 · el valor es de solo lectura (readonly / const T&) y no se puede modificar a través de él";
 if(code=="E4301")return "nota: E4301 · un cast no puede cambiar si un valor es préstamo, owner o copia";
 if(code=="E4401")return "nota: E4401 · una función exportada no puede usar en su firma un tipo que el módulo no exporta; expórtalo también";
 return "";
}
export function renderDiagnostic(code:string,message:string,file:string,start:number,end:number):string{
 // Mensaje principal y anotaciones ("ayuda:", "nota:").
 const parts=message.split("\n");let notes:string[]=[];for(let k:number=1;k<parts.length;k=k+1)if(parts[k]!="")notes.push(parts[k]);
 if(codeNote(code)!="")notes.push(codeNote(code));
 if(code=="IR_INVALID")notes.push("nota: es un error interno de etsc (el IR generado no es válido), no de tu programa; abre una issue con este ejemplo");
 let rendered=paint("error["+codeLabel(code)+"]","1;31")+paint(": "+parts[0],"1");
 const text=sourceText(file);
 if(text!=""&&start>=0){const from=byteIndex(text,start);end=((end>start)?byteIndex(text,end):from);start=from;}
 if(text==""||start<0||start>text.length){
  if(file!="")rendered=rendered+"\n  "+paint("-->","1;34")+" "+displayPath(file);
  for(const note of notes)rendered=rendered+"\n  "+paint("=","1;34")+" "+note;
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
 if(notes.length>0){rendered=rendered+"\n"+gutter+" "+paint("|","1;34");for(const note of notes)rendered=rendered+"\n"+gutter+" "+paint("=","1;34")+" "+paint(note.slice(0,note.indexOf(":",0)+1),"1")+note.slice(note.indexOf(":",0)+1,note.length);}
 return rendered;
}
// Resumen final: "error: no se pudo compilar por 3 errores".
export function renderSummary(count:number):string{
 return paint("error","1;31")+paint(": no se pudo compilar por "+(count==1?"un error":numberToString(count)+" errores"),"1");
}
