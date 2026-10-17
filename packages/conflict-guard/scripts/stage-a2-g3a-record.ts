import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { calculateReplayMetrics, inputHash, type AdjudicationConfig, type AdjudicationInput, type ReplayGroupOutcome, type ZoneVerdict } from "../dist/index.js";
import { createModelRuntime, loadModelEnvironment, repositoryRoot } from "./model-runtime.ts";

type Probability = { allow: number; warn: number; lock: number };
type RecordedReport = { dataset: string; config: AdjudicationConfig; inputs: Array<{ input: AdjudicationInput; local: ZoneVerdict }>; responses: Array<[string, ZoneVerdict]>; model: { calls: Array<{ inputHash: string; cacheKey?: string; role?: string; status?: string; latencyMs?: number; costUsd?: number }> }; groups: Array<{ id: string; outcome: ReplayGroupOutcome; result: Record<string, any> }> };
const { values } = parseArgs({ options: { lower: { type: "string", default: "0.20" }, upper: { type: "string", default: "0.50" }, prompt: { type: "string", default: "pair-v1" }, output: { type: "string", default: "g3a-results.json" } } });
const lower = Number(values.lower);
const upper = Number(values.upper);
if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) throw new Error("G3a 阈值无效");
const promptVersion = values.prompt!;
if (!["pair-v1", "pair-v4", "pair-v5"].includes(promptVersion)) throw new Error("G3a 提示词版本无效");
const stageRoot = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A2");
loadModelEnvironment();
if (process.env.ADJUDICATION_BUDGET_SCOPE && process.env.ADJUDICATION_BUDGET_SCOPE !== "stage-a2") throw new Error("G3a 必须使用 stage-a2 预算");
process.env.ADJUDICATION_BUDGET_SCOPE = "stage-a2";
const sourceDirectory = path.join(stageRoot, "pair-v5/G2");
const sourceFile = path.join(sourceDirectory, "results.json.gz");
if (!existsSync(sourceFile)) throw new Error(`缺少 D1-v4 的 G2 录制：${sourceFile}`);
const report = JSON.parse(gunzipSync(await fs.readFile(sourceFile)).toString()) as RecordedReport;
if (report.dataset !== "d1-v4") throw new Error(`G3a 必须使用 D1-v4 录制，当前输入为 ${report.dataset}`);
const dataCheck = JSON.parse(await fs.readFile(path.join(stageRoot, "data-check.json"), "utf8")) as { grey: Array<{ id: string; grey: boolean }> };
const greyIds = new Set(dataCheck.grey.filter((row) => row.grey).map((row) => row.id));
const cacheDirectory = promptVersion === "pair-v1" ? path.join(repositoryRoot, ".test-workspaces/stage-a2-g3a-cache/pair-v1") : path.join(repositoryRoot, ".test-workspaces/stage-a2-g3a-cache");
const probabilities = new Map<string, Probability>();
for (const entry of report.responses) {
  const hash = entry[0];
  const input = report.inputs.find((row) => inputHash(row.input) === hash);
  if (!input) continue;
  const response = entry[1] as ZoneVerdict;
  const cacheKey = report.groups.flatMap((group) => group.result.judgements ?? []).map((judgement: any) => judgement.verdict?.adjudication?.inputHash === hash ? judgement.verdict.adjudication.inputHash : undefined).find(Boolean);
  if (!cacheKey) continue;
  const matchingCall = report.model.calls.find((call) => call.inputHash === hash);
  if (!matchingCall?.cacheKey) continue;
  try {
    const cached = JSON.parse(await fs.readFile(path.join(cacheDirectory, `${matchingCall.cacheKey}.json`), "utf8")) as { result?: { probabilities?: Probability } };
    if (cached.result?.probabilities) probabilities.set(hash, cached.result.probabilities);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!probabilities.has(hash) && response.adjudication?.confidence !== undefined) continue;
}

