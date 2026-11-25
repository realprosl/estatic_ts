import { listen, Socket } from "estatic:net";
async function handleClient(connection: Socket): Promise<void> {
  const request = await connection.read(16384);
  if (request.isOk()) {
    const body: string = "Hello from Estatic TS";
    const response: string = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: " + numberToString(body.length) + "\r\nConnection: close\r\n\r\n" + body;
    const written = await connection.write(response);
    if (written.isOk() == false) { printError(written.error().message); }
  } else {
    printError(request.error().message);
  }
  connection.end();
  return;
}

async function serve(): Promise<void> {
  const opened = listen(8080, "0.0.0.0");
  if (opened.isOk() == false) {
    printError(opened.error().message);
    return;
  }
  const server = opened.value();
  print("Listening on http://127.0.0.1:8080");
  while (true) {
    const accepted = await server.accept();
    if (accepted.isOk()) {
      spawn(handleClient(accepted.value()));
    } else {
      printError(accepted.error().message);
    }
  }
}

await serve();
