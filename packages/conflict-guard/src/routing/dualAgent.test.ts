import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { applyPatch } from "diff";
import { createSemanticIndex } from "../semantic/index.js";
import { mapSymbolChanges } from "../semantic/changes.js";
import { parseSymbols } from "../semantic/symbols.js";
import { deletedSymbolKeys } from "../semantic/changes.js";
import { textDiffOps } from "../tracking/textDiff.js";
import { SemanticChangeTracker } from "./candidates.js";
import { classify } from "./classifier.js";
import type { ActiveChangeSet, EditBatch } from "../model/types.js";
import { createPairCoordinator } from "../coordination/pairState.js";
import { VirtualClock } from "../replay/clock.js";
import type { CandidatePair } from "./candidates.js";
import type { ZoneVerdict } from "./classifier.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../test/fixtures/dual-agent-export.json", import.meta.url), "utf8"));

describe("双 Agent 的真实审批输入", () => {
  it("原始审批 diff 完整恢复提案，删除重复声明保留公开的 formatMoney", () => {
    expect(applyPatch(fixture.before, fixture.diff)).toBe(fixture.after);
    const files = { [fixture.file]: fixture.after, [fixture.consumer.file]: fixture.consumer.after };
    const index = createSemanticIndex({ files: { listFiles: () => Object.keys(files), readFile: (file) => files[file], version: () => 1 }, now: () => 0 });
    index.update();
    const deleted = deletedSymbolKeys({ file: fixture.file, textBefore: fixture.before, textAfter: fixture.after, ops: textDiffOps(fixture.before, fixture.after), origin: { kind: "agent", runId: "agent", ownerId: "alice" }, at: 0, revisionAfter: 1 });
    const changes = mapSymbolChanges({ file: fixture.file, baseText: fixture.before, ranges: [{ start: 0, end: fixture.after.length }], deletedSymbolKeys: deleted, firstTouchedAt: 0, lastTouchedAt: 1 }, fixture.after, index);
    const consumer = mapSymbolChanges({ file: fixture.consumer.file, baseText: fixture.consumer.before, ranges: [{ start: 0, end: fixture.consumer.after.length }], firstTouchedAt: 0, lastTouchedAt: 1 }, fixture.consumer.after, index)[0]!;
    for (const producer of changes) {
      const result = classify({ left: { actor: { kind: "agent", runId: "agent", ownerId: "alice" }, symbol: producer }, right: { actor: { kind: "human", memberId: "alice" }, symbol: consumer }, path: fixture.relation, nested: false, typeOnly: false, project: index });
      expect(result.ruleId, producer.key).not.toBe("runtime-export-removed");
    }
    expect(changes.some((change) => change.key === "src/pricing.ts#formatMoney@2" && change.status === "deleted")).toBe(false);
  });

  it("无法解析的 after 不形成导出删除结论", () => {
    const files = { [fixture.file]: fixture.after, [fixture.consumer.file]: fixture.consumer.after };
    const index = createSemanticIndex({ files: { listFiles: () => Object.keys(files), readFile: (file) => files[file], version: () => 1 }, now: () => 0 });
    index.update();
    const declaration = parseSymbols(fixture.file, fixture.before).find((symbol) => symbol.name === "formatMoney")!;
    const before = fixture.before.slice(declaration.start, declaration.end);
    const producer = { ...declaration, status: "modified" as const, before, after: before.slice(0, -1), lastTouchedAt: 1 };
    const consumer = mapSymbolChanges({ file: fixture.consumer.file, baseText: fixture.consumer.before, ranges: [{ start: 0, end: fixture.consumer.after.length }], firstTouchedAt: 0, lastTouchedAt: 1 }, fixture.consumer.after, index)[0]!;
    const result = classify({ left: { actor: { kind: "agent", runId: "agent", ownerId: "alice" }, symbol: producer }, right: { actor: { kind: "human", memberId: "alice" }, symbol: consumer }, path: fixture.relation, nested: false, typeOnly: false, project: index });
    expect(result.ruleId).toBe("unparsable-side");
  });
});

