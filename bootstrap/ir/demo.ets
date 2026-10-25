import { ModuleLoader, LoaderOptions, PathAlias } from "../modules/loader";
import { analyzeProject } from "../checker/expansion";
import { lowerProject } from "./lower";
import { IrIssue, IrSource } from "./model";
import { formatIr } from "./format";
function runIr(): void {
  let entry: string = ""; let options = new LoaderOptions();
  for (let at: number = 1; at < argumentCount(); at = at+1) {
    const arg: string = argument(at);
    if (arg == "--root" || arg == "--cache") { at = at+1; if (at >= argumentCount()) exitProcess(2); if (arg == "--root") options.roots.push(normalizePath(argument(at))); else options.cacheDirectory = argument(at); }
    else if (arg == "--alias") { if (at+2 >= argumentCount()) exitProcess(2); options.aliases.push(new PathAlias(argument(at+1),argument(at+2))); at = at+2; }
    else if (entry == "" && !arg.startsWith("-")) entry = arg; else exitProcess(2);
  }
  if (entry == "") { printError("Expected source entry [--root path] [--alias name path] [--cache path]"); exitProcess(2); }
  let loader = new ModuleLoader(options); const graph = loader.load(entry); const project = analyzeProject(graph);
  let ir = lowerProject(project.graph,project.binding,project.checked);
  let diagnostics = project.graph.diagnostics;
  for (const d of project.binding.diagnostics) diagnostics.push(d);
  for (const d of project.checked.diagnostics) diagnostics.push(d);
  let seen: string[] = [];
  for (const d of diagnostics) {
    const key: string = d.file+":"+numberToString(d.token.offset)+":"+d.code+":"+d.message;
    if (!seen.includes(key)) { seen.push(key); ir.diagnostics.push(new IrIssue(d.code,d.message,new IrSource("","",d.file,-1,d.token.offset,d.endToken.endOffset))); }
  }
  print(formatIr(ir)); if (!ir.success) exitProcess(1);
}
runIr();
