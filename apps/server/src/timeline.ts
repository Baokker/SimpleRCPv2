import { nanoid } from "nanoid";
import type {
  MemberKind,
  TimelineItem,
  TimelineItemStatus,
  TimelineItemType
} from "./types.js";

interface AppendTimelineInput {
  roomId: string;
  actorName: string;
  actorKind: MemberKind;
  type: TimelineItemType;
  label: string;
  status: TimelineItemStatus;
  detail?: string;
  eventId?: string;
  taskId?: string;
  runId?: string;
}

export function createTimelineStore() {
  const items: TimelineItem[] = [];

  return {
    append(input: AppendTimelineInput) {
      const item: TimelineItem = {
        id: nanoid(10),
        timestamp: new Date().toISOString(),
        ...input
      };
      items.push(item);
      return item;
    },
    list(roomId: string) {
      return items.filter((item) => item.roomId === roomId);
    },
    clearRoom(roomId: string) {
      const nextItems = items.filter((item) => item.roomId !== roomId);
      items.splice(0, items.length, ...nextItems);
    }
  };
}

export type TimelineStore = ReturnType<typeof createTimelineStore>;
