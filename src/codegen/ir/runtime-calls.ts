import { TERMINAL_METHODS } from "../../semantic/terminal-methods.ts";
import { fileCalleeMap, regexCalleeMap, netCalleeMap, asyncCalleeMap, etsNetworkCalleeMap } from "../runtime-callees.ts";
import { runtimeBackendsForCalls } from "../../modules/runtime-backends.ts";
import type { IrCppGenerator } from "./cpp-generator.ts";
import type { IrFunction, IrInstruction } from "./model.ts";

export const globalCalls=new Set([
  "argument","argumentCount","exitProcess","length","numberToString","jsonIsNull","jsonIsString","jsonIsNumber","jsonIsBool","jsonIsArray","jsonIsObject","jsonArrayLength","jsonArrayGet","jsonObjectGet","jsonObjectKeys","jsonAsString","jsonAsNumber","jsonAsBool","jsonEscape","fileExists","readFile","writeFile","appendFile","copyFile","moveFile","removeFile","readFileAsync","writeFileAsync","appendFileAsync","copyFileAsync","moveFileAsync","removeFileAsync","fileExistsAsync","fail","hasError","clearError",
]);
export const asyncCalls=new Set(["sleep","delay","spawn","cancel","cancellationToken","createCancellation","isCancelled","taskResolve","promiseAll","promiseRace","all","race","timeout","retry"]);
export const stringMethods=new Set(["charAt","charCodeAt","indexOf","lastIndexOf","includes","startsWith","endsWith","slice","substring","substr","split","trim","trimStart","trimEnd","toUpperCase","toLowerCase","repeat","replace","replaceAll","localeCompare","toString"]);
export const objectMethods:Record<string,Set<string>>={
  "!Math":new Set(["floor","ceil","round","abs","sqrt","pow","min","max","random"]),
  "!Date":new Set(["now","utc"]), "!JSON":new Set(["parse","stringify","parseValue","stringifyBool","stringifyNumber","stringifyValue"]),
  "!path":new Set(["dirname","basename","extname","join","resolve","normalize","isAbsolute"]),
  "!fs":new Set(["readFile","writeFile","appendFile","copyFile","rename","unlink","readFileSync","writeFileSync","appendFileSync","copyFileSync","renameSync","unlinkSync","existsSync"]),
  "!process":new Set(["cwd","exit","argv","argc"]),
  "Console":new Set(["log","info","debug","trace","warn","error"]),
};
export function emitRuntimeCall(g:IrCppGenerator,f:IrFunction,i:IrInstruction):string {
  const c=g.project.runtimeContracts[i.contract];if(!c||!c.capability||c.effects.length===0)g.fail("Contrato runtime ausente",i.source);
  const a=(n:number,consume=true)=>g.operand(f,i,n,consume);
  const runtimeArg=(k:number)=>["ref","constRef"].includes(g.shape(f.values[i.operands[k]]).kind)?`(*(${a(k)}))`:a(k);
  const args=()=>i.operands.map((_,k)=>runtimeArg(k)).join(","), T=g.type(i.typeId);
  if(c.name.startsWith("builtin.")) {
    const name=c.name.slice(8);
    const backend=runtimeBackendsForCalls([name]);
    for(const key of ["libuv","curl","tls","ioUring"] as const)g.backends[key] ||= backend[key];
    if(fileCalleeMap[name]||netCalleeMap[name]||etsNetworkCalleeMap[name]) {
      g.headers.add("runtime/ets_runtime_full.hpp");g.backends.libuv=true;
      if(backend.tls)g.headers.add("runtime/ets_tls.hpp");
      return `${fileCalleeMap[name]??netCalleeMap[name]??etsNetworkCalleeMap[name]}(${args()})`;
    }
    if(regexCalleeMap[name]){g.headers.add("runtime/ets_regex.hpp");return `${regexCalleeMap[name]}(${args()})`;}
    if(asyncCalleeMap[name]){g.headers.add(name==="resolveDns"?"runtime/ets_dns.hpp":"runtime/ets_async.hpp");g.backends.libuv=true;return `${asyncCalleeMap[name]}(${args()})`;}
    if(["setTimeout","setInterval","cancelTimer"].includes(name)){g.headers.add("runtime/ets_timer.hpp");g.backends.libuv=true;return `ets::${name}(${args()})`;}
    if(["optionalMap","optionalAndThen"].includes(name))return `${name}(${a(0)},${g.callback(f,i,1)})`;

    if(name==="stopLoop"){g.headers.add("runtime/ets_async.hpp");g.backends.libuv=true;return "ets::defaultEventLoop.stop()";}
    if(name==="length")return `ets::length(${a(0)})`;
    if(name==="optionalSome")return `${T}::some(${a(0)})`;
    if(name==="optionalNone")return `${T}::none()`;
    if(["ok","resultOk","err","resultErr"].includes(name))return `${T}::${["err","resultErr"].includes(name)?"failure":"success"}(${a(0)})`;
    if(name==="optionalIsPresent")return `(${a(0)}).isPresent()`;
    if(name==="optionalValueOr")return `(${a(0)}).valueOr(${a(1)})`;
    if(name==="booleanToString")return `std::string(${a(0)}?"true":"false")`;
    if(name==="optionalOrElse")return `(${a(0)}).orElse(${a(1)})`;
    if(name==="resultIsOk")return `(${a(0)}).isOk()`;
    if(globalCalls.has(name)) {
      if(/File/.test(name)||name==="fileExists"){g.headers.add("runtime/ets_file.hpp");g.backends.libuv=true;}
      return `${name}(${args()})`;
    }
    if(asyncCalls.has(name)) {
      g.headers.add("runtime/ets_async.hpp");g.backends.libuv=true;
      if(["all","promiseAll","race","promiseRace"].includes(name)) {
        const race=["race","promiseRace"].includes(name);
        if(g.shape(i.typeId).kind==="Promise")return `ets::${race?"task_race":"task_all"}(${args()})`;
        return race?`([&](){auto tasks=${a(0)};return ets::race(tasks);}())`:`ets::all(${args()})`;
      }
      return `ets::${name}(${args()})`;
    }
    g.fail(`Capacidad runtime no implementada: ${c.capability}`,i.source);
  }
  const dot=c.name.lastIndexOf("."), base=c.name.slice(0,dot), method=c.name.slice(dot+1);
  if(base==="!http") {
    if(["createServer","express","server"].includes(method)){g.httpServer();return "ets::Server{}";}
    if(["param","query","header"].includes(method)){g.httpServer();return `ets::http_${method}(*(${a(0,false)}),${a(1)})`;}
    if(["get","post"].includes(method)) {
      g.headers.add("runtime/ets_http_curl_async.hpp");g.backends.curl=true;g.backends.libuv=true;
      const values=i.operands.map((_,k)=>a(k));if(method==="post"&&values.length===2)values.push('std::string("text/plain")');
      return `ets::httpClient${method==="get"?"Get":"Post"}Async(${values.join(",")})`;
    }
  }
  if(base==="Request.property"&&["method","path","rawQuery","body"].includes(method)){g.httpServer();return `(${a(0,false)})->${method}`;}
  if(base==="Server") {
    g.httpServer();const receiver=g.deref(a(0,false),f.values[i.operands[0]]);
    if(["get","post","put","patch","delete"].includes(method))return `(${receiver}).${method==="delete"?"del":method}(${a(1)},[handler=${a(2)}](const ets::HttpRequest& request,ets::HttpResponse& response)mutable{handler(std::addressof(request),std::addressof(response));})`;
    if(method==="listen")return `(${receiver}).listen(${i.operands.slice(1).map((_,k)=>a(k+1)).join(",")})`;
  }
  if(base==="Response"&&["status","header","send","json"].includes(method)){g.httpServer();return `std::addressof((${a(0,false)})->${method}(${i.operands.slice(1).map((_,k)=>a(k+1)).join(",")}))`;}
  if(base==="HttpClientResponse"&&["status","body","header"].includes(method))return `(${g.deref(a(0,false),f.values[i.operands[0]])}).${method==="status"?"status_code":method==="body"?"body_str":method}(${i.operands.slice(1).map((_,k)=>a(k+1)).join(",")})`;
  if(base==="Console"&&TERMINAL_METHODS[method]){g.headers.add("runtime/ets_terminal.hpp");return `console.${method}(${args()})`;}
  if(objectMethods[base]?.has(method)) {
    if(["!fs","!path","!process"].includes(base)){g.headers.add("runtime/ets_runtime_full.hpp");g.backends.libuv=true;}
    const object=base==="Console"?"console":base.slice(1);
    return `${object}.${method.startsWith("stringify")?"stringify":method}(${base==="Console"?i.operands.map((v,k)=>g.output(a(k,false),f.values[v])).join(","):args()})`;
  }
  if(base==="string"&&stringMethods.has(method))return `ets::string_${method}(${args()})`;
  if(!i.operands.length)g.fail(`Capacidad runtime no implementada: ${c.capability}`,i.source);
  const actual=f.values[i.operands[0]], input=g.inner(actual), shape=g.shape(input), receiver=g.deref(a(0,false),actual);
  if(["Optional","Result"].includes(base)) {
    if(["isPresent","isEmpty","isOk","value","error","valueOr","orElse"].includes(method)) {
      const value=g.shape(actual).resource?a(0):a(0,false);
      return `(${g.deref(value,actual)}).${method}(${i.operands.slice(1).map((_,k)=>a(k+1)).join(",")})`;
    }
    if(["map","andThen"].includes(method))return `(${receiver}).${method}(${g.callback(f,i,1)})`;
  }
  if(["Map","Set"].includes(base)) {
    if(["set","add","has","clear","size","delete"].includes(method))return `(${receiver}).${method==="delete"?"removeKey":method}(${i.operands.slice(1).map((_,k)=>a(k+1)).join(",")})`;
    if(method==="get")return `${T}::of((${receiver}).get(${a(1)}))`;
    if(method==="forEach")return `(${receiver}).forEach(${g.callback(f,i,1)})`;
  }
  if(base==="array") {
    g.headers.add("runtime/ets_collections.hpp");const E=g.elementType(shape.arguments[0]);
    const callback=()=>g.callback(f,i,i.operands.length-1);
    if(method==="push")return `ets_push_vec<${E}>(${receiver},${a(1)})`;
    if(method==="pop")return `ets_pop_vec<${E}>(${receiver})`;
    if(method==="delete")return `(${receiver}).erase((${receiver}).begin()+static_cast<std::ptrdiff_t>(${a(1)}))`;
    if(method==="map")return `ets_map_vec<${E},${g.elementType(g.shape(i.typeId).arguments[0])}>(${receiver},${callback()})`;
    if(method==="flatMap")return `ets_flat_map_vec<${E},${g.elementType(g.shape(i.typeId).arguments[0])}>(${receiver},${callback()})`;
    if(method==="filter")return `ets_filter_vec<${E}>(${receiver},${callback()})`;
    if(method==="forEach")return `ets_for_each_vec(${receiver},${callback()})`;
    if(method==="some")return `ets_some_vec(${receiver},${callback()})`;
    if(method==="every")return `ets_every_vec(${receiver},${callback()})`;
    if(method==="find")return `ets_find_vec(${receiver},${callback()})`;
    if(method==="reduce")return `ets_reduce(${a(1)},${receiver},${callback()})`;
    if(method==="slice")return `ets_slice_vec(${receiver},${a(1)},${i.operands.length>2?a(2):`static_cast<int>((${receiver}).size())`})`;
    if(method==="includes")return `ets_includes_vec(${receiver},${a(1)})`;
    if(method==="join")return `ets_join_vec(${receiver},${a(1)})`;
    if(method==="concat")return `ets_concat_vec<${E}>({${i.operands.map((_,k)=>g.deref(a(k),f.values[i.operands[k]])).join(",")}})`;
    if(method==="sort")return i.operands.length===1?`([&](){std::sort((${receiver}).begin(),(${receiver}).end());return ${g.shape(i.typeId).resource?`std::move(${receiver})`:receiver};}())`:`ets_sort_vec(${receiver},${callback()})`;
  }
  g.fail(`Capacidad runtime no implementada: ${c.capability}`,i.source);
}
