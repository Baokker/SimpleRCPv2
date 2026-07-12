import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { ChatMessage } from "./types.js";

export interface CreateChatMessageInput {
  roomId: string;
  authorId: string;
  authorName: string;
  text: string;
}

export function createChatStore(events: EventLog) {
  const messages: ChatMessage[] = [];

  return {
    createMessage(input: CreateChatMessageInput) {
      const message: ChatMessage = {
        id: nanoid(10),
        timestamp: new Date().toISOString(),
        ...input
      };
      messages.push(message);
      events.append({
        type: "chat_message_created",
        roomId: message.roomId,
        memberId: message.authorId,
        payload: {
          messageId: message.id,
          authorName: message.authorName,
          text: message.text
        }
      });
      return message;
    },
    listMessages(roomId: string) {
      return messages.filter((message) => message.roomId === roomId);
    }
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
