import { expect, it } from "vitest";
import { arbitrate, type Participant } from "./arbitration.js";
import { buildIntentInjection, createIntentBoard, parseAgentPlan } from "./intents.js";
import { createOwnerCards } from "./ownerCards.js";
import { VirtualClock } from "../replay/clock.js";
import { createSemanticIndex } from "../semantic/index.js";
import { MemoryFileProvider } from "../replay/files.js";
import type { GuardConflict } from "../model/types.js";

const alice: Participant = { kind: "human", memberId: "alice" };
const bob: Participant = { kind: "human", memberId: "bob" };
const first = { kind: "agent" as const, runId: "first", ownerId: "alice" };
const second = { kind: "agent" as const, runId: "second", ownerId: "bob" };
const lock = { zone: "black" as const, decision: "lock" as const };
it("arbitrates the five owner relationships and both controls", () => {
  for (const [left, right, type, recipients, lights] of [
    [alice, bob, "freeze-humans", ["alice", "bob"], []],
    [first, { ...second, ownerId: "alice" }, "retry-agent", [], []],
    [alice, first, "reject-agent", [], ["alice"]],
    [alice, second, "reject-agent", [], ["bob"]],
    [first, second, "owner-card", ["alice", "bob"], []]
  ] as const) {
    const action = arbitrate({ left, right, later: right }, lock);
    expect(action).toMatchObject({ type, recipients, lightRecipients: lights });
    expect(arbitrate({ left, right, later: right }, lock, "all-human").recipients).toEqual([...new Set([left.kind === "human" ? left.memberId : left.ownerId, right.kind === "human" ? right.memberId : right.ownerId])]);
    expect(arbitrate({ left, right, later: right }, lock, "all-auto")).toMatchObject({ type: "reject-later", recipients: [], lightRecipients: [] });
    expect(arbitrate({ left, right, later: right }, { zone: "grey", decision: "warn" }).type).toBe("continue");
  }
});
it("parses complete plans and advances task revisions for all three causes", () => {
  expect(parseAgentPlan("PLAN:\nsrc/a.ts#price\nEND_PLAN")).toEqual(["src/a.ts#price"]);
  expect(parseAgentPlan("PLAN:\n../a.ts#price\nEND_PLAN")).toEqual([]);
  expect(parseAgentPlan("No plan")).toEqual([]);
  const events: Array<[string, unknown, unknown?]> = [];
  const board = createIntentBoard({ changed: (...args) => { events.push(args); } });
  const baseRevision = {};
  board.create(first, "Change price", baseRevision);
  board.plan(first.runId, "PLAN:\nsrc/a.ts#price\nEND_PLAN");
  board.actual(first.runId, ["src/a.ts#price"]);
  expect(board.get(first.runId)?.taskRevision).toBe(0);
  board.actual(first.runId, ["src/a.ts#tax"]);
  board.actual(first.runId, ["src/a.ts#tax"]);
  board.task(first.runId, "Change tax"); board.basis(first.runId, "src/a.ts#price", 2); board.basis(first.runId, "src/a.ts#price", 2);
  expect(board.get(first.runId)?.taskRevision).toBe(3);
  expect(baseRevision).toEqual({});
  board.status(first.runId, "done"); expect(events.at(-1)?.[0]).toBe("intent_closed");
  board.statusForActors([first, alice], "blocked");
  expect(board.get(first.runId)?.status).toBe("done");
});
it("filters injected context with the semantic index and enforces both limits", () => {
  const files = new MemoryFileProvider({ "a.ts": "export function price() { return 1; }\nexport function total() { return price(); }\nexport function other() { return 0; }" });
  const index = createSemanticIndex({ files, now: () => 0 }); index.update();
  const options = { enabled: true, actor: second, scope: ["a.ts#total"], intents: [], changes: Array.from({ length: 9 }, (_, number) => ({ actor: alice, symbol: number === 0 ? "a.ts#other" : "a.ts#price", summary: "x".repeat(700) })), related: (left: string[], right: string[]) => index.findPaths(left, right, 2).length > 0, display: () => "Alice" };
  const input = buildIntentInjection(options);
  expect(input.text).not.toContain("a.ts#other"); expect(input.count).toBeLessThanOrEqual(5); expect(input.text.length).toBeLessThanOrEqual(1500);
  expect(buildIntentInjection({ ...options, enabled: false }).text).toBe("");
  expect(buildIntentInjection(options)).toEqual(input);
});
const conflict: GuardConflict = { pairId: "pair", revision: 1, self: second, other: first, otherDisplayName: "Alice 的 Agent", symbols: { self: "a.ts#total", other: "a.ts#price" }, beforeSignature: "price()", afterSignature: "price(currency: string)", ruleId: "call-signature-incompatible", zone: "black", decision: "lock", summaryZh: "调用签名不兼容。" };
it("requires both owners to accept and supports yield, timeout, and unavailable advice", async () => {
  const clock = new VirtualClock(); const resolved: string[] = []; const notices: unknown[] = [];
  const cards = createOwnerCards({ clock, timeoutMs: 50, changed() {}, notify(event) { notices.push(event); }, resolve(card) { resolved.push(card.status); }, error(error) { throw error; } });
  const card = cards.open(conflict, [], "total calls price");
  cards.suggestion(card.id);
  expect(() => cards.act(card.id, "alice", "accept")).toThrow("没有可采纳");
  cards.suggestion(card.id, { explanation: "需要兼容接口。", suggestion: "保留旧签名作为重载。" });
  cards.act(card.id, "alice", "accept"); expect(cards.list()[0]?.status).toBe("waiting");
  cards.act(card.id, "bob", "accept");
  const next = cards.open({ ...conflict, revision: 2 }, [], ""); cards.act(next.id, "alice", "yield");
  cards.open({ ...conflict, revision: 3 }, [], ""); clock.advanceTo(50);
  const closed = cards.open({ ...conflict, revision: 4 }, [], ""); cards.closeRun(second.runId);
  expect(cards.list().find((entry) => entry.id === closed.id)?.status).toBe("closed");
  await cards.dispose(); expect(resolved).toEqual(["accepted", "yielded", "timeout", "closed"]); expect(notices).toHaveLength(8);
});

it("keeps an owner card available while the other Agent is still active", async () => {
  const clock = new VirtualClock();
  const cards = createOwnerCards({ clock, changed() {}, notify() {}, resolve() {}, error(error) { throw error; } });
  const card = cards.open(conflict, [], "");
  cards.finishRun(first.runId);
  expect(cards.list()[0]?.status).toBe("waiting");
  cards.act(card.id, "alice", "yield");
  expect(cards.list()[0]?.status).toBe("yielded");
  const next = cards.open({ ...conflict, revision: 2 }, [], "");
  cards.finishRun(second.runId);
  expect(cards.list().find((entry) => entry.id === next.id)?.status).toBe("closed");
  await cards.dispose();
});
