// Demo del API estilo Node expuesta como built-in `fs` en Estatic.
// (Sin `async function main` porque el `int main` de C++ no puede ser corutina;
//  el codegen traduce `await` a top-level a `ets::syncWait`.)

const file:string=argumentCount()>1?argument(1):"fs-demo.txt";

// --- Sync ---------------------------------------------------------------
if (fs.existsSync(file)) {
  const removed: Result<boolean> = fs.unlinkSync(file);
  if (removed.isOk() == false) { console.error("unlink previo falló:", removed.error()); }
}
const written: Result<boolean> = fs.writeFileSync(file, "hola fs\n");
if (written.isOk() == false) { console.error("write falló:", written.error()); }
console.log("escrito OK");

const contents: Result<string> = fs.readFileSync(file);
if (contents.isOk() == false) { console.error("read falló:", contents.error()); }
console.log("leído sync:", contents.value());

// --- Async --------------------------------------------------------------
const asyncRead: Promise<Result<string>> = fs.readFile(file);
const asyncResult: Result<string> = await asyncRead;
if (asyncResult.isOk() == false) { console.error("async read falló:", asyncResult.error()); }
console.log("leído async:", asyncResult.value());

const removed: Result<boolean> = fs.unlinkSync(file);
if (removed.isOk() == false) { console.error("unlink falló:", removed.error()); }
console.log("borrado OK");
