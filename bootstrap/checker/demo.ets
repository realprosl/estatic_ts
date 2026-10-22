import { ModuleLoader, LoaderOptions, PathAlias } from "../modules/loader";
import { bindProject, BindingResult } from "../binder/binder";
import { formatBinding } from "../binder/format";
import { checkProject, CheckResult } from "./checker";
import { formatChecked } from "./format";
import { formatSource } from "../frontend/frontend";
import { contentHash } from "../modules/platform";
function runCheckingDemo(): void {
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
  const binding: BindingResult = bindProject(graph); const bindingBefore: string = formatBinding(binding,graph);
  const result: CheckResult = checkProject(graph,binding); const text: string = formatChecked(result,binding,graph);
  // A second check must be independent, and may never annotate cached syntax.
  const again: CheckResult = checkProject(graph,binding);
  if (formatChecked(again,binding,graph) != text) { printError("Checking is not deterministic"); exitProcess(3); }
  for (let i: number = 0; i < graph.modules.length; i = i + 1) {
    if (before[i] != contentHash(formatSource(graph.modules[i].cached.result))) { printError("Checker mutated syntax"); exitProcess(3); }
  }
  if (formatBinding(binding,graph) != bindingBefore) { printError("Checker mutated binding"); exitProcess(3); }
  print(text); if (!result.success) exitProcess(1);
}
runCheckingDemo();
