import {IrCppResult} from "./generator";
function quote(value:string):string{return '"'+jsonEscape(value)+'"';}
function strings(values:string[]):string{
 let output:string[]=[];for(const value of values)output.push(quote(value));return "["+output.join(",")+"]";
}
function booleanText(value:boolean):string{return value?"true":"false";}
export function formatCppResult(result:constRef<IrCppResult>):string{
 const flags=result.runtimeBackends;
 return '{"cpp":'+quote(result.cpp)+',"headers":'+strings(result.headers)+',"capabilities":'+strings(result.capabilities)+',"runtimeBackends":{"libuv":'+booleanText(flags.libuv)+',"curl":'+booleanText(flags.curl)+',"tls":'+booleanText(flags.tls)+',"ioUring":'+booleanText(flags.ioUring)+'}}';
}
