import {configureAnalysisJobs,configureAnalysisProfile} from "../analysis/options";
import { ModuleLoader, LoaderOptions, PathAlias } from "../modules/loader";
import { analyzeProject } from "../checker/expansion";
import { lowerProject } from "./lower";
import { IrProject, IrIssue, IrSource } from "./model";
import { formatIr } from "./format";
function runIr(): void {
  let verbose: boolean = false; let entry: string = ""; let options = new LoaderOptions();
  for (let at: number = 1; at < argumentCount(); at = at+1) {
    const arg: string = argument(at);
    if(arg=="--profile-analysis"){if(!configureAnalysisProfile())exitProcess(2);}
    else if(arg=="--jobs"){at=at+1;if(at>=argumentCount()||!configureAnalysisJobs(argument(at))){printError("--jobs requiere un entero entre 1 y 32");exitProcess(2);}}
    else if (arg == "--verbose") { verbose = true; options.verbose = true; }
    else if (arg == "--root" || arg == "--cache") { at = at+1; if (at >= argumentCount()) exitProcess(2); if (arg == "--root") options.roots.push(normalizePath(argument(at))); else options.cacheDirectory = argument(at); }
    else if (arg == "--alias") { if (at+2 >= argumentCount()) exitProcess(2); options.aliases.push(new PathAlias(argument(at+1),argument(at+2))); at = at+2; }
    else if (entry == "" && !arg.startsWith("-")) entry = arg; else exitProcess(2);
  }
  if (entry == "") { printError("Expected source entry [--root path] [--alias name path] [--cache path]"); exitProcess(2); }
  let loader = new ModuleLoader(options); const graph = loader.load(entry); const project = analyzeProject(graph,verbose);
  let diagnostics = project.graph.diagnostics;
  for (const d of project.binding.diagnostics) diagnostics.push(d);
  for (const d of project.checked.diagnostics) diagnostics.push(d);
  let ir = new IrProject();
  if (diagnostics.length == 0) {
    if (verbose) printError("frontend: lowering IR");
    ir = lowerProject(project.graph,project.binding,project.checked,verbose);
  }
  let seen: string[] = [];
  for (const d of diagnostics) {
    const key: string = d.file+":"+numberToString(d.token.offset)+":"+d.code+":"+d.message;
    if (!seen.includes(key)) { seen.push(key); ir.diagnostics.push(new IrIssue(d.code,d.message,new IrSource("","",d.file,-1,d.token.offset,d.endToken.endOffset))); }
  }
  if (verbose) printError("frontend: serializing verified IR");
  print(formatIr(ir)); if (!ir.success) exitProcess(1);
}
runIr();
