import { expect, it } from "vitest";
import { VirtualClock } from "../replay/clock.js";
import { createAdjudicationService } from "./service.js";
import { defaultAdjudicationConfig } from "./config.js";
import type { CachedCall, JudgeResult, ProviderSubscription } from "./types.js";
import { createJudgeRegistry } from "./adapters.js";

const input = { promptVersion: "pair-v1", left: { actorKind: "human", file: "a.ts", symbol: "a.ts#a", before: "a", after: "b" }, right: { actorKind: "human", file: "b.ts", symbol: "b.ts#b", before: "c", after: "d" }, relationship: "call", invariants: "", local: { excludedRules: [] } };
const local = { zone: "grey" as const, decision: "warn" as const, ruleId: "semantic-interaction-uncertain", summary: "可能互相影响", evidence: [], contractChanged: { left: false, right: false } };
const result: JudgeResult = { decision: "allow", confidence: 0.9, latencyMs: 10, raw: {} };

it("separates fast and deep cache entries when adapter and model names match", async () => {
  const cache = new Map<string, CachedCall>();
  const dependencies = { clock: new VirtualClock(), mode: "record" as const, cache: { async get(key: string) { return cache.get(key); }, async put(value: CachedCall) { cache.set(value.key, value); } }, fast: { name: "openai-compatible", model: "same-model", cacheParameters: { logprobs: true }, async judge() { return { ...result, decision: "allow" as const }; } }, deep: { name: "openai-compatible", model: "same-model", cacheParameters: { response_format: { type: "json_object" } }, async judge() { return { ...result, decision: "lock" as const }; } } };
  const fast = createAdjudicationService({ ...dependencies, config: { ...defaultAdjudicationConfig, strategy: "G2" } });
  const deep = createAdjudicationService({ ...dependencies, config: { ...defaultAdjudicationConfig, strategy: "G1" } });
  expect((await fast.judge(input, local, new AbortController().signal)).decision).toBe("allow");
  expect((await deep.judge(input, local, new AbortController().signal)).decision).toBe("lock");
  expect(cache.size).toBe(2);
  expect(new Set([...cache.values()].map((entry) => entry.call.role))).toEqual(new Set(["fast", "deep"]));
});

it("reports replay cache misses identically when the wall clock changes", async () => {
  const clock = new VirtualClock();
  const service = createAdjudicationService({ clock, config: { ...defaultAdjudicationConfig, strategy: "G2" }, mode: "replay", fast: { name: "jev", model: "jev-1.13.0", async judge() { throw new Error("replay must stay offline"); } }, deep: { name: "deepseek", model: "test", async judge() { throw new Error("replay must stay offline"); } }, cache: { async get() { clock.advanceTo(clock.now() + 37); return undefined; }, async put() {} } });
  const first = await service.judge(input, local, new AbortController().signal);
  clock.advanceTo(1000);
  const second = await service.judge(input, local, new AbortController().signal);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(first.adjudication).toMatchObject({ status: "degraded", latencyMs: 0 });
  expect(service.stats().calls).toBe(0);
});

it("在配对录制中只复用快判缓存并保留深判请求", async () => {
  const cache = new Map<string, CachedCall>();
  let fastCalls = 0;
  let deepCalls = 0;
  const fast = { name: "jev", model: "jev-1.13.0", async judge() { fastCalls += 1; return { ...result, decision: "warn" as const }; } };
  const deep = { name: "minimax", model: "MiniMax-M3", async judge() { deepCalls += 1; return { ...result, decision: "lock" as const }; } };
  const dependencies = { clock: new VirtualClock(), cache: { async get(key: string) { return cache.get(key); }, async put(value: CachedCall) { cache.set(value.key, value); } }, fast, deep };
  const record = createAdjudicationService({ ...dependencies, mode: "record", config: { ...defaultAdjudicationConfig, strategy: "G2" } });
  await record.judge(input, local, new AbortController().signal);
  const paired = createAdjudicationService({ ...dependencies, mode: "record", cacheReadRoles: new Set(["fast"]), cacheMissAsFailure: true, config: { ...defaultAdjudicationConfig, strategy: "G3a" } });
  const verdict = await paired.judge(input, local, new AbortController().signal);
  expect(verdict.decision).toBe("lock");
  expect(fastCalls).toBe(1);
  expect(deepCalls).toBe(1);
  expect(paired.stats().cacheHits).toBe(1);
});

