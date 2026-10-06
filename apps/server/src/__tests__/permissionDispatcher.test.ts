import { describe, expect, it } from "vitest";
import { createPermissionDispatcher } from "../agent/permissionDispatcher.js";

describe("Agent permission dispatcher", () => {
  it("runs handlers in registration order and rejects on a handler failure without failing the run", async () => {
    const order: number[] = [];
    const replies: unknown[] = [];
    const traces: string[] = [];
    const dispatcher = createPermissionDispatcher({
      reply: async (reply) => { replies.push(reply); },
      trace: async (type) => { traces.push(type); },
      handlers: [async () => { order.push(1); return { reply: "once" }; }, async () => { order.push(2); throw new Error("handler unavailable"); }, async () => { order.push(3); return { reply: "once" }; }]
    });
    await dispatcher.dispatch({ id: "request-1", sessionID: "session-1", permission: "edit", metadata: {} });
    expect(order).toEqual([1, 2]);
    expect(replies).toEqual([{ requestId: "request-1", reply: "reject", message: expect.stringContaining("retry") }]);
    expect(traces).toContain("permission_handler_error");
  });

  it("approves once only after every handler approves and deduplicates a repeated request", async () => {
    const replies: string[] = [];
    let approved = 0;
    const dispatcher = createPermissionDispatcher({ reply: async ({ reply }) => { replies.push(reply); }, trace: async () => {}, handlers: [async () => ({ reply: "once", onApproved: () => { approved += 1; } }), async () => ({ reply: "once" })] });
    const request = { id: "request-2", sessionID: "session-1", permission: "edit", metadata: {} };
    await Promise.all([dispatcher.dispatch(request), dispatcher.dispatch(request)]);
    expect(replies).toEqual(["once"]);
    expect(approved).toBe(1);
  });

  it("finishes and disposes an empty handler list without an unhandled rejection", async () => {
    const replies: string[] = [];
    const dispatcher = createPermissionDispatcher({ handlers: [], reply: async ({ reply }) => { replies.push(reply); }, trace: async () => {} });
    await dispatcher.dispatch({ id: "empty", sessionID: "session-1", permission: "edit", metadata: {} });
    dispatcher.dispose();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(replies).toEqual(["once"]);
  });

  it("removes a completed request so a later request with the same id is processed again", async () => {
    let calls = 0;
    const replies: string[] = [];
    const dispatcher = createPermissionDispatcher({
      handlers: [async () => { calls += 1; return { reply: "once" }; }],
      reply: async ({ reply }) => { replies.push(reply); },
      trace: async () => {}
    });
    const request = { id: "reused", sessionID: "session-1", permission: "edit", metadata: {} };
    await dispatcher.dispatch(request);
    await dispatcher.dispatch(request);
    expect(calls).toBe(2);
    expect(replies).toEqual(["once", "once"]);
  });
});
