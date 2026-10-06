import { describe, expect, it } from "vitest";
import type { CandidatePair } from "../routing/candidates.js";
import type { SymbolChange } from "../semantic/changes.js";
import { MemoryFileProvider } from "./files.js";
import { VirtualClock } from "./clock.js";
import { createP0Policy, createP1Policy, createP2Policy } from "./policies.js";
import { replayTrace } from "./engine.js";
import type { TraceEvent } from "../trace/trace.js";
import { calculateReplayMetrics } from "./metrics.js";
import { checkReplay } from "./check.js";
import fs from "node:fs/promises";
import { readTrace } from "../trace/trace.js";
import { replayLibraries } from "../../scripts/replay-libs.js";

describe("阶段 4 回放基础设施", () => {
  it("historical refresh coalescing is verified by identical semantic input hashes", async () => {
    const events = readTrace(await fs.readFile(new URL("../../../../docs/conflict-guard/evidence/stage-5-review/continuous-input.jsonl", import.meta.url), "utf8"));
    const libs = await replayLibraries();
    expect(checkReplay(events, { libs }).valid).toBe(true);
    const changed = events.map((event) => event.type === "pair_judged" ? { ...event, pair: { ...(event.pair as CandidatePair), revisionKey: "0".repeat(64) } } : event);
    expect(checkReplay(changed, { libs }).valid).toBe(false);
    const strict = events.map((event) => event.type === "session_start" ? { ...event, pairRevisionMode: "judged-input" } : event);
    expect(checkReplay(strict, { libs }).valid).toBe(false);
  });
  it("虚拟时钟按时间和创建顺序执行定时器", () => {
    const clock = new VirtualClock(10);
    const output: string[] = [];
    clock.setTimeout(() => output.push("late"), 20);
    clock.setTimeout(() => output.push("early"), 5);
    clock.setTimeout(() => output.push("early-2"), 5);
    clock.advanceTo(15);
    expect(output).toEqual(["early", "early-2"]);
    clock.advanceTo(30);
    expect(output).toEqual(["early", "early-2", "late"]);
  });

  it("四种策略产生固定判定", () => {
    const pair = samplePair();
    const project = { symbolsInFile: () => [], outgoing: () => [], incoming: () => [] };
    const activeFiles = [
      { actor: pair.left.actor, file: "src/a.ts", symbols: [sampleChange("src/a.ts#run")] },
      { actor: pair.right.actor, file: "src/a.ts", symbols: [sampleChange("src/a.ts#other")] }
    ];
    expect(createP0Policy().decide({ pair, activeFiles, project, symbols: () => undefined }).decision).toBe("allow");
    expect(createP1Policy().decide({ pair, activeFiles, project, symbols: () => undefined }).decision).toBe("lock");
    expect(createP2Policy().decide({ pair, activeFiles, project, symbols: () => undefined }).decision).toBe("lock");
  });

  it("P1 只锁定同一文件的活跃修改", () => {
    const pair = samplePair();
    const project = { symbolsInFile: () => [], outgoing: () => [], incoming: () => [] };
    const activeFiles = [
      { actor: pair.left.actor, file: "src/a.ts", symbols: [sampleChange("src/a.ts#run")] },
      { actor: pair.right.actor, file: "src/b.ts", symbols: [sampleChange("src/b.ts#other")] }
    ];
    expect(createP1Policy().decide({ pair, activeFiles, project, symbols: () => undefined }).decision).toBe("allow");
  });

  it("同一轨迹重复回放得到相同 JSON", () => {
    const trace = simpleTrace();
    const first = replayTrace(trace, { policy: "P0", seed: 17 });
    const second = replayTrace(trace, { policy: "P0", seed: 17 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("内存文件提供者使用全局递增版本", () => {
    const files = new MemoryFileProvider({ "src/a.ts": "export const a = 1;" });
    const first = files.version("src/a.ts");
    files.set("src/a.ts", "export const a = 2;");
    const second = files.version("src/a.ts");
    files.remove("src/a.ts");
    files.open("src/a.ts", "export const a = 3;");
    expect(second).toBeGreaterThan(first as number);
    expect(files.version("src/a.ts")).toBeGreaterThan(second as number);
  });

  it("锁定后进入冻结区域的编辑被标记为应当阻止", () => {
    const trace = simpleTrace();
    trace.push({ schema: 3, seq: 4, at: 20, type: "doc_open", file: "src/b.ts", text: "import { run } from \"./a.js\";\nexport function other() { return run(); }\n", textHash: "" });
    trace.push({ schema: 3, seq: 5, at: 30, type: "edit", file: "src/b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: 0, deleted: "import { run } from \"./a.js\";\nexport function other() { return run(); }\n", inserted: "import { run } from \"./a.js\";\nexport function other() { return run() + 1; }\n" }], revisionAfter: 1 });
    trace.push({ schema: 3, seq: 6, at: 1600, type: "edit", file: "src/a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: 0, deleted: "export function run() { return 2; }\n", inserted: "export function run() { return 3; }\n" }], revisionAfter: 2 });
    const result = replayTrace(trace, { policy: "P2" });
    expect(result.blockedEdits.some((edit) => edit.seq === 5 && edit.shouldHaveBeenBlocked)).toBe(true);
    expect(result.blockedEdits.some((edit) => edit.seq === 6 && edit.shouldHaveBeenBlocked)).toBe(true);
  });

  it("指标计算提供 Wilson 区间并按算子分组", () => {
    const metrics = calculateReplayMetrics([
      { truth: "lock", decision: "lock", local: true, escaped: false, missed: false, overblocked: false, frozenPersonSeconds: 2, cardCount: 1, operatorFamily: "IC", detectability: "typecheck", virtualDurationMs: 100 },
      { truth: "allow", decision: "lock", local: true, escaped: false, missed: false, overblocked: true, frozenPersonSeconds: 2, cardCount: 1, operatorFamily: "SF", detectability: "none", virtualDurationMs: 100 }
    ]);
    expect(metrics.agreement.value).toBe(0.5);
    expect(metrics.agreement.low).toBeLessThan(metrics.agreement.value);
    expect(metrics.byOperatorFamily.IC.groups).toBe(1);
    expect(metrics.cardsPerHour).toBeGreaterThan(0);
  });

  it("P1 为同文件无语义关系的修改建立文件锁，P2 放行", () => {
    const text = "export function alpha() { return 1; }\nexport function beta() { return 2; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text },
      { schema: 3, seq: 2, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: text.indexOf("1"), deleted: "1", inserted: "3" }] },
      { schema: 3, seq: 3, at: 200, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: text.indexOf("2"), deleted: "2", inserted: "4" }] }
    ];
    const p1 = replayTrace(trace, { policy: "P1", endAt: 3000 });
    expect(p1.judgements.map((item) => item.verdict.decision)).toEqual(["lock"]);
    expect(p1.semanticRelations).toBe(0);
    expect(replayTrace(trace, { policy: "P2" }).judgements).toEqual([]);
  });
  it("P1 首次编辑文件尾部注释立即冻结其他成员的整个文件", () => {
    const text = "export function alpha() { return 1; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text },
      { schema: 3, seq: 2, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: text.length, deleted: "", inserted: "// note\n" }] },
      { schema: 3, seq: 3, at: 300, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: text.indexOf("1"), deleted: "1", inserted: "2" }] }
    ];
    const result = replayTrace(trace, { policy: "P1", endAt: 2500 });
    expect(result.errors).toEqual([]);
    expect(result.blockedEdits.map((edit) => edit.shouldHaveBeenBlocked)).toEqual([false, true]);
    expect(result.freezeIntervals).toMatchObject([{ actor: { kind: "human", memberId: "bob" }, file: "a.ts", start: 100 }]);
  });
  it("P2 反事实编辑保持原有符号所有权，批次关闭后所有者继续编辑", () => {
    const producer = "export function alpha() { return 1; }\n";
    const consumer = "import { alpha } from './a.js';\nexport function beta() { return alpha() + 1; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text: producer },
      { schema: 3, seq: 2, at: 0, type: "doc_open", file: "b.ts", text: consumer },
      { schema: 3, seq: 3, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("1"), deleted: "1", inserted: "2" }] },
      { schema: 3, seq: 4, at: 5000, type: "edit", file: "b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.lastIndexOf("1"), deleted: "1", inserted: "2" }] },
      { schema: 3, seq: 5, at: 5200, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("1"), deleted: "2", inserted: "3" }] },
      { schema: 3, seq: 6, at: 7000, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("1"), deleted: "3", inserted: "4" }] }
    ];
    const result = replayTrace(trace, { policy: "P2", endAt: 9000 });
    expect(result.errors).toEqual([]);
    expect(result.blockedEdits.map((edit) => edit.shouldHaveBeenBlocked)).toEqual([false, true, false, false]);
    expect(result.freezeIntervals.every((interval) => interval.actor.memberId === "bob")).toBe(true);
    expect(result.finalTexts["a.ts"]).toContain("return 4");
    expect(result.finalTexts["b.ts"]).toContain("alpha() + 2");
  });

  it("P3 执行同符号规则，冻结区域外编辑继续执行并记录写盘闸门", () => {
    const text = "export function alpha() { return 1; }\nexport function beta() { return 2; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text },
      { schema: 3, seq: 2, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: text.indexOf("1"), deleted: "1", inserted: "3" }] },
      { schema: 3, seq: 3, at: 200, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: text.indexOf("1"), deleted: "3", inserted: "4" }] },
      { schema: 3, seq: 4, at: 1800, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: text.indexOf("2"), deleted: "2", inserted: "5" }] },
      { schema: 3, seq: 5, at: 1900, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: text.indexOf("1"), deleted: "4", inserted: "6" }] }
    ];
    const result = replayTrace(trace, { policy: "P3", endAt: 4000 });
    expect(result.judgements[0]!.verdict.ruleId).toBe("same-symbol-concurrent-write");
    expect(result.freezeIntervals.filter((interval) => interval.symbol === "a.ts#alpha").map((interval) => interval.actor)).toEqual([
      { kind: "human", memberId: "alice" },
      { kind: "human", memberId: "bob" }
    ]);
    expect(result.blockedEdits.find((edit) => edit.seq === 4)!.shouldHaveBeenBlocked).toBe(false);
    expect(result.blockedEdits.find((edit) => edit.seq === 5)!.shouldHaveBeenBlocked).toBe(true);
    expect(result.gateIntervals.some((interval) => interval.file === "a.ts")).toBe(true);
    expect(result.persistBlockedCount).toBeGreaterThan(0);
    expect(result.finalTexts["a.ts"]).toContain("return 6");
  });

  it("缺少录制判定的轨迹不宣称一致性通过", () => {
    expect(checkReplay(simpleTrace())).toMatchObject({ checked: false, valid: false });
  });
  it("撤回操作立即结束冻结与闸门区间", () => {
    const trace = simpleTrace();
    trace.push({ schema: 3, seq: 4, at: 20, type: "edit", file: "src/a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: 31, deleted: "2", inserted: "3" }] });
    const locked = replayTrace(trace, { policy: "P3", endAt: 1700 });
    const pairId = locked.judgements[0]!.pairId;
    trace.push({ schema: 3, seq: 5, at: 1800, type: "ui_action", action: "revert_pair", memberId: "alice", pairId });
    trace.push({ schema: 3, seq: 6, at: 1900, type: "edit", file: "src/a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: 31, deleted: "3", inserted: "4" }] });
    const result = replayTrace(trace, { policy: "P3", endAt: 2000 });
    expect(result.freezeIntervals.every((interval) => interval.end === 1800)).toBe(true);
    expect(result.gateIntervals.some((interval) => interval.file === "src/a.ts" && interval.end === 1800)).toBe(true);
    expect(result.blockedEdits.find((edit) => edit.seq === 6)?.shouldHaveBeenBlocked).toBe(false);
  });

  it("策略计算异常记录为 warn，输入继续复原", () => {
    const trace = simpleTrace();
    trace.push({ schema: 3, seq: 4, at: 20, type: "edit", file: "src/a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: 31, deleted: "2", inserted: "3" }] });
    const result = replayTrace(trace, { policy: { id: "P3", decide() { throw new Error("invalid policy configuration"); } } });
    expect(result.finalDecision).toBe("warn");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe("invalid policy configuration");
    expect(result.freezeIntervals).toEqual([]);
    expect(result.finalTexts["src/a.ts"]).toContain("return 3");
  });

  it("mirror_resync 使用产品的差异转换，保留两人的独立修改区域", () => {
    const text = "export function alpha() { return 1; }\nexport function beta() { return 2; }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "a.ts", text },
      { schema: 3, seq: 2, at: 100, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: text.indexOf("1"), deleted: "1", inserted: "3" }] },
      { schema: 3, seq: 3, at: 200, type: "edit", file: "a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: text.indexOf("2"), deleted: "2", inserted: "4" }] },
      { schema: 3, seq: 4, at: 1800, type: "mirror_resync", file: "a.ts", text: "// refreshed\n" + text.replace("return 1", "return 3").replace("return 2", "return 4") }
    ];
    const result = replayTrace(trace, { policy: "P3" });
    expect(result.judgements).toEqual([]);
    expect(result.finalTexts["a.ts"]).toContain("// refreshed");
  });
  it("批次关闭后的即时输入可以查询公开箭头函数的 T0 信息", () => {
    const producer = "export class Box { apply = (value: number) => value; }\n";
    const consumer = "import { Box } from './box'; export function useBox() { const box = new Box(); return box.apply(1); }\n";
    const trace: TraceEvent[] = [
      { schema: 3, seq: 1, at: 0, type: "doc_open", file: "box.ts", text: producer },
      { schema: 3, seq: 2, at: 0, type: "doc_open", file: "consumer.ts", text: consumer },
      { schema: 3, seq: 3, at: 100, type: "edit", file: "box.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: producer.indexOf("number"), deleted: "number", inserted: "string" }] },
      { schema: 3, seq: 4, at: 1601, type: "edit", file: "consumer.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: consumer.indexOf("apply(1)") + 6, deleted: "1", inserted: "2" }] }
    ];
    const result = replayTrace(trace, { policy: "P3", endAt: 1700 });
    expect(result.errors).toEqual([]);
    expect(result.coordinationEvents.filter((event) => event.type === "t0_warning")).toMatchObject([{ at: 1601, memberId: "bob", symbol: "box.ts#Box.apply" }]);
  });

  it("D2 的 51 个案例保存产品结果与来源动作对照，六个交付场景保留来源限制", async () => {
    const root = new URL("../../bench/datasets/d2-greylock/", import.meta.url);
    const manifest = JSON.parse(await fs.readFile(new URL("manifest.json", root), "utf8")) as { cases: Array<{ id: string; category: string; trace: string; sourceDecision: string; unavailable?: string; actual: Array<{ ruleId: string; decision: string; revision: number }> }> };
    expect(manifest.cases.filter((item) => item.category === "rule-case")).toHaveLength(51);
    expect(manifest.cases.filter((item) => item.category === "delivery-scenario")).toHaveLength(6);
    const differences: Array<{ id: string; decision: string | undefined }> = [];
    for (const item of manifest.cases) {
      const events = readTrace(await fs.readFile(new URL(item.trace, root), "utf8"));
      const result = replayTrace(events, { policy: "P3" });
      expect(result.judgements.map((event) => ({ ruleId: event.verdict.ruleId, decision: event.verdict.decision, revision: event.revision })), item.id).toEqual(item.actual);
      if (item.category === "rule-case") {
        expect(result.judgements.length, item.id).toBeGreaterThan(0);
        const decision = result.judgements.at(-1)?.verdict.decision;
        if (decision !== item.sourceDecision) differences.push({ id: item.id, decision });
      }
      else expect(item.unavailable, item.id).toMatch(/one-side-unchanged|no-static-relation/);
    }
    expect(differences).toEqual([
      { id: "ky-retry-method-normalization-safe", decision: "warn" },
      { id: "ky-json-schema-validation-order-safe", decision: "warn" },
      { id: "defu-config-layer-order-safe", decision: "warn" },
      { id: "cookie-max-age-validation-safe", decision: "warn" }
    ]);
  }, 30_000);

  it("真实白区轨迹按文件独立核验闸门顺序与状态", async () => {
    const root = new URL("../../../../docs/conflict-guard/evidence/checkpoint-a-live-traces/", import.meta.url);
    const events = readTrace(await fs.readFile(new URL("rules-white.jsonl", root), "utf8"));
    const initialFiles = JSON.parse(await fs.readFile(new URL("rules-white-project.json", root), "utf8")) as Record<string, string>;
    expect(checkReplay(events, { initialFiles }).valid).toBe(true);
    const opened = events.filter((event) => event.type === "persist_gate" && event.allowed === true);
    expect(opened).toHaveLength(2);
    expect(opened[0]!.at).toBe(opened[1]!.at);
    const exchanged = events.map((event) => event === opened[0] ? { ...opened[1]!, seq: event.seq } : event === opened[1] ? { ...opened[0]!, seq: event.seq } : event);
    expect(checkReplay(exchanged, { initialFiles }).valid).toBe(true);
    const invalid = events.map((event) => event === opened[0] ? { ...event, allowed: false, reason: "pending-judgement" } : event);
    expect(checkReplay(invalid, { initialFiles }).coordinationDifferences.some((event) => event.type === "persist_gate")).toBe(true);
  });
});

function sampleChange(key: string): SymbolChange {
  const file = key.slice(0, key.indexOf("#"));
  const name = key.slice(key.indexOf("#") + 1);
  return { key, file, name, kind: "function", status: "modified", before: `function ${name}() { return 1; }`, after: `function ${name}() { return 2; }`, startLine: 1, endLine: 1, lastTouchedAt: 1 };
}

function samplePair(): CandidatePair {
  return {
    id: "pair",
    left: { actor: { kind: "human", memberId: "alice" }, symbol: "src/a.ts#run", status: "modified" },
    right: { actor: { kind: "human", memberId: "bob" }, symbol: "src/a.ts#other", status: "modified" },
    distance: 1,
    path: { from: "src/a.ts#run", to: "src/a.ts#other", hops: [{ from: "src/a.ts#run", to: "src/a.ts#other", kind: "call", direction: "forward" }], typeOnly: false },
    firstSeenAt: 1,
    updatedAt: 1
  };
}

function simpleTrace(): TraceEvent[] {
  return [
    { schema: 3, seq: 1, at: 0, type: "session_start" },
    { schema: 3, seq: 2, at: 0, type: "doc_open", file: "src/a.ts", text: "export function run() { return 1; }\n", textHash: "" },
    { schema: 3, seq: 3, at: 10, type: "edit", file: "src/a.ts", origin: { kind: "human", memberId: "alice" }, ops: [{ from: 31, deleted: "1", inserted: "2" }], revisionAfter: 1 }
  ];
}
