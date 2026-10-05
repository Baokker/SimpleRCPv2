import { describe, expect, it } from "vitest";
import type { CandidatePair } from "../routing/candidates.js";
import type { SymbolChange } from "../semantic/changes.js";
import { MemoryFileProvider } from "./files.js";
import { VirtualClock } from "./clock.js";
import { createP0Policy, createP1Policy, createP2Policy } from "./policies.js";
import { replayTrace } from "./engine.js";
import type { TraceEvent } from "../trace/trace.js";
import { calculateReplayMetrics } from "./metrics.js";

describe("阶段 4 回放基础设施", () => {
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

  it("锁定后落入冻结文件的编辑被标记为应当阻止", () => {
    const trace = simpleTrace();
    trace.push({ schema: 3, seq: 4, at: 20, type: "doc_open", file: "src/b.ts", text: "import { run } from \"./a.js\";\nexport function other() { return run(); }\n", textHash: "" });
    trace.push({ schema: 3, seq: 5, at: 30, type: "edit", file: "src/b.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: 0, deleted: "import { run } from \"./a.js\";\nexport function other() { return run(); }\n", inserted: "import { run } from \"./a.js\";\nexport function other() { return run() + 1; }\n" }], revisionAfter: 1 });
    trace.push({ schema: 3, seq: 6, at: 40, type: "edit", file: "src/a.ts", origin: { kind: "human", memberId: "bob" }, ops: [{ from: 0, deleted: "export function run() { return 2; }\n", inserted: "export function run() { return 3; }\n" }], revisionAfter: 2 });
    const result = replayTrace(trace, { policy: "P2" });
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
