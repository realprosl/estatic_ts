@include("runtime/ets_compiler_host.hpp")
// Only target-runtime OS calls cross this boundary; compiler policy stays in ETS.
@cppgen function hostCode(code:string):string{return code;}
export function environment(name:string):string{hostCode("return ets_compiler_host::environment(name);");return "";}
export function environmentDefined(name:string):boolean{hostCode("return ets_compiler_host::environmentDefined(name);");return false;}
export function setEnvironment(name:string,value:string):boolean{hostCode("return ets_compiler_host::setEnvironment(name,value);");return false;}
export function forkWorker():number{hostCode("return ets_compiler_host::forkWorker();");return -1;}
export function finishWorker(status:number):void{hostCode("ets_compiler_host::finishWorker(status);return;");return;}
export function waitWorker(pid:number):number{hostCode("return ets_compiler_host::waitWorker(pid);");return 125;}
export function temporaryDirectory():string{hostCode("return ets_compiler_host::temporaryDirectory();");return "";}
export function analysisUsage():number[]{hostCode("return ets_compiler_host::analysisUsage();");return [];}
export function hostError():string{hostCode("return ets_compiler_host::lastError();");return "";}
export function exists(fileName:string):boolean{hostCode("return ets_compiler_host::exists(fileName);");return false;}
export function readText(fileName:string):string{hostCode("return ets_compiler_host::readText(fileName);");return "";}
export function stdinText():string{hostCode("return ets_compiler_host::stdinText();");return "";}
export function writeText(fileName:string,text:string):boolean{hostCode("return ets_compiler_host::writeText(fileName,text);");return false;}
export function files(directory:string):string[]{hostCode("return ets_compiler_host::files(directory);");let empty:string[]=[];return empty;}
export function remove(fileName:string):boolean{hostCode("return ets_compiler_host::remove(fileName);");return false;}
export function executable():string{hostCode("return ets_compiler_host::executable();");return "";}
export function rename(from:string,to:string):boolean{hostCode("return ets_compiler_host::rename(from,to);");return false;}
export function launch(args:string[],output:string="",errors:string=""):number{hostCode("return ets_compiler_host::launch(args,output,errors);");return -2;}
export function poll(processId:number):number{hostCode("return ets_compiler_host::poll(processId);");return 125;}
export function terminate(processId:number):void{hostCode("ets_compiler_host::terminate(processId);return;");return;}
export function now():number{hostCode("return ets_compiler_host::now();");return 0;}
export function pause(milliseconds:number):void{hostCode("ets_compiler_host::pause(milliseconds);return;");return;}
export function terminal():boolean{hostCode("return ets_compiler_host::terminal();");return false;}
export function columns():number{hostCode("return ets_compiler_host::columns();");return 80;}

export function compilerHome():string{hostCode("return ets_compiler_host::compilerRoot();");return "";}

export function objectKeys(value:JsonValue):string[]{hostCode("return jsonObjectKeys(value);");let keys:string[]=[];return keys;}

export function directories(fileName:string):boolean{hostCode("return ets_compiler_host::directories(fileName);");return false;}
