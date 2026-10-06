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
