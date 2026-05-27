import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMockAgentTask } from "../agents/mockAgent.js";
import { createEventLog } from "../eventLog.js";
import { createTaskStore } from "../tasks.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-agent-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "hello.ts"),
    "export const hello = 'world';\n"
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node -e \"console.log('agent-test-ok')\""
      }
    })
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("mock agent", () => {
  it("edits authorized file, runs authorized command, and reports", async () => {
    const events = createEventLog();
    const tasks = createTaskStore(events);
    const task = tasks.createTask({
      roomId: "room-1",
      title: "Update greeting",
      description: "Change greeting text",
      creatorId: "human-1",
      assigneeId: "agent-1",
      editablePaths: ["src/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "Tests pass"
    });

    const report = await runMockAgentTask({
      workspaceRoot: root,
      events,
      tasks,
      taskId: task.id,
      agentId: "agent-1"
    });

    await expect(
      fs.readFile(path.join(root, "src", "hello.ts"), "utf8")
    ).resolves.toContain("collaboration");
    expect(report.summary).toContain("MockAgent updated src/hello.ts");
    expect(events.list().map((event) => event.type)).toContain(
      "agent_reported"
    );
  });
});
