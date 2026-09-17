import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectStatus,
  formatProjectStatus
} from "../src/projectStatus.js";

test("project status reports progress and the next task", () => {
  const status = createProjectStatus([
    { title: "Open the workspace", completed: true },
    { title: "Edit a file together", completed: false }
  ]);

  assert.deepEqual(status, {
    taskCount: 2,
    completedCount: 1,
    nextTask: "Edit a file together"
  });
});

test("formatted status is ready for terminal output", () => {
  const output = formatProjectStatus({
    taskCount: 2,
    completedCount: 1,
    nextTask: "Edit a file together"
  });

  assert.equal(
    output,
    [
      "SimpleRCPv2 demo workspace",
      "Tasks: 2",
      "Completed: 1",
      "Next: Edit a file together"
    ].join("\n")
  );
});
