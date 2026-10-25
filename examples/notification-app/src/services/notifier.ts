import { Channel } from "@domain/channel";
import { Message } from "@domain/message";

export function deliver(channels: Channel[], messages: Message[]): string[] {
  let receipts: string[] = [];
  for (const message of messages) {
    for (const channel of channels) {
      receipts.push(channel.send(message));
    }
  }
  return receipts;
}
