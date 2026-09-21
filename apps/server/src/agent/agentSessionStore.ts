import path from "node:path";
import type { AgentSession } from "@simplercp/shared";
import { nanoid } from "nanoid";
import { createRecordStore } from "./recordStore.js";

export function createAgentSessionStore(projectId: string, projectRoot: string) {
  const records = createRecordStore<AgentSession>({
    root: path.join(projectRoot, "agent-sessions"),
    projectId,
    fileName: "session.json",
    recordKey: "session",
    invalidMessage: "Invalid Agent session file",
    missingMessage: "Agent session not found",
    validateRecord(value): value is AgentSession {
      if (!value || typeof value !== "object") return false;
      const session = value as Record<string, unknown>;
      return typeof session.id === "string" &&
        typeof session.projectId === "string" &&
        typeof session.memberId === "string" &&
        typeof session.title === "string";
    }
  });

  return {
    create(input: Omit<AgentSession, "id" | "createdAt" | "updatedAt">) {
      const now = new Date().toISOString();
      return records.create({ ...input, id: nanoid(12), createdAt: now, updatedAt: now });
    },
    get: records.get,
    async list(memberId?: string) {
      return (await records.list())
        .filter((session) => !memberId || session.memberId === memberId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    update(sessionId: string, update: Partial<AgentSession>) {
      return records.update(sessionId, (current) => ({
        ...current,
        ...update,
        id: current.id,
        projectId: current.projectId,
        memberId: current.memberId,
        updatedAt: new Date().toISOString()
      }));
    }
  };
}

export type AgentSessionStore = ReturnType<typeof createAgentSessionStore>;
