import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import { readJsonFile, writeJsonFileAtomically } from "./jsonFile.js";
import type { ChatMessage } from "./types.js";

export interface CreateChatMessageInput {
  roomId: string;
  authorId: string;
  authorName: string;
  text: string;
}

interface ChatFile {
  version: 1;
  messages: ChatMessage[];
}

export function createChatStore(
  events: EventLog,
  options: { storagePath?: string } = {}
) {
  let messages: ChatMessage[] = [];
  let operations: Promise<void> | undefined;

  function ensureLoaded() {
    operations ??= loadMessages(options.storagePath).then((loaded) => {
      messages = loaded;
    });
    return operations;
  }

  return {
    async createMessage(input: CreateChatMessageInput) {
      let created: ChatMessage | undefined;
      const creation = ensureLoaded().then(async () => {
        const message: ChatMessage = {
          sequence: (messages.at(-1)?.sequence ?? 0) + 1,
          id: nanoid(10),
          timestamp: new Date().toISOString(),
          ...input
        };
        const nextMessages = [...messages, message];
        await saveMessages(options.storagePath, nextMessages);
        messages = nextMessages;
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
        created = message;
      });
      operations = creation;
      await creation;
      if (!created) throw new Error("Chat message was not created");
      return created;
    },
    async listMessages(roomId: string) {
      await ensureLoaded();
      return messages.map((message) => ({ ...message, roomId }));
    },
    async awaitIdle() {
      await ensureLoaded();
    }
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;

async function loadMessages(storagePath?: string): Promise<ChatMessage[]> {
  if (!storagePath) return [];
  const parsed = await readJsonFile<ChatFile>(storagePath);
  if (parsed === undefined) return [];
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.messages)) {
    throw new Error("Invalid chat history");
  }
  return parsed.messages;
}

async function saveMessages(
  storagePath: string | undefined,
  messages: ChatMessage[]
) {
  if (!storagePath) return;
  await writeJsonFileAtomically(storagePath, { version: 1, messages } satisfies ChatFile);
}
