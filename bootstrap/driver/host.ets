@include("runtime/ets_compiler_host.hpp")
// Only target-runtime OS calls cross this boundary; compiler policy stays in ETS.
@cppgen function hostCode(code:string):string{return code;}
export function environment(name:string):string{hostCode("return ets_compiler_host::environment(name);");return "";}
export function environmentDefined(name:string):boolean{hostCode("return ets_compiler_host::environmentDefined(name);");return false;}
export function hostError():string{hostCode("return ets_compiler_host::lastError();");return "";}
export function exists(path:string):boolean{hostCode("return ets_compiler_host::exists(path);");return false;}
export function readText(path:string):string{hostCode("return ets_compiler_host::readText(path);");return "";}
export function stdinText():string{hostCode("return ets_compiler_host::stdinText();");return "";}
export function writeText(path:string,text:string):boolean{hostCode("return ets_compiler_host::writeText(path,text);");return false;}
export function files(directory:string):string[]{hostCode("return ets_compiler_host::files(directory);");let empty:string[]=[];return empty;}
export function remove(path:string):boolean{hostCode("return ets_compiler_host::remove(path);");return false;}
export function launch(args:string[],output:string="",errors:string=""):number{hostCode("return ets_compiler_host::launch(args,output,errors);");return -2;}
export function poll(processId:number):number{hostCode("return ets_compiler_host::poll(processId);");return 125;}
export function terminate(processId:number):void{hostCode("ets_compiler_host::terminate(processId);return;");return;}
export function now():number{hostCode("return ets_compiler_host::now();");return 0;}
export function pause(milliseconds:number):void{hostCode("ets_compiler_host::pause(milliseconds);return;");return;}
export function terminal():boolean{hostCode("return ets_compiler_host::terminal();");return false;}
export function columns():number{hostCode("return ets_compiler_host::columns();");return 80;}
