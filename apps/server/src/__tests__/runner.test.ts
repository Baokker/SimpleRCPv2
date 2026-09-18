import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { runWorkspaceCommand } from "../runner.js";
import { createTestWorkspace } from "./testWorkspace.js";

let root: string;

beforeEach(async () => {
  root = await createTestWorkspace("runner-");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("runner", () => {
  it("runs any submitted command and records output", async () => {
    const events = createEventLog();
    const result = await runWorkspaceCommand({
      workspaceRoot: root,
      command: "node -e \"console.log('adhoc-ok')\"",
      events,
      roomId: "room-1",
      initiatorId: "human-1",
      timeoutMs: 10_000
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("adhoc-ok");
    const eventTypes = events.list().map((event) => event.type);
    expect(eventTypes[0]).toBe("command_started");
    expect(eventTypes).toContain("command_output");
    expect(eventTypes.at(-1)).toBe("command_completed");
    expect(events.list().at(-1)?.payload).toMatchObject({
      command: "node -e \"console.log('adhoc-ok')\"",
      exitCode: 0,
      durationMs: expect.any(Number),
      startedAt: expect.any(String)
    });
  });
});
