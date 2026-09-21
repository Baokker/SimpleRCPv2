import path from "node:path";
import type { AgentRun } from "@simplercp/shared";
import { nanoid } from "nanoid";
import { createRecordStore } from "./recordStore.js";

export function createAgentRunStore(projectId: string, projectRoot: string) {
  const runsRoot = path.join(projectRoot, "agent-runs");
  const records = createRecordStore<AgentRun>({
    root: runsRoot,
    projectId,
    fileName: "run.json",
    recordKey: "run",
    invalidMessage: "Invalid Agent run file",
    missingMessage: "Agent run not found",
    validateRecord(value): value is AgentRun {
      if (!value || typeof value !== "object") return false;
      const run = value as Record<string, unknown>;
      return typeof run.id === "string" && typeof run.projectId === "string";
    }
  });

  return {
    runsRoot,
    create(input: Omit<AgentRun, "id" | "createdAt">) {
      return records.create({
        ...input,
        id: nanoid(12),
        createdAt: new Date().toISOString()
      });
    },
    get: records.get,
    async list() {
      return (await records.list()).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
      );
    },
    update(runId: string, update: Partial<AgentRun>) {
      return records.update(runId, (current) => ({ ...current, ...update, id: current.id }));
    }
  };
}

export type AgentRunStore = ReturnType<typeof createAgentRunStore>;
