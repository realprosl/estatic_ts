import { argument } from "estatic:process";
import tls from "estatic:tls";
async function secureServer(certificate: string, privateKey: string): Promise<void> {
  const created = tls.createServer({ cert: certificate, key: privateKey });
  if (created.isOk() == false) { printError(created.error().message); return; }
  const server = created.value();
  const opened = server.listen(34443, "127.0.0.1");
  if (opened.isOk() == false) { printError(opened.error().message); return; }
  print("READY");
  const accepted = await server.accept(5000);
  if (accepted.isOk()) {
    const connection = accepted.value();
    const request = await connection.read(4096, 5000);
    if (request.isOk()) {
      const response = await connection.write("secure:" + request.value(), 5000);
      if (response.isOk() == false) { printError(response.error().message); }
    }
    connection.end();
  } else { printError(accepted.error().message); }
  server.close();
  return;
}

await secureServer(argument(1), argument(2));