it("selects G4 T2 deep reasoning with its own budget and cache identity", async () => {
  const cache = new Map<string, CachedCall>();
  const received: boolean[] = [];
  const dependencies = { clock: new VirtualClock(), mode: "record" as const, cache: { async get(key: string) { return cache.get(key); }, async put(value: CachedCall) { cache.set(value.key, value); } }, fast: { name: "jev", model: "jev-1.13.0", async judge() { throw new Error("T2 must select deep"); } }, deep: { name: "deepseek", model: "test", async judge(_input: unknown, options: { reasoning: boolean }) { received.push(options.reasoning); return result; } } };
  const t1 = createAdjudicationService({ ...dependencies, config: { ...defaultAdjudicationConfig, strategy: "G1" } });
  const t2 = createAdjudicationService({ ...dependencies, config: { ...defaultAdjudicationConfig, strategy: "G4", point: "T2", t2Strategy: "G1", reasoning: true, hardDeadlineMs: 30000 } });
  await t1.judge(input, local, new AbortController().signal);
  const verdict = await t2.judge(input, local, new AbortController().signal);
  expect(received).toEqual([false, true]);
  expect(cache.size).toBe(2);
  expect(verdict.adjudication).toMatchObject({ source: "deep", point: "T2" });
});

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

it("G3a publishes the fast conclusion before the deep confirmation", async () => {
  const updates: string[] = [];
  const received: boolean[] = [];
  const promptVersions: string[] = [];
  const service = createAdjudicationService({
    clock: new VirtualClock(),
    config: { ...defaultAdjudicationConfig, strategy: "G3a", reasoning: true },
    mode: "live",
    fast: { name: "jev", model: "jev-1.13.0", async judge() { return { ...result, decision: "warn" as const }; } },
    deep: { name: "minimax", model: "MiniMax-M3", async judge(deepInput, options) { received.push(options.reasoning); promptVersions.push(deepInput.promptVersion); return { ...result, decision: "allow" as const }; } }
  });
  const final = await service.judgeWithUpdates(input, local, new AbortController().signal, undefined, (verdict, update) => { updates.push(`${verdict.decision}:${update?.final !== false ? "final" : "initial"}`); });
  expect(updates).toEqual(["warn:initial", "allow:final"]);
  expect(received).toEqual([true]);
  expect(promptVersions).toEqual(["pair-v1"]);
  expect(final).toMatchObject({ decision: "allow", ruleId: "model-deep" });
});

it("white and black verdicts never call providers", async () => {
  let calls = 0;
  const judge = async () => { calls += 1; return result; };
  const service = createAdjudicationService({ clock: new VirtualClock(), config: defaultAdjudicationConfig, mode: "live", fast: { name: "jev", model: "jev-1.13.0", judge }, deep: { name: "deepseek", model: "test", judge } });
  for (const zone of ["white", "black"] as const) expect((await service.judge(input, { ...local, zone }, new AbortController().signal)).zone).toBe(zone);
  expect(calls).toBe(0);
});

