import { Message } from "./message";

export interface Channel {
  send(message: Message): string;
}
