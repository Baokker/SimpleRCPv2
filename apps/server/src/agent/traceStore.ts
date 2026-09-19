import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTraceEvent } from "@simplercp/shared";

export function createTraceStore(storagePath: string, sensitiveValues: string[]) {
  let operations = Promise.resolve();

  return {
    async append(input: Omit<AgentTraceEvent, "sequence" | "timestamp">) {
      let result: AgentTraceEvent | undefined;
      operations = operations.then(async () => {
        const events = await readTrace(storagePath);
        const event = filterSensitive(
          {
            ...input,
            sequence: (events.at(-1)?.sequence ?? 0) + 1,
            timestamp: new Date().toISOString()
          },
          sensitiveValues
        ) as AgentTraceEvent;
        await fs.mkdir(path.dirname(storagePath), { recursive: true });
        await fs.appendFile(storagePath, `${JSON.stringify(event)}\n`, "utf8");
        result = event;
      });
      await operations;
      if (!result) throw new Error("Agent trace event was not created");
      return result;
    },
    async list() {
      await operations;
      return readTrace(storagePath);
    }
  };
}

async function readTrace(storagePath: string): Promise<AgentTraceEvent[]> {
  try {
    const content = await fs.readFile(storagePath, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentTraceEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function filterSensitive(value: unknown, sensitiveValues: string[]): unknown {
  if (typeof value === "string") {
    return sensitiveValues
      .filter(Boolean)
      .reduce(
        (filtered, sensitive) => filtered.split(sensitive).join("[REDACTED]"),
        value
      );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => filterSensitive(entry, sensitiveValues));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        filterSensitive(entry, sensitiveValues)
      ])
    );
  }
  return value;
}

export type TraceStore = ReturnType<typeof createTraceStore>;
