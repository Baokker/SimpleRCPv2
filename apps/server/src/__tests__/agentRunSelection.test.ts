import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentRunStore } from "../agent/agentRunStore.js";
import { createAgentSessionStore } from "../agent/agentSessionStore.js";
import { selectRunnableAgentRun } from "../agent/agentRunSelection.js";
import { getCompletedOverlapGroup, type AgentSchedulerQueue } from "../agent/agentScheduler.js";
import { createTestWorkspace } from "./testWorkspace.js";

describe("Agent queued run selection", () => {
  let root: string;
  beforeEach(async () => { root = await createTestWorkspace("agent-selection-"); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it.each([undefined, "removed-session"])("selects an invalid session %s for terminal failure instead of keeping it queued", async (sessionId) => {
    const runs = createAgentRunStore("project", root);
    const sessions = createAgentSessionStore("project", root);
    const run = await runs.create({ projectId: "project", memberId: "alice", prompt: "task", status: "queued", runtime: "opencode", provider: "deepseek", model: "deepseek-chat", sessionId });
    const queue: AgentSchedulerQueue = { runIds: [run.id], processing: false, activeRunIds: new Set(), activeSessionIds: new Set(), runningPromises: new Set(), workspacePreparing: false, rescanRequested: false, closing: false };
    expect(await selectRunnableAgentRun({ queue, runs, sessions, workspacePath: root })).toEqual({ runId: run.id, sessionId: sessionId ?? `missing:${run.id}`, requiresWorkspacePreparation: false });
  });

  it("retains a chain of overlapping ledgers until all connected runs finish", () => {
    const overlaps = new Map([["first", new Set(["middle"])], ["middle", new Set(["first", "last"])], ["last", new Set(["middle"])]]);
    expect(getCompletedOverlapGroup("first", overlaps, new Set(["middle"]))).toEqual([]);
    expect(getCompletedOverlapGroup("middle", overlaps, new Set(["last"]))).toEqual([]);
    expect(new Set(getCompletedOverlapGroup("last", overlaps, new Set()))).toEqual(new Set(["first", "middle", "last"]));
  });
});
