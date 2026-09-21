import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentRunStore } from "../agent/agentRunStore.js";
import { createTestWorkspace } from "./testWorkspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentRunStore", () => {
  it("preserves concurrent runs and their updates after restart", async () => {
    const root = await createTestWorkspace("agent-run-store-");
    roots.push(root);
    const projectRoot = path.join(root, "projects", "demo");
    const store = createAgentRunStore("demo", projectRoot);
    const input = {
      projectId: "demo",
      memberId: "member-a",
      prompt: "Change a file",
      status: "queued" as const,
      runtime: "opencode" as const,
      provider: "deepseek" as const,
      model: "deepseek-chat"
    };
    const [first, second] = await Promise.all([
      store.create(input),
      store.create({ ...input, memberId: "member-b" })
    ]);
    await Promise.all([
      store.update(first.id, { status: "running" }),
      store.update(first.id, { status: "completed", output: "Done" })
    ]);

    const reloaded = createAgentRunStore("demo", projectRoot);
    await expect(reloaded.get(first.id)).resolves.toMatchObject({
      id: first.id,
      status: "completed",
      output: "Done"
    });
    await expect(reloaded.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id }),
      expect.objectContaining({ id: second.id, memberId: "member-b" })
    ]));
  });
});
