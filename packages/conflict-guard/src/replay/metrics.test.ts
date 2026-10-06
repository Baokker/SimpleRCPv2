import { describe, expect, it } from "vitest";
import { calculateReplayMetrics, detectPersistExposure, frozenPersonSeconds, replayOutcome, type ReplayGroupOutcome } from "./metrics.js";
import { createOraclePolicy, policyFor } from "./policies.js";
import { replayTrace } from "./engine.js";
import type { TraceEvent } from "../trace/trace.js";

describe("检查点 A 回放指标", () => {
  it("总体与分组分别使用 lock、allow、lock 或 warn 真值作为分母", () => {
    const metrics = calculateReplayMetrics([
      outcome({ truth: "lock", decision: "allow", missed: true, escaped: true }),
      outcome({ truth: "lock", decision: "lock" }),
      outcome({ truth: "allow", decision: "lock", overblocked: true }),
      outcome({ truth: "warn", decision: "lock", overblocked: true, escaped: true })
    ]);
    for (const group of [metrics, metrics.byOperatorFamily.IC, metrics.byDetectability["runtime-only"]]) {
      expect(group.missBlockRatio.value).toBe(0.5);
      expect(group.falseBlockRatio.value).toBe(1);
      expect(group.escapeRatio.value).toBe(2 / 3);
    }
  });

  it("本地决定使用变更对数量，没有变更对的样本不参与", () => {
    const metrics = calculateReplayMetrics([
      outcome({ totalPairCount: 3, localDecisionCount: 2 }),
      outcome({ totalPairCount: 1, localDecisionCount: 1 }),
      outcome({ totalPairCount: 0, localDecisionCount: 0, local: true })
    ]);
    expect(metrics.localDecisionRatio?.value).toBe(3 / 4);
    expect(calculateReplayMetrics([outcome({ local: true })]).localDecisionRatio).toBeNull();
    expect(calculateReplayMetrics([outcome()]).localDecisionRatio).toBeNull();
  });

  it("安全样本与冲突样本的判定延迟分别报告", () => {
    const metrics = calculateReplayMetrics([
      outcome({ variantKind: "conflict", latenciesMs: [25, 100], latencyMs: 100 }),
      outcome({ variantKind: "safe", latenciesMs: [0, 5], latencyMs: 5 })
    ]);
    expect(metrics.variantCounts).toEqual({ conflict: 1, safe: 1 });
    expect(metrics.decisionLatencyMs.byVariant.conflict).toMatchObject({ samples: 2, p50: 25, p95: 100 });
    expect(metrics.decisionLatencyMs.byVariant.safe).toMatchObject({ samples: 2, p50: 0, p95: 5 });
  });

  it("预言机只锁定真值为冲突的候选关系", () => {
    const trace = relatedTrace();
    expect(replayTrace(trace, { policy: createOraclePolicy("allow") }).finalDecision).toBe("allow");
    expect(replayTrace(trace, { policy: createOraclePolicy("warn") }).finalDecision).toBe("lock");
    expect(replayTrace(trace, { policy: createOraclePolicy("lock") }).finalDecision).toBe("lock");
    expect(() => policyFor("P*")).toThrow(/真值/);
    expect(() => createOraclePolicy(undefined as never)).toThrow(/真值/);
  });

  it("写入之后才发出的提示保留逃逸与判定前暴露窗口", () => {
    const input = {
      truth: "warn" as const,
      baseline: { "a.ts": "before-a", "b.ts": "before-b" },
      merged: { "a.ts": "after-a", "b.ts": "after-b" },
      persisted: [
        { at: 300, file: "a.ts", text: "after-a", counterfactual: false },
        { at: 500, file: "b.ts", text: "after-b", counterfactual: false }
      ]
    };
    expect(detectPersistExposure({ ...input, interventions: [2000] })).toEqual({ escaped: true, conflictPersistAt: 500, exposureWindowMs: 1500 });
    expect(detectPersistExposure({ ...input, interventions: [400] })).toEqual({ escaped: false, conflictPersistAt: 500 });
    expect(detectPersistExposure({ ...input, interventions: [] })).toEqual({ escaped: true, conflictPersistAt: 500 });
  });

  it("被阻止的反事实写入不构成冲突合并态写入", () => {
    expect(detectPersistExposure({
      truth: "lock", baseline: { "a.ts": "before" }, merged: { "a.ts": "after" }, interventions: [],
      persisted: [{ at: 300, file: "a.ts", text: "after", counterfactual: true }]
    })).toEqual({ escaped: false });
  });

  it("放行判定没有卡片，频率时长只使用第一次到最后一次编辑", () => {
    const trace = relatedTrace();
    const result = replayTrace(trace, { policy: "P0", endAt: 10_000 });
    const value = replayOutcome({
      truth: "allow", variantKind: "safe", operatorFamily: "SF", detectability: "none", trace, result,
      baseline: { "a.ts": "export function run() { return 1; }\n" }, merged: result.finalTexts
    });
    expect(value.cardCount).toBe(0);
    expect(value.virtualDurationMs).toBe(100);
    expect(calculateReplayMetrics([value]).localDecisionRatio).toBeNull();
  });

  it("冻结在人停止活跃修改的时刻结束，同一成员的重叠范围不重复计算", () => {
    const actor = { kind: "human" as const, memberId: "alice" };
    expect(frozenPersonSeconds({ endedAt: 10_000, freezeIntervals: [
      { pairId: "a", symbol: "a.ts#a", file: "a.ts", actor, startOffset: 0, endOffset: 10, start: 100, end: 500 },
      { pairId: "b", symbol: "a.ts#b", file: "a.ts", actor, startOffset: 20, endOffset: 30, start: 200, end: 600 }
    ] })).toBe(0.5);
  });

  it("一次黑区判定计一张卡片，成员结束修改后冻结时长停止增加", () => {
    const trace = relatedTrace();
    trace.push({ schema: 3, seq: 4, at: 1800, type: "ui_action", action: "change_set_done", memberId: "alice" });
    const result = replayTrace(trace, { policy: "P3", endAt: 10_000 });
    const value = replayOutcome({
      truth: "lock", variantKind: "conflict", operatorFamily: "SS", detectability: "runtime-only", trace, result,
      baseline: { "a.ts": "export function run() { return 1; }\n" }, merged: result.finalTexts
    });
    expect(value.cardCount).toBe(1);
    expect(value.freezeCount).toBe(1);
    expect(value.frozenPersonSeconds).toBeGreaterThan(0);
    expect(value.frozenPersonSeconds).toBeLessThan(1);
    expect(result.freezeIntervals.every((interval) => interval.end! < 2000)).toBe(true);
  });

  it("P1 在另一成员首次输入之前锁定整个文件，独立函数同样受保护", () => {
    const text = "export function alpha() { return 1; }\nexport function beta() { return 2; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text },
      { schema: 3, seq: 2, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: text.indexOf("1"), deleted: "1", inserted: "3" }] },
      { schema: 3, seq: 3, at: 5000, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: text.indexOf("2"), deleted: "2", inserted: "4" }] },
      { schema: 3, seq: 4, at: 6000, type: "ui_action", action: "change_set_done", memberId: "alice" }
    ];
    const result = replayTrace(trace, { policy: "P1", endAt: 7000 });
    expect(result.blockedEdits.find((edit) => edit.seq === 3)?.shouldHaveBeenBlocked).toBe(true);
    expect(result.blockedEdits.find((edit) => edit.seq === 2)?.shouldHaveBeenBlocked).toBe(false);
    const region = result.freezeIntervals.find((region) => region.actor.kind === "human" && region.actor.memberId === "bob" && region.start === 100);
    expect(region).toBeDefined();
    expect(region).toMatchObject({ file: "a.ts", startOffset: 0, endOffset: text.length, end: 6000 });
    expect(frozenPersonSeconds(result)).toBeGreaterThanOrEqual(5.9);
  });

  it("P2 在另一成员的第一次依赖符号输入时阻止，无关符号保持可编辑", () => {
    const producer = "export function discount(value: number) { return value * 2; }\n";
    const consumer = "import { discount } from './a.js';\nexport function checkout() { return discount(3); }\nexport function unrelated() { return 4; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text: producer },
      { schema: 3, seq: 2, at: 0, type: "doc_open", file: "b.ts", text: consumer },
      { schema: 3, seq: 3, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("2"), deleted: "2", inserted: "5" }] },
      { schema: 3, seq: 4, at: 3000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.indexOf("4"), deleted: "4", inserted: "6" }] },
      { schema: 3, seq: 5, at: 5000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.indexOf("3"), deleted: "3", inserted: "7" }] },
      { schema: 3, seq: 6, at: 6000, type: "ui_action", action: "change_set_done", memberId: "alice" }
    ];
    const result = replayTrace(trace, { policy: "P2", endAt: 7000 });
    expect(result.blockedEdits.find((edit) => edit.seq === 5)?.shouldHaveBeenBlocked).toBe(true);
    expect(result.blockedEdits.find((edit) => edit.seq === 4)?.shouldHaveBeenBlocked).toBe(false);
    const region = result.freezeIntervals.find((region) => region.actor.kind === "human" && region.actor.memberId === "bob" && region.symbol === "b.ts#checkout" && region.start === 100);
    expect(region).toBeDefined();
    expect(region?.end).toBe(6000);
    expect(frozenPersonSeconds(result)).toBeGreaterThanOrEqual(5.9);
  });

  it("延迟从批次关闭计时，预言机闸门阻止合并文本在判定之前写入", () => {
    const trace = relatedTrace();
    const baseline = { "a.ts": "export function run() { return 1; }\n" };
    const merged = { "a.ts": "export function run() { return 3; }\n" };
    const p0 = replayTrace(trace, { policy: "P0" });
    const oracle = replayTrace(trace, { policy: "P*", oracleTruth: "lock" });
    const sample = { truth: "lock" as const, variantKind: "conflict" as const, operatorFamily: "SS", detectability: "runtime-only", trace, baseline, merged };
    expect(replayOutcome({ ...sample, result: p0 })).toMatchObject({ escaped: true, conflictPersistAt: 500, unnotifiedEscape: true });
    expect(replayOutcome({ ...sample, result: oracle })).toMatchObject({ escaped: false, latenciesMs: [25] });
    expect(oracle.persisted).toEqual([]);
    expect(oracle.gateIntervals.some((interval) => interval.start < 500)).toBe(true);
  });

  it.each(["P0", "P2", "P3", "P*"] as const)("%s 的先后编辑与后续 revision 从当前相关批次关闭计时", (policy) => {
    const producer = "export function discount(value: number) { return value * 2; }\n";
    const consumer = "import { discount } from './a.js';\nexport function checkout() { return discount(3); }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text: producer },
      { schema: 3, seq: 2, at: 0, type: "doc_open", file: "b.ts", text: consumer },
      { schema: 3, seq: 3, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("2"), deleted: "2", inserted: "5" }] },
      { schema: 3, seq: 4, at: 60_000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.indexOf("3"), deleted: "3", inserted: "6" }] },
      { schema: 3, seq: 5, at: 60_150, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.indexOf("3"), deleted: "6", inserted: "7" }] },
      { schema: 3, seq: 6, at: 90_000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.indexOf("3"), deleted: "7", inserted: "8" }] },
      { schema: 3, seq: 7, at: 90_150, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.indexOf("3"), deleted: "8", inserted: "9" }] }
    ];
    const result = replayTrace(trace, { policy, oracleTruth: "lock", idleMs: 1500 });
    expect(result.errors).toEqual([]);
    expect(result.judgements.map((item) => item.triggerAt)).toEqual([61_650, 91_650]);
    expect(result.judgements.map((item) => item.at - item.triggerAt)).toEqual([25, 25]);
    expect(result.judgements[1]!.revision).toBeGreaterThan(result.judgements[0]!.revision);
  });

  it("同一批次产生的多个变更对分别保留该批次的触发时刻", () => {
    const producer = "export function discount(value: number) { return value * 2; }\nexport function tax(value: number) { return value + 1; }\n";
    const consumer = "import { discount, tax } from './a.js';\nexport function checkout() { return tax(discount(3)); }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text: producer },
      { schema: 3, seq: 2, at: 0, type: "doc_open", file: "b.ts", text: consumer },
      { schema: 3, seq: 3, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("2"), deleted: "2", inserted: "5" }, { from: producer.lastIndexOf("1"), deleted: "1", inserted: "4" }] },
      { schema: 3, seq: 4, at: 60_000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.indexOf("3"), deleted: "3", inserted: "7" }] }
    ];
    const result = replayTrace(trace, { policy: "P0", idleMs: 1500 });
    expect(result.judgements).toHaveLength(2);
    expect(result.judgements.map((item) => item.triggerAt)).toEqual([61_500, 61_500]);
    expect(result.judgements.map((item) => item.at - item.triggerAt)).toEqual([25, 25]);
  });

  it("同一 revision 的 T0 提示与灰区通知只计一次卡片", () => {
    const producer = "export function snapshot() { return { value: 1 }; }\n";
    const consumer = "import { snapshot } from './a.js';\nexport function checkout() { return snapshot().value + 1; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text: producer },
      { schema: 3, seq: 2, at: 0, type: "doc_open", file: "b.ts", text: consumer },
      { schema: 3, seq: 3, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("1") + 1, deleted: "", inserted: ", tax: 0" }] },
      { schema: 3, seq: 4, at: 3000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.lastIndexOf("1"), deleted: "1", inserted: "2" }] }
    ];
    const result = replayTrace(trace, { policy: "P3" });
    expect(result.coordinationEvents.filter((event) => event.type === "t0_warning")).toHaveLength(1);
    expect(result.judgements.map((item) => item.verdict.decision)).toEqual(["warn"]);
    expect(replayOutcome({ truth: "warn", variantKind: "conflict", operatorFamily: "CP", detectability: "runtime-only", trace, result, baseline: { "a.ts": producer, "b.ts": consumer }, merged: result.finalTexts }).cardCount).toBe(1);
  });

  it("已有变更对的新批次 T0 计入下一次判定的 revision", () => {
    const producer = "export function snapshot() { return { value: 1 }; }\n";
    const consumer = "import { snapshot } from './a.js';\nexport function checkout() { return snapshot().value + 1; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text: producer },
      { schema: 3, seq: 2, at: 0, type: "doc_open", file: "b.ts", text: consumer },
      { schema: 3, seq: 3, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("1") + 1, deleted: "", inserted: ", tax: 0" }] },
      { schema: 3, seq: 4, at: 3000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.lastIndexOf("1"), deleted: "1", inserted: "2" }] },
      { schema: 3, seq: 5, at: 6000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.lastIndexOf("1"), deleted: "2", inserted: "1 /* checked */" }] }
    ];
    const result = replayTrace(trace, { policy: "P3" });
    expect(result.coordinationEvents.filter((event) => event.type === "t0_warning")).toHaveLength(2);
    expect(result.judgements.map((item) => [item.revision, item.verdict.decision])).toEqual([[0, "warn"], [1, "allow"]]);
    expect(replayOutcome({ truth: "allow", variantKind: "safe", operatorFamily: "CP", detectability: "none", trace, result, baseline: { "a.ts": producer, "b.ts": consumer }, merged: result.finalTexts }).cardCount).toBe(2);
  });

  it.each(["P0", "P1"] as const)("%s 跨文件放行时不产生 T0 或语义闸门", (policy) => {
    const producer = "export function snapshot() { return { value: 1 }; }\n";
    const consumer = "import { snapshot } from './a.js';\nexport function checkout() { return snapshot().value + 1; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text: producer },
      { schema: 3, seq: 2, at: 0, type: "doc_open", file: "b.ts", text: consumer },
      { schema: 3, seq: 3, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("1") + 1, deleted: "", inserted: ", tax: 0" }] },
      { schema: 3, seq: 4, at: 3000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.lastIndexOf("1"), deleted: "1", inserted: "2" }] }
    ];
    const result = replayTrace(trace, { policy });
    expect(result.gateIntervals).toHaveLength(0);
    expect(result.coordinationEvents.filter((event) => event.type === "t0_warning")).toHaveLength(0);
    expect(replayOutcome({ truth: "warn", variantKind: "conflict", operatorFamily: "CP", detectability: "runtime-only", trace, result, baseline: { "a.ts": producer, "b.ts": consumer }, merged: result.finalTexts })).toMatchObject({ cardCount: 0, escaped: true });
  });
});

function outcome(values: Partial<ReplayGroupOutcome> = {}): ReplayGroupOutcome {
  return { truth: "allow", decision: "allow", escaped: false, missed: false, overblocked: false, frozenPersonSeconds: 0, cardCount: 0, operatorFamily: "IC", detectability: "runtime-only", ...values };
}

function relatedTrace(): TraceEvent[] {
  const text = "export function run() { return 1; }\n";
  return [
    { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text },
    { schema: 3, seq: 2, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: text.indexOf("1"), deleted: "1", inserted: "2" }] },
    { schema: 3, seq: 3, at: 200, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: text.indexOf("1"), deleted: "2", inserted: "3" }] }
  ];
}
