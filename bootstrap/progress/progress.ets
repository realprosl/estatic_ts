import {terminal,columns} from "../driver/host";
class Progress {
 enabled:boolean;verbose:boolean;animated:boolean;label:string;detail:string;started:number;total:number;frame:number;width:number;
 constructor(){this.enabled=false;this.verbose=false;this.animated=false;this.label="";this.detail="";this.started=0;this.total=0;this.frame=0;this.width=80;}
 configure(verbose:boolean,animate:boolean):void{this.enabled=true;this.verbose=verbose;this.animated=animate&&terminal();this.width=columns();this.total=Date.now();}
 clear():void{if(this.animated)writeError("\r[2K");}
 render():void{if(!this.animated||this.label=="")return;const symbols:string[]=["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];let text:string=symbols[this.frame%10]+" "+this.label;if(this.verbose&&this.detail!="")text+=" · "+this.detail;text+=" ("+numberToString(Math.floor(Date.now()-this.started))+" ms)";this.frame+=1;this.clear();writeError(text.slice(0,Math.max(20,this.width-1)));}
 finish(ok:boolean=true):void{if(this.label=="")return;this.clear();printError((ok?"✓ ":"✗ ")+this.label+" ("+numberToString(Math.floor(Date.now()-this.started))+" ms)");this.label="";this.detail="";}
 start(label:string):void{this.finish();this.label=label;this.started=Date.now();this.render();}
 update(text:string):void{if(!this.enabled){printError(text);return;}if(!this.verbose)return;this.detail=text;this.render();}
 summary():void{this.finish();printError("✓ Compilación completada ("+numberToString(Math.floor(Date.now()-this.total))+" ms)");}
}
let progress=new Progress();
export function configureProgress(verbose:boolean,animate:boolean):void{progress.configure(verbose,animate);}
export function progressStart(label:string):void{progress.start(label);}
export function progressDetail(text:string):void{progress.update(text);}
export function progressTick():void{progress.render();}
export function progressFinish(ok:boolean=true):void{progress.finish(ok);}
export function progressSummary():void{progress.summary();}
