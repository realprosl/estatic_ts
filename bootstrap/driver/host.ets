@include("runtime/ets_compiler_host.hpp")
// Only target-runtime OS calls cross this boundary; compiler policy stays in ETS.
@cppgen function hostCode(code:string):string{return code;}
export function environment(name:string):string{hostCode("return ets_compiler_host::environment(name);");return "";}
export function environmentDefined(name:string):boolean{hostCode("return ets_compiler_host::environmentDefined(name);");return false;}
export function hostError():string{hostCode("return ets_compiler_host::lastError();");return "";}
export function exists(fileName:string):boolean{hostCode("return ets_compiler_host::exists(fileName);");return false;}
export function readText(fileName:string):string{hostCode("return ets_compiler_host::readText(fileName);");return "";}
export function stdinText():string{hostCode("return ets_compiler_host::stdinText();");return "";}
export function writeText(fileName:string,text:string):boolean{hostCode("return ets_compiler_host::writeText(fileName,text);");return false;}
export function files(directory:string):string[]{hostCode("return ets_compiler_host::files(directory);");let empty:string[]=[];return empty;}
export function remove(fileName:string):boolean{hostCode("return ets_compiler_host::remove(fileName);");return false;}
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

export function copyFile(source:string,target:string):boolean{hostCode("return ets_compiler_host::copyFile(source,target);");return false;}
export function temporaryDirectory(parent:string):string{hostCode("return ets_compiler_host::temporaryDirectory(parent);");return "";}
export function removeDirectory(path:string):boolean{hostCode("return ets_compiler_host::removeDirectory(path);");return false;}
