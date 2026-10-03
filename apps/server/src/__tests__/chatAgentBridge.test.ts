import { describe, expect, it } from "vitest";
import { createChatStore } from "../chat.js";
import { createChatAgentBridge } from "../agent/chatAgentBridge.js";
import { createEventLog } from "../eventLog.js";

function createFixture(activeRun?: Record<string, unknown>) {
  const chat = createChatStore(createEventLog());
  const agent = {
    id: "team-session",
    projectId: "demo",
    memberId: "",
    scope: "team" as const,
    handle: "agent",
    title: "agent",
    runtime: "opencode" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const runs: Record<string, unknown>[] = activeRun ? [activeRun] : [];
  const createdRuns: Record<string, unknown>[] = [];
  const runtime = {
    room: { id: "room", members: [{ id: "member-a", displayName: "Alice", profileRole: "Developer" }] },
    rooms: { getMember() { return { id: "member-a", displayName: "Alice", profileRole: "Developer" }; } },
    chat
  };
  const agentRuns = {
    async listTeamAgents() { return [agent]; },
    async listRuns() { return runs; },
    async cancelRun(projectId: string, runId: string, memberId: string, interruptedBy: { runId: string; memberId: string } | undefined) {
      const run = runs.find((candidate) => candidate.id === runId);
      if (run) {
        run.status = "cancelled";
        run.interruptedByRunId = interruptedBy?.runId;
        run.interruptedByMemberId = interruptedBy?.memberId;
      }
      return run;
    },
    async createRun(input: Record<string, unknown>) {
      const run = { id: "new-run", status: "queued", ...input };
      createdRuns.push(run);
      runs.push(run);
      return run;
    }
  };
  const bridge = createChatAgentBridge({
    agentRuns: agentRuns as never,
    runtimeManager: { get() { return runtime; } } as never
  });
  return { chat, bridge, runs, createdRuns };
}

describe("chat Agent bridge", () => {
  it("creates a team run with requester role and discussion context", async () => {
    const fixture = createFixture();
    await fixture.chat.createMessage({ roomId: "room", authorId: "member-b", authorName: "Bob", text: "Please check the README" });
    const message = await fixture.chat.createMessage({ roomId: "room", authorId: "member-a", authorName: "Alice", authorRole: "Developer", text: "@agent update the title" });
    await fixture.bridge.handleMessage("demo", message);
    expect(fixture.createdRuns[0]).toMatchObject({
      source: "chat",
      chatMessageId: message.id,
      extraPrompt: expect.stringContaining("Requested by Alice (Role: Developer)")
    });
    expect(fixture.createdRuns[0]?.extraPrompt).toContain("[Bob] Please check the README");
  });

  it("cancels an active run and starts a new run in the same session", async () => {
    const fixture = createFixture({
      id: "old-run",
      sessionId: "team-session",
      status: "running",
      memberName: "Alice",
      createdAt: "2026-01-01T00:00:00.000Z",
      fileChanges: [{ file: "README.md" }]
    });
    const message = await fixture.chat.createMessage({ roomId: "room", authorId: "member-a", authorName: "Bob", text: "@agent stop and inspect the tests" });
    await fixture.bridge.handleMessage("demo", message);
    expect(fixture.runs[0]).toMatchObject({ status: "cancelled" });
    expect(fixture.runs[0]).toMatchObject({
      interruptedByRunId: expect.any(String),
      interruptedByMemberId: "member-a"
    });
    expect(fixture.createdRuns[0]).toMatchObject({ sessionId: "team-session", runId: expect.any(String) });
    expect(fixture.createdRuns[0]).toMatchObject({ interruptsRunId: "old-run" });
    const extraPrompt = String(fixture.createdRuns[0]?.extraPrompt);
    expect(extraPrompt).toContain("Requested by Bob (Role: Developer)");
    await expect(fixture.chat.listMessages("room")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "system", agentSessionId: "team-session", runId: "old-run" }),
      expect.objectContaining({ kind: "system", text: expect.stringContaining("interrupted @agent") })
    ]));
  });
});
