import { describe, expect, test } from "vitest";
import { createPairCoordinator } from "./pairState.js";
import type { CandidatePair } from "../routing/candidates.js";

const pair: CandidatePair = { id: "p", left: { actor: { kind: "human", memberId: "a" }, symbol: "a.ts#run", status: "modified" }, right: { actor: { kind: "human", memberId: "b" }, symbol: "b.ts#call", status: "modified" }, distance: 1, path: { from: "a.ts#run", to: "b.ts#call", hops: [{ from: "a.ts#run", to: "b.ts#call", kind: "call", direction: "forward" }], typeOnly: false }, firstSeenAt: 1, updatedAt: 1 };
const verdict = { zone: "black" as const, decision: "lock" as const, ruleId: "call-signature-incompatible", summary: "冲突", evidence: [], contractChanged: { left: true, right: false } };

describe("变更对状态机", () => {
  test("pending judged stale judged and confirmed resolution", () => {
    let now = 1;
    const events: string[] = [];
    const coordinator = createPairCoordinator({ now: () => now, classify: () => verdict });
    coordinator.onEvent((event) => events.push(event.type));
    expect(coordinator.update([pair])[0]?.status).toBe("judged");
    coordinator.markChanged(pair.id);
    expect(coordinator.get(pair.id)?.status).toBe("stale");
    now = 5;
    coordinator.update([pair]);
    coordinator.confirm(pair.id, "left");
    coordinator.confirm(pair.id, "right");
    expect(coordinator.get(pair.id)?.resolution).toBe("overridden");
    expect(events).toEqual(["pair_judged", "pair_stale", "pair_judged", "pair_resolved"]);
  });
  test("重判放行后自动解除冻结", () => {
    let lock = true;
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => lock ? verdict : { ...verdict, zone: "white", decision: "allow", ruleId: "observability-only" } });
    coordinator.update([pair]);
    coordinator.markChanged(pair.id);
    lock = false;
    coordinator.update([pair]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "resolved", resolution: "auto-cleared", verdict: { decision: "allow" } });
  });
  test("双方确认后同一修订号不会再次判为冻结", () => {
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    coordinator.update([pair]);
    expect(coordinator.confirm(pair.id, "left")).toBe(true);
    expect(coordinator.confirm(pair.id, "right")).toBe(true);
    const events: string[] = [];
    coordinator.onEvent((event) => events.push(event.type));
    coordinator.update([pair]);
    expect(coordinator.get(pair.id)?.status).toBe("resolved");
    expect(events).toEqual([]);
  });
  test("候选消失后关闭并累计冻结时长", () => {
    let now = 1;
    const coordinator = createPairCoordinator({ now: () => now, classify: () => verdict });
    coordinator.update([pair]);
    now = 11;
    coordinator.update([]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "closed", totalLockMs: 10 });
  });
});
