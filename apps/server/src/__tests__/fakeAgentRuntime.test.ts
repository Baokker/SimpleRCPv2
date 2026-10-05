import { describe, expect, it } from "vitest";
import { createFakeAgentRuntime } from "../agent/fakeAgentRuntime.js";

describe("fake Agent runtime fault isolation", () => {
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
