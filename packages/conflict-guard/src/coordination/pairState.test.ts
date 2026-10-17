import { describe, expect, test } from "vitest";
import { createJudgementQueue, createPairCoordinator } from "./pairState.js";
import { createSessionCoordinator } from "./session.js";
import { VirtualClock } from "../replay/clock.js";
import type { CandidatePair } from "../routing/candidates.js";

const pair: CandidatePair = { id: "p", left: { actor: { kind: "human", memberId: "a" }, symbol: "a.ts#run", status: "modified" }, right: { actor: { kind: "human", memberId: "b" }, symbol: "b.ts#call", status: "modified" }, distance: 1, path: { from: "a.ts#run", to: "b.ts#call", hops: [{ from: "a.ts#run", to: "b.ts#call", kind: "call", direction: "forward" }], typeOnly: false }, firstSeenAt: 1, updatedAt: 1 };
const verdict = { zone: "black" as const, decision: "lock" as const, ruleId: "call-signature-incompatible", summary: "冲突", evidence: [], contractChanged: { left: true, right: false } };

describe("变更对状态机", () => {
  test("人与 Agent 共用每帧上限，取消与关闭结束排队请求", () => {
    const clock = new VirtualClock();
    const queue = createJudgementQueue({ clock, frameMs: 200, maximum: 20 });
    const completed: string[] = [];
    for (const point of ["T1", "T2", "T3"]) for (let ordinal = 0; ordinal < 15; ordinal += 1) queue.enqueue(`${point}:${ordinal}`, () => completed.push(`${point}:${ordinal}`));
    clock.advanceTo(199);
    expect(completed).toHaveLength(0);
    clock.advanceTo(200);
    expect(completed).toHaveLength(20);
    expect(completed).toContain("T2:4");
    clock.advanceTo(400);
    expect(completed).toHaveLength(40);
    expect(completed).toContain("T3:9");
    const cancelled: string[] = [];
    queue.enqueue("cancelled", () => completed.push("cancelled"), () => cancelled.push("cancelled"));
    queue.cancel("cancelled");
    queue.enqueue("closing", () => completed.push("closing"), () => cancelled.push("closing"));
    queue.dispose();
    clock.advanceTo(1000);
    expect(completed).toHaveLength(40);
    expect(cancelled).toEqual(["cancelled", "closing"]);
    queue.enqueue("closed", () => completed.push("closed"), () => cancelled.push("closed"));
    expect(cancelled).toEqual(["cancelled", "closing", "closed"]);
  });

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
    expect(events).toEqual(["pair_judged", "pair_stale", "pair_unchanged", "pair_resolved"]);
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
  test("有效拦截不会被研判失败或语法等待覆盖", () => {
    let complete: ((value: typeof verdict) => void) | undefined;
    let mode: "lock" | "failure" | "waiting" = "lock";
    const grey = { ...verdict, zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain" };
    const unavailable = { ...grey, decision: "warn" as const, ruleId: "model-unavailable", adjudication: { strategy: "G2" as const, source: "fallback" as const, latencyMs: 1, status: "degraded" as const, escalated: false, userExplanation: "研判失败", suggestedAction: "请检查", inputHash: "x", promptVersion: "pair-v1" } };
    const waiting = { ...grey, ruleId: "syntax-incomplete-waiting", deferred: { reason: "syntax-incomplete" } };
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => grey, adjudicate(_pair, _local, _signal, done) {
      complete = done;
      if (mode === "lock") done(verdict);
      if (mode === "failure") done(unavailable);
      if (mode === "waiting") done(waiting);
    } });
    coordinator.update([{ ...pair, revisionKey: "one" }]);
    expect(coordinator.get(pair.id)?.verdict?.decision).toBe("lock");
    mode = "failure";
    coordinator.update([{ ...pair, revisionKey: "two" }]);
    expect(coordinator.get(pair.id)?.verdict).toMatchObject({ decision: "lock", ruleId: "call-signature-incompatible" });
    mode = "waiting";
    coordinator.update([{ ...pair, revisionKey: "three" }]);
    expect(coordinator.get(pair.id)?.verdict).toMatchObject({ decision: "lock", ruleId: "call-signature-incompatible" });
    coordinator.finishSyntax(pair.id);
    expect(coordinator.get(pair.id)?.verdict).toMatchObject({ decision: "lock", ruleId: "call-signature-incompatible" });
    expect(complete).toBeDefined();
  });
  test("有效放行遇到研判失败时降为提醒", () => {
    const completes: Array<(value: typeof verdict) => void> = [];
    const grey = { ...verdict, zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain" };
    const unavailable = { ...grey, ruleId: "model-unavailable", adjudication: { strategy: "G2" as const, source: "fallback" as const, latencyMs: 1, status: "degraded" as const, escalated: false, userExplanation: "研判失败", suggestedAction: "请检查", inputHash: "x", promptVersion: "pair-v1" } };
    const allowed = { ...grey, zone: "white" as const, decision: "allow" as const, ruleId: "model-fast", adjudication: { strategy: "G2" as const, source: "fast" as const, latencyMs: 1, status: "success" as const, escalated: false, userExplanation: "可以继续", suggestedAction: "继续修改", inputHash: "x", promptVersion: "pair-v1" } };
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => grey, adjudicate(_pair, _local, _signal, done) { completes.push(done); } });
    coordinator.update([{ ...pair, revisionKey: "allow" }]);
    completes[0]!(allowed);
    expect(coordinator.get(pair.id)?.verdict).toMatchObject({ decision: "allow" });
    coordinator.update([{ ...pair, revisionKey: "failed" }]);
    completes[1]!(unavailable);
    expect(coordinator.get(pair.id)?.verdict).toMatchObject({ decision: "warn", ruleId: "model-unavailable" });
  });
  test("有效放行遇到语法结束提醒时仍采用最后一个完整版本", () => {
    const completes: Array<(value: typeof verdict) => void> = [];
    const grey = { ...verdict, zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain" };
    const allowed = { ...grey, zone: "white" as const, decision: "allow" as const, ruleId: "model-fast", adjudication: { strategy: "G2" as const, source: "fast" as const, latencyMs: 1, status: "success" as const, escalated: false, userExplanation: "可以继续", suggestedAction: "继续修改", inputHash: "x", promptVersion: "pair-v1" } };
    const final = { ...grey, decision: "warn" as const, ruleId: "syntax-incomplete-final", localOnly: true };
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => grey, adjudicate(_pair, _local, _signal, done) { completes.push(done); } });
    coordinator.update([{ ...pair, revisionKey: "allow" }]);
    completes[0]!(allowed);
    coordinator.update([{ ...pair, revisionKey: "syntax" }]);
    completes[1]!(final);
    expect(coordinator.get(pair.id)?.verdict).toMatchObject({ decision: "allow", ruleId: "model-fast" });
  });
  test("语法不完整只在变更集结束时生成一次结束提醒", () => {
    const waiting = { ...verdict, zone: "grey" as const, decision: "warn" as const, ruleId: "syntax-incomplete-waiting", deferred: { reason: "syntax-incomplete" } };
    const events: string[] = [];
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => ({ ...verdict, zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain" }), adjudicate(_pair, _local, _signal, complete) { complete(waiting); } });
    coordinator.onEvent((event) => events.push(event.type));
    coordinator.update([{ ...pair, revisionKey: "typing" }]);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "pending", verdict: { ruleId: "syntax-incomplete-waiting" } });
    coordinator.update([{ ...pair, revisionKey: "typing" }]);
    expect(events.filter((event) => event === "pair_syntax_waiting")).toHaveLength(1);
    coordinator.finishSyntax(pair.id);
    coordinator.finishSyntax(pair.id);
    expect(coordinator.get(pair.id)).toMatchObject({ status: "judged", verdict: { ruleId: "syntax-incomplete-final", decision: "warn" } });
    expect(events.filter((event) => event === "pair_judged")).toHaveLength(1);
  });
  test("同一活跃变更集的多个修订不会重复生成语法结束提醒", () => {
    const waiting = { ...verdict, zone: "grey" as const, decision: "warn" as const, ruleId: "syntax-incomplete-waiting", deferred: { reason: "syntax-incomplete" } };
    const events: string[] = [];
    const actor = pair.left.actor;
    const session = createSessionCoordinator({
      tracker: { getOpenBatches: () => [] } as never,
      semantic: { getActiveChangeSets: () => [] } as never,
      index: {} as never,
      now: () => 1,
      intervene: false,
      classify: () => ({ ...verdict, zone: "grey", decision: "warn", ruleId: "semantic-interaction-uncertain" }),
      adjudicate: (_pair, _local, _signal, complete) => complete(waiting),
      onError: () => undefined
    });
    session.coordinator.onEvent((event) => events.push(event.type));
    session.coordinator.update([{ ...pair, revisionKey: "r1" }]);
    session.finishSyntax("a.ts", actor);
    session.coordinator.update([{ ...pair, revisionKey: "r2" }]);
    session.finishSyntax("a.ts", actor);
    expect(events.filter((event) => event === "pair_judged")).toHaveLength(1);
    session.changeSetOpened(actor);
    session.coordinator.update([{ ...pair, revisionKey: "r3" }]);
    session.finishSyntax("a.ts", actor);
    expect(events.filter((event) => event === "pair_unchanged")).toHaveLength(1);
  });
  test("候选关系消失时记录关闭原因", () => {
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => verdict });
    coordinator.update([pair]);
    coordinator.update([], () => true, () => "candidate-filtered");
    expect(coordinator.get(pair.id)).toMatchObject({ status: "closed", closeReason: "candidate-filtered" });
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
  test("d1-0059-conflict 在模型失败和语法结束提醒之后保留最后有效拦截", () => {
    const grey = { ...verdict, zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain" };
    const unavailable = { ...grey, ruleId: "model-unavailable", adjudication: { strategy: "G2" as const, source: "fallback" as const, latencyMs: 1, status: "degraded" as const, escalated: false, userExplanation: "研判失败", suggestedAction: "请检查", inputHash: "d1-0059", promptVersion: "pair-v1" } };
    const waiting = { ...grey, ruleId: "syntax-incomplete-waiting", deferred: { reason: "syntax-incomplete" } };
    let attempt = 0;
    const results = [verdict, verdict, unavailable, waiting];
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => grey, adjudicate(_pair, _local, _signal, complete) { complete(results[attempt++]!); } });
    for (const revisionKey of ["rev1", "rev2", "rev15", "final"]) coordinator.update([{ ...pair, id: "d1-0059-conflict", revisionKey }]);
    coordinator.finishSyntax("d1-0059-conflict");
    expect(coordinator.get("d1-0059-conflict")).toMatchObject({ status: "judged", verdict: { decision: "lock", ruleId: "call-signature-incompatible" } });
  });
  test("d1-0082-conflict 在后续无效结果之后保留最后有效拦截", () => {
    const grey = { ...verdict, zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain" };
    const unavailable = { ...grey, ruleId: "model-unavailable", adjudication: { strategy: "G2" as const, source: "fallback" as const, latencyMs: 1, status: "degraded" as const, escalated: false, userExplanation: "研判失败", suggestedAction: "请检查", inputHash: "d1-0082", promptVersion: "pair-v1" } };
    let attempt = 0;
    const results = [verdict, verdict, unavailable];
    const coordinator = createPairCoordinator({ now: () => 1, classify: () => grey, adjudicate(_pair, _local, _signal, complete) { complete(results[attempt++]!); } });
    for (const revisionKey of ["rev1", "rev2", "final"]) coordinator.update([{ ...pair, id: "d1-0082-conflict", revisionKey }]);
    expect(coordinator.get("d1-0082-conflict")).toMatchObject({ status: "judged", verdict: { decision: "lock", ruleId: "call-signature-incompatible" } });
  });
});
