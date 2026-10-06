import type { Decision, ZoneVerdict } from "../routing/classifier.js";
import type { ConflictGuardClock } from "../tracking/tracker.js";

export type GreyStrategy = "G0" | "G1" | "G2" | "G3" | "G4";
export type ProviderMode = "live" | "record" | "replay";
export type ProviderStatus = "success" | "timeout" | "failed" | "invalid-format" | "cancelled" | "cache-hit";
export interface AdjudicationInput {
  point?: "T1" | "T2" | "T3";
  reasoning?: boolean;
  promptVersion: string;
  left: { actorKind: string; file: string; symbol: string; before: string; after: string };
  right: AdjudicationInput["left"];
  relationship: string;
  invariants: string;
  invariantCoverage?: { callers: boolean; tests: boolean; comments: boolean; usage: boolean };
  local: { excludedRules: string[]; typecheck?: ZoneVerdict["typecheck"] };
}
export interface JudgeResult {
  decision: Decision;
  confidence: number;
  latencyMs: number;
  raw: unknown;
  probabilities?: Record<Decision, number>;
  evidence?: Array<{ path: string; symbol: string; reason: string }>;
  userExplanation?: string;
  suggestedAction?: string;
  usage?: { inputTokens: number; outputTokens: number };
}
export interface FastJudge { name: string; model: string; cacheParameters?: Record<string, unknown>; judge(input: AdjudicationInput, signal: AbortSignal): Promise<JudgeResult> }
export interface DeepJudge { name: string; model: string; cacheParameters?: Record<string, unknown>; judge(input: AdjudicationInput, options: { reasoning: boolean }, signal: AbortSignal): Promise<JudgeResult> }
export interface ProviderCall {
  point?: "T1" | "T2" | "T3";
  adapter: string;
  role?: "fast" | "deep";
  model: string;
  promptVersion: string;
  inputHash: string;
  cacheKey?: string;
  status: ProviderStatus;
  latencyMs: number;
  decision?: Decision;
  confidence?: number;
  usage?: JudgeResult["usage"];
  costUsd: number;
}
export interface ModelVerdictMetadata {
  point?: "T1" | "T2" | "T3";
  strategy: GreyStrategy;
  source: "fast" | "deep" | "fallback";
  adapter?: string;
  model?: string;
  confidence?: number;
  latencyMs: number;
  status: "success" | "degraded";
  escalated: boolean;
  userExplanation: string;
  suggestedAction: string;
  inputHash: string;
  promptVersion: string;
}
export interface CachedCall { key: string; input: AdjudicationInput; call: ProviderCall; parameters?: Record<string, unknown>; result?: JudgeResult }
export interface ModelCache { get(key: string): Promise<CachedCall | undefined>; put(value: CachedCall): Promise<void> }
export interface AdjudicationConfig {
  version: string;
  promptVersion: string;
  strategy: GreyStrategy;
  fast: string;
  deep: string;
  fastModel: string;
  fastSamplingCount?: number;
  threshold: number;
  t1Strategy: "G2" | "G3";
  t2Strategy?: "G1" | "G2" | "G3";
  t3Strategy?: "G1" | "G2" | "G3";
  t2Reasoning?: boolean;
  t3Reasoning?: boolean;
  point?: "T1" | "T2" | "T3";
  reasoning?: boolean;
  contextLimit: number;
  topK: number;
  invariants: boolean;
  softDeadlineMs: number;
  hardDeadlineMs: number;
  prices: { date: string; fastInputPerMillion: number; fastOutputPerMillion: number; deepInputPerMillion: number; deepOutputPerMillion: number };
}
export interface AdjudicationDependencies {
  clock: ConflictGuardClock;
  config: AdjudicationConfig;
  mode: ProviderMode;
  fast: FastJudge;
  deep: DeepJudge;
  cache?: ModelCache;
  sensitiveValues?: string[];
  onCall?(call: ProviderCall): void;
  onError?(stage: "trace" | "cache"): void;
}
export class ProviderError extends Error {
  constructor(public readonly status: Exclude<ProviderStatus, "success" | "cache-hit">, message = `provider ${status}`) { super(message); }
}
