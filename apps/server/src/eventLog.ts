import { nanoid } from "nanoid";
import type { EventRecord } from "./types.js";
import { readJsonFile, writeJsonFileAtomically } from "./jsonFile.js";

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
  "file_changed",
  "workspace_file_created",
  "workspace_directory_created",
  "workspace_path_renamed",
  "workspace_path_deleted",
  "agent_task_queued",
  "agent_task_started",
  "agent_task_completed",
  "agent_task_failed",
  "agent_task_cancelled"
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
      const event: EventRecord = {
        id: nanoid(),
        timestamp: new Date().toISOString(),
        ...input
      };
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
