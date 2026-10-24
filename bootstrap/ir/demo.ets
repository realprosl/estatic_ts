import { ModuleLoader, LoaderOptions } from "../modules/loader";
import { analyzeProject } from "../checker/expansion";
import { lowerProject } from "./lower";
import { formatIr } from "./format";
function runIr(): void {
  if (argumentCount() != 2) { printError("Expected source entry"); exitProcess(2); }
  let loader = new ModuleLoader(new LoaderOptions()); const graph = loader.load(argument(1)); const project = analyzeProject(graph);
  const ir = lowerProject(project.graph,project.binding,project.checked); print(formatIr(ir)); if (!ir.success) exitProcess(1);
}
runIr();
