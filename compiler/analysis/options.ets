import {environment,setEnvironment,analysisUsage} from "../platform/host";
export function parseAnalysisJobs(value:string):number{
 if(value.length==0)return 0;let count:number=0;
 for(let at:number=0;at<value.length;at=at+1){const digit:number=value.charCodeAt(at)-48;if(digit<0||digit>9)return 0;count=count*10+digit;if(count>32)return 0;}
 return count>=1?count:0;
}
export function analysisJobs():number{const value=environment("ESTATIC_ANALYSIS_JOBS");return value==""?1:parseAnalysisJobs(value);}
export function configureAnalysisJobs(value:string):boolean{return parseAnalysisJobs(value)>0&&setEnvironment("ESTATIC_ANALYSIS_JOBS",value);}
export function configureAnalysisProfile():boolean{return setEnvironment("ESTATIC_PROFILE_ANALYSIS","1");}
export function profileBegin():number[]{if(environment("ESTATIC_PROFILE_ANALYSIS")!="1")return [];return analysisUsage();}
export function profileEnd(name:string,before:number[],counts:string=""):void{
 if(before.length==0)return;const after=analysisUsage();
 printError("frontend: profile "+name+" wall_ms="+numberToString(after[0]-before[0])+" cpu_ms="+numberToString(after[1]-before[1])+" self_peak_rss_kib="+numberToString(after[2])+" worker_peak_rss_kib="+numberToString(after[3])+(counts==""?"":" "+counts));
}
