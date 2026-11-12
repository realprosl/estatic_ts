import { writeFileSync } from "node:fs";
import { fileCalleeMap,regexCalleeMap,netCalleeMap,asyncCalleeMap,etsNetworkCalleeMap } from "../../src/codegen/runtime-callees.ts";
import { cppType } from "../../src/codegen/cpp-types.ts";
import { runtimeBackendsForCalls } from "../../src/modules/runtime-backends.ts";
import { TERMINAL_METHODS } from "../../src/semantic/terminal-methods.ts";
import { globalCalls,asyncCalls,stringMethods,objectMethods } from "../../src/codegen/ir/runtime-calls.ts";
export function nativeTables(output:string):void {
 const q=JSON.stringify;
 const map=(name:string,values:Record<string,string>)=>`inline const std::map<S,S> ${name}{${Object.entries(values).map(([a,b])=>`{${q(a)},${q(b)}}`).join(",")}};`;
 const set=(name:string,values:Iterable<string>)=>`inline const std::set<S> ${name}{${[...values].map(q).join(",")}};`;
 const names=[...new Set([...Object.keys(fileCalleeMap),...Object.keys(netCalleeMap),...Object.keys(asyncCalleeMap),...Object.keys(etsNetworkCalleeMap),...globalCalls,...asyncCalls])];
 const primitive=["number","string","boolean","void","i8","u8","i16","u16","i32","u32","i64","u64","f32","f64","Console","JsonValue","Regex","FileReader","TcpListener","TcpConnection","TlsContext","TlsConnection","CancellationSource","CancellationToken","FsWatcher","FsEvent"];
 writeFileSync(output,["#pragma once","namespace estc {",map("nativeTypes",Object.fromEntries(primitive.map(name=>[name,cppType(name)]))),map("fileCalls",fileCalleeMap),map("regexCalls",regexCalleeMap),map("netCalls",netCalleeMap),map("asyncRuntimeCalls",asyncCalleeMap),map("networkCalls",etsNetworkCalleeMap),set("globalCalls",globalCalls),set("asyncCalls",asyncCalls),set("stringMethods",stringMethods),set("terminalMethods",Object.keys(TERMINAL_METHODS)),...Object.entries(objectMethods).map(([name,methods],index)=>set(`objectMethods${index}`,methods)),`inline const std::map<S,std::set<S>> objectMethods{${Object.keys(objectMethods).map((name,index)=>`{${q(name)},objectMethods${index}}`).join(",")}};`,...(["libuv","curl","tls","ioUring"] as const).map(key=>set(`backend_${key}`,names.filter(name=>runtimeBackendsForCalls([name])[key]))),"}"].join("\n"));
}
