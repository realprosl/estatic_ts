import { LoaderOptions, PathAlias, ModuleLoader, formatGraph } from "./loader";

function runDemo(): void {
  let options: LoaderOptions = new LoaderOptions(); let entry: string = ""; let repeat: number = 1;
  for (let i: number = 1; i < argumentCount(); i = i + 1) {
    const arg: string = argument(i);
    if (arg == "--cache" || arg == "--root" || arg == "--syntax-key") {
      i = i + 1; if (i >= argumentCount()) exitProcess(2);
      if (arg == "--cache") options.cacheDirectory = argument(i);
      else if (arg == "--root") options.roots.push(normalizePath(argument(i)));
      else options.syntaxKey = argument(i);
    } else if (arg == "--alias") {
      if (i + 2 >= argumentCount()) exitProcess(2);
      options.aliases.push(new PathAlias(argument(i + 1), argument(i + 2))); i = i + 2;
    } else if (arg == "--twice") repeat = 2;
    else if (entry == "") entry = arg;
    else exitProcess(2);
  }
  if (entry == "") { printError("Expected entry [--cache directory] [--root directory] [--alias name directory] [--twice]"); exitProcess(2); }
  let loader: ModuleLoader = new ModuleLoader(options); let success: boolean = true;
  for (let i: number = 0; i < repeat; i = i + 1) {
    const graph = loader.load(entry); print(formatGraph(graph)); if (!graph.success) success = false;
  }
  if (!success) exitProcess(1);
}
runDemo();
