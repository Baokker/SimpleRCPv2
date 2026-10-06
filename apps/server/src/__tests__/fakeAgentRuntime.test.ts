import { describe, expect, it } from "vitest";
import { createFakeAgentRuntime } from "../agent/fakeAgentRuntime.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createTestWorkspace } from "./testWorkspace.js";

describe("fake Agent runtime fault isolation", () => {
  it("waits for a single approval, records rejection and retries the declared compatible edit", async () => {
    const root = await createTestWorkspace("agent-permission-runtime-");
    const runtime = createFakeAgentRuntime({ editPermission: "ask" });
    try {
      await fs.writeFile(path.join(root, "value.ts"), "const value = 1;\n");
      let count = 0;
      const events: string[] = [];
      const stop = await runtime.subscribe({ workspacePath: root, sessionId: "edit-session" }, async (event) => {
        events.push(event.type);
        if (event.type === "permission.asked") {
          expect(await fs.readFile(path.join(root, "value.ts"), "utf8")).toBe("const value = 1;\n");
          count += 1;
          await runtime.replyPermission!({ workspacePath: root, sessionId: "edit-session", requestId: String(event.data.id), reply: count === 1 ? "reject" : "once", message: count === 1 ? "signature changed" : undefined });
        }
      });
      await runtime.run({ workspacePath: root, sessionId: "edit-session", prompt: "fake-edit=value.ts:1=>2 fake-on-reject=value.ts:1=>3" });
      await stop();
      expect(count).toBe(2);
      expect(events).toContain("fake.permission_rejected");
      expect(await fs.readFile(path.join(root, "value.ts"), "utf8")).toBe("const value = 3;\n");
    } finally { await runtime.dispose(); await fs.rm(root, { recursive: true, force: true }); }
  });
  it("continues a run when one event listener fails", async () => {
    const runtime = createFakeAgentRuntime();
    const events: string[] = [];
    const listenerErrors: unknown[] = [];
    const stop = await runtime.subscribe({ workspacePath: ".", sessionId: "fake-session" }, async (event) => {
      events.push(event.type);
      if (event.type === "fake.started") throw new Error("listener failure");
    }, (error) => { listenerErrors.push(error); });
    await expect(runtime.run({ workspacePath: ".", sessionId: "fake-session", prompt: "fake-delay=1" })).resolves.toMatchObject({ text: expect.stringContaining("Fake Agent completed") });
    await stop();
    expect(events).toEqual(["fake.started", "fake.completed"]);
    expect(listenerErrors).toHaveLength(1);
    await runtime.dispose();
  });
});
