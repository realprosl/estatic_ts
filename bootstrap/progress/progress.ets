import {terminal,columns,environment,environmentDefined} from "../driver/host";
class Progress {
 enabled:boolean;verbose:boolean;animated:boolean;drawn:boolean;label:string;detail:string;started:number;total:number;frame:number;last:number;width:number;
 constructor(){this.enabled=false;this.verbose=false;this.animated=false;this.drawn=false;this.label="";this.detail="";this.started=0;this.total=0;this.frame=0;this.last=0;this.width=80;}
 configure(verbose:boolean,animate:boolean):void{
  this.enabled=true;this.verbose=verbose;
  this.animated=animate&&terminal()&&!environmentDefined("NO_COLOR")&&environment("TERM")!="dumb"&&environment("CI")=="";
  this.width=columns();this.total=Date.now();
 }
 scope(label:string):string{
  if(label.includes("configuración")||label.startsWith("Leyendo"))return "setup";
  if(label.startsWith("Analizando")||label.startsWith("Verificando"))return "check";
  if(label.startsWith("Guardando"))return "emit";
  if(label.startsWith("Creando")||label.startsWith("Actualizando"))return "init";
  return "build";
 }
 paint(text:string,code:string):string{return this.animated?"\u001b["+code+"m"+text+"\u001b[0m":text;}
 tag(label:string):string{return this.paint("["+this.scope(label)+"]","35");}
 duration(ms:number):string{
  if(ms<1000)return numberToString(Math.floor(ms))+" ms";
  if(ms<60000){const fraction:number=Math.floor((ms%1000)/10);return numberToString(Math.floor(ms/1000))+"."+(fraction<10?"0":"")+numberToString(fraction)+" s";}
  return numberToString(Math.floor(ms/60000))+" min "+numberToString(Math.floor(ms%60000/1000))+" s";
 }
 clean(text:string):string{let result:string="";for(let at:number=0;at<text.length;at+=1){const code:number=text.charCodeAt(at);if(code<32||code==127)result+=" ";else result+=text.charAt(at);}return result;}
 displayPath(text:string):string{const base:string=normalizePath(".")+"/";const normalized:string=normalizePath(text);return this.clean(normalized.startsWith(base)?normalized.slice(base.length,normalized.length):text);}
 clear():void{if(this.drawn){writeError("\r\u001b[2K");this.drawn=false;}}
 render(force:boolean=false):void{
  if(!this.animated||this.label==""||(!force&&Date.now()-this.last<80))return;
  const symbols:string[]=["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  const suffix:string=" · "+this.duration(Date.now()-this.started);const prefix:string="["+this.scope(this.label)+"] ";
  const available:number=Math.max(1,this.width-prefix.length-suffix.length-4);
  let text:string=this.clean(this.detail!=""?this.detail:this.label);
  if(text.length>available){const left:number=Math.floor((available-1)/2);const right:number=available-1-left;text=text.slice(0,left)+"…"+(right>0?text.slice(text.length-right,text.length):"");}
  this.clear();writeError(this.tag(this.label)+" "+this.paint(symbols[this.frame%10],"36")+" "+text+this.paint(suffix,"2"));
  this.frame+=1;this.last=Date.now();this.drawn=true;
 }
 finish(ok:boolean=true):void{
  if(this.label=="")return;this.clear();
  if(this.animated||this.verbose)printError(this.tag(this.label)+" "+this.paint(ok?"✓":"✗",ok?"32":"31")+" "+this.label+" ("+this.duration(Date.now()-this.started)+")");
  this.label="";this.detail="";
 }
 start(label:string):void{
  this.finish();this.label=label;this.started=Date.now();this.frame=0;
  if(this.animated)this.render(true);else if(this.verbose)printError(this.tag(label)+" > "+label);
 }
 update(text:string):void{
  if(!this.enabled){printError(text);return;}
  if(!this.verbose&&(!this.animated||!text.startsWith("frontend: ")))return;
  this.detail=text;if(!this.verbose&&text.startsWith("frontend: "))this.detail=text.slice(10,text.length);if(this.animated)this.render();else printError("  "+text);
 }
 summary(cpp:string="",binary:string=""):void{
  this.finish();if(this.animated||this.verbose)printError(this.paint("[etsc]","35")+" "+this.paint("✓","32")+" Compilación completada ("+this.duration(Date.now()-this.total)+")");
  if(this.animated&&!this.verbose){if(cpp!="")printError(this.paint("       ↳","2")+" C++  "+this.displayPath(cpp));if(binary!="")printError(this.paint("       ↳","2")+" bin  "+this.displayPath(binary));}
 }
}
let progress=new Progress();
export function configureProgress(verbose:boolean,animate:boolean):void{progress.configure(verbose,animate);}
export function progressInteractive():boolean{return progress.animated;}
export function progressStart(label:string):void{progress.start(label);}
export function progressDetail(text:string):void{progress.update(text);}
export function progressTick():void{progress.render();}
export function progressFinish(ok:boolean=true):void{progress.finish(ok);}
export function progressSummary(cpp:string="",binary:string=""):void{progress.summary(cpp,binary);}
