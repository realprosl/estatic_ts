import { Message } from "@domain/message";
import { formatMessage } from "@shared/format";

export class EmailChannel {
  send(message: Message): string {
    return "mail | " + message.subject + " | " + formatMessage(message);
  }
}
