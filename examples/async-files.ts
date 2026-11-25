import { argument } from "estatic:process";
import fs from "estatic:fs";
async function processFile(path: string): Promise<void> {
  const copy: string = path + ".copy";

  const written = await fs.writeFile(path, "hello");
  if (written.isOk() == false) { printError(written.error().message); }

  const appended = await fs.appendFile(path, " async files");
  if (appended.isOk() == false) { printError(appended.error().message); }

  const contents = await fs.readFile(path);
  if (contents.isOk()) { print(contents.value()); }
  else { printError(contents.error().message); }

  const copied = await fs.copyFile(path, copy);
  if (copied.isOk() == false) { printError(copied.error().message); }

  print("copy exists=", fs.existsSync(copy));

  const removedPath = await fs.unlink(path);
  const removedCopy = await fs.unlink(copy);
  if (removedPath.isOk() == false) { printError(removedPath.error().message); }
  if (removedCopy.isOk() == false) { printError(removedCopy.error().message); }
  return;
}

await processFile(argument(1));
