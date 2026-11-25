import { argument } from "estatic:process";
import { existsSync, readFile, writeFile, appendFile, copyFile, unlink } from "estatic:fs";
async function processFile(path: string): Promise<void> {
  const copy: string = path + ".copy";

  const written = await writeFile(path, "hello");
  if (written.isOk() == false) { printError(written.error().message); }

  const appended = await appendFile(path, " async files");
  if (appended.isOk() == false) { printError(appended.error().message); }

  const contents = await readFile(path);
  if (contents.isOk()) { print(contents.value()); }
  else { printError(contents.error().message); }

  const copied = await copyFile(path, copy);
  if (copied.isOk() == false) { printError(copied.error().message); }

  print("copy exists=", existsSync(copy));

  const removedPath = await unlink(path);
  const removedCopy = await unlink(copy);
  if (removedPath.isOk() == false) { printError(removedPath.error().message); }
  if (removedCopy.isOk() == false) { printError(removedCopy.error().message); }
  return;
}

await processFile(argument(1));
