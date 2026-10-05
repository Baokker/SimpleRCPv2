import { describe, expect, it } from "vitest";
import { createSemanticIndex } from "../semantic/index.js";
import { SemanticChangeTracker, type SemanticChangeEvent } from "./candidates.js";
import type { ActiveChangeSet, EditBatch } from "../model/types.js";

describe("候选对", () => {
  it("已结束的无关单元不会被后续同符号候选计入关联统计", () => {
    const baseline = "export function a() { return 1; }";
    let source = "export function a() { return 2; }";
    let version = 1;
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => version }, now: () => 0 });
    index.update();
    const tracker = new SemanticChangeTracker({ index, readFile: () => source, now: () => version });
    const events: SemanticChangeEvent[] = [];
    tracker.onEvent((event) => events.push(event));
    function set(memberId: string, baseText: string, at: number): ActiveChangeSet {
      return { actor: { kind: "human", memberId }, status: "settled", files: new Map([["a.ts", { file: "a.ts", baseText, ranges: [{ start: 0, end: source.length }], firstTouchedAt: at, lastTouchedAt: at }]]) };
    }
    function batch(id: string, memberId: string, baseText: string): EditBatch {
      return { id, actor: { kind: "human", memberId }, file: "a.ts", startedAt: version, endedAt: version, closeReason: "idle", ranges: [{ start: 0, end: source.length }], textBefore: baseText, textAfter: source };
    }
    tracker.update([set("alice", baseline, 1)], [{ batch: batch("first", "alice", baseline) }]);
    tracker.update([]);
    const nextBaseline = source;
    source = "export function a() { return 3; /* Bob */ }";
    version += 1;
    index.update(["a.ts"]);
    tracker.update([set("alice", nextBaseline, 2), set("bob", "export function a() { return 3; }", 3)], [{ batch: batch("second", "alice", nextBaseline) }, { batch: batch("third", "bob", "export function a() { return 3; }") }]);
    expect(tracker.statistics()).toEqual({ total: 3, related: 2, unrelated: 1, unrelatedRatio: 1 / 3, typeOnly: 0 });
    expect(events.filter((event) => event.type === "change_unit")).toHaveLength(3);
    tracker.update([]);
    expect(tracker.statistics().related).toBe(2);
    tracker.update([set("alice", source, 4)], [{ batch: batch("unchanged", "alice", source) }]);
    expect(tracker.statistics().total).toBe(3);
    expect(events.filter((event) => event.type === "change_unit")).toHaveLength(3);
  });
  it("发现零跳、一跳与两跳，更新路径并关闭结束修改的候选对", () => {
    const baseline = "export function a() { return 1; }\nexport function b() { return a(); }\nexport function c() { return b(); }\nexport function isolated() { return 0; }\n";
    let source = baseline.replace("return 1", "return 2").replace("return a();", "return a() + 1;").replace("return b();", "return b() + 1;");
    let version = 1;
    let at = 1;
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => version }, now: () => performance.now() });
    index.update();
    const tracker = new SemanticChangeTracker({ index, readFile: () => source, now: () => at });
    const events: SemanticChangeEvent[] = [];
    tracker.onEvent((event) => events.push(event));
    function changeSet(memberId: string, name: string): ActiveChangeSet {
      const symbol = index.symbolsInFile("a.ts").find((symbol) => symbol.name === name)!;
      return { actor: { kind: "human", memberId }, status: "settled", files: new Map([["a.ts", { file: "a.ts", baseText: baseline, ranges: [{ start: symbol.start, end: symbol.end }], firstTouchedAt: 0, lastTouchedAt: at }]]) };
    }
    tracker.update([changeSet("alice", "a"), changeSet("bob", "a")]);
    expect(tracker.getCandidatePairs()[0]).toMatchObject({ distance: 0, path: null });
    tracker.update([changeSet("alice", "a"), changeSet("bob", "b")]);
    expect(tracker.getCandidatePairs()[0]?.distance).toBe(1);
    tracker.update([changeSet("alice", "a"), changeSet("bob", "c")]);
    const pair = tracker.getCandidatePairs()[0]!;
    expect(pair.distance).toBe(2);
    expect(pair.path?.hops).toEqual([
      { from: "a.ts#a", to: "a.ts#b", kind: "call", direction: "backward" },
      { from: "a.ts#b", to: "a.ts#c", kind: "call", direction: "backward" }
    ]);
    source = source.replace("return b() + 1;", "return a() + 2;");
    version += 1;
    at = 2;
    index.update(["a.ts"]);
    tracker.update([changeSet("alice", "a"), changeSet("bob", "c")]);
    expect(tracker.getCandidatePairs()[0]).toMatchObject({ id: pair.id, firstSeenAt: 1, updatedAt: 2, distance: 1 });
    expect(events.some((event) => event.type === "pair_candidate_updated")).toBe(true);
    tracker.captureStaleEdges();
    source = source.replace("return a() + 2;", "return 4;");
    version += 1;
    index.update(["a.ts"]);
    tracker.update([changeSet("alice", "a"), changeSet("bob", "c")]);
    expect(tracker.getCandidatePairs()).toEqual([]);
    expect(events.at(-1)?.type).toBe("pair_candidate_closed");
    source = source.replace("return 4;", "return a() + 2;");
    version += 1;
    index.update(["a.ts"]);
    tracker.update([changeSet("alice", "a"), changeSet("bob", "c")]);
    tracker.update([changeSet("alice", "a")]);
    expect(tracker.getCandidatePairs()).toEqual([]);
    expect(events.at(-1)?.type).toBe("pair_candidate_closed");
  });

  it("删除符号后使用活跃变更期间的墓碑关系", () => {
    const baseline = "export function target() { return 1; }\nexport function caller() { return target(); }\n";
    let source = baseline;
    let version = 1;
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => version }, now: () => performance.now() });
    index.update();
    const tracker = new SemanticChangeTracker({ index, readFile: () => source, now: () => version });
    const targetStart = baseline.indexOf("export function target");
    const callerStart = baseline.indexOf("export function caller");
    const active = (memberId: string, start: number, end: number, deletedSymbolKeys?: string[]): ActiveChangeSet => ({
      actor: { kind: "human", memberId },
      status: "settled",
      files: new Map([["a.ts", { file: "a.ts", baseText: baseline, ranges: [{ start, end }], firstTouchedAt: 0, lastTouchedAt: 1, deletedSymbolKeys }]])
    });
    tracker.update([active("alice", targetStart, targetStart), active("bob", callerStart, baseline.length)]);
    source = "export function caller() { return removedTarget(); }\n";
    version += 1;
    tracker.captureStaleEdges();
    index.update(["a.ts"]);
    tracker.update([
      active("alice", targetStart, targetStart, ["a.ts#target"]),
      active("bob", 0, source.length)
    ]);
    expect(tracker.getCandidatePairs()).toEqual(expect.arrayContaining([expect.objectContaining({ distance: 1, left: expect.objectContaining({ symbol: "a.ts#target", status: "deleted" }) })]));
    expect(index.incoming("a.ts#target")).toEqual([]);
    tracker.update([active("bob", 0, source.length)]);
    expect(tracker.findPaths(["a.ts#target"], ["a.ts#caller"], 2)).toEqual([]);
  });

  it("首次删除变更在索引更新前保存旧关系", () => {
    const baseline = "export function target() { return 1; }\nexport function caller() { return target(); }\n";
    let source = baseline;
    let version = 1;
    const index = createSemanticIndex({ files: { listFiles: () => ["a.ts"], readFile: () => source, version: () => version }, now: () => performance.now() });
    index.update();
    const tracker = new SemanticChangeTracker({ index, readFile: () => source, now: () => version });
    const targetStart = baseline.indexOf("export function target");
    const callerStart = baseline.indexOf("export function caller");
    const active: ActiveChangeSet[] = [
      { actor: { kind: "human", memberId: "alice" }, status: "settled", files: new Map([["a.ts", { file: "a.ts", baseText: baseline, ranges: [{ start: targetStart, end: targetStart }], firstTouchedAt: 0, lastTouchedAt: 1, deletedSymbolKeys: ["a.ts#target"] }]]) },
      { actor: { kind: "human", memberId: "bob" }, status: "settled", files: new Map([["a.ts", { file: "a.ts", baseText: baseline, ranges: [{ start: callerStart, end: baseline.length }], firstTouchedAt: 0, lastTouchedAt: 1 }]]) }
    ];
    source = "export function caller() { return removedTarget(); }\n";
    version += 1;
    tracker.captureStaleEdges(active);
    index.update(["a.ts"]);
    tracker.update(active);
    expect(tracker.getCandidatePairs()).toEqual(expect.arrayContaining([
      expect.objectContaining({ distance: 1, left: expect.objectContaining({ symbol: "a.ts#target", status: "deleted" }) })
    ]));
  });
});
