import { Message } from "@domain/message";
import { formatMessage } from "@shared/format";

export class SmsChannel {
  send(message: Message): string {
    return "sms | " + formatMessage(message);
  }
}
