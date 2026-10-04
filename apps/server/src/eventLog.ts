import { nanoid } from "nanoid";
import type { EventRecord } from "./types.js";
import { readJsonFile, writeJsonFileAtomically } from "./jsonFile.js";
import { redactSensitive } from "./agent/traceStore.js";

export interface EventInput {
  type: string;
  roomId?: string;
  memberId?: string;
  participantId?: string;
  payload?: Record<string, unknown>;
}

interface EventFile {
  version: 1;
  events: EventRecord[];
}

const durableEventTypes = new Set([
  "terminal_input",
  "chat_message_created",
  "file_changed",
  "workspace_file_created",
  "workspace_directory_created",
  "workspace_path_renamed",
  "workspace_path_deleted",
  "agent_task_queued",
  "agent_task_started",
  "agent_task_completed",
  "agent_task_failed",
  "agent_task_cancelled",
  "knowledge_card_created",
  "knowledge_card_updated",
  "knowledge_card_confirmed",
  "knowledge_card_archived",
  "knowledge_suggestion_created",
  "knowledge_suggestion_resolved",
  "knowledge_notification",
  "knowledge_warning_read",
  "knowledge_review_completed",
  "mirror_resync"
]);

export function createEventLog(storagePath?: string) {
  const events: EventRecord[] = [];
  let operations = Promise.resolve();
  const loading = storagePath ? loadEvents(storagePath, events) : Promise.resolve();

  function enqueue(operation: () => Promise<void>) {
    const result = operations.then(operation);
    operations = result.then(() => undefined, () => undefined);
  }

  return {
    append(input: EventInput) {
      const event: EventRecord = redactSensitive({
        id: nanoid(),
        timestamp: new Date().toISOString(),
        ...input
      }) as EventRecord;
      events.push(event);
      if (storagePath && durableEventTypes.has(event.type)) {
        enqueue(async () => {
          await loading;
          await writeJsonFileAtomically(storagePath, {
            version: 1,
            events: events.filter((candidate) => durableEventTypes.has(candidate.type))
          } satisfies EventFile);
        });
      }
      return event;
    },
    list() {
      return [...events];
    },
    async awaitIdle() {
      await loading;
      await operations;
    }
  };
}

export type EventLog = ReturnType<typeof createEventLog>;

async function loadEvents(storagePath: string, events: EventRecord[]) {
  const stored = await readJsonFile<EventFile>(storagePath);
  if (stored === undefined) return;
  if (
    stored.version !== 1 ||
    !Array.isArray(stored.events) ||
    stored.events.some(
      (event) =>
        !event ||
        typeof event.id !== "string" ||
        typeof event.type !== "string" ||
        typeof event.timestamp !== "string"
    )
  ) {
    throw new Error("Invalid activity file");
  }
  events.unshift(...stored.events);
}
