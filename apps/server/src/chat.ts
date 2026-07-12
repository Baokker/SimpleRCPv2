import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { ChatMessage, MemberKind } from "./types.js";

export interface CreateChatMessageInput {
  roomId: string;
  authorId: string;
  authorName: string;
  authorKind: MemberKind;
  text: string;
  taskId?: string;
  runId?: string;
}

export function createChatStore(events: EventLog) {
  const messages: ChatMessage[] = [];

  return {
    createMessage(input: CreateChatMessageInput) {
      const message: ChatMessage = {
        id: nanoid(10),
        timestamp: new Date().toISOString(),
        mentions: parseMentions(input.text),
        ...input
      };
      messages.push(message);
      events.append({
        type: "chat_message_created",
        roomId: message.roomId,
        memberId: message.authorId,
        taskId: message.taskId,
        payload: {
          messageId: message.id,
          authorName: message.authorName,
          authorKind: message.authorKind,
          text: message.text,
          mentions: message.mentions,
          runId: message.runId
        }
      });
      return message;
    },
    listMessages(roomId: string) {
      return messages.filter((message) => message.roomId === roomId);
    }
  };
}

export function parseMentions(text: string) {
  const matches = text.matchAll(/@([A-Za-z][A-Za-z0-9_-]*)/g);
  return [...matches].flatMap((match) => (match[1] ? [match[1]] : []));
}

export type ChatStore = ReturnType<typeof createChatStore>;
