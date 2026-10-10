import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CachedCall, ProviderCall } from "../dist/index.js";

export interface ProviderConfiguration { baseUrl: string; jsonMode?: boolean; temperature?: number }
export type ModelProviderConfiguration = Record<string, ProviderConfiguration>;

export function providerConfiguration(adapter: string, parameters: Record<string, unknown>): ProviderConfiguration {
  if (typeof parameters.endpoint !== "string" || !parameters.endpoint.trim()) throw new Error("模型录制缺少实际端点");
  return { baseUrl: parameters.endpoint, ...(adapter === "minimax" ? { jsonMode: parameters.response_format !== undefined, temperature: Number(parameters.temperature) } : {}) };
}

export async function recordedProviderConfiguration(policies: Record<string, { model: { calls: ProviderCall[]; providers?: ModelProviderConfiguration } }>, directory: string) {
  const configuration: ModelProviderConfiguration = {};
  for (const [policy, report] of Object.entries(policies)) {
    if (report.model.providers) {
      for (const [adapter, provider] of Object.entries(report.model.providers)) {
        if (configuration[adapter] && !isDeepStrictEqual(configuration[adapter], provider)) throw new Error("同一适配器包含不同请求配置");
        configuration[adapter] = provider;
      }
      if (report.model.calls.some((call) => !configuration[call.adapter])) throw new Error("模型报告缺少实际请求配置");
      continue;
    }
    for (const call of report.model.calls) {
      if (!call.cacheKey) throw new Error("模型录制缺少缓存身份");
      const directories = [...new Set([policy, "G1", "G2"])];
      let entry: CachedCall | undefined;
      for (const candidate of directories) {
        try { entry = JSON.parse(await fs.readFile(path.join(directory, candidate, `${call.cacheKey}.json`), "utf8")); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      if (!entry?.parameters || entry.key !== call.cacheKey || entry.call.adapter !== call.adapter || entry.call.model !== call.model) throw new Error("模型录制缓存身份不完整");
      const actual = providerConfiguration(call.adapter, entry.parameters);
      if (configuration[call.adapter] && !isDeepStrictEqual(configuration[call.adapter], actual)) throw new Error("同一适配器包含不同请求配置");
      configuration[call.adapter] = actual;
    }
  }
  return configuration;
}
