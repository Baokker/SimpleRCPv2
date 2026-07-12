import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentRunStore } from "../agentRuns.js";
import { createChatStore } from "../chat.js";
import { createEventLog } from "../eventLog.js";
import { createRoomStore } from "../rooms.js";
import { createScenarioService } from "../scenarios.js";
import { createTaskStore } from "../tasks.js";
import { createTimelineStore } from "../timeline.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-scenario-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "hello.ts"),
    "export const hello = 'world';\n"
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node -e \"console.log('scenario-ok')\""
      }
    })
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("scenario service", () => {
  it("runs the observable demo and records chat, edit, command, and success", async () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const tasks = createTaskStore(events);
    const chat = createChatStore(events);
    const agentRuns = createAgentRunStore(events);
    const timeline = createTimelineStore();
    const room = rooms.createRoom(root);
    const scenarios = createScenarioService({
      workspaceRoot: root,
      events,
      rooms,
      tasks,
      chat,
      agentRuns,
      timeline
    });

    const result = await scenarios.runScenario("observable-demo", room.id);

    expect(result.status).toBe("completed");
    expect(timeline.list(room.id).map((item) => item.type)).toEqual(
      expect.arrayContaining(["chat", "edit", "command", "result"])
    );
    expect(timeline.list(room.id).at(-1)).toMatchObject({
      type: "result",
      status: "completed"
    });
    await expect(
      fs.readFile(path.join(root, "src", "hello.ts"), "utf8")
    ).resolves.toContain("collaboration");
  });
});
