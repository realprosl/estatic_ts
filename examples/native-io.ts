import { argument } from "estatic:process";
import fs from "estatic:fs";
const source: string = argument(1);
const copy: string = source + ".copy";
const moved: string = source + ".moved";

const written = fs.writeFileSync(source, "hello");
if (written.isOk() == false) {
  printError(written.error().message);
} else {
  const appended = fs.appendFileSync(source, " native");
  if (appended.isOk() == false) printError(appended.error().message);
}

const contents = fs.readFileSync(source);
if (contents.isOk()) {
  write("Contenido: ");
  print(contents.value());
}

if (fs.copyFileSync(source, copy).isOk() && fs.renameSync(copy, moved).isOk()) {
  print("Movido: ", fs.existsSync(moved));
}

const removedSource = fs.unlinkSync(source);
if (removedSource.isOk() == false) { printError(removedSource.error().message); }
const removedMoved = fs.unlinkSync(moved);
if (removedMoved.isOk() == false) { printError(removedMoved.error().message); }
