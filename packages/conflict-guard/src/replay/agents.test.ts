import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { replayAgentTrace } from "./agents.js";
import { textDiffOps } from "../tracking/textDiff.js";
import type { TraceEvent } from "../trace/trace.js";

it("recomputes different interruption counts with deterministic owner arbitration", async () => {
  const first = { kind: "agent" as const, runId: "first", ownerId: "alice" };
  const second = { kind: "agent" as const, runId: "second", ownerId: "bob" };
  const same = { kind: "agent" as const, runId: "same", ownerId: "alice" };
  const before = "export function price(value: number) { return value; }\n";
  const after = before.replace("value: number", "value: number, currency: string");
  const consumer = 'import { price } from "./pricing";\nexport function total() { return price(10); }\n';
  const raw = [
    { at: 0, type: "session_start" },
    { at: 0, type: "doc_open", file: "pricing.ts", text: before },
    { at: 0, type: "doc_open", file: "cart.ts", text: consumer },
    ...[first, second, same].map((actor) => ({ at: 0, type: "intent_created", intent: { actor, owner: actor.ownerId, task: "Change total", plannedScope: [], actualScope: [], baseRevision: {}, taskRevision: 0, status: "planning" } })),
    { at: 10, type: "edit", file: "pricing.ts", origin: first, ops: textDiffOps(before, after) },
    { at: 2000, type: "agent_proposal", actor: second, requestId: "second-1", proposals: [{ file: "cart.ts", before: consumer, after: consumer.replace("price(10)", "price(20)") }] },
    { at: 2100, type: "agent_proposal", actor: same, requestId: "same-1", proposals: [{ file: "cart.ts", before: consumer, after: consumer.replace("price(10)", "price(30)") }] }
  ];
  const trace = raw.map((event, index) => ({ schema: 3, seq: index + 1, ...event })) as TraceEvent[];
  const counts: number[] = [];
  for (const mode of ["owner", "all-human", "all-auto"] as const) {
    const result = await replayAgentTrace(trace, { mode });
    expect(result.errors).toEqual([]);
    expect(result.actions).toHaveLength(2);
    expect(JSON.stringify(await replayAgentTrace(trace, { mode }))).toBe(JSON.stringify(result));
    counts.push(result.statistics.reduce((sum, member) => sum + member.interruptions, 0));
  }
  expect(counts).toEqual([2, 3, 0]);
});

it("rechecks Agent dependencies at T3 and preserves warning notifications", async () => {
  const actor = { kind: "agent" as const, runId: "consumer", ownerId: "bob" };
  const other = { kind: "agent" as const, runId: "producer", ownerId: "alice" };
  const before = "export function price(value: number) { return value; }\n";
  const after = before.replace("value: number", "value: number, currency: string");
  const consumer = 'import { price } from "./pricing";\nexport function total() { return price(10); }\n';
  const changed = consumer.replace("price(10)", "price(20)");
  const raw = [
    { at: 0, type: "session_start" },
    { at: 0, type: "project_snapshot", files: { "pricing.ts": before, "cart.ts": consumer } },
    { at: 0, type: "agent_run_started", actor, baseline: { "pricing.ts": before, "cart.ts": consumer } },
    { at: 0, type: "agent_run_started", actor: other, baseline: { "pricing.ts": before, "cart.ts": consumer } },
    { at: 100, type: "edit", file: "cart.ts", origin: actor, ops: textDiffOps(consumer, changed) },
    { at: 2000, type: "edit", file: "pricing.ts", origin: other, ops: textDiffOps(before, after) },
    { at: 4000, type: "agent_review", actor, proposals: [{ file: "cart.ts", before: consumer, after: changed }], writes: [{ file: "cart.ts", before: consumer, after: changed }], forceRevert: false },
    { at: 4100, type: "agent_notice", level: "light", notice: { id: "warning", memberId: "bob", at: 4100 } }
  ];
  const trace = raw.map((event, index) => ({ schema: 3, seq: index + 1, ...event })) as TraceEvent[];
  const result = await replayAgentTrace(trace, { mode: "owner" });
  expect(result.actions.some((entry) => entry.point === "T3")).toBe(true);
  expect(result.statistics.find((member) => member.memberId === "bob")?.light).toBe(1);
  expect(result.errors).toEqual([]);
  expect(JSON.stringify(await replayAgentTrace(trace, { mode: "owner" }))).toBe(JSON.stringify(result));
});

