import { ModuleLoader, LoaderOptions, PathAlias } from "../modules/loader";
import { bindProject, BindingResult } from "./binder";
import { formatBinding } from "./format";
import { formatSource } from "../frontend/frontend";
import { contentHash } from "../modules/platform";
function runBindingDemo(): void {
  let options: LoaderOptions = new LoaderOptions(); let entry: string = "";
  for (let i: number = 1; i < argumentCount(); i = i + 1) {
    const arg: string = argument(i);
    if (arg == "--cache" || arg == "--root") {
      i = i + 1; if (i >= argumentCount()) exitProcess(2);
      if (arg == "--cache") options.cacheDirectory = argument(i); else options.roots.push(normalizePath(argument(i)));
    } else if (arg == "--alias") {
      if (i + 2 >= argumentCount()) exitProcess(2);
      options.aliases.push(new PathAlias(argument(i + 1), argument(i + 2))); i = i + 2;
    } else if (entry == "") entry = arg; else exitProcess(2);
  }
  if (entry == "") { printError("Expected entry [--cache directory] [--root directory] [--alias name target]"); exitProcess(2); }
  let loader: ModuleLoader = new ModuleLoader(options); const graph = loader.load(entry);
  let before: string[] = []; for (const module of graph.modules) before.push(contentHash(formatSource(module.cached.result)));
  const result: BindingResult = bindProject(graph); const text: string = formatBinding(result, graph);
  // A second bind must be independent, and may never annotate cached syntax.
  const again: BindingResult = bindProject(graph);
  if (formatBinding(again, graph) != text) { printError("Binding is not deterministic"); exitProcess(3); }
  for (let i: number = 0; i < graph.modules.length; i = i + 1) {
    if (before[i] != contentHash(formatSource(graph.modules[i].cached.result))) { printError("Binding mutated syntax"); exitProcess(3); }
  }
  print(text); if (!result.success) exitProcess(1);
}
runBindingDemo();
