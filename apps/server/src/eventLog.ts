import { nanoid } from "nanoid";
import type { EventRecord } from "./types.js";

export interface EventInput {
  type: string;
  roomId?: string;
  memberId?: string;
  taskId?: string;
  payload?: object;
}

export function createEventLog() {
  const events: EventRecord[] = [];

  return {
    append(input: EventInput) {
      const event: EventRecord = {
        id: nanoid(),
        timestamp: new Date().toISOString(),
        ...input
      };
      events.push(event);
      return event;
    },
    list() {
      return [...events];
    }
  };
}

export type EventLog = ReturnType<typeof createEventLog>;