it("selects the last human modification for automatic arbitration", async () => {
  const alice = { kind: "human" as const, memberId: "alice" };
  const bob = { kind: "human" as const, memberId: "bob" };
  const before = "export function price(value: number) { return value; }\n";
  const after = before.replace("value: number", "value: number, currency: string");
  const consumer = 'import { price } from "./pricing";\nexport function total() { return price(10); }\n';
  const raw = [
    { at: 0, type: "session_start" },
    { at: 0, type: "project_snapshot", files: { "pricing.ts": before, "cart.ts": consumer } },
    { at: 0, type: "doc_open", file: "pricing.ts", text: before },
    { at: 0, type: "doc_open", file: "cart.ts", text: consumer },
    { at: 10, type: "edit", file: "pricing.ts", origin: alice, ops: textDiffOps(before, after) },
    { at: 2000, type: "edit", file: "cart.ts", origin: bob, ops: textDiffOps(consumer, consumer.replace("price(10)", "price(20)")) },
    { at: 10000, type: "session_end" }
  ];
  const trace = raw.map((event, index) => ({ schema: 3, seq: index + 1, ...event })) as TraceEvent[];
  const result = await replayAgentTrace(trace, { mode: "all-auto" });
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0]?.action).toMatchObject({ type: "reject-later", later: bob });
  expect(result.actions[0]?.at).toBe(3500);
});

it("replays injection only at run start and rejected edits and respects the recorded switch", async () => {
  const actor = { kind: "agent" as const, runId: "worker", ownerId: "bob" };
  const source = "export function price(value: number) { return value; }\n";
  const raw = [
    { at: 0, type: "session_start", intentInjection: true },
    { at: 0, type: "project_snapshot", files: { "pricing.ts": source } },
    { at: 0, type: "intent_created", intent: { actor, owner: "bob", task: "Change pricing.ts", plannedScope: [], actualScope: [], baseRevision: {}, taskRevision: 0, status: "planning" } },
    { at: 0, type: "agent_run_started", actor },
    { at: 100, type: "agent_proposal", actor, requestId: "worker-1", proposals: [{ file: "pricing.ts", before: source, after: `${source}// Agent note\n` }] }
  ];
  const trace = raw.map((event, index) => ({ schema: 3, seq: index + 1, ...event })) as TraceEvent[];
  const before = JSON.stringify(trace);
  const result = await replayAgentTrace(trace, { mode: "owner" });
  expect(result.injections).toHaveLength(1);
  expect(result.injections[0]?.at).toBe(0);
  expect(JSON.stringify(trace)).toBe(before);
  expect(JSON.stringify(await replayAgentTrace(trace, { mode: "owner" }))).toBe(JSON.stringify(result));
  trace[0]!.intentInjection = false;
  expect((await replayAgentTrace(trace, { mode: "owner" })).injections).toEqual([]);
});

