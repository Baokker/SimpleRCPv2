import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdjudicationService, createJudgeRegistry, defaultAdjudicationConfig, type AdjudicationConfig, type CachedCall, type ProviderCall, type ProviderMode, type ProviderSubscription } from "../dist/index.js";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export function loadModelEnvironment() { const file = path.join(repositoryRoot, ".env"); if (existsSync(file)) process.loadEnvFile(file); }
export function createModelRuntime(config: AdjudicationConfig = defaultAdjudicationConfig, mode: ProviderMode = "replay", directory = path.join(repositoryRoot, "packages/conflict-guard/bench/model-cache"), onCall?: (call: ProviderCall) => void, models: Record<string, string> = {}, recordedSubscriptions?: readonly ProviderSubscription[]) {
  if (models.jev && models.jev !== config.fastModel) throw new Error("录制快判版本与配置不一致");
  const env = process.env;
  const scope = env.ADJUDICATION_BUDGET_SCOPE ?? "stage5";
  if (!/^[a-z0-9-]+$/.test(scope)) throw new Error("调用预算名称无效");
  const limits = { fast: 2000, deep: scope === "checkpoint-b" ? 1000 : 800 };
  let budgetExhausted = false;
  const secrets = Object.entries(env).filter(([name, value]) => /(?:KEY|TOKEN|SECRET)(?:_|$)/i.test(name) && value).map(([, value]) => value!);
  const wrappedFetch: typeof fetch = async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const fast = String(url).endsWith("/v1/systemone") || body.logprobs === true || body.messages?.[0]?.content?.endsWith("Output exactly one word: allow, warn, or lock.");
    const budgetFile = path.join(repositoryRoot, `.test-workspaces/${scope}-call-budget.json`);
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
    return fetch(url, init);
  };
  const registry = createJudgeRegistry({ config, now: () => performance.now(), fetch: wrappedFetch, jev: { apiKey: env.TYPESAFE_API_KEY, baseUrl: env.TYPESAFE_BASE_URL }, deepseek: { apiKey: env.DEEPSEEK_API_KEY, baseUrl: env.DEEPSEEK_BASE_URL, model: models.deepseek ?? env.DEEPSEEK_MODEL ?? "deepseek-flash" }, ...(env.ADJUDICATION_COMPATIBLE_BASE_URL && env.ADJUDICATION_COMPATIBLE_MODEL || mode === "replay" && models["openai-compatible"] ? { compatible: { apiKey: env.ADJUDICATION_COMPATIBLE_API_KEY, baseUrl: env.ADJUDICATION_COMPATIBLE_BASE_URL ?? "", model: models["openai-compatible"] ?? env.ADJUDICATION_COMPATIBLE_MODEL! } } : {}) });
  const service = createAdjudicationService({ config, mode, sensitiveValues: secrets, fast: registry.fast(config.fast), deep: registry.deep(config.deep), clock: { now: () => performance.now(), setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) }, onCall, recordedSubscriptions, onError: (stage) => console.error(JSON.stringify({ infrastructureError: stage })), cache: {
    async get(key) {
      try { return JSON.parse(await fs.readFile(path.join(directory, `${key}.json`), "utf8")) as CachedCall; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    },
    async put(value) {
      await fs.mkdir(directory, { recursive: true });
      const target = path.join(directory, `${value.key}.json`);
      const temporary = `${target}.${process.pid}.part`;
      await fs.writeFile(temporary, JSON.stringify(value) + "\n", { mode: 0o600 });
      await fs.rename(temporary, target);
    }
  } });
  return { ...service, async judge(...args: Parameters<typeof service.judge>) {
    const verdict = await service.judge(...args);
    if (budgetExhausted) throw new Error("真实调用预算已达到上限，命令已经停止，原因已写入证据目录");
    return verdict;
  } };
}
