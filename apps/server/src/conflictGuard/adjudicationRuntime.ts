import fs from "node:fs/promises";
import path from "node:path";
import { createAdjudicationService, createJudgeRegistry, defaultAdjudicationConfig, type AdjudicationConfig, type CachedCall, type ConflictGuardClock, type DeepJudge, type FastJudge, type ProviderCall, type ProviderMode } from "@simplercp/conflict-guard";

export interface ServerAdjudicationConfig {
  settings?: AdjudicationConfig;
  mode?: ProviderMode;
  cacheDirectory?: string;
  jev: { apiKey?: string; baseUrl?: string };
  deepseek: { apiKey?: string; baseUrl?: string; model: string };
  compatible?: { apiKey?: string; baseUrl: string; model: string };
  judges?: { fast: FastJudge; deep: DeepJudge };
}

export function createServerAdjudication(options: ServerAdjudicationConfig, clock: ConflictGuardClock, sensitiveValues: string[], onCall: (call: ProviderCall) => void) {
  const config = options.settings ?? defaultAdjudicationConfig;
  const registry = createJudgeRegistry({ ...options, config, fetch: globalThis.fetch, now: clock.now });
  const directory = options.cacheDirectory;
  return createAdjudicationService({ config, clock, mode: options.mode ?? "live", sensitiveValues, fast: options.judges?.fast ?? registry.fast(config.fast), deep: options.judges?.deep ?? registry.deep(config.deep), onCall, onError: (stage) => console.error("Model adjudication infrastructure error", { stage }), cache: directory ? {
    async get(key) {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("缓存键无效");
      try { return JSON.parse(await fs.readFile(path.join(directory, `${key}.json`), "utf8")) as CachedCall; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    },
    async put(value) {
      if (!/^[a-f0-9]{64}$/.test(value.key)) throw new Error("缓存键无效");
      await fs.mkdir(directory, { recursive: true });
      const target = path.join(directory, `${value.key}.json`);
      const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.part`;
      await fs.writeFile(temporary, JSON.stringify(value) + "\n", { mode: 0o600 });
      await fs.rename(temporary, target);
    }
  } : undefined });
}