function scopeTrace() {
  const producer = { kind: "agent" as const, runId: "producer", ownerId: "alice" };
  const consumer = { kind: "agent" as const, runId: "consumer", ownerId: "bob" };
  const price = "export function price(value: number) { return value; }\n";
  const changedPrice = price.replace("value: number", "value: number, currency: string");
  const cart = 'import { price } from "./pricing";\nexport function total() { return price(10); }\nexport function unrelated() { return "ok"; }\n';
  const changedCart = cart.replace('return "ok"', 'return "done"');
  const raw = [
    { at: 0, type: "session_start", intentInjection: true },
    { at: 0, type: "project_snapshot", files: { "pricing.ts": price, "cart.ts": cart } },
    ...[producer, consumer].map((actor) => ({ at: 0, type: "intent_created", intent: { actor, owner: actor.ownerId, task: "Change cart.ts", plannedScope: [], actualScope: [], baseRevision: {}, taskRevision: 0, status: "planning" } })),
    { at: 0, type: "agent_run_started", actor: producer },
    { at: 0, type: "agent_run_started", actor: consumer },
    { at: 10, type: "intent_updated", reason: "plan", intent: { actor: consumer, plannedScope: ["cart.ts#unrelated"] } },
    { at: 20, type: "edit", file: "pricing.ts", origin: producer, ops: textDiffOps(price, changedPrice) },
    { at: 2000, type: "agent_proposal", actor: consumer, requestId: "rejected", proposals: [{ file: "cart.ts", before: cart, after: cart.replace("price(10)", "price(20)") }] },
    { at: 2100, type: "session_checkpoint" }
  ];
  return { consumer, cart, changedCart, trace: raw.map((event, index) => ({ schema: 3, seq: index + 1, ...event })) as TraceEvent[] };
}

it("keeps rejected proposals outside the actual scope of a later attributed write", async () => {
  const { consumer, cart, changedCart, trace } = scopeTrace();
  trace.push(...[
    { at: 2200, type: "agent_proposal", actor: consumer, requestId: "approved", proposals: [{ file: "cart.ts", before: cart, after: changedCart }] },
    { at: 2300, type: "agent_write_attributed", actor: consumer, file: "cart.ts", contentHash: createHash("sha256").update(changedCart).digest("hex") },
    { at: 2301, type: "edit", origin: consumer, file: "cart.ts", ops: textDiffOps(cart, changedCart) }
  ].map((event, index) => ({ schema: 3, seq: trace.length + index + 1, ...event })) as TraceEvent[]);
  const result = await replayAgentTrace(trace, { mode: "all-auto" });
  expect(result.actions[0]?.action).toMatchObject({ type: "reject-later" });
  expect(result.intents.find((intent) => intent.actor.runId === consumer.runId)).toMatchObject({ actualScope: ["cart.ts#unrelated"], taskRevision: 0, status: "running" });
  expect(result.errors).toEqual([]);
  expect(await replayAgentTrace(trace, { mode: "all-auto" })).toEqual(result);
});

it("uses the attributed edit when formatting changes the proposed content hash", async () => {
  const { consumer, cart, changedCart, trace } = scopeTrace();
  const formatted = changedCart.replace('unrelated() { return "done"; }', 'unrelated() {\n  return "done";\n}');
  trace.push(...[
    { at: 2200, type: "agent_proposal", actor: consumer, requestId: "approved", proposals: [{ file: "cart.ts", before: cart, after: changedCart }] },
    { at: 2300, type: "reservation_mismatch", actor: consumer, file: "cart.ts", expectedHash: createHash("sha256").update(changedCart).digest("hex"), actualHash: createHash("sha256").update(formatted).digest("hex") },
    { at: 2301, type: "agent_write_attributed", actor: consumer, file: "cart.ts", contentHash: createHash("sha256").update(formatted).digest("hex") },
    { at: 2302, type: "edit", origin: consumer, file: "cart.ts", ops: textDiffOps(cart, formatted) }
  ].map((event, index) => ({ schema: 3, seq: trace.length + index + 1, ...event })) as TraceEvent[]);
  const result = await replayAgentTrace(trace, { mode: "all-auto" });
  expect(result.intents.find((intent) => intent.actor.runId === consumer.runId)).toMatchObject({ actualScope: ["cart.ts#unrelated"], taskRevision: 0, status: "running" });
  expect(result.errors).toEqual([]);
});

