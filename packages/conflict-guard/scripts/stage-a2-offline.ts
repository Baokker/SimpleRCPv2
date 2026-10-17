import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { calculateReplayMetrics, replayOutcome, type ZoneVerdict } from "../dist/index.js";
import { repositoryRoot } from "./model-runtime.ts";

type Probability = { allow: number; warn: number; lock: number };
type RecordedGroup = { id: string; relationGroupId: string; programHash: string; outcome: ReturnType<typeof replayOutcome>; result: Record<string, any> };
type RecordedReport = { dataset: string; config: Record<string, unknown>; model: { calls: Array<Record<string, unknown>>; syntaxDeferred?: number; syntaxWaitP50Ms?: number | null; syntaxWaitP95Ms?: number | null }; responses: Array<[string, ZoneVerdict]>; groups: RecordedGroup[] };

const { values } = parseArgs({ options: {
  source: { type: "string", default: "docs/conflict-guard/experiment/v2/stage-A2/pair-v4/G2/results.json.gz" },
  dataset: { type: "string", default: "packages/conflict-guard/bench/datasets/d1-v4" },
  cache: { type: "string" },
  grey: { type: "string", default: "docs/conflict-guard/experiment/v2/stage-A2/data-check.json" },
  prompt: { type: "string", default: "pair-v4" },
  out: { type: "string", default: "docs/conflict-guard/experiment/v2/stage-A2/offline-results.json" },
  lower: { type: "string", multiple: true },
  upper: { type: "string", multiple: true },
  standard: { type: "boolean", default: false }
} });

