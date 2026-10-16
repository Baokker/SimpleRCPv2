import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { calculateReplayMetrics, replayOutcome, selectDevelopmentCandidate, type DevelopmentCandidate } from "../dist/index.js";
import { repositoryRoot } from "./model-runtime.ts";
import { developmentSamples } from "./model-dataset.ts";

const { values } = parseArgs({ options: { phase: { type: "string", default: "prompt" } } });
if (!["prompt", "threshold", "final"].includes(values.phase!)) throw new Error("选择阶段无效");
const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A");
const read = async (file: string) => JSON.parse(gunzipSync(await fs.readFile(file)).toString());
const old = await read(path.join(repositoryRoot, "docs/conflict-guard/evidence/preexperiment/record/results.json.gz"));
const grey = new Set(old.policies.P3.groups.filter((row: any) => row.result.judgements.some((judgement: any) => judgement.verdict.zone === "grey" && !judgement.verdict.localOnly)).map((row: any) => row.id));
const prepared = await read(path.join(root, "prepared.json.gz"));
const additionalGrey = prepared.groups.filter((row: any) => !grey.has(row.id) && row.local.judgements.some((judgement: any) => judgement.verdict.zone === "grey" && !judgement.verdict.localOnly)).map((row: any) => row.id);
assert.equal(grey.size, 61);
const quantile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)]! : null;
function describe(id: string, report: any, historical = false) {
  const data = historical ? report.policies.G1 : report;
  const groups = data.groups.filter((row: any) => grey.has(row.id));
  assert.equal(groups.length, grey.size);
  const metrics = calculateReplayMetrics(groups.map((row: any) => row.outcome));
  const calls = data.model.calls;
  const subscriptions = data.model.subscriptions ?? [];
  const valid = (call: any) => ["success", "cache-hit"].includes(call.status) && call.latencyMs <= (call.budgetMs ?? 8000);
  const validCalls = calls.filter(valid);
  const completed = historical ? validCalls.map((call: any) => call.latencyMs) : report.responses.map((entry: any) => entry[1].adjudication).filter((metadata: any) => metadata?.status === "success").map((metadata: any) => metadata.latencyMs);
  const requestRows = id.startsWith("G3") ? subscriptions : calls;
  const validResponseRatio = requestRows.length ? requestRows.filter(valid).length / requestRows.length : 0;
  const syntaxPairs = new Map<string, { deferred: number; waitMs: number }>();
  for (const row of data.groups) for (const pair of row.result.pairs) for (const record of pair.records) {
    const wait = record.pair.syntaxWait;
    if (!wait?.deferred) continue;
    const key = `${row.id}:${pair.id}`;
    const previous = syntaxPairs.get(key);
    if (!previous || wait.deferred > previous.deferred || wait.waitMs > previous.waitMs) syntaxPairs.set(key, wait);
  }
  const usage = calls.reduce((sum: any, call: any) => ({ inputTokens: sum.inputTokens + (call.usage?.inputTokens ?? 0), outputTokens: sum.outputTokens + (call.usage?.outputTokens ?? 0) }), { inputTokens: 0, outputTokens: 0 });
  const costUsd = historical ? data.model.recordedCostUsd : calls.reduce((sum: number, call: any) => {
    if (!call.usage) return sum;
    const fast = call.role === "fast";
    const prices = report.config.prices;
    return sum + (call.usage.inputTokens * (fast ? prices.fastInputPerMillion : prices.deepInputPerMillion) + call.usage.outputTokens * (fast ? prices.fastOutputPerMillion : prices.deepOutputPerMillion)) / 1e6 * (fast ? 1 : prices.usdPerCurrencyUnit);
  }, 0);
  const syntaxWaits = [...syntaxPairs.values()].map((wait) => wait.waitMs);
  const candidate: DevelopmentCandidate = { id, validResponseRatio, falseBlockRatio: metrics.falseBlockRatio.value, missed: groups.filter((row: any) => row.outcome.truth === "lock" && row.outcome.missed).length, agreement: metrics.agreement.value, p50Ms: quantile(completed, 0.5), escalationRatio: data.model.escalationRatio ?? 0 };
  return { ...candidate, samples: groups.length, relationGroups: new Set(groups.map((row: any) => row.relationGroupId)).size, metrics, safeWarningCount: groups.filter((row: any) => row.outcome.truth === "allow" && row.outcome.decision === "warn").length, falseBlockCount: groups.filter((row: any) => row.outcome.truth === "allow" && row.outcome.overblocked).length, p95Ms: quantile(completed, 0.95), requestCount: calls.length, validRequests: calls.filter(valid).length, missingUsage: calls.filter((call: any) => !call.usage).length, callStatus: Object.fromEntries([...new Set(calls.map((call: any) => call.status))].map((status) => [status, calls.filter((call: any) => call.status === status).length])), syntaxDeferredRequests: historical ? null : report.inputs.filter((request: any) => request.input.syntax?.deferred).length, observedIncompleteRevisions: historical ? null : [...syntaxPairs.values()].reduce((sum, wait) => sum + wait.deferred, 0), syntaxWaitP50Ms: quantile(syntaxWaits, 0.5), syntaxWaitP95Ms: quantile(syntaxWaits, 0.95), costUsd, usage, cacheMisses: historical || report.mode === "replay" ? data.model.cacheMisses ?? 0 : 0, additionalGreySamples: data.groups.filter((row: any) => !grey.has(row.id) && row.result.judgements.some((judgement: any) => judgement.verdict.zone === "grey" && !judgement.verdict.localOnly)).map((row: any) => row.id), noJudgement: groups.filter((row: any) => !row.result.judgements.length).map((row: any) => row.id), groups: groups.map((row: any) => ({ id: row.id, truth: row.outcome.truth, decision: row.outcome.decision })) };
}
const fourth = await read(path.join(root, "pair-v4/G1/results.json.gz"));
const rows = [describe("pair-v1 G1", old, true), describe("pair-v4 G1", fourth)];
const prompt = selectDevelopmentCandidate(rows, "prompt").id.startsWith("pair-v4") ? "pair-v4" : "pair-v1";
let threshold: number | undefined;
let policy: string | undefined;
if (values.phase !== "prompt") {
  const deep = prompt === "pair-v4" ? fourth : await read(path.join(root, "pair-v1/G1/results.json.gz"));
  const fast = await read(path.join(root, `${prompt}/G2/results.json.gz`));
  rows.push(describe("G2", fast));
  const curves = [];
  for (const value of [0, 0.2, 0.4, 0.6, 0.8]) {
    const report = await read(path.join(root, `${prompt}/G3-${value}/results.json.gz`));
    const row = describe(`G3-${value}`, report);
    rows.push(row);
    curves.push(row);
  }
  threshold = Number(selectDevelopmentCandidate(curves, "threshold").id.slice(3));
  policy = selectDevelopmentCandidate([describe("G1", deep), describe("G2", fast), curves.find((row) => row.id === `G3-${threshold}`)!], "strategy").id.startsWith("G3") ? "G3" : selectDevelopmentCandidate([describe("G1", deep), describe("G2", fast), curves.find((row) => row.id === `G3-${threshold}`)!], "strategy").id;
  if (values.phase === "final") {
    const selected = policy === "G1" ? deep : policy === "G2" ? fast : await read(path.join(root, `${prompt}/G3-${threshold}/results.json.gz`));
    const { samples } = await developmentSamples(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v3"));
    const localRows = samples.map((sample) => {
      const result = prepared.groups.find((row: any) => row.id === sample.label.id)!.local;
      return { id: sample.label.id, outcome: replayOutcome({ truth: sample.label.label as "allow" | "warn" | "lock", variantKind: sample.variant.kind, operatorFamily: sample.group.operator.family, detectability: sample.label.detectability, baseline: sample.variant.baseline, merged: sample.variant.merged, trace: sample.trace, result }) };
    });
    const human = (groups: any[]) => ({ ...calculateReplayMetrics(groups.map((row) => row.outcome)), safeWarningRatio: groups.filter((row) => row.outcome.truth === "allow" && row.outcome.decision === "warn").length / groups.filter((row) => row.outcome.truth === "allow").length });
    await fs.writeFile(path.join(root, "human-comparison.json"), JSON.stringify({ split: "dev", samples: samples.length, P3: human(localRows), P4: human(selected.groups), selected: { prompt, threshold, policy } }, null, 2) + "\n");
  }
}
await fs.writeFile(path.join(root, `selection-${values.phase}.json`), JSON.stringify({ split: "dev", commonGrey: grey.size, additionalGrey, prompt, threshold, policy, rows }, null, 2) + "\n");
console.log(JSON.stringify({ prompt, threshold, policy, rows: rows.map(({ id, agreement, missed, falseBlockCount, validResponseRatio, p50Ms, p95Ms, requestCount, syntaxDeferredRequests, cacheMisses }) => ({ id, agreement, missed, falseBlockCount, validResponseRatio, p50Ms, p95Ms, requestCount, syntaxDeferredRequests, cacheMisses })) }));
