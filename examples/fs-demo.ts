// Demo del API estilo Node de la librería `estatic:fs`.
// (Sin `async function main` porque el `int main` de C++ no puede ser corutina;
//  el codegen traduce `await` a top-level a `ets::syncWait`.)

import { argument, argumentCount } from "estatic:process";
import fs from "estatic:fs";
const file:string=argumentCount()>1?argument(1):"fs-demo.txt";

// --- Sync ---------------------------------------------------------------
if (fs.existsSync(file)) {
  const removed = fs.unlinkSync(file);
  if (removed.isOk() == false) { console.error("unlink previo falló:", removed.error().message); }
}
const written = fs.writeFileSync(file, "hola fs\n");
if (written.isOk() == false) { console.error("write falló:", written.error().message); }
console.log("escrito OK");

const contents = fs.readFileSync(file);
if (contents.isOk() == false) { console.error("read falló:", contents.error().message); }
console.log("leído sync:", contents.value());

// --- Async --------------------------------------------------------------
const asyncResult = await fs.readFile(file);
if (asyncResult.isOk() == false) { console.error("async read falló:", asyncResult.error().message); }
console.log("leído async:", asyncResult.value());

const removed = fs.unlinkSync(file);
if (removed.isOk() == false) { console.error("unlink falló:", removed.error().message); }
console.log("borrado OK");
