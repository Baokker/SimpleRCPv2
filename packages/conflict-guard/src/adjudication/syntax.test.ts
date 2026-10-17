import { expect, it } from "vitest";
import { createSyntaxWaitTracker } from "./syntax.js";
import { buildAdjudicationInput } from "./invariants.js";
import { createAdjudicationService } from "./service.js";
import { createJudgeRegistry } from "./adapters.js";
import { defaultAdjudicationConfig } from "./config.js";
import { MemoryFileProvider } from "../replay/files.js";
import { createSemanticIndex } from "../semantic/index.js";
import { classify } from "../routing/classifier.js";
import { createPairCoordinator } from "../coordination/pairState.js";
import type { CandidatePair } from "../routing/candidates.js";
import type { ZoneInput, ZoneVerdict } from "../routing/classifier.js";

function declarations() {
  const files = new MemoryFileProvider({ "a.ts": "export function price(value = 2) { return value * 2; }", "b.ts": 'import { price } from "./a"; export function buy() { return price(10); }' });
  const project = createSemanticIndex({ files, now: () => 0 });
  project.update();
  const side = (file: string, name: string, memberId: string) => {
    const symbol = project.symbolsInFile(file).find((symbol) => symbol.name === name)!;
    const before = files.readFile(file).slice(symbol.start, symbol.end);
    return { actor: { kind: "human" as const, memberId }, symbol: { ...symbol, status: "modified" as const, before, after: before, lastTouchedAt: 0 } };
  };
  const input: ZoneInput = { left: side("a.ts", "price", "alice"), right: side("b.ts", "buy", "bob"), project, path: project.findPaths(["a.ts#price"], ["b.ts#buy"])[0]!, nested: false, typeOnly: false };
  input.left.symbol.after = "export function price(value = 3) { return value *";
  input.right.symbol.after = "export function buy() { return price(10) + 1; }";
  return input;
}

it("计算首次语法推迟到声明恢复完整的全部等待时间", () => {
  const input = declarations();
  const tracker = createSyntaxWaitTracker();
  expect(tracker.observe("pair", "r1", [input.left.symbol], 100)).toEqual({ deferred: 1, waitMs: 0 });
  expect(tracker.observe("pair", "r1", [input.left.symbol], 200)).toEqual({ deferred: 1, waitMs: 100 });
  expect(tracker.observe("pair", "r2", [input.left.symbol], 300)).toEqual({ deferred: 2, waitMs: 200 });
  input.left.symbol.after += " 2; }";
  expect(tracker.observe("pair", "r3", [input.left.symbol], 450)).toEqual({ deferred: 2, waitMs: 350 });
  expect(tracker.observe("pair", "r3", [input.left.symbol], 900)).toEqual({ deferred: 2, waitMs: 350 });
  input.left.symbol.after = "export function price(value = 3) { return value *";
  expect(tracker.observe("pair", "r4", [input.left.symbol], 1000)).toEqual({ deferred: 3, waitMs: 350 });
  input.left.symbol.after += " 2; }";
  expect(tracker.observe("pair", "r5", [input.left.symbol], 1200)).toEqual({ deferred: 3, waitMs: 550 });
  tracker.retain(new Set());
  expect(tracker.observe("pair", "r5", [input.left.symbol], 1300)).toBeUndefined();
  input.left.symbol.after = "export function price(value = 3) { return value *";
  expect(tracker.observe("closed", "r1", [input.left.symbol], 1400)).toEqual({ deferred: 1, waitMs: 0 });
  expect(tracker.observe("closed", "r1", [input.left.symbol], 1500, true)).toEqual({ deferred: 1, waitMs: 100 });
  expect(tracker.observe("closed", "r1", [input.left.symbol], 600000, true)).toEqual({ deferred: 1, waitMs: 100 });
});

it("变更集结束后停止语法等待计时，并且同一版本不重复累计", () => {
  const input = declarations();
  const tracker = createSyntaxWaitTracker();
  expect(tracker.observe("pair", "r1", [input.left.symbol], 100)).toEqual({ deferred: 1, waitMs: 0 });
  tracker.finalize("pair", "r1", 250);
  expect(tracker.observe("pair", "r1", [input.left.symbol], 1000)).toEqual({ deferred: 1, waitMs: 150 });
  expect(tracker.observe("pair", "r1", [input.left.symbol], 2000)).toEqual({ deferred: 1, waitMs: 150 });
  expect(tracker.observe("pair", "r2", [input.left.symbol], 2100)).toEqual({ deferred: 2, waitMs: 150 });
});

it("等待结果保留候选且不进入最终缓存，下一次完整修改重新检查", async () => {
  const input = declarations();
  const config = { ...defaultAdjudicationConfig, strategy: "G1" as const };
  const registry = createJudgeRegistry({ fetch: globalThis.fetch, now: () => 0, config, jev: {}, deepseek: { model: "unused" } });
  const service = createAdjudicationService({ config, mode: "live", fast: registry.fast("jev"), deep: registry.deep("minimax"), clock: { now: () => 0, setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout) } });
  const pair: CandidatePair = { id: "syntax-pair", revisionKey: "incomplete", left: { actor: input.left.actor, symbol: input.left.symbol.key, status: "modified" }, right: { actor: input.right.actor, symbol: input.right.symbol.key, status: "modified" }, path: input.path, distance: 1, firstSeenAt: 0, updatedAt: 0 };
  const resultCache = new Map<string, { verdict: ZoneVerdict; pair: CandidatePair }>();
  let completion = Promise.resolve();
  const coordinator = createPairCoordinator({ now: () => 0, resultCache, classify: () => classify(input), adjudicate(_pair, local, signal, complete) { completion = service.judge(buildAdjudicationInput(input, local, config), local, signal).then(complete); } });
  coordinator.update([pair]);
  await completion;
  expect(coordinator.get(pair.id)?.verdict?.ruleId).toBe("syntax-incomplete-waiting");
  expect(coordinator.get(pair.id)?.status).toBe("pending");
  expect(resultCache.size).toBe(0);
  expect(service.stats().calls).toBe(0);
  coordinator.update([pair]);
  expect(service.stats().syntaxDeferred).toBe(1);
  const local = classify(input);
  const finalInput = buildAdjudicationInput(input, local, config);
  finalInput.syntax!.batchClosed = true;
  expect(await service.judge(finalInput, local, new AbortController().signal)).toMatchObject({ ruleId: "syntax-incomplete-final", localOnly: true });
  expect(service.stats().calls).toBe(0);
  input.left.symbol.after += " 2; }";
  coordinator.update([{ ...pair, revisionKey: "complete" }]);
  await completion;
  expect(coordinator.get(pair.id)?.status).toBe("judged");
  expect(coordinator.get(pair.id)?.revision).toBe(1);
  expect(service.stats().calls).toBe(1);
  expect(resultCache.size).toBe(1);
  coordinator.dispose();
  service.dispose();
});