const baseDecision = (verdict: ZoneVerdict): "allow" | "warn" | "lock" => {
  const score = verdict.adjudication?.inputHash ? probabilities.get(verdict.adjudication.inputHash) : undefined;
  if (!score) return verdict.decision;
  return score.lock >= upper ? "lock" : score.lock < lower ? "allow" : "warn";
};
const aggregate = (decisions: string[]) => decisions.includes("lock") ? "lock" : decisions.includes("warn") ? "warn" : "allow";
const needsDeep = new Set<string>();
for (const group of report.groups.filter((row) => greyIds.has(row.id))) for (const pair of group.result.pairs ?? []) {
  const verdict = pair.final?.verdict as ZoneVerdict | undefined;
  if (verdict && baseDecision(verdict) === "warn" && verdict.adjudication?.inputHash) needsDeep.add(verdict.adjudication.inputHash);
}
const cachedHashes = new Set<string>();
if (!existsSync(cacheDirectory)) throw new Error(`G3a 深判缓存目录不存在：${cacheDirectory}`);
for (const file of await fs.readdir(cacheDirectory)) {
  if (!file.endsWith(".json")) continue;
  const cached = JSON.parse(await fs.readFile(path.join(cacheDirectory, file), "utf8")) as { call?: { inputHash?: string; role?: string; status?: string } };
  if (cached.call?.role === "deep" && cached.call.status === "success" && cached.call.inputHash) cachedHashes.add(cached.call.inputHash);
}
const missingDeepCache = [...needsDeep].filter((hash) => !cachedHashes.has(hash));
if (missingDeepCache.length) throw new Error(`G3a 深判缓存不完整，缺少 ${missingDeepCache.length} 个输入；本命令不会发起新的模型请求。`);
const inputs = new Map(report.inputs.map((row) => [inputHash(row.input), row]));
const config: AdjudicationConfig = { ...report.config, strategy: "G1", promptVersion, point: "T2", reasoning: true, hardDeadlineMs: 30000, softDeadlineMs: 2000 };
const models = JSON.parse(await fs.readFile(path.join(stageRoot, "models.json"), "utf8")) as Record<string, string>;
const providers = JSON.parse(await fs.readFile(path.join(stageRoot, "providers.json"), "utf8"));
const calls: Array<Record<string, unknown>> = [];
const runtime = createModelRuntime(config, "replay", cacheDirectory, (call) => calls.push(call), models, undefined, undefined, providers);
const deepResults = new Map<string, { verdict: ZoneVerdict; latencyMs: number; status: string }>();
for (const hash of needsDeep) {
  const entry = inputs.get(hash);
  if (!entry) throw new Error(`G3a 输入缺失：${hash}`);
  const result = await runtime.judge({ ...entry.input, promptVersion }, entry.local, new AbortController().signal);
  deepResults.set(hash, { verdict: { ...entry.local, decision: result.decision, zone: result.decision === "lock" ? "black" : result.decision === "allow" ? "white" : "grey", ruleId: `model-deep`, summary: result.adjudication?.userExplanation ?? result.summary, adjudication: result.adjudication }, latencyMs: result.latencyMs, status: result.adjudication?.status ?? "success" });
}
type TimelineEntry = { sample: string; pairId: string; revision: number; firstAt: number; firstDecision: "allow" | "warn" | "lock"; firstLatencyMs: number | null; deepRequested: boolean; deepAt: number | null; deepDecision: "allow" | "warn" | "lock" | null; deepApplied: boolean; invalidatedByRevision?: number };
const timeline: TimelineEntry[] = [];
for (const group of report.groups.filter((row) => greyIds.has(row.id))) {
  for (const pair of group.result.pairs ?? []) {
    const judgements = (group.result.judgements ?? []).filter((judgement: any) => judgement.pairId === pair.id && judgement.verdict?.ruleId === "model-fast").sort((left: any, right: any) => left.revision - right.revision || left.at - right.at);
    for (const judgement of judgements) {
      const hash = judgement.verdict.adjudication?.inputHash as string | undefined;
      const firstDecision = baseDecision(judgement.verdict);
      const deep = firstDecision === "warn" && hash ? deepResults.get(hash) : undefined;
      const deepAt = deep ? judgement.at + deep.latencyMs : null;
      const invalidated = deep ? judgements.find((candidate: any) => candidate.revision > judgement.revision && candidate.at <= deepAt) : undefined;
      timeline.push({ sample: group.id, pairId: pair.id, revision: judgement.revision, firstAt: judgement.at, firstDecision, firstLatencyMs: judgement.verdict.adjudication?.latencyMs ?? null, deepRequested: Boolean(deep), deepAt, deepDecision: deep?.verdict.decision ?? null, deepApplied: Boolean(deep && !invalidated), ...(invalidated ? { invalidatedByRevision: invalidated.revision } : {}) });
    }
  }
}
const groups = report.groups.filter((row) => greyIds.has(row.id)).map((group) => {
  const decisions = (group.result.pairs ?? []).flatMap((pair: any) => {
    const verdict = pair.final?.verdict as ZoneVerdict | undefined;
    if (!verdict) return [];
    const thresholdDecision = baseDecision(verdict);
    if (thresholdDecision !== "warn" || !verdict.adjudication?.inputHash) return [thresholdDecision];
    const entry = timeline.find((item) => item.sample === group.id && item.pairId === pair.id && item.revision === (pair.final?.revision ?? 0));
    return [entry?.deepApplied ? entry.deepDecision ?? "warn" : thresholdDecision];
  });
  const decision = aggregate(decisions) as ReplayGroupOutcome["decision"];
  return { ...group, outcome: { ...group.outcome, decision, missed: group.outcome.truth === "lock" && decision !== "lock", overblocked: group.outcome.truth === "allow" && decision === "lock" } };
});
const metrics = calculateReplayMetrics(groups.map((group) => group.outcome));
const quality = { balancedAccuracy: groups.filter((group) => group.outcome.truth === "lock").length ? (groups.filter((group) => group.outcome.truth === "lock" && group.outcome.decision === "lock").length / groups.filter((group) => group.outcome.truth === "lock").length + groups.filter((group) => group.outcome.truth === "allow" && group.outcome.decision !== "lock").length / groups.filter((group) => group.outcome.truth === "allow").length) / 2 : null, missBlockRate: metrics.missBlockRatio.value, falseBlockRate: metrics.falseBlockRatio.value, conflictNotificationRate: groups.filter((group) => group.outcome.truth === "lock" && group.outcome.decision !== "allow").length / Math.max(1, groups.filter((group) => group.outcome.truth === "lock").length), safeWarningRate: groups.filter((group) => group.outcome.truth === "allow" && group.outcome.decision === "warn").length / Math.max(1, groups.filter((group) => group.outcome.truth === "allow").length), threeClassAgreement: metrics.agreement.value };
const fastCalls = report.model.calls.filter((call) => call.role === "fast");
const completed = groups.filter((group) => group.result?.pairs?.some((pair: any) => pair.final?.verdict?.adjudication?.status === "success" && ["model-fast", "model-deep"].includes(String(pair.final.verdict.ruleId)))).length;
const percentile = (values: number[], fraction: number) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)]! : null;
const callSummary = (entries: Array<{ status?: string; latencyMs?: number; costUsd?: number }>) => {
  const successful = entries.filter((entry) => ["success", "cache-hit"].includes(String(entry.status))).length;
  const latency = entries.map((entry) => Number(entry.latencyMs)).filter(Number.isFinite).sort((left, right) => left - right);
  return { calls: entries.length, successfulRequests: successful, requestCompletionRate: entries.length ? successful / entries.length : null, p50Ms: percentile(latency, 0.5), p95Ms: percentile(latency, 0.95), costUsd: entries.reduce((sum, entry) => sum + Number(entry.costUsd ?? 0), 0) };
};
const deepSummary = callSummary(calls as Array<{ status?: string; latencyMs?: number; costUsd?: number }>);
const fastSummary = callSummary(fastCalls);
const output = { strategy: "G3a", promptVersion, sourcePromptVersion: report.config.promptVersion, dataset: report.dataset, threshold: { lower, upper }, greySamples: groups.length, deepInputCount: needsDeep.size, exploratory: true, executionMode: "virtual-timeline", completion: { completedChangePairs: completed, totalChangePairs: groups.length, rate: groups.length ? completed / groups.length : 0 }, model: { fast: fastSummary, deep: deepSummary, totalCalls: fastSummary.calls + deepSummary.calls, totalCostUsd: fastSummary.costUsd + deepSummary.costUsd, calls, stats: runtime.stats() }, timing: { firstConclusion: callSummary(fastCalls), deepConfirmation: deepSummary, deepApplied: timeline.filter((entry) => entry.deepApplied).length, deepInvalidated: timeline.filter((entry) => entry.deepRequested && !entry.deepApplied).length }, quality, timeline, groups: groups.map((group) => ({ id: group.id, truth: group.outcome.truth, decision: group.outcome.decision })) };
await fs.writeFile(path.join(stageRoot, values.output!), JSON.stringify(output, null, 2) + "\n");
runtime.dispose();
console.log(JSON.stringify({ strategy: output.strategy, greySamples: output.greySamples, deepInputCount: output.deepInputCount, calls: calls.length, quality }));
