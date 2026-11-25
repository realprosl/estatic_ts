import { argument } from "estatic:process";
import { readFileSync, writeFileSync, appendFileSync, copyFileSync, renameSync, unlinkSync, existsSync } from "estatic:fs";
const source: string = argument(1);
const copy: string = source + ".copy";
const moved: string = source + ".moved";

const written = writeFileSync(source, "hello");
if (written.isOk() == false) {
  printError(written.error().message);
} else {
  const appended = appendFileSync(source, " native");
  if (appended.isOk() == false) printError(appended.error().message);
}

const contents = readFileSync(source);
if (contents.isOk()) {
  write("Contenido: ");
  print(contents.value());
}

if (copyFileSync(source, copy).isOk() && renameSync(copy, moved).isOk()) {
  print("Movido: ", existsSync(moved));
}

const removedSource = unlinkSync(source);
if (removedSource.isOk() == false) { printError(removedSource.error().message); }
const removedMoved = unlinkSync(moved);
if (removedMoved.isOk() == false) { printError(removedMoved.error().message); }
