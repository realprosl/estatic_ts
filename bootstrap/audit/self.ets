import { ModuleLoader, LoaderOptions } from "../modules/loader";
import { analyzeProject } from "../checker/expansion";
import { quoteSource } from "../frontend/frontend";

// Native frontend only. The host adapter builds this executable using stage 0;
// the executable reads and analyzes the requested sources itself.
function checkSources(): void {
  const entry: string = argumentCount() > 1 ? argument(1) : "bootstrap/checker/demo.ets";
  let loader = new ModuleLoader(new LoaderOptions()); const graph = loader.load(entry);
  const project = analyzeProject(graph,true); let typed: number = 0;
  for (const file of project.checked.files) for (const value of file.types) if (value != "") typed = typed+1;
  let diagnostics: string[] = [];
  for (const diagnostic of project.checked.diagnostics) diagnostics.push("{\"file\":"+quoteSource(diagnostic.file)+",\"phase\":"+quoteSource(diagnostic.phase)+",\"message\":"+quoteSource(diagnostic.message)+",\"line\":"+numberToString(diagnostic.token.line)+",\"column\":"+numberToString(diagnostic.token.column)+"}");
  print("{\"success\":"+(project.checked.success ? "true" : "false")+",\"modules\":"+numberToString(project.graph.modules.length)+",\"symbols\":"+numberToString(project.binding.symbols.length)+",\"typedNodes\":"+numberToString(typed)+",\"diagnostics\":["+diagnostics.join(",")+"]}");
  if (!project.checked.success) exitProcess(1);
}
checkSources();
