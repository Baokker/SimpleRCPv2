import { expect, it } from "vitest";
import { VirtualClock } from "../replay/clock.js";
import { createAdjudicationService } from "./service.js";
import { defaultAdjudicationConfig } from "./config.js";
import type { CachedCall, JudgeResult } from "./types.js";

const input = { promptVersion: "pair-v1", left: { actorKind: "human", file: "a.ts", symbol: "a.ts#a", before: "a", after: "b" }, right: { actorKind: "human", file: "b.ts", symbol: "b.ts#b", before: "c", after: "d" }, relationship: "call", invariants: "", local: { excludedRules: [] } };
const local = { zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain", summary: "可能互相影响", evidence: [], contractChanged: { left: false, right: false } };
const result: JudgeResult = { decision: "allow", confidence: 0.9, latencyMs: 10, raw: {} };

it("coalesces concurrent calls, records and replays without network", async () => {
  const clock = new VirtualClock(); const cache = new Map<string, CachedCall>(); let requests = 0;
  const fast = { name: "jev", model: "jev-1.13.0", async judge() { requests += 1; return result; } };
  const dependencies = { clock, config: { ...defaultAdjudicationConfig, strategy: "G2" as const }, fast, deep: { name: "deepseek", model: "deepseek-chat", async judge() { return result; } }, cache: { async get(key: string) { return cache.get(key); }, async put(value: CachedCall) { cache.set(value.key, value); } } };
  const service = createAdjudicationService({ ...dependencies, mode: "record" });
  const [left, right] = await Promise.all([service.judge(input, local, new AbortController().signal), service.judge(input, local, new AbortController().signal)]);
  expect(requests).toBe(1); expect(left).toEqual(right);
  const replay = createAdjudicationService({ ...dependencies, mode: "replay" });
  expect(await replay.judge(input, local, new AbortController().signal)).toEqual(left);
  expect(requests).toBe(1);
  expect((await replay.judge({ ...input, invariants: "missing" }, local, new AbortController().signal)).adjudication?.status).toBe("degraded");
});

it("hard deadline returns warn even if a provider ignores cancellation", async () => {
  const clock = new VirtualClock(); let signal: AbortSignal | undefined;
  const service = createAdjudicationService({ clock, config: { ...defaultAdjudicationConfig, strategy: "G2" }, mode: "live", fast: { name: "jev", model: "jev-1.13.0", judge(_input, incoming) { signal = incoming; return new Promise(() => {}); } }, deep: { name: "deepseek", model: "deepseek-chat", async judge() { return result; } } });
  const promise = service.judge(input, local, new AbortController().signal);
  await Promise.resolve(); await Promise.resolve();
  clock.advanceTo(8000);
  expect((await promise).decision).toBe("warn");
  expect(signal?.aborted).toBe(true);
});

it("one cancelled subscriber does not cancel another; last subscriber aborts", async () => {
  const clock = new VirtualClock(); let signal: AbortSignal | undefined; let finish: (value: JudgeResult) => void = () => {};
  const service = createAdjudicationService({ clock, config: { ...defaultAdjudicationConfig, strategy: "G2" }, mode: "live", fast: { name: "jev", model: "jev-1.13.0", judge(_input, incoming) { signal = incoming; return new Promise((resolve) => { finish = resolve; }); } }, deep: { name: "deepseek", model: "deepseek-chat", async judge() { return result; } } });
  const first = new AbortController(); const second = new AbortController();
  const a = service.judge(input, local, first.signal); const b = service.judge(input, local, second.signal);
  await Promise.resolve(); await Promise.resolve();
  first.abort(); expect(signal?.aborted).toBe(false);
  finish(result);
  await expect(a).rejects.toMatchObject({ status: "cancelled" });
  expect((await b).decision).toBe("allow");
});

it("G3 escalates low confidence, lock and failures within one T1 budget", async () => {
  for (const response of [{ ...result, confidence: 0.4 }, { ...result, decision: "lock" as const }, undefined]) {
    let deepCalls = 0;
    const service = createAdjudicationService({ clock: new VirtualClock(), config: { ...defaultAdjudicationConfig, threshold: 0.7 }, mode: "live", fast: { name: "jev", model: "jev-1.13.0", async judge() { if (!response) throw new Error("测试故障"); return response; } }, deep: { name: "deepseek", model: "test", async judge() { deepCalls += 1; return { ...result, decision: "warn", userExplanation: "需要共同检查。", suggestedAction: "请双方检查计算。" }; } } });
    expect((await service.judge(input, local, new AbortController().signal)).adjudication).toMatchObject({ source: "deep", escalated: true });
    expect(deepCalls).toBe(1);
  }
});

it("white and black verdicts never call providers", async () => {
  let calls = 0;
  const judge = async () => { calls += 1; return result; };
  const service = createAdjudicationService({ clock: new VirtualClock(), config: defaultAdjudicationConfig, mode: "live", fast: { name: "jev", model: "jev-1.13.0", judge }, deep: { name: "deepseek", model: "test", judge } });
  for (const zone of ["white", "black"] as const) expect((await service.judge(input, { ...local, zone }, new AbortController().signal)).zone).toBe(zone);
  expect(calls).toBe(0);
});

it("rejects corrupted cached decisions and confidence", async () => {
  const clock = new VirtualClock(); const cache = new Map<string, CachedCall>();
  const dependencies = { clock, config: { ...defaultAdjudicationConfig, strategy: "G2" as const }, fast: { name: "jev", model: "jev-1.13.0", async judge() { return result; } }, deep: { name: "deepseek", model: "test", async judge() { return result; } }, cache: { async get(key: string) { return cache.get(key); }, async put(value: CachedCall) { cache.set(value.key, value); } } };
  await createAdjudicationService({ ...dependencies, mode: "record" }).judge(input, local, new AbortController().signal);
  const entry = [...cache.values()][0]!;
  entry.result!.confidence = 2;
  const verdict = await createAdjudicationService({ ...dependencies, mode: "replay" }).judge(input, local, new AbortController().signal);
  expect(verdict).toMatchObject({ decision: "warn", adjudication: { status: "degraded" } });
});

it("bounds stalled cache access by the T1 deadline", async () => {
  const clock = new VirtualClock();
  const service = createAdjudicationService({ clock, config: { ...defaultAdjudicationConfig, strategy: "G2" }, mode: "replay", fast: { name: "jev", model: "jev-1.13.0", async judge() { return result; } }, deep: { name: "deepseek", model: "test", async judge() { return result; } }, cache: { get() { return new Promise(() => {}); }, async put() {} } });
  const pending = service.judge(input, local, new AbortController().signal);
  clock.advanceTo(8000);
  expect(await pending).toMatchObject({ decision: "warn", adjudication: { status: "degraded", latencyMs: 8000 } });
});

it("bounds the entire cascade even when reported fast latency excludes waiting", async () => {
  const clock = new VirtualClock(); let completeFast: (value: JudgeResult) => void = () => {}; let deepSignal: AbortSignal | undefined;
  const service = createAdjudicationService({ clock, config: defaultAdjudicationConfig, mode: "live", fast: { name: "jev", model: "jev-1.13.0", judge() { return new Promise((resolve) => { completeFast = resolve; }); } }, deep: { name: "deepseek", model: "test", judge(_input, _options, signal) { deepSignal = signal; return new Promise(() => {}); } } });
  const pending = service.judge(input, local, new AbortController().signal);
  await Promise.resolve(); await Promise.resolve();
  clock.advanceTo(7000); completeFast({ ...result, decision: "lock", latencyMs: 10 });
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  expect(deepSignal).toBeDefined();
  clock.advanceTo(8000);
  expect(await pending).toMatchObject({ decision: "warn", adjudication: { status: "degraded", latencyMs: 8000 } });
  expect(deepSignal?.aborted).toBe(true);
});

it("late subscribers retain their own remaining cascade budget", async () => {
  const clock = new VirtualClock(); let deepCalls = 0;
  const service = createAdjudicationService({ clock, config: defaultAdjudicationConfig, mode: "live", fast: { name: "jev", model: "jev-1.13.0", judge() { return new Promise(() => {}); } }, deep: { name: "deepseek", model: "test", async judge() { deepCalls += 1; return result; } } });
  const first = service.judge(input, local, new AbortController().signal);
  clock.advanceTo(6000);
  const second = service.judge(input, local, new AbortController().signal);
  clock.advanceTo(8000);
  expect(await first).toMatchObject({ decision: "warn", adjudication: { status: "degraded", latencyMs: 8000 } });
  expect(await second).toMatchObject({ decision: "allow", adjudication: { source: "deep", latencyMs: 2010 } });
  expect(deepCalls).toBe(1);
});

it("counts trace callbacks and failed cache writes without failing adjudication", async () => {
  const service = createAdjudicationService({ clock: new VirtualClock(), config: { ...defaultAdjudicationConfig, strategy: "G2" }, mode: "record", fast: { name: "jev", model: "jev-1.13.0", async judge() { throw new Error("测试故障"); } }, deep: { name: "deepseek", model: "test", async judge() { return result; } }, onCall() { throw new Error("测试故障"); }, cache: { async get() { return undefined; }, async put() { throw new Error("测试故障"); } } });
  expect((await service.judge(input, local, new AbortController().signal)).decision).toBe("warn");
  expect(service.stats().infrastructureFailures).toBe(2);
});

it("retains completed request usage and cost when recording fails", async () => {
  const service = createAdjudicationService({ clock: new VirtualClock(), config: { ...defaultAdjudicationConfig, strategy: "G2" }, mode: "record", fast: { name: "jev", model: "jev-1.13.0", async judge() { return { ...result, usage: { inputTokens: 1000, outputTokens: 0 } }; } }, deep: { name: "deepseek", model: "test", async judge() { return result; } }, cache: { async get() { return undefined; }, async put() { throw new Error("测试故障"); } } });
  expect((await service.judge(input, local, new AbortController().signal)).decision).toBe("warn");
  expect(service.stats().costUsd).toBeCloseTo(0.000042, 8);
  expect(service.calls()[0]?.usage?.inputTokens).toBe(1000);
  expect(service.stats().infrastructureFailures).toBeGreaterThan(0);
});
