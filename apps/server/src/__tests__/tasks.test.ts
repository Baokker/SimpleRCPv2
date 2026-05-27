import { describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { createTaskStore } from "../tasks.js";

describe("task authorization", () => {
  it("allows authorized file paths and commands", () => {
    const events = createEventLog();
    const tasks = createTaskStore(events);
    const task = tasks.createTask({
      roomId: "room-1",
      title: "Update greeting",
      description: "Change hello text",
      creatorId: "human-1",
      assigneeId: "agent-1",
      editablePaths: ["src/**", "tests/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "Tests pass"
    });

    expect(tasks.canEdit(task.id, "src/hello.ts")).toBe(true);
    expect(tasks.canRunCommand(task.id, "npm test")).toBe(true);
    expect(tasks.canEdit(task.id, "package.json")).toBe(false);
    expect(tasks.canRunCommand(task.id, "rm -rf .")).toBe(false);
  });
});
