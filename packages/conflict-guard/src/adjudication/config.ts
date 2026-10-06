import type { AdjudicationConfig } from "./types.js";

export const defaultAdjudicationConfig: AdjudicationConfig = {
  version: "adjudication-v1",
  promptVersion: "pair-v1",
  strategy: "G3",
  fast: "jev",
  deep: "deepseek",
  fastModel: "jev-1.13.0",
  threshold: 0,
  t1Strategy: "G3",
  t2Strategy: "G1",
  t3Strategy: "G1",
  t2Reasoning: false,
  t3Reasoning: false,
  contextLimit: 3000,
  topK: 3,
  invariants: true,
  softDeadlineMs: 2000,
  hardDeadlineMs: 8000,
  prices: { date: "2026-10-06", fastInputPerMillion: 0.042, fastOutputPerMillion: 0, deepInputPerMillion: 0.3, deepOutputPerMillion: 1.2 }
};

export function validateAdjudicationConfig(config: AdjudicationConfig) {
  if (!["G0", "G1", "G2", "G3", "G4"].includes(config.strategy) || !["G2", "G3"].includes(config.t1Strategy)) throw new Error("无效的研判策略");
  if (!Number.isFinite(config.threshold) || config.threshold < 0 || config.threshold > 1) throw new Error("研判阈值必须介于 0 与 1");
  if (config.fastModel !== "jev-1.13.0") throw new Error("快判模型必须固定为 jev-1.13.0");
  if (!Number.isInteger(config.contextLimit) || config.contextLimit < 1 || config.contextLimit > 3000) throw new Error("上下文上限必须介于 1 与 3000");
  const deadline = config.point === "T2" ? 30000 : config.point === "T3" ? 60000 : 8000;
  if (config.point !== undefined && !["T1", "T2", "T3"].includes(config.point)) throw new Error("研判时点无效");
  for (const strategy of [config.t2Strategy, config.t3Strategy]) if (strategy !== undefined && !["G1", "G2", "G3"].includes(strategy)) throw new Error("Agent 研判策略无效");
  if (![config.softDeadlineMs, config.hardDeadlineMs].every(Number.isFinite) || config.softDeadlineMs < 0 || config.hardDeadlineMs <= config.softDeadlineMs || config.hardDeadlineMs > deadline) throw new Error("研判时间预算无效");
  if (!Number.isInteger(config.topK) || config.topK < 1 || config.topK > 3) throw new Error("调用点数量必须介于 1 与 3");
  for (const [key, value] of Object.entries(config.prices)) if (key !== "date" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("价格配置无效");
  return config;
}
