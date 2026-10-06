import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdjudicationService, createJudgeRegistry, defaultAdjudicationConfig, type AdjudicationConfig, type CachedCall, type ProviderCall, type ProviderMode } from "../dist/index.js";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export function loadModelEnvironment() { process.loadEnvFile(path.join(repositoryRoot, ".env")); }
export function createModelRuntime(config: AdjudicationConfig = defaultAdjudicationConfig, mode: ProviderMode = "replay", directory = path.join(repositoryRoot, "packages/conflict-guard/bench/model-cache"), onCall?: (call: ProviderCall) => void) {
  const env = process.env;
  let budgetExhausted = false;
  const secrets = [env.TYPESAFE_API_KEY, env.DEEPSEEK_API_KEY, env.ADJUDICATION_COMPATIBLE_API_KEY].filter((value): value is string => Boolean(value));
  const wrappedFetch: typeof fetch = async (url, init) => {
    const fast = String(url).endsWith("/v1/systemone");
    const budgetFile = path.join(repositoryRoot, ".test-workspaces/stage5-call-budget.json");
    let budget = { fast: 0, deep: 0 };
    try { budget = JSON.parse(await fs.readFile(budgetFile, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (fast ? budget.fast >= 2000 : budget.deep >= 800) {
      budgetExhausted = true;
      const evidence = path.join(repositoryRoot, "docs/conflict-guard/evidence/stage-5-budget-stop.json");
      await fs.mkdir(path.dirname(evidence), { recursive: true });
      await fs.writeFile(evidence, JSON.stringify({ reason: "call-limit", role: fast ? "fast" : "deep", calls: budget, limits: { fast: 2000, deep: 800 } }, null, 2) + "\n");
      throw new Error("真实调用预算已达到上限");
    }
    if (fast) budget.fast += 1; else budget.deep += 1;
    await fs.mkdir(path.dirname(budgetFile), { recursive: true });
    await fs.writeFile(budgetFile, JSON.stringify(budget) + "\n");
    return fetch(url, init);
  };
  const registry = createJudgeRegistry({ config, now: () => performance.now(), fetch: wrappedFetch, jev: { apiKey: env.TYPESAFE_API_KEY, baseUrl: env.TYPESAFE_BASE_URL }, deepseek: { apiKey: env.DEEPSEEK_API_KEY, baseUrl: env.DEEPSEEK_BASE_URL, model: env.DEEPSEEK_MODEL ?? "deepseek-flash" }, ...(env.ADJUDICATION_COMPATIBLE_BASE_URL && env.ADJUDICATION_COMPATIBLE_MODEL ? { compatible: { apiKey: env.ADJUDICATION_COMPATIBLE_API_KEY, baseUrl: env.ADJUDICATION_COMPATIBLE_BASE_URL, model: env.ADJUDICATION_COMPATIBLE_MODEL } } : {}) });
  const service = createAdjudicationService({ config, mode, sensitiveValues: secrets, fast: registry.fast(config.fast), deep: registry.deep(config.deep), clock: { now: () => performance.now(), setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) }, onCall, onError: (stage) => console.error(JSON.stringify({ infrastructureError: stage })), cache: {
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
