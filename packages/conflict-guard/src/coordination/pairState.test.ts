import { describe, expect, test } from "vitest";
import { createPairCoordinator } from "./pairState.js";
import type { CandidatePair } from "../routing/candidates.js";

const pair: CandidatePair = { id: "p", left: { actor: { kind: "human", memberId: "a" }, symbol: "a.ts#run", status: "modified" }, right: { actor: { kind: "human", memberId: "b" }, symbol: "b.ts#call", status: "modified" }, distance: 1, path: { from: "a.ts#run", to: "b.ts#call", hops: [{ from: "a.ts#run", to: "b.ts#call", kind: "call", direction: "forward" }], typeOnly: false }, firstSeenAt: 1, updatedAt: 1 };
const verdict = { zone: "black" as const, decision: "lock" as const, ruleId: "call-signature-incompatible", summary: "冲突", evidence: [], contractChanged: { left: true, right: false } };

describe("变更对状态机", () => {
  test("pending and stale inputs retain their revision across refreshes and temporary removal", () => {
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    const defer = () => false;
    coordinator.update([{ ...pair, revisionKey: "first" }], defer);
    coordinator.update([{ ...pair, revisionKey: "typing" }], defer);
    coordinator.update([]);
    coordinator.update([{ ...pair, revisionKey: "complete" }]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "judged", revision: 0 });
    coordinator.update([{ ...pair, revisionKey: "changed" }], defer);
    coordinator.update([{ ...pair, revisionKey: "typing-again" }], defer);
    coordinator.update([]);
    coordinator.update([{ ...pair, revisionKey: "complete-again" }]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "judged", revision: 1 });
  });
  test("grey analysis aborts on revision change and ignores late results", () => {
    const requests: Array<{ signal: AbortSignal; complete(value: typeof verdict): void }> = [];
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => ({ ...verdict, zone: "grey", decision: "warn" }), adjudicate(_pair, _local, signal, complete) { requests.push({ signal, complete }); } });
    coordinator.update([{ ...pair, revisionKey: "one" }]);
    expect(coordinator.get(pair.id)?.status).toBe("analyzing");
    coordinator.update([{ ...pair, revisionKey: "two" }]);
    expect(requests[0]?.signal.aborted).toBe(true);
    requests[0]?.complete(verdict);
    expect(coordinator.get(pair.id)?.status).toBe("analyzing");
    requests[1]?.complete(verdict);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "judged", revision: 1, verdict: { decision: "lock" } });
  });
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
  test("只在符号内容或关系路径变化时增加修订号", () => {
    let current = { ...pair, revisionKey: "same", updatedAt: 1 };
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    coordinator.update([current]);
    current = { ...current, updatedAt: 99 };
    coordinator.update([current]);
    expect(coordinator.get(pair.id)?.revision).toBe(0);
    current = { ...current, revisionKey: "changed" };
    coordinator.update([current]);
    expect(coordinator.get(pair.id)?.revision).toBe(1);
  });
  test("变更对重新出现时延续修订号", () => {
    const current = { ...pair, revisionKey: "same" };
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    coordinator.update([current]);
    coordinator.markChanged(pair.id);
    coordinator.update([]);
    coordinator.update([current]);
    expect(coordinator.get(pair.id)?.revision).toBe(1);
  });
  test("灰区同一修订只计算一次", () => {
    let count = 0;
    const current = { ...pair, revisionKey: "same" };
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => { count += 1; return { ...verdict, zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain" }; } });
    coordinator.update([current]);
    coordinator.update([{ ...current, updatedAt: 50 }]);
    expect(count).toBe(1);
  });
  test("双方确认的修订在变更对关闭后重新出现时继续有效", () => {
    const current = { ...pair, revisionKey: "same" };
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    coordinator.update([current]);
    coordinator.confirm(pair.id, "left");
    coordinator.confirm(pair.id, "right");
    coordinator.update([]);
    coordinator.update([{ ...current, updatedAt: 10 }]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "resolved", resolution: "overridden", revision: 0 });
  });
  test("a previous confirmation does not apply after closed revisions return to their original content", () => {
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    coordinator.update([{ ...pair, revisionKey: "original" }]);
    coordinator.confirm(pair.id, "left");
    coordinator.confirm(pair.id, "right");
    coordinator.update([]);
    coordinator.update([{ ...pair, revisionKey: "changed" }]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "judged", revision: 1, verdict: { decision: "lock" } });
    coordinator.update([]);
    coordinator.update([{ ...pair, revisionKey: "original" }]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "judged", revision: 2, verdict: { decision: "lock" }, leftConfirmed: false, rightConfirmed: false });
    expect(coordinator.get(pair.id)?.resolution).toBeUndefined();
  });
  test("关闭后不同内容重新出现时继续增加修订号", () => {
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    coordinator.update([{ ...pair, revisionKey: "first" }]);
    coordinator.update([]);
    coordinator.update([{ ...pair, revisionKey: "second" }]);
    expect(coordinator.get(pair.id)?.revision).toBe(1);
  });
  test("撤回后仍有候选关系时不保留撤回完成请求", () => {
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    coordinator.update([{ ...pair, revisionKey: "first" }]);
    coordinator.requestResolution(pair.id, "reverted");
    coordinator.update([{ ...pair, revisionKey: "second" }]);
    coordinator.update([]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "closed" });
    expect(coordinator.get(pair.id)?.resolution).toBeUndefined();
  });
});
