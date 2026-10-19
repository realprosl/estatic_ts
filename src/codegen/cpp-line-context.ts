/** Track only the lexical state needed to insert directives between physical
 * C++ lines. Inserting inside a raw string, block comment or continued macro
 * would change the program. This is not a C++ parser. */
export class CppLineContext {
  private mode:"code"|"block"|"line"|"string"|"char"|"raw"="code";
  private rawEnd="";
  private continued=false;
  private prefix="";
  private logicalRawEnd="";
  private logicalStart:"code"|"block"|"line"|"string"|"char"|"raw"="code";

  get canInsertDirective():boolean { return this.mode === "code" && !this.continued; }

  consume(line:string):void {
    line=line.replace(/\r$/,"");
    const initial=this.continued ? this.logicalStart : this.mode;
    const initialRawEnd=this.continued ? this.logicalRawEnd : this.rawEnd;
    if(this.continued) {line=this.prefix+line;this.mode=initial;this.rawEnd=initialRawEnd;}
    let i=0;
    while(i < line.length) {
      if(this.mode === "raw") {
        const close=line.indexOf(this.rawEnd,i);
        if(close < 0) break;
        i=close+this.rawEnd.length;this.mode="code";continue;
      }
      if(this.mode === "block") {
        const close=line.indexOf("*/",i);
        if(close < 0) break;
        i=close+2;this.mode="code";continue;
      }
      if(this.mode === "line") break;
      const c=line[i],next=line[i+1];
      if(this.mode === "string" || this.mode === "char") {
        if(c === "\\") {i+=2;continue;}
        if(c === (this.mode === "string" ? '"' : "'")) this.mode="code";
        i++;continue;
      }
      if(c === "/" && next === "/") {this.mode="line";break;}
      if(c === "/" && next === "*") {this.mode="block";i+=2;continue;}
      if(i === 0 || !/[A-Za-z0-9_]/.test(line[i-1])) {
        const raw=/^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/.exec(line.slice(i));
        if(raw) {this.mode="raw";this.rawEnd=")"+raw[1]+'"';i+=raw[0].length;continue;}
        // Numeric tokens can contain apostrophes: 1'000 and 0xAB'CD.
        if(/[0-9]/.test(c) || c === "." && /[0-9]/.test(next ?? "")) {
          i++;while(i < line.length && /[A-Za-z0-9_'.]/.test(line[i])) i++;
          continue;
        }
      }
      if(c === '"') this.mode="string";
      else if(c === "'") this.mode="char";
      i++;
    }
    // Raw-string payloads retain their physical newlines. Elsewhere a final
    // backslash splices the next line before comments/strings are interpreted.
    const splice=/\\[ \t]*$/.exec(line);
    this.continued=this.mode !== "raw" && !!splice;
    this.logicalStart=initial;
    this.logicalRawEnd=initialRawEnd;
    this.prefix=this.continued ? line.slice(0,splice!.index) : "";
    if(this.mode === "line" && !this.continued) this.mode="code";
    // An ordinary literal cannot span an unspliced newline. Recover at the
    // line boundary so its native syntax error is not hidden by map handling.
    if((this.mode === "string" || this.mode === "char") && !this.continued) this.mode="code";
  }
}
