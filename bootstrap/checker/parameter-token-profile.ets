import { ModuleGraph, ModuleLoader, LoaderOptions } from "../modules/loader";
import { BindingResult, BindingSymbol, BindingScope, BoundFile, bindProject } from "../binder/binder";
import { NativeChecker } from "./checker";
import { quoteSource } from "../frontend/frontend";
import { traceAnalysis } from "../frontend/analysis-trace";
function probeTokens(): void {
  if (argumentCount() != 2) exitProcess(2);
  const arg: string = argument(1);
  if (arg == "m512" || arg == "m1024" || arg == "m2048") {
    const count: number = arg == "m512" ? 512 : arg == "m1024" ? 1024 : 2048;
    let binding = new BindingResult();
    binding.symbols.push(new BindingSymbol("Owner","ClassDeclaration",0,0,0,true,true));
    binding.symbols.push(new BindingSymbol("Other","ClassDeclaration",0,0,2,true,true));
    binding.scopes.push(new BindingScope(-1,0,99,"module"));
    binding.scopes.push(new BindingScope(0,0,0,"ClassDeclaration"));
    binding.scopes.push(new BindingScope(0,0,2,"ClassDeclaration"));
    binding.files.push(new BoundFile(0,100));
    binding.files[0].nodeScopes[0] = 1; binding.files[0].nodeScopes[2] = 2;
    for (let i: number = 0; i < count; i = i+1) {
      binding.symbols.push(new BindingSymbol("other"+numberToString(i),"ClassField",2,0,3,true,false));
      binding.scopes[2].symbols.push(i+2);
    }
    const field: number = binding.symbols.length;
    binding.symbols.push(new BindingSymbol("field","ClassField",1,0,1,true,false));
    binding.scopes[1].symbols.push(field);
    let checker = new NativeChecker(new ModuleGraph(""),binding);
    traceAnalysis(true,"checker.memberProbe","BEGIN");
    for (let repeat: number = 0; repeat < 128; repeat = repeat+1) {
      if (checker.memberSymbol("#0","field") != field || checker.memberSymbol("#0","absent") != -1) exitProcess(3);
    }
    traceAnalysis(true,"checker.memberProbe","END"); print("{\"success\":true}"); return;
  }
  if (arg == "512" || arg == "1024" || arg == "2048") {
    const count: number = arg == "512" ? 512 : arg == "1024" ? 1024 : 2048;
    let binding = new BindingResult();
    for (let i: number = 0; i < count; i = i+1) binding.symbols.push(new BindingSymbol("value","builtin",0,-1,-1,true,false));
    let checker = new NativeChecker(new ModuleGraph(""),binding);
    traceAnalysis(true,"checker.tokenProbe","BEGIN");
    for (let repeat: number = 0; repeat < 128; repeat = repeat+1) {
      if (checker.parameterBound("number") != "" || checker.packToken("number")) exitProcess(3);
    }
    traceAnalysis(true,"checker.tokenProbe","END");
    print("{\"success\":true}"); return;
  }
  let loader = new ModuleLoader(new LoaderOptions()); const graph = loader.load(arg);
  const binding = bindProject(graph); let checker = new NativeChecker(graph,binding);
  const result = checker.check(); if (!result.success) exitProcess(3);
  let parameter: number = -1; let pack: number = -1;
  for (let sid: number = 0; sid < binding.symbols.length; sid = sid+1) {
    if (binding.symbols[sid].kind == "TypeParameter" && binding.symbols[sid].name == "T") parameter = sid;
    if (binding.symbols[sid].kind == "TypeParameter" && binding.symbols[sid].name == "P") pack = sid;
  }
  if (parameter < 0 || pack < 0) exitProcess(3);
  let tokens: string[] = ["@"+numberToString(parameter),"@"+numberToString(pack),"number","#0","","@0"+numberToString(parameter),"@-1","@1.0","@1<X>","@NaN","@2147483648","@"+numberToString(binding.symbols.length)];
  let output: string[] = ["["]; let comma: string = "";
  for (const token of tokens) {
    output.push(comma+"{\"token\":"+quoteSource(token)+",\"bound\":"+quoteSource(checker.parameterBound(token))+",\"pack\":"+(checker.packToken(token)?"true":"false")+"}"); comma = ",";
  }
  output.push("]"); print(output.join(""));
}
probeTokens();
