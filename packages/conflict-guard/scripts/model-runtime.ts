import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdjudicationService, createJudgeRegistry, defaultAdjudicationConfig, type AdjudicationConfig, type CachedCall, type ProviderCall, type ProviderMode, type ProviderSubscription } from "../dist/index.js";
import type { createExperimentBudget } from "./experiment-budget.ts";
import { providerConfiguration, type ModelProviderConfiguration } from "./model-providers.ts";
import { createModelCacheWriter } from "./model-cache-writer.ts";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export function loadModelEnvironment() { const file = path.join(repositoryRoot, ".env"); if (existsSync(file)) process.loadEnvFile(file); }
export function createModelRuntime(config: AdjudicationConfig = defaultAdjudicationConfig, mode: ProviderMode = "replay", directory = path.join(repositoryRoot, "packages/conflict-guard/bench/model-cache"), onCall?: (call: ProviderCall) => void, models: Record<string, string> = {}, recordedSubscriptions?: readonly ProviderSubscription[], experimentBudget?: Awaited<ReturnType<typeof createExperimentBudget>>, providers: ModelProviderConfiguration = {}) {
  if (models.jev && models.jev !== config.fastModel) throw new Error("录制快判版本与配置不一致");
  for (const [adapter, provider] of Object.entries(providers)) {
    if (!["jev", "minimax", "deepseek", "openai-compatible"].includes(adapter) || !provider || typeof provider.baseUrl !== "string" || !provider.baseUrl.trim() || provider.jsonMode !== undefined && typeof provider.jsonMode !== "boolean" || provider.temperature !== undefined && (!Number.isFinite(provider.temperature) || provider.temperature < 0 || provider.temperature > 2)) throw new Error("模型请求配置无效");
  }
  const env = process.env;
  const scope = env.ADJUDICATION_BUDGET_SCOPE ?? "stage5";
  if (!/^[a-z0-9-]+$/.test(scope)) throw new Error("调用预算名称无效");
  const limits = scope === "preexperiment" ? { fast: 1000, deep: 600 } : { fast: 2000, deep: scope === "checkpoint-b" ? 1000 : 800 };
  let budgetExhausted = false;
  let budgetFailure: unknown;
  let budgetWrites = Promise.resolve();
  let budgetReservations = Promise.resolve();
  const secrets = Object.entries(env).filter(([name, value]) => /(?:KEY|TOKEN|SECRET)(?:_|$)/i.test(name) && value).map(([, value]) => value!);
  const wrappedFetch: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const fast = String(url).endsWith("/v1/systemone") || body.logprobs === true || body.messages?.[0]?.content?.endsWith("Output exactly one word: allow, warn, or lock.");
    if (experimentBudget) {
      try { await experimentBudget.consume(fast ? "fast" : "deep"); }
      catch (error) { budgetFailure = error; throw error; }
      return fetch(url, init);
    }
    const budgetFile = path.join(repositoryRoot, `.test-workspaces/${scope}-call-budget.json`);
    budgetReservations = budgetReservations.then(async () => {
    let budget = { fast: 0, deep: 0 };
    try { budget = JSON.parse(await fs.readFile(budgetFile, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (fast ? budget.fast >= limits.fast : budget.deep >= limits.deep) {
      budgetExhausted = true;
      const evidence = path.join(repositoryRoot, `docs/conflict-guard/evidence/${scope}-budget-stop.json`);
      await fs.mkdir(path.dirname(evidence), { recursive: true });
      await fs.writeFile(evidence, JSON.stringify({ reason: "call-limit", role: fast ? "fast" : "deep", calls: budget, limits }, null, 2) + "\n");
      throw new Error("真实调用预算已达到上限");
    }
    if (fast) budget.fast += 1; else budget.deep += 1;
    await fs.mkdir(path.dirname(budgetFile), { recursive: true });
    await fs.writeFile(budgetFile, JSON.stringify(budget) + "\n");
    });
    await budgetReservations;
    return fetch(url, init);
  };
  const registry = createJudgeRegistry({ config, now: () => performance.now(), fetch: wrappedFetch, jev: { apiKey: env.TYPESAFE_API_KEY, baseUrl: providers.jev?.baseUrl ?? env.TYPESAFE_BASE_URL }, deepseek: { apiKey: env.DEEPSEEK_API_KEY, baseUrl: providers.deepseek?.baseUrl ?? env.DEEPSEEK_BASE_URL, model: models.deepseek ?? env.DEEPSEEK_MODEL ?? "deepseek-flash" }, minimax: { apiKey: env.MINIMAX_API_KEY, baseUrl: providers.minimax?.baseUrl ?? env.MINIMAX_BASE_URL, model: models.minimax ?? env.MINIMAX_MODEL ?? "MiniMax-M3", jsonMode: providers.minimax?.jsonMode ?? env.MINIMAX_JSON_MODE !== "false", temperature: providers.minimax?.temperature ?? Number(env.MINIMAX_TEMPERATURE ?? 0) }, ...(env.ADJUDICATION_COMPATIBLE_BASE_URL && env.ADJUDICATION_COMPATIBLE_MODEL || mode === "replay" && models["openai-compatible"] ? { compatible: { apiKey: env.ADJUDICATION_COMPATIBLE_API_KEY, baseUrl: providers["openai-compatible"]?.baseUrl ?? env.ADJUDICATION_COMPATIBLE_BASE_URL ?? "", model: models["openai-compatible"] ?? env.ADJUDICATION_COMPATIBLE_MODEL! } } : {}) });
  const fastJudge = registry.fast(config.fast);
  const deepJudge = registry.deep(config.deep);
  const actualProviders = Object.fromEntries([fastJudge, deepJudge].map((judge) => [judge.name, providerConfiguration(judge.name, judge.cacheParameters!)]));
  let cacheMisses = 0;
  const cacheWriter = createModelCacheWriter(directory);
  const service = createAdjudicationService({ config, mode, sensitiveValues: secrets, fast: fastJudge, deep: deepJudge, clock: { now: () => performance.now(), setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) }, onCall(call) {
    onCall?.(call);
    if (experimentBudget && call.status !== "cache-hit") budgetWrites = budgetWrites.then(() => experimentBudget.consume("usd", call.costUsd)).catch((error) => { budgetFailure = error; });
  }, recordedSubscriptions, onError: (stage) => console.error(JSON.stringify({ infrastructureError: stage })), cache: {
    async get(key) {
      const candidates = [directory, ...(/^G[0-4]$/.test(path.basename(directory)) ? ["G1", "G2"].map((policy) => path.join(path.dirname(directory), policy)).filter((candidate) => candidate !== directory) : [])];
      for (const candidate of candidates) {
        try { return JSON.parse(await fs.readFile(path.join(candidate, `${key}.json`), "utf8")) as CachedCall; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      cacheMisses += 1;
      return undefined;
    },
    async put(value) {
      await cacheWriter.put(value);
    }
  } });
  return { ...service, providerConfiguration: actualProviders, cacheMisses: () => cacheMisses, async judge(...args: Parameters<typeof service.judge>) {
    const verdict = await service.judge(...args);
    await budgetWrites;
    if (budgetFailure) throw budgetFailure;
    if (budgetExhausted) throw new Error("真实调用预算已达到上限，命令已经停止，原因已写入证据目录");
    return verdict;
  } };
}
