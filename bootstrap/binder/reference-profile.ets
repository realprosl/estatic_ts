// Diagnostic driver: isolate Binder.bind() from loading and JSON formatting.
import { ModuleLoader, LoaderOptions } from "../modules/loader";
import { Binder } from "./binder";
import { formatBinding } from "./format";
function profileReferences(): void {
  if (argumentCount() != 2) exitProcess(2);
  let loader = new ModuleLoader(new LoaderOptions());
  const graph = loader.load(argument(1));
  let binder = new Binder(graph); binder.trace = true;
  const result = binder.bind();
  print(formatBinding(result, graph));
  if (!result.success) exitProcess(1);
}
profileReferences();
