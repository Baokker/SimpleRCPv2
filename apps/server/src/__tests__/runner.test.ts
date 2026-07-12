import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { runWorkspaceCommand } from "../runner.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-runner-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node -e \"console.log('runner-ok')\""
      }
    })
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("runner", () => {
  it("runs whitelisted commands and records output", async () => {
    const events = createEventLog();
    const result = await runWorkspaceCommand({
      workspaceRoot: root,
      command: "npm test",
      whitelist: ["npm test"],
      events,
      roomId: "room-1",
      initiatorId: "human-1",
      timeoutMs: 10_000
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("runner-ok");
    const eventTypes = events.list().map((event) => event.type);
    expect(eventTypes[0]).toBe("command_started");
    expect(eventTypes).toContain("command_output");
    expect(eventTypes.at(-1)).toBe("command_completed");
  });

  it("runs quick whitelisted commands", async () => {
    const events = createEventLog();
    const result = await runWorkspaceCommand({
      workspaceRoot: root,
      command: "npm test",
      whitelist: ["npm test"],
      events,
      roomId: "room-1",
      initiatorId: "human-1",
      timeoutMs: 10_000
    });

    expect(result.exitCode).toBe(0);
    expect(events.list().map((event) => event.type)).toContain(
      "command_completed"
    );
  });

  it("rejects commands outside the whitelist", async () => {
    const events = createEventLog();
    await expect(
      runWorkspaceCommand({
        workspaceRoot: root,
        command: "rm -rf .",
        whitelist: ["npm test"],
        events,
        roomId: "room-1",
        initiatorId: "human-1",
        timeoutMs: 10_000
      })
    ).rejects.toThrow("Command is not authorized");
  });

  it("keeps ad hoc commands blocked in restricted mode", async () => {
    const events = createEventLog();

    await expect(
      runWorkspaceCommand({
        workspaceRoot: root,
        command: "node -e \"console.log('adhoc-ok')\"",
        whitelist: ["npm test"],
        commandMode: "restricted",
        events,
        roomId: "room-1",
        initiatorId: "human-1",
        timeoutMs: 10_000
      })
    ).rejects.toThrow("Command is not authorized");
  });

  it("allows ad hoc commands in unrestricted mode", async () => {
    const events = createEventLog();

    const result = await runWorkspaceCommand({
      workspaceRoot: root,
      command: "node -e \"console.log('adhoc-ok')\"",
      whitelist: ["npm test"],
      commandMode: "unrestricted",
      events,
      roomId: "room-1",
      initiatorId: "human-1",
      timeoutMs: 10_000
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("adhoc-ok");
  });
});