describe("批次符号簇", () => {
  it("批次结束前已经关闭的候选关系计入该变更单元，新的活跃周期独立统计", () => {
    const base = "export function a() { return 1; }\nexport function b() { return a(); }\n";
    const source = base.replace("return 1", "return 2").replace("return a()", "return a() + 1");
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => 1 }, now: () => 0 });
    index.update();
    const tracker = new SemanticChangeTracker({ index, readFile: () => source, now: () => 0 });
    const range = (name: string) => { const symbol = index.symbolsInFile("a.ts").find((symbol) => symbol.name === name)!; return [{ start: symbol.start, end: symbol.end }]; };
    const set = (memberId: string, name: string, startedAt = 0): ActiveChangeSet => ({ actor: { kind: "human", memberId }, status: "settled", files: new Map([["a.ts", { file: "a.ts", baseText: base, ranges: range(name), firstTouchedAt: startedAt, lastTouchedAt: startedAt + 1 }]]) });
    const batch = (id: string, startedAt = 0): EditBatch => ({ id, actor: { kind: "human", memberId: "alice" }, file: "a.ts", startedAt, endedAt: startedAt + 1, closeReason: "idle", textBefore: base, textAfter: source, ranges: range("a") });
    tracker.update([set("alice", "a"), set("bob", "b")]);
    expect(tracker.getCandidatePairs()).toHaveLength(1);
    tracker.update([set("alice", "a")]);
    expect(tracker.getCandidatePairs()).toHaveLength(0);
    tracker.update([set("alice", "a")], [{ batch: batch("first") }]);
    expect(tracker.statistics()).toMatchObject({ total: 1, related: 1, unrelated: 0 });
    tracker.update([]);
    tracker.update([set("alice", "a", 10)], [{ batch: batch("second", 10) }]);
    expect(tracker.statistics()).toMatchObject({ total: 2, related: 1, unrelated: 1 });
  });

  it("每个判定批次最多执行 20 次，相同修订号只发布一次且跨协调器复用缓存", () => {
    const source = "export function a() { return 2; }\nexport function b() { return a() + 1; }";
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => 1 }, now: () => 0 });
    index.update();
    const symbols = mapSymbolChanges({ file: "a.ts", baseText: source.replace("return 2", "return 1").replace("a() + 1", "a()"), ranges: [{ start: 0, end: source.length }], firstTouchedAt: 0, lastTouchedAt: 1 }, source, index);
    const left = symbols.find((symbol) => symbol.name === "a")!;
    const right = symbols.find((symbol) => symbol.name === "b")!;
    const pairs: CandidatePair[] = Array.from({ length: 45 }, (_, ordinal) => ({ id: String(ordinal), left: { actor: { kind: "human", memberId: `left-${ordinal}` }, symbol: left.key, status: "modified" }, right: { actor: { kind: "human", memberId: `right-${ordinal}` }, symbol: right.key, status: "modified" }, path: null, distance: 0, firstSeenAt: 0, updatedAt: 0, revisionKey: "unchanged-input" }));
    const clock = new VirtualClock();
    const resultCache = new Map<string, { verdict: ZoneVerdict; pair: CandidatePair }>();
    let classified = 0;
    const classification = (pair: CandidatePair) => { classified += 1; return classify({ left: { actor: pair.left.actor, symbol: left }, right: { actor: pair.right.actor, symbol: right }, path: null, nested: false, typeOnly: false, project: index }); };
    const coordinator = createPairCoordinator({ clock, now: () => clock.now(), judgementFrameMs: 200, maxJudgementsPerFrame: 20, classify: classification, resultCache });
    const events: string[] = [];
    coordinator.onEvent((event) => events.push(event.type));
    coordinator.update(pairs);
    clock.advanceTo(199);
    expect(classified).toBe(0);
    clock.advanceTo(200);
    expect(classified).toBe(20);
    coordinator.update(pairs);
    clock.advanceTo(400);
    expect(classified).toBe(40);
    clock.advanceTo(600);
    expect(classified).toBe(45);
    coordinator.update(pairs);
    clock.advanceTo(800);
    expect(events.filter((event) => event === "pair_judged")).toHaveLength(45);
    coordinator.dispose();
    const next = createPairCoordinator({ now: () => 0, classify: classification, resultCache });
    next.update(pairs);
    expect(classified).toBe(45);
    next.dispose();
  });
  it("共享的未修改类型不生成候选对", () => {
    const base = "export type Money = number;\nexport function a(value: Money): Money { return value; }\nexport function b(value: Money): Money { return value; }";
    const source = base.replaceAll("return value;", "return value + 1;");
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => 1 }, now: () => 0 });
    index.update();
    const tracker = new SemanticChangeTracker({ index, readFile: () => source, now: () => 0 });
    const set = (memberId: string, name: string): ActiveChangeSet => {
      const symbol = index.symbolsInFile("a.ts").find((symbol) => symbol.name === name)!;
      return { actor: { kind: "human", memberId }, status: "settled", files: new Map([["a.ts", { file: "a.ts", baseText: base, ranges: [{ start: symbol.start, end: symbol.end }], firstTouchedAt: 0, lastTouchedAt: 1 }]]) };
    };
    tracker.update([set("alice", "a"), set("bob", "b")]);
    expect(tracker.getCandidatePairs()).toHaveLength(0);
  });

  it("第三位参与者修改共享类型时，其他两位参与者的类型路径仍然独立过滤", () => {
    const base = "export type Money = number;\nexport function a(value: Money): Money { return value; }\nexport function b(value: Money): Money { return value; }";
    const source = base.replace("Money = number", "Money = number | bigint").replaceAll("return value;", "console.info(value); return value;");
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => 1 }, now: () => 0 });
    index.update();
    const tracker = new SemanticChangeTracker({ index, readFile: () => source, now: () => 0 });
    const set = (memberId: string, name: string): ActiveChangeSet => {
      const symbol = index.symbolsInFile("a.ts").find((symbol) => symbol.name === name)!;
      return { actor: { kind: "human", memberId }, status: "settled", files: new Map([["a.ts", { file: "a.ts", baseText: base, ranges: [{ start: symbol.start, end: symbol.end }], firstTouchedAt: 0, lastTouchedAt: 1 }]]) };
    };
    tracker.update([set("alice", "a"), set("bob", "b"), set("carol", "Money")]);
    const pairs = tracker.getCandidatePairs();
    expect(pairs).toHaveLength(2);
    expect(pairs.every((pair) => [pair.left.actor, pair.right.actor].some((actor) => actor.kind === "human" && actor.memberId === "carol"))).toBe(true);
  });

  it("一个批次内一跳相关的符号生成一个候选对并保留全部符号", () => {
    const base = "export function a() { return 1; }\nexport function b() { return a(); }\nexport function c() { return b(); }\n";
    const source = base.replace("return 1", "return 2").replace("return a()", "return a() + 1").replace("return b()", "return b() + 1");
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => 1 }, now: () => 0 });
    index.update();
    const tracker = new SemanticChangeTracker({ index, readFile: () => source, now: () => 0 });
    const range = (names: string[]) => parseSymbols("a.ts", source).filter((symbol) => names.includes(symbol.name)).map((symbol) => ({ start: symbol.start, end: symbol.end }));
    const set = (memberId: string, names: string[]): ActiveChangeSet => ({ actor: { kind: "human", memberId }, status: "settled", files: new Map([["a.ts", { file: "a.ts", baseText: base, ranges: range(names), firstTouchedAt: 0, lastTouchedAt: 1 }]]) });
    const batch = (memberId: string, names: string[]): EditBatch => ({ id: memberId, actor: { kind: "human", memberId }, file: "a.ts", startedAt: 0, endedAt: 1, closeReason: "idle", textBefore: base, textAfter: source, ranges: range(names) });
    tracker.update([set("alice", ["a", "b"]), set("bob", ["c"])], [{ batch: batch("alice", ["a", "b"]) }, { batch: batch("bob", ["c"]) }]);
    expect(tracker.getCandidatePairs()).toHaveLength(1);
    expect(tracker.getCandidatePairs()[0]?.left).toMatchObject({ symbols: ["a.ts#a", "a.ts#b"] });
    expect(tracker.statistics()).toMatchObject({ total: 2, related: 2, unrelated: 0 });
  });
});