it("defers incomplete declarations without calling either model and records the wait", async () => {
  const registry = createJudgeRegistry({ fetch: globalThis.fetch, now: () => 0, config: defaultAdjudicationConfig, jev: {}, deepseek: { model: "unused" } });
  const service = createAdjudicationService({
    clock: new VirtualClock(),
    config: { ...defaultAdjudicationConfig, strategy: "G3a" },
    mode: "live",
    fast: registry.fast("jev"),
    deep: registry.deep("minimax")
  });
  const incomplete = {
    ...input,
    syntax: {
      left: { complete: false, reason: "after declaration has syntax diagnostics" },
      right: { complete: true },
      deferred: true
    }
  };
  const updates: Array<{ verdict: unknown; final?: boolean }> = [];
  const verdict = await service.judgeWithUpdates(incomplete, local, new AbortController().signal, { deferred: 1, waitMs: 240 }, (verdict, update) => updates.push({ verdict, final: update?.final }));
  expect(verdict).toMatchObject({ decision: "warn", ruleId: "syntax-incomplete-waiting", localOnly: true, deferred: { reason: "syntax-incomplete" } });
  expect(updates).toEqual([{ verdict, final: true }]);
  expect(service.calls()).toHaveLength(0);
  expect(service.stats()).toMatchObject({ calls: 0, judgements: 0, syntaxDeferred: 1, syntaxWaitP50Ms: 240, syntaxWaitP95Ms: 240 });
  const closed = await service.judgeWithUpdates({ ...incomplete, syntax: { ...incomplete.syntax, batchClosed: true } }, local, new AbortController().signal, undefined, (verdict, update) => updates.push({ verdict, final: update?.final }));
  expect(closed).toMatchObject({ decision: "warn", ruleId: "syntax-incomplete-final" });
  const white = { ...local, zone: "white" as const, decision: "allow" as const };
  expect(await service.judgeWithUpdates(input, white, new AbortController().signal, undefined, (verdict, update) => updates.push({ verdict, final: update?.final }))).toEqual(white);
  expect(updates).toEqual([{ verdict, final: true }, { verdict: closed, final: true }, { verdict: white, final: true }]);
  expect(service.calls()).toHaveLength(0);
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

it("shared deep requests preserve each subscriber's cascade deadline", async () => {
  const clock = new VirtualClock();
  let completeFast: (value: JudgeResult) => void = () => {};
  let completeDeep: (value: JudgeResult) => void = () => {};
  let deepSignal: AbortSignal | undefined;
  let deepCalls = 0;
  const service = createAdjudicationService({ clock, config: defaultAdjudicationConfig, mode: "live", fast: { name: "jev", model: "jev-1.13.0", judge() { return new Promise((resolve) => { completeFast = resolve; }); } }, deep: { name: "deepseek", model: "test", judge(_input, _options, signal) { deepCalls += 1; deepSignal = signal; return new Promise((resolve) => { completeDeep = resolve; }); } } });
  const first = service.judge(input, local, new AbortController().signal);
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  clock.advanceTo(6000);
  const second = service.judge(input, local, new AbortController().signal);
  clock.advanceTo(7000);
  completeFast({ ...result, decision: "lock", latencyMs: 7000 });
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  expect(deepCalls).toBe(1);
  clock.advanceTo(8000);
  expect(await first).toMatchObject({ decision: "warn", adjudication: { status: "degraded", latencyMs: 8000 } });
  expect(deepSignal?.aborted).toBe(false);
  clock.advanceTo(9000);
  completeDeep({ ...result, latencyMs: 2000 });
  expect(await second).toMatchObject({ decision: "allow", adjudication: { source: "deep", status: "success", latencyMs: 3000 } });
});

it("replays staggered subscribers with their own waits and timeout outcomes", async () => {
  const clock = new VirtualClock();
  const cache = new Map<string, CachedCall>();
  const subscriptions: ProviderSubscription[] = [];
  let completeFast!: (value: JudgeResult) => void;
  let completeDeep!: (value: JudgeResult) => void;
  let networkCalls = 0;
  const dependencies = { config: defaultAdjudicationConfig, fast: { name: "jev", model: "jev-1.13.0", judge() { networkCalls += 1; return new Promise<JudgeResult>((resolve) => { completeFast = resolve; }); } }, deep: { name: "deepseek", model: "test", judge() { networkCalls += 1; return new Promise<JudgeResult>((resolve) => { completeDeep = resolve; }); } }, cache: { async get(key: string) { return cache.get(key); }, async put(entry: CachedCall) { cache.set(entry.key, entry); } } };
  const recording = createAdjudicationService({ ...dependencies, clock, mode: "record", onSubscription: (subscription: ProviderSubscription) => subscriptions.push(subscription) });
  const first = recording.judge(input, local, new AbortController().signal);
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  clock.advanceTo(6000);
  const second = recording.judge(input, local, new AbortController().signal);
  clock.advanceTo(7000);
  completeFast({ ...result, decision: "lock", latencyMs: 7000 });
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  clock.advanceTo(8000);
  const left = await first;
  clock.advanceTo(9000);
  completeDeep({ ...result, latencyMs: 2000 });
  const right = await second;
  expect([left.decision, right.decision]).toEqual(["warn", "allow"]);
  expect(subscriptions.map(({ role, occurrence, status, latencyMs, budgetMs }) => ({ role, occurrence, status, latencyMs, budgetMs }))).toEqual([
    { role: "fast", occurrence: 1, status: "success", latencyMs: 7000, budgetMs: 8000 },
    { role: "fast", occurrence: 2, status: "success", latencyMs: 1000, budgetMs: 8000 },
    { role: "deep", occurrence: 1, status: "timeout", latencyMs: 1000, budgetMs: 1000 },
    { role: "deep", occurrence: 2, status: "success", latencyMs: 2000, budgetMs: 7000 }
  ]);
  expect([...cache.values()].map((entry) => entry.call.status)).toEqual(["success", "success"]);
  expect(recording.stats()).toMatchObject({ calls: 2, judgements: 2, failures: 1 });
  const replay = createAdjudicationService({ ...dependencies, clock: new VirtualClock(), mode: "replay", recordedSubscriptions: subscriptions });
  expect(await replay.judge(input, local, new AbortController().signal)).toEqual(left);
  expect(await replay.judge(input, local, new AbortController().signal)).toEqual(right);
  expect(networkCalls).toBe(2);
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

for (const point of ["T2", "T3"] as const) it(`aborts the ${point} provider at the configured Agent deadline`, async () => {
  const clock = new VirtualClock();
  let providerSignal: AbortSignal | undefined;
  const duration = point === "T2" ? 30000 : 60000;
  const service = createAdjudicationService({ clock, config: { ...defaultAdjudicationConfig, strategy: "G4", point, hardDeadlineMs: duration }, mode: "live", fast: { name: "jev", model: "jev-1.13.0", async judge() { return result; } }, deep: { name: "deepseek", model: "test", judge(_input, _options, signal) { providerSignal = signal; return new Promise(() => {}); } } });
  const pending = service.judge({ ...input, point }, local, new AbortController().signal);
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  expect(providerSignal).toBeDefined();
  clock.advanceTo(duration);
  expect(await pending).toMatchObject({ adjudication: { status: "degraded", latencyMs: duration } });
  expect(providerSignal?.aborted).toBe(true);
});
