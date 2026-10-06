import { describe, expect, it } from "vitest";
import { createAgentSessionOperations } from "../agent/agentSessionOperations.js";

describe("Agent session operations", () => {
  it("serializes one session and releases it after an error", async () => {
    const sessions = createAgentSessionOperations();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const first = sessions.run("session-a", async () => { events.push("first-start"); await waiting; events.push("first-end"); });
    const second = sessions.run("session-a", async () => { events.push("second"); });
    await sessions.run("session-b", async () => { events.push("other-session"); });
    expect(events).toEqual(["first-start", "other-session"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "other-session", "first-end", "second"]);
    await expect(sessions.run("session-a", async () => { throw new Error("Operation failed"); })).rejects.toThrow("Operation failed");
    await expect(sessions.run("session-a", async () => "available")).resolves.toBe("available");
  });
});
