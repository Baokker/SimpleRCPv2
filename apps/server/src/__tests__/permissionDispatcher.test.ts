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
    expect(replies).toEqual([{ requestId: "request-1", sessionId: "session-1", reply: "reject", message: expect.stringContaining("handler unavailable") }]);
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

  it("shares a repeated request while its permission reply is pending", async () => {
    let release!: () => void;
    let replied!: () => void;
    const replyStarted = new Promise<void>((resolve) => { replied = resolve; });
    const replyFinished = new Promise<void>((resolve) => { release = resolve; });
    let handled = 0;
    const replies: string[] = [];
    const dispatcher = createPermissionDispatcher({
      handlers: [async () => { handled += 1; return { reply: "once" }; }],
      reply: async ({ reply }) => { replies.push(reply); replied(); await replyFinished; },
      trace: async () => {}
    });
    const request = { id: "pending-reply", sessionID: "session-1", permission: "edit", metadata: {} };
    const first = dispatcher.dispatch(request);
    await replyStarted;
    const second = dispatcher.dispatch(request);
    release();
    await Promise.all([first, second]);
    expect(handled).toBe(1);
    expect(replies).toEqual(["once"]);
  });

  it("processes another empty-handler request after the earlier reply completes", async () => {
    const replies: string[] = [];
    const dispatcher = createPermissionDispatcher({ handlers: [], reply: async ({ reply }) => { replies.push(reply); }, trace: async () => {} });
    const request = { id: "empty-reused", sessionID: "session-1", permission: "edit", metadata: {} };
    await dispatcher.dispatch(request);
    await dispatcher.dispatch(request);
    expect(replies).toEqual(["once", "once"]);
  });

  it("rejects after cancellation during approval and releases the proposal", async () => {
    let approving!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { approving = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const replies: string[] = [];
    let discarded = 0;
    const dispatcher = createPermissionDispatcher({
      handlers: [async () => ({ reply: "once", onApproved: async () => { approving(); await pending; }, onRejected: () => { discarded += 1; } })],
      reply: async ({ reply }) => { replies.push(reply); },
      trace: async () => {}
    });
    const completion = dispatcher.dispatch({ id: "cancel-approval", sessionID: "session-1", permission: "edit", metadata: {} });
    await started;
    dispatcher.dispose();
    await completion;
    release();
    expect(replies).toEqual(["reject"]);
    expect(discarded).toBe(1);
  });

  it("rejects and replies when pausing approval throws", async () => {
    const replies: Array<{ requestId: string; reply: string; message?: string }> = [];
    const dispatcher = createPermissionDispatcher({
      handlers: [async () => ({ reply: "once" })],
      pause: () => { throw new Error("pause unavailable"); },
      reply: async (reply) => { replies.push(reply); },
      trace: async () => {}
    });

    await dispatcher.dispatch({ id: "pause-error", sessionID: "session-1", permission: "edit", metadata: {} });

    expect(replies).toEqual([{ requestId: "pause-error", sessionId: "session-1", reply: "reject", message: expect.stringContaining("pause unavailable") }]);
  });

  it("keeps the permission reply when resuming approval throws", async () => {
    const replies: string[] = [];
    const traces: string[] = [];
    const dispatcher = createPermissionDispatcher({
      handlers: [],
      pause: () => () => { throw new Error("resume unavailable"); },
      reply: async ({ reply }) => { replies.push(reply); },
      trace: async (type) => { traces.push(type); }
    });

    await dispatcher.dispatch({ id: "resume-error", sessionID: "session-1", permission: "edit", metadata: {} });

    expect(replies).toEqual(["once"]);
    expect(traces).toContain("permission_resume_error");
  });

  it("defers one permission while other requests complete and rejects deferred requests on dispose", async () => {
    const replies: Array<{ requestId: string; reply: string }> = [];
    const dispatcher = createPermissionDispatcher({
      handlers: [{ handle: async (request) => ({ reply: request.id === "deferred" ? "defer" : "once" }), budgetMs: 1000 }],
      reply: async (reply) => { replies.push(reply); }, trace: async () => {}
    });
    const deferred = dispatcher.dispatch({ id: "deferred", sessionID: "child", permission: "edit", metadata: {} });
    await dispatcher.dispatch({ id: "other", sessionID: "root", permission: "edit", metadata: {} });
    expect(replies).toEqual([{ requestId: "other", sessionId: "root", reply: "once" }]);
    dispatcher.dispose();
    await deferred;
    expect(replies.at(-1)).toMatchObject({ requestId: "deferred", sessionId: "child", reply: "reject" });
  });

  it("resolves a deferred permission and applies the handler-specific deadline", async () => {
    const replies: string[] = [];
    const dispatcher = createPermissionDispatcher({ handlers: [{ handle: async () => ({ reply: "defer" }), budgetMs: 30 }], reply: async ({ reply }) => { replies.push(reply); }, trace: async () => {} });
    const first = dispatcher.dispatch({ id: "resolve", sessionID: "root", permission: "edit", metadata: {} });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(dispatcher.resolve("resolve", { reply: "once" })).toBe(true);
    await first;
    await dispatcher.dispatch({ id: "deadline", sessionID: "root", permission: "edit", metadata: {} });
    expect(replies).toEqual(["once", "reject"]);
  });

  it("stops repeated internal failures on one file and notifies the owner once", async () => {
    const replies: string[] = []; const notices: string[] = [];
    const dispatcher = createPermissionDispatcher({ handlers: [async () => { throw new Error("Cannot reconstruct edit"); }], reply: async ({ message }) => { replies.push(message!); }, trace: async () => {}, unavailable: (file) => { notices.push(file); } });
    for (const id of ["first", "second", "third", "fourth"]) await dispatcher.dispatch({ id, sessionID: "root", permission: "edit", metadata: { filepath: "src/cart.ts" } });
    expect(replies[0]).toContain("Cannot reconstruct edit");
    expect(replies[2]).toContain("冲突检查暂不可用，请停止修改此文件并向用户报告");
    expect(notices).toEqual(["src/cart.ts"]);
  });
  it("limits failures raised while normalizing a permission's file path", async () => {
    let normalizations = 0;
    const notices: string[] = [];
    const replies: string[] = [];
    const dispatcher = createPermissionDispatcher({ handlers: [], fileKey: () => { normalizations += 1; throw new Error("Path escapes workspace root"); }, reply: async ({ message }) => { replies.push(message!); }, trace: async () => {}, unavailable: (file) => { notices.push(file); } });
    for (const id of ["first", "second", "third", "fourth"]) await dispatcher.dispatch({ id, sessionID: "root", permission: "edit", metadata: { filepath: "outside.ts" } });
    expect(normalizations).toBe(2);
    expect(replies[2]).toContain("冲突检查暂不可用，请停止修改此文件并向用户报告");
    expect(notices).toEqual(["outside.ts"]);
  });
  it("applies the defer deadline to a handler without a judgement budget", async () => {
    const replies: string[] = [];
    const dispatcher = createPermissionDispatcher({ handlers: [{ handle: async () => ({ reply: "defer" }), budgetMs: null }], deferBudgetMs: 20, reply: async ({ reply }) => { replies.push(reply); }, trace: async () => {} });
    await dispatcher.dispatch({ id: "defer-timeout", sessionID: "child", permission: "edit", metadata: {} });
    expect(replies).toEqual(["reject"]);
    expect(dispatcher.resolve("defer-timeout", { reply: "once" })).toBe(false);
  });
  it("accepts an immediate deferred resolution and preserves approval cleanup", async () => {
    const replies: string[] = [];
    let approvals = 0;
    const dispatcher = createPermissionDispatcher({ handlers: [async () => ({ reply: "defer", onApproved: () => { approvals += 1; } })], trace: async (type) => { if (type === "permission_deferred") expect(dispatcher.resolve("immediate", { reply: "once" })).toBe(true); }, reply: async ({ reply }) => { replies.push(reply); } });
    await dispatcher.dispatch({ id: "immediate", sessionID: "child", permission: "edit", metadata: {} });
    expect(replies).toEqual(["once"]);
    expect(approvals).toBe(1);
  });
});