const sourcePath = path.resolve(repositoryRoot, values.source!);
const datasetPath = path.resolve(repositoryRoot, values.dataset!);
const report = JSON.parse(gunzipSync(await fs.readFile(sourcePath)).toString()) as RecordedReport;
const promptVersion = values.prompt!;
const dataCheck = JSON.parse(await fs.readFile(path.resolve(repositoryRoot, values.grey!), "utf8")) as { grey: Array<{ id: string; grey: boolean }> };
const greyIds = new Set(dataCheck.grey.filter((row) => row.grey).map((row) => row.id));
const cacheDirectory = path.resolve(repositoryRoot, values.cache ?? `.test-workspaces/stage-a-cache/${promptVersion}/G2`);
const baseResponses = new Map<string, ZoneVerdict>(report.responses);
const probabilities = new Map<string, Probability>();
for (const call of report.model.calls) {
  if (call.status !== "success" || typeof call.cacheKey !== "string" || typeof call.inputHash !== "string") continue;
  try {
    const cached = JSON.parse(await fs.readFile(path.join(cacheDirectory, `${call.cacheKey}.json`), "utf8")) as { result?: { probabilities?: Probability } };
    const value = cached.result?.probabilities;
    if (value && Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry))) probabilities.set(call.inputHash, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const thresholdPairs = (values.lower?.length ? values.lower.map(Number) : [0.05, 0.10, 0.15, 0.20]).flatMap((lower) => (values.upper?.length ? values.upper.map(Number) : [0.50, 0.60, 0.70, 0.80]).filter((upper) => lower < upper).map((upper) => ({ lower, upper })));
const strategies = [
  ...(values.standard ? thresholdPairs.map((pair) => ({ id: `G2p-new-${pair.lower.toFixed(2)}-${pair.upper.toFixed(2)}`, kind: "threshold" as const, ...pair })) : [{ id: "G2", kind: "original" as const }, ...thresholdPairs.map((pair) => ({ id: `G2p-${pair.lower.toFixed(2)}-${pair.upper.toFixed(2)}`, kind: "threshold" as const, ...pair }))]),
];
const manifest = JSON.parse(await fs.readFile(path.join(datasetPath, "manifest.json"), "utf8")) as { version: string };

const results = [] as Array<Record<string, unknown>>;
for (const strategy of strategies) {
  const outcomes = [] as ReturnType<typeof replayOutcome>[];
  const groups = [] as Array<{ id: string; relationGroupId: string; truth: string; decision: string; operatorFamily: string; detectability: string; probability?: Probability }>;
  for (const sample of report.groups.filter((row) => greyIds.has(row.id))) {
    const decision = strategy.kind === "threshold" ? finalDecisionWithThreshold(sample.result, probabilities, strategy.lower, strategy.upper) : sample.outcome.decision;
    const outcome = { ...sample.outcome, decision, missed: sample.outcome.truth === "lock" && decision !== "lock", overblocked: sample.outcome.truth === "allow" && decision === "lock" };
    outcomes.push(outcome);
    groups.push({ id: sample.id, relationGroupId: sample.relationGroupId, truth: sample.outcome.truth, decision: outcome.decision, operatorFamily: sample.outcome.operatorFamily ?? "unknown", detectability: sample.outcome.detectability ?? "unknown", ...probabilityForGroup(sample.result, probabilities) });
  }
  const metrics = calculateReplayMetrics(outcomes);
  const quality = binaryQuality(outcomes);
  const calls = report.model.calls.filter((call) => call.role === "fast");
  const validGroups = groups.filter((row) => rowHasValidModelResult(report.groups.find((sample) => sample.id === row.id)?.result));
  results.push({ id: strategy.id, promptVersion, metrics, quality, completion: { completedChangePairs: validGroups.length, totalChangePairs: groups.length, rate: groups.length ? validGroups.length / groups.length : 0 }, model: modelMetrics(report.model, calls, report.groups.filter((row) => greyIds.has(row.id))), probabilityInputs: probabilities.size, groups });
}

await fs.mkdir(path.dirname(path.resolve(repositoryRoot, values.out!)), { recursive: true });
await fs.writeFile(path.resolve(repositoryRoot, values.out!), JSON.stringify({ dataset: manifest.version, split: "dev", source: values.source, cacheDirectory, results }, null, 2) + "\n");
console.log(JSON.stringify({ dataset: manifest.version, split: "dev", source: values.source, probabilityInputs: probabilities.size, strategies: results.map((row) => ({ id: row.id, quality: row.quality })) }));

function binaryQuality(outcomes: Array<ReturnType<typeof replayOutcome>>) {
  const conflicts = outcomes.filter((outcome) => outcome.truth === "lock");
  const safe = outcomes.filter((outcome) => outcome.truth === "allow");
  const truePositive = conflicts.filter((outcome) => outcome.decision === "lock").length;
  const trueNegative = safe.filter((outcome) => outcome.decision !== "lock").length;
  const miss = conflicts.length - truePositive;
  const falseBlock = safe.length - trueNegative;
  const notifications = outcomes.filter((outcome) => outcome.truth === "lock" && outcome.decision !== "allow").length;
  const safeWarnings = safe.filter((outcome) => outcome.decision === "warn").length;
  const agreement = outcomes.filter((outcome) => outcome.truth === outcome.decision).length;
  return {
    balancedAccuracy: conflicts.length && safe.length ? ((truePositive / conflicts.length) + (trueNegative / safe.length)) / 2 : null,
    conflictRecall: conflicts.length ? truePositive / conflicts.length : null,
    safeContinuation: safe.length ? trueNegative / safe.length : null,
    missBlockRate: conflicts.length ? miss / conflicts.length : null,
    falseBlockRate: safe.length ? falseBlock / safe.length : null,
    conflictNotificationRate: conflicts.length ? notifications / conflicts.length : null,
    safeWarningRate: safe.length ? safeWarnings / safe.length : null,
    threeClassAgreement: outcomes.length ? agreement / outcomes.length : null,
    counts: { conflicts: conflicts.length, safe: safe.length, truePositive, trueNegative, miss, falseBlock, notifications, safeWarnings, agreement }
  };
}

function modelMetrics(model: RecordedReport["model"], calls: Array<Record<string, unknown>>, groups: RecordedGroup[]) {
  const latency = calls.map((call) => Number(call.latencyMs)).filter(Number.isFinite).sort((left, right) => left - right);
  const percentile = (fraction: number) => latency.length ? latency[Math.max(0, Math.ceil(latency.length * fraction) - 1)]! : null;
  const syntaxPairs = new Map<string, { deferred: number; waitMs: number }>();
  for (const group of groups) for (const pair of group.result.pairs ?? []) {
    const records = Array.isArray(pair.records) ? pair.records : [];
    const waits = records.map((record: any) => record.pair?.syntaxWait).filter((value: any) => value && Number.isFinite(value.waitMs));
    if (waits.length) syntaxPairs.set(String(pair.id), waits.reduce((current: { deferred: number; waitMs: number }, value: { deferred?: number; waitMs: number }) => ({ deferred: Math.max(current.deferred, Number(value.deferred ?? 0)), waitMs: Math.max(current.waitMs, Number(value.waitMs)) }), { deferred: 0, waitMs: 0 }));
  }
  const syntaxWaits = [...syntaxPairs.values()].map((value) => value.waitMs).sort((left, right) => left - right);
  const syntaxPercentile = (fraction: number) => syntaxWaits.length ? syntaxWaits[Math.max(0, Math.ceil(syntaxWaits.length * fraction) - 1)]! : null;
  return { requestCompletionRate: calls.length ? calls.filter((call) => ["success", "cache-hit"].includes(String(call.status))).length / calls.length : 0, calls: calls.length, successfulRequests: calls.filter((call) => ["success", "cache-hit"].includes(String(call.status))).length, failures: calls.filter((call) => !["success", "cache-hit"].includes(String(call.status))).length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), syntaxDeferred: [...syntaxPairs.values()].reduce((sum, value) => sum + value.deferred, 0) || (model.syntaxDeferred ?? 0), syntaxWaitP50Ms: syntaxPercentile(0.5) ?? model.syntaxWaitP50Ms ?? null, syntaxWaitP95Ms: syntaxPercentile(0.95) ?? model.syntaxWaitP95Ms ?? null, costUsd: calls.reduce((sum, call) => sum + Number(call.costUsd ?? 0), 0) };
}

function rowHasValidModelResult(result: Record<string, any> | undefined) {
  return Boolean(result?.judgements?.some((judgement: { verdict?: ZoneVerdict }) => judgement.verdict?.adjudication?.status === "success" && ["model-fast", "model-deep"].includes(String(judgement.verdict.ruleId))));
}

function probabilityForGroup(result: { judgements: Array<{ verdict: ZoneVerdict }> }, scores: Map<string, Probability>) {
  for (const judgement of result.judgements) {
    const hash = judgement.verdict.adjudication?.inputHash;
    if (hash && scores.has(hash)) return { probability: scores.get(hash) };
  }
  return {};
}

function finalDecisionWithThreshold(result: Record<string, any>, scores: Map<string, Probability>, lower: number, upper: number) {
  const decisions = (result.pairs ?? []).flatMap((pair: { final?: { verdict?: ZoneVerdict } }) => pair.final?.verdict ? [decisionForVerdict(pair.final.verdict, scores, lower, upper)] : []);
  return decisions.includes("lock") ? "lock" : decisions.includes("warn") ? "warn" : "allow";
}

function decisionForVerdict(verdict: ZoneVerdict, scores: Map<string, Probability>, lower: number, upper: number): "allow" | "warn" | "lock" {
  const score = verdict.adjudication?.inputHash ? scores.get(verdict.adjudication.inputHash) : undefined;
  if (!score) return verdict.decision;
  return score.lock >= upper ? "lock" : score.lock < lower ? "allow" : "warn";
}
