import net from "estatic:net";
async function cancelSoon(source: CancellationSource): Promise<void> {
  await sleep(20);
  cancel(source);
  return;
}

async function cancellationDemo(port: number): Promise<void> {
  const source: CancellationSource = createCancellation();
  const token: CancellationToken = cancellationToken(source);
  const opened = net.listen(port, "127.0.0.1");
  if (opened.isOk() == false) { printError(opened.error().message); return; }
  const server = opened.value();
  spawn(cancelSoon(source));
  const accepted = await server.acceptUntil(5000, token);
  if (accepted.isOk() == false) { print(accepted.error().message); }
  server.close();
  return;
}

await cancellationDemo(34567);
