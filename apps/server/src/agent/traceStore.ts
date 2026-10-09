import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTraceEvent } from "@simplercp/shared";

export function createTraceStore(storagePath: string, sensitiveValues: string[] = collectSensitiveEnvironment()) {
  const collectedValues = [...new Set([...collectSensitiveEnvironment(), ...sensitiveValues])];
  let operations = Promise.resolve();
  let writeFailures = 0;
  let readFailures = 0;
  let sequence: number | undefined;

  return {
    async append(input: Omit<AgentTraceEvent, "sequence" | "timestamp">) {
      let result: AgentTraceEvent | undefined;
      operations = operations.catch(() => undefined).then(async () => {
        if (sequence === undefined) sequence = (await readTrace(storagePath)).at(-1)?.sequence ?? 0;
        const event = redactSensitive(
          {
            ...input,
            sequence: sequence + 1,
            timestamp: new Date().toISOString()
          },
          collectedValues
        ) as AgentTraceEvent;
        await fs.mkdir(path.dirname(storagePath), { recursive: true });
        await fs.appendFile(storagePath, `${JSON.stringify(event)}\n`, "utf8");
        sequence = event.sequence;
        result = event;
      });
      try {
        await operations;
      } catch (error) {
        writeFailures += 1;
        console.error("Agent trace write failed", error);
        throw error;
      }
      if (!result) throw new Error("Agent trace event was not created");
      return result;
    },
    async list() {
      await operations.catch(() => undefined);
      try {
        return await readTrace(storagePath);
      } catch (error) {
        readFailures += 1;
        console.error("Agent trace read failed", error);
        throw error;
      }
    },
    diagnostics() { return { writeFailures, readFailures }; }
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

export function redactSensitive(value: unknown, sensitiveValues: string[] = collectSensitiveEnvironment(), options?: { preserveLength?: boolean }): unknown {
  if (typeof value === "string") {
    let filtered = [...new Set([...collectSensitiveEnvironment(), ...sensitiveValues])]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
      .reduce(
        (filtered, sensitive) => filtered.split(sensitive).join(options?.preserveLength ? "*".repeat(sensitive.length) : `[REDACTED:${sensitiveLabel(sensitive)}]`),
        value
      );
    filtered = filtered.replace(/sk-[A-Za-z0-9_-]{16,}/g, match => options?.preserveLength ? "*".repeat(match.length) : "[REDACTED:API_KEY]");
    filtered = filtered.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, match => options?.preserveLength ? "*".repeat(match.length) : "Bearer [REDACTED:TOKEN]");
    filtered = filtered.replace(/(Authorization:[ \t]*)[^\r\n]+/gi, (match, prefix: string) => options?.preserveLength ? prefix + "*".repeat(match.length - prefix.length) : `${prefix}[REDACTED:TOKEN]`);
    return filtered;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry, sensitiveValues, options));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactSensitive(entry, sensitiveValues, options)
      ])
    );
  }
  return value;
}

function sensitiveLabel(value: string) {
  const entry = Object.entries(process.env).find(([, candidate]) => candidate === value);
  return entry?.[0] ?? "TOKEN";
}

function collectSensitiveEnvironment() {
  return Object.entries(process.env)
    .filter(([name, value]) => /KEY|SECRET|TOKEN|PASSWORD/i.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value as string);
}

export type TraceStore = ReturnType<typeof createTraceStore>;
