import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSessionStore } from "../agent/agentSessionStore.js";
import { createTestWorkspace } from "./testWorkspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentSessionStore", () => {
  it("persists sessions, filters by member, and updates activity order", async () => {
    const root = await createTestWorkspace("agent-session-store-");
    roots.push(root);
    const store = createAgentSessionStore("demo", path.join(root, "projects", "demo"));
    const first = await store.create({
      projectId: "demo",
      memberId: "member-a",
      memberName: "Ada",
      title: "Fix login",
      runtime: "opencode"
    });
    const second = await store.create({
      projectId: "demo",
      memberId: "member-b",
      memberName: "Linus",
      title: "Write tests",
      runtime: "opencode"
    });

    await store.update(first.id, { runtimeSessionId: "runtime-1", lastRunId: "run-1" });

    await expect(store.list("member-a")).resolves.toEqual([
      expect.objectContaining({ id: first.id, title: "Fix login", runtimeSessionId: "runtime-1" })
    ]);
    await expect(store.list("member-b")).resolves.toEqual([
      expect.objectContaining({ id: second.id, title: "Write tests" })
    ]);

    const reloaded = createAgentSessionStore("demo", path.join(root, "projects", "demo"));
    await expect(reloaded.get(first.id)).resolves.toMatchObject({
      id: first.id,
      runtimeSessionId: "runtime-1",
      lastRunId: "run-1"
    });
  });

  it("retains sessions created concurrently after restarting", async () => {
    const root = await createTestWorkspace("agent-session-store-");
    roots.push(root);
    const projectRoot = path.join(root, "projects", "demo");
    const store = createAgentSessionStore("demo", projectRoot);
    const input = {
      projectId: "demo",
      memberId: "member-a",
      title: "First task",
      runtime: "opencode" as const
    };
    const [first, second] = await Promise.all([
      store.create(input),
      store.create({ ...input, title: "Second task" })
    ]);

    const reloaded = createAgentSessionStore("demo", projectRoot);
    await expect(reloaded.list("member-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, title: "First task" }),
      expect.objectContaining({ id: second.id, title: "Second task" })
    ]));
  });
});
