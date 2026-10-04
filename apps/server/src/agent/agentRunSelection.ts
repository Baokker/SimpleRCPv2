import { statSync } from "node:fs";
import path from "node:path";
import type { AgentRunStore } from "./agentRunStore.js";
import type { AgentSessionStore } from "./agentSessionStore.js";
import type { AgentSchedulerQueue } from "./agentScheduler.js";

export async function selectRunnableAgentRun(options: {
  queue: AgentSchedulerQueue;
  runs: AgentRunStore;
  sessions: AgentSessionStore;
  workspacePath: string;
}) {
  const { queue, runs, sessions } = options;
  if (queue.workspacePreparing) return undefined;
  for (const runId of queue.runIds) {
    const run = await runs.get(runId);
    if (!run || run.status !== "queued") {
      queue.runIds = queue.runIds.filter((candidate) => candidate !== runId);
      continue;
    }
    const session = run.sessionId ? await sessions.get(run.sessionId) : undefined;
    // 无效会话交给 executeRun 写入终止状态和失败轨迹。
    if (!session) return { runId, sessionId: run.sessionId ?? `missing:${runId}`, requiresWorkspacePreparation: false };
    if (queue.activeSessionIds.has(session.id)) continue;
    const requiresWorkspacePreparation = session.scope === "team" && !statSync(path.join(options.workspacePath, ".git"), { throwIfNoEntry: false });
    if (requiresWorkspacePreparation && queue.activeRunIds.size > 0) return undefined;
    return { runId, sessionId: session.id, requiresWorkspacePreparation };
  }
  return undefined;
}
