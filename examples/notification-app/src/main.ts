import { Channel } from "@domain/channel";
import { Message } from "@domain/message";
import { SmsChannel } from "./channels/sms";
import { EmailChannel } from "./channels/email";
import { deliver } from "./services/notifier";

// Exercises the native async runtime without contacting an external service.
await sleep(1);

const channels: Channel[] = [new SmsChannel(), new EmailChannel()];
const messages: Message[] = [
  new Message("Ana", "Pedido", "Tu pedido esta listo"),
  new Message("Luis", "Cuenta", "Tu cuenta esta activada")
];
const receipts: string[] = deliver(channels, messages);
for (const receipt of receipts) {
  print(receipt);
}
if (receipts.length != 4) {
  printError("Numero de notificaciones incorrecto");
  exitProcess(1);
}
print("TOTAL: " + numberToString(receipts.length));
