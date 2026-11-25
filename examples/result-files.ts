import { argument } from "estatic:process";
import fs from "estatic:fs";
function safeDivide(left: number, right: number): Result<number> {
  if (right == 0) {
    return err<number>("division by zero");
  }
  return ok(left / right);
}

const path: string = argument(1);
const copy: string = path + ".copy";

const written = fs.writeFileSync(path, "hello");
if (written.isOk() == false) {
  printError(written.error().message);
}

const appended = fs.appendFileSync(path, " Result");
if (appended.isOk() == false) {
  printError(appended.error().message);
}

const contents = fs.readFileSync(path);
if (contents.isOk()) {
  print(contents.value());
} else {
  printError(contents.error().message);
}

const copied = fs.copyFileSync(path, copy);
if (copied.isOk() == false) {
  printError(copied.error().message);
}

const calculation: Result<number> = safeDivide(84, 2);
if (calculation.isOk()) {
  print(calculation.value());
}

const removedOriginal = fs.unlinkSync(path);
const removedCopy = fs.unlinkSync(copy);
if (removedOriginal.isOk() == false) { printError(removedOriginal.error().message); }
if (removedCopy.isOk() == false) { printError(removedCopy.error().message); }
