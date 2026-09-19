import fs from "node:fs/promises";
import path from "node:path";
import type { AgentSession } from "@simplercp/shared";
import { nanoid } from "nanoid";

interface AgentSessionFile {
  version: 1;
  session: AgentSession;
}

export function createAgentSessionStore(projectId: string, projectRoot: string) {
  const sessionsRoot = path.join(projectRoot, "agent-sessions");
  const sessions = new Map<string, AgentSession>();
  let loaded = false;
  let operations = Promise.resolve();

  async function ensureLoaded() {
    if (loaded) return;
    const entries = await readDirectory(sessionsRoot);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const session = await readSession(
        path.join(sessionsRoot, entry.name, "session.json")
      );
      if (session.projectId !== projectId || session.id !== entry.name) {
        throw new Error("Invalid Agent session file");
      }
      sessions.set(session.id, session);
    }
    loaded = true;
  }

  async function save(session: AgentSession) {
    const storagePath = path.join(sessionsRoot, session.id, "session.json");
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    const nextPath = `${storagePath}.next`;
    await fs.writeFile(
      nextPath,
      `${JSON.stringify({ version: 1, session } satisfies AgentSessionFile, null, 2)}\n`,
      "utf8"
    );
    await fs.rename(nextPath, storagePath);
  }

  return {
    get sessionsRoot() {
      return sessionsRoot;
    },
    async create(input: Omit<AgentSession, "id" | "createdAt" | "updatedAt">) {
      await ensureLoaded();
      const now = new Date().toISOString();
      const session: AgentSession = {
        ...input,
        id: nanoid(12),
        createdAt: now,
        updatedAt: now
      };
      operations = operations.then(async () => {
        await save(session);
        sessions.set(session.id, session);
      });
      await operations;
      return { ...session };
    },
    async get(sessionId: string) {
      await ensureLoaded();
      const session = sessions.get(sessionId);
      return session ? { ...session } : undefined;
    },
    async list(memberId?: string) {
      await ensureLoaded();
      return [...sessions.values()]
        .filter((session) => !memberId || session.memberId === memberId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((session) => ({ ...session }));
    },
    async update(sessionId: string, update: Partial<AgentSession>) {
      await ensureLoaded();
      let result: AgentSession | undefined;
      operations = operations.then(async () => {
        const current = sessions.get(sessionId);
        if (!current) throw new Error("Agent session not found");
        const next: AgentSession = {
          ...current,
          ...update,
          id: current.id,
          projectId: current.projectId,
          memberId: current.memberId,
          updatedAt: new Date().toISOString()
        };
        await save(next);
        sessions.set(sessionId, next);
        result = next;
      });
      await operations;
      if (!result) throw new Error("Agent session not found");
      return { ...result };
    }
  };
}

async function readDirectory(directoryPath: string) {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readSession(storagePath: string) {
  const parsed = JSON.parse(await fs.readFile(storagePath, "utf8")) as AgentSessionFile;
  if (
    parsed.version !== 1 ||
    !parsed.session?.id ||
    !parsed.session.projectId ||
    !parsed.session.memberId ||
    !parsed.session.title
  ) {
    throw new Error("Invalid Agent session file");
  }
  return parsed.session;
}

export type AgentSessionStore = ReturnType<typeof createAgentSessionStore>;