it("derives blocked intent states from the replayed owner card and releases both participants", async () => {
  const { trace } = scopeTrace();
  const blocked = await replayAgentTrace(trace, { mode: "owner" });
  expect(blocked.intents.map((intent) => intent.status)).toEqual(["blocked", "blocked"]);
  const card = blocked.cards[0]!;
  trace.push(...[
    { at: 2200, type: "arbitration_updated", card: { ...card, suggestionStatus: "ready", suggestion: "保留旧调用方式作为重载。" } },
    { at: 2300, type: "ui_action", action: "arbitration_accept", pairId: card.conflict.pairId, memberId: "alice" },
    { at: 2400, type: "ui_action", action: "arbitration_accept", pairId: card.conflict.pairId, memberId: "bob" },
    { at: 2500, type: "session_checkpoint" }
  ].map((event, index) => ({ schema: 3, seq: trace.length + index + 1, ...event })) as TraceEvent[]);
  const released = await replayAgentTrace(trace, { mode: "owner" });
  expect(released.cards[0]?.status).toBe("accepted");
  expect(released.intents.map((intent) => intent.status)).toEqual(["running", "running"]);
  expect(released.errors).toEqual([]);
  expect((await replayAgentTrace(trace, { mode: "all-auto" })).intents.find((intent) => intent.actor.runId === "consumer")?.status).toBe("running");
});

it("keeps intents blocked when another related proposal reuses a waiting card", async () => {
  const { consumer, cart, trace } = scopeTrace();
  trace.push({ schema: 3, seq: trace.length + 1, at: 2200, type: "agent_proposal", actor: consumer, requestId: "repeated", proposals: [{ file: "cart.ts", before: cart, after: cart.replace("price(10)", "price(30)") }] });
  const result = await replayAgentTrace(trace, { mode: "owner" });
  expect(result.cards).toHaveLength(1);
  expect(result.intents.map((intent) => intent.status)).toEqual(["blocked", "blocked"]);
});

it("keeps a shared participant blocked until both owner cards are resolved", async () => {
  const { cart, trace } = scopeTrace();
  const third = { kind: "agent" as const, runId: "third", ownerId: "charlie" };
  trace.push(...[
    { at: 2200, type: "intent_created", intent: { actor: third, owner: third.ownerId, task: "Change total", baseRevision: {} } },
    { at: 2200, type: "agent_run_started", actor: third },
    { at: 2300, type: "agent_proposal", actor: third, requestId: "third", proposals: [{ file: "cart.ts", before: cart, after: cart.replace("price(10)", "price(30)") }] },
    { at: 2400, type: "session_checkpoint" }
  ].map((event, index) => ({ schema: 3, seq: trace.length + index + 1, ...event })) as TraceEvent[]);
  const blocked = await replayAgentTrace(trace, { mode: "owner" });
  expect(blocked.cards).toHaveLength(2);
  const first = blocked.cards.find((card) => card.conflict.self.kind === "agent" && card.conflict.self.runId === "consumer")!;
  const second = blocked.cards.find((card) => card.conflict.self.kind === "agent" && card.conflict.self.runId === "third")!;
  trace.push({ schema: 3, seq: trace.length + 1, at: 2500, type: "ui_action", action: "arbitration_yield", pairId: first.conflict.pairId, memberId: "bob" });
  const waiting = await replayAgentTrace(trace, { mode: "owner" });
  expect(waiting.intents.find((intent) => intent.actor.runId === "producer")?.status).toBe("blocked");
  expect(waiting.cards.find((card) => card.id === second.id)?.status).toBe("waiting");
  trace.push({ schema: 3, seq: trace.length + 1, at: 2600, type: "ui_action", action: "arbitration_yield", pairId: second.conflict.pairId, memberId: "charlie" });
  const released = await replayAgentTrace(trace, { mode: "owner" });
  expect(released.intents.find((intent) => intent.actor.runId === "producer")?.status).toBe("running");
  expect(released.errors).toEqual([]);
  expect(await replayAgentTrace(trace, { mode: "owner" })).toEqual(released);
});
