import fs from "node:fs/promises";
import path from "node:path";
import { readTrace } from "../dist/trace/trace.js";
import { existsSync } from "node:fs";
import { checkReplay } from "../dist/replay/check.js";
import { replayLibraries } from "./replay-libs.ts";
import { createReplayModelPolicy, replayTrace, inputHash, cacheKey, canonicalJson, createAdjudicationService, VirtualClock, type CachedCall, type AdjudicationConfig, type AdjudicationInput, type ZoneVerdict } from "../dist/index.js";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({ args: process.argv.slice(2).filter((value) => value !== "--"), allowPositionals: true, options: { cache: { type: "string", default: "bench/model-cache" } } });
const input = positionals[0];
if (!input) throw new Error("必须提供轨迹文件");
const file = path.resolve(input);
const events = readTrace(await fs.readFile(file, "utf8"));
const projectFile = file.replace(/\.jsonl$/, "-project.json");
const initialFiles = existsSync(projectFile) ? JSON.parse(await fs.readFile(projectFile, "utf8")) as Record<string, string> : undefined;
const libs = await replayLibraries();
const settings = events.find((event) => event.type === "session_start")?.adjudication as AdjudicationConfig | undefined;
let policy;
const cacheKeys: string[] = [];
let replayedProviderCalls: ReturnType<ReturnType<typeof createAdjudicationService>["calls"]> = [];
if (settings) {
  const directory = path.resolve(values.cache!);
  const calls = events.filter((event) => event.type === "provider_call");
  const entries = new Map<string, CachedCall>();
  for (const call of calls.filter((call) => call.status !== "cancelled")) {
    if (typeof call.cacheKey !== "string" || !/^[a-f0-9]{64}$/.test(call.cacheKey)) throw new Error("provider_call 缺少有效缓存键");
    const entry = JSON.parse(await fs.readFile(path.join(directory, `${call.cacheKey}.json`), "utf8"));
    if (entry.key !== call.cacheKey || entry.call.inputHash !== call.inputHash || !entry.parameters || cacheKey(entry.input, entry.call.adapter, entry.call.model, entry.parameters) !== entry.key) throw new Error("provider_call 与缓存内容不一致");
    entries.set(entry.key, entry);
    cacheKeys.push(call.cacheKey);
  }
  const identity = (role: "fast" | "deep", name: string) => {
    const recorded = [...entries.values()].filter((entry) => entry.call.role === role && entry.call.adapter === name && (!entry.call.point || entry.call.point === "T1"));
    const comparable = (entry: CachedCall) => { const { availableBudgetMs: _budget, ...parameters } = entry.parameters ?? {}; return { model: entry.call.model, parameters }; };
    if (new Set(recorded.map((entry) => canonicalJson(comparable(entry)))).size > 1) throw new Error("轨迹中同一角色包含不同 T1 请求配置");
    const entry = recorded[0];
    const { role: _role, reasoning: _reasoning, hardDeadlineMs: _deadline, availableBudgetMs: _budget, ...cacheParameters } = entry?.parameters ?? {};
    return { name, model: entry?.call.model ?? (role === "fast" ? settings.fastModel : "unrecorded"), cacheParameters, async judge(): Promise<never> { throw new Error("回放校验禁止联网"); } };
  };
  const service = createAdjudicationService({ config: settings, mode: "replay", clock: new VirtualClock(), fast: identity("fast", settings.fast), deep: identity("deep", settings.deep), cache: { async get(key) { return entries.get(key); }, async put() { throw new Error("回放校验禁止改写缓存"); } } });
  const cancelled = new Set(calls.filter((call) => call.status === "cancelled").map((call) => String(call.inputHash)));
  for (const event of events.filter((event) => event.type === "pair_judged")) {
    const verdict = event.verdict as ZoneVerdict;
    if (verdict.adjudication) cancelled.delete(verdict.adjudication.inputHash);
  }
  const requests = new Map<string, { input: AdjudicationInput; local: ZoneVerdict }>();
  const responses = new Map<string, ZoneVerdict>();
  const contexts = Object.keys(initialFiles ?? {});
  for (let pass = 0; ; pass += 1) {
    if (pass > events.length) throw new Error("回放校验的输入集合未能稳定");
    requests.clear();
    replayTrace(events, { policy: createReplayModelPolicy(settings, responses, (input, local) => requests.set(inputHash(input), { input, local }), contexts, cancelled), libs, initialFiles });
    const missing = [...requests].filter(([hash]) => !responses.has(hash) && !cancelled.has(hash));
    if (!missing.length) break;
    for (const [hash, request] of missing) responses.set(hash, await service.judge(request.input, request.local, new AbortController().signal));
  }
  policy = createReplayModelPolicy(settings, responses, undefined, contexts, cancelled);
  replayedProviderCalls = service.calls();
  service.dispose();
}
const result = { ...checkReplay(events, { libs, initialFiles, ...(policy ? { policy } : {}) }), modelCache: { checked: cacheKeys.length, keys: cacheKeys, calls: replayedProviderCalls } };
console.log(JSON.stringify(result));
if (!result.valid) process.exitCode = 1;
