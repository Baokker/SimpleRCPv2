import { describe, expect, it } from "vitest";
import { createAgentScheduler, type AgentSchedulerQueue } from "../agent/agentScheduler.js";

function queue(): AgentSchedulerQueue {
  return { runIds: ["broken", "healthy"], processing: false, activeRunIds: new Set(), activeSessionIds: new Set(), runningPromises: new Set(), workspacePreparing: false, rescanRequested: false, closing: false };
}

describe("Agent scheduler fault isolation", () => {
  it("marks a run failed when selection throws and continues selecting the next run", async () => {
    const state = queue();
    const failed: string[] = [];
    let selectionCount = 0;
    const scheduler = createAgentScheduler({
      maxConcurrentRuns: 1,
      isClosing: () => false,
      getQueue: () => state,
      findRunnableRun: async () => {
        selectionCount += 1;
        if (selectionCount === 1) throw new Error("selection failure");
        if (state.runIds.includes("healthy")) return { runId: "healthy", sessionId: "healthy-session", requiresWorkspacePreparation: false };
        return undefined;
      },
      onRunStart: () => () => undefined,
      executeRun: async (_projectId, runId) => { if (runId === "healthy") state.runIds = []; },
      onSchedulerError: async (_projectId, error, runId) => { if (runId) failed.push(`${runId}:${String(error)}`); }
    });
    await scheduler.processQueue("project");
    await Promise.all([...state.runningPromises]);
    expect(failed).toEqual(["broken:Error: selection failure"]);
    expect(state.activeRunIds).toEqual(new Set());
  });
});
