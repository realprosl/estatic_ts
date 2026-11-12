import { inspectSource } from "./frontend";

if (argumentCount() == 1) print(inspectSource('const text=`Hola ${1+2}`; print(text);', "<demo>"));
else {
  // Pairs allow checking independent files sequentially in the same process.
  if ((argumentCount() - 1) % 2 != 0) { print("Expected source/name pairs"); exitProcess(2); }
  for (let i: number = 1; i < argumentCount(); i = i + 2) print(inspectSource(argument(i), argument(i + 1)));
}
