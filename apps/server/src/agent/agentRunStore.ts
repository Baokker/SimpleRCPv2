import fs from "node:fs/promises";
import path from "node:path";
import type { AgentRun } from "@simplercp/shared";
import { nanoid } from "nanoid";

interface AgentRunFile {
  version: 1;
  run: AgentRun;
}

export function createAgentRunStore(projectId: string, projectRoot: string) {
  const runsRoot = path.join(projectRoot, "agent-runs");
  const runs = new Map<string, AgentRun>();
  let loaded = false;
  let operations = Promise.resolve();

  async function ensureLoaded() {
    if (loaded) return;
    const entries = await readDirectory(runsRoot);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const run = await readRun(path.join(runsRoot, entry.name, "run.json"));
      if (run.projectId !== projectId || run.id !== entry.name) {
        throw new Error("Invalid Agent run file");
      }
      runs.set(run.id, run);
    }
    loaded = true;
  }

  async function save(run: AgentRun) {
    const storagePath = path.join(runsRoot, run.id, "run.json");
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    const nextPath = `${storagePath}.next`;
    await fs.writeFile(
      nextPath,
      `${JSON.stringify({ version: 1, run } satisfies AgentRunFile, null, 2)}\n`,
      "utf8"
    );
    await fs.rename(nextPath, storagePath);
  }

  return {
    get runsRoot() {
      return runsRoot;
    },
    async create(input: Omit<AgentRun, "id" | "createdAt">) {
      await ensureLoaded();
      const run: AgentRun = {
        ...input,
        id: nanoid(12),
        createdAt: new Date().toISOString()
      };
      operations = operations.then(async () => {
        await save(run);
        runs.set(run.id, run);
      });
      await operations;
      return { ...run };
    },
    async get(runId: string) {
      await ensureLoaded();
      const run = runs.get(runId);
      return run ? { ...run } : undefined;
    },
    async list() {
      await ensureLoaded();
      return [...runs.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((run) => ({ ...run }));
    },
    async update(runId: string, update: Partial<AgentRun>) {
      await ensureLoaded();
      let result: AgentRun | undefined;
      operations = operations.then(async () => {
        const current = runs.get(runId);
        if (!current) throw new Error("Agent run not found");
        const next = { ...current, ...update, id: current.id };
        await save(next);
        runs.set(runId, next);
        result = next;
      });
      await operations;
      if (!result) throw new Error("Agent run not found");
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

async function readRun(storagePath: string) {
  const parsed = JSON.parse(await fs.readFile(storagePath, "utf8")) as AgentRunFile;
  if (parsed.version !== 1 || !parsed.run?.id || !parsed.run.projectId) {
    throw new Error("Invalid Agent run file");
  }
  return parsed.run;
}

export type AgentRunStore = ReturnType<typeof createAgentRunStore>;
