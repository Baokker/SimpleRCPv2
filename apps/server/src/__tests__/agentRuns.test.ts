import { describe, expect, it } from "vitest";
import { createAgentRunStore } from "../agentRuns.js";
import { createEventLog } from "../eventLog.js";

describe("agent run store", () => {
  it("creates and updates visible agent runs", () => {
    const events = createEventLog();
    const runs = createAgentRunStore(events);

    const run = runs.createRun({
      roomId: "room-1",
      agentId: "agent-mock",
      agentName: "MockAgent",
      triggerMessageId: "message-1",
      taskId: "task-1"
    });

    runs.updateStatus(run.id, "thinking", "Reading task context");
    runs.updateStatus(run.id, "completed", "MockAgent finished");

    expect(runs.listRuns("room-1")[0]).toMatchObject({
      status: "completed",
      lastAction: "MockAgent finished"
    });
    expect(events.list().map((event) => event.type)).toContain(
      "agent_run_updated"
    );
  });
});
