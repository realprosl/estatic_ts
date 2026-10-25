import { Message } from "@domain/message";

export function formatMessage(message: Message): string {
  return message.recipient + ": " + message.body;
}
