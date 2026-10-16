import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { calculateReplayMetrics, inputHash, type AdjudicationConfig, type AdjudicationInput, type ReplayGroupOutcome, type ZoneVerdict } from "../dist/index.js";
import { createModelRuntime, loadModelEnvironment, repositoryRoot } from "./model-runtime.ts";

type Probability = { allow: number; warn: number; lock: number };
type RecordedReport = { dataset: string; config: AdjudicationConfig; inputs: Array<{ input: AdjudicationInput; local: ZoneVerdict }>; responses: Array<[string, ZoneVerdict]>; model: { calls: Array<{ inputHash: string; cacheKey?: string }> }; groups: Array<{ id: string; outcome: ReplayGroupOutcome; result: Record<string, any> }> };
const { values } = parseArgs({ options: { lower: { type: "string", default: "0.20" }, upper: { type: "string", default: "0.50" }, prompt: { type: "string", default: "pair-v1" }, output: { type: "string", default: "g3a-results.json" } } });
const lower = Number(values.lower);
const upper = Number(values.upper);
if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) throw new Error("G3a 阈值无效");
const promptVersion = values.prompt!;
if (!["pair-v1", "pair-v4", "pair-v5"].includes(promptVersion)) throw new Error("G3a 提示词版本无效");
const stageRoot = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A2");
const report = JSON.parse(gunzipSync(await fs.readFile(path.join(stageRoot, "pair-v5/G2/results.json.gz"))).toString()) as RecordedReport;
const dataCheck = JSON.parse(await fs.readFile(path.join(stageRoot, "data-check.json"), "utf8")) as { grey: Array<{ id: string; grey: boolean }> };
const greyIds = new Set(dataCheck.grey.filter((row) => row.grey).map((row) => row.id));
const cacheDirectory = path.join(repositoryRoot, ".test-workspaces/stage-a-cache/pair-v5/G2");
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
const inputs = new Map(report.inputs.map((row) => [inputHash(row.input), row]));
const config: AdjudicationConfig = { ...report.config, strategy: "G1", promptVersion, point: "T2", reasoning: true, hardDeadlineMs: 30000, softDeadlineMs: 2000 };
const models = JSON.parse(await fs.readFile(path.join(stageRoot, "models.json"), "utf8")) as Record<string, string>;
const providers = JSON.parse(await fs.readFile(path.join(stageRoot, "providers.json"), "utf8"));
loadModelEnvironment();
const calls: Array<Record<string, unknown>> = [];
const runtime = createModelRuntime(config, "record", path.join(repositoryRoot, `.test-workspaces/stage-a2-g3a-cache/${promptVersion}`), (call) => calls.push(call), models, undefined, undefined, providers);
const deepResults = new Map<string, ZoneVerdict>();
for (const hash of needsDeep) {
  const entry = inputs.get(hash);
  if (!entry) throw new Error(`G3a 输入缺失：${hash}`);
  const result = await runtime.judge({ ...entry.input, promptVersion }, entry.local, new AbortController().signal);
  deepResults.set(hash, { ...entry.local, decision: result.decision, zone: result.decision === "lock" ? "black" : result.decision === "allow" ? "white" : "grey", ruleId: `model-deep`, summary: result.adjudication?.userExplanation ?? result.summary, adjudication: result.adjudication });
}
const groups = report.groups.filter((row) => greyIds.has(row.id)).map((group) => {
  const decisions = (group.result.pairs ?? []).flatMap((pair: any) => {
    const verdict = pair.final?.verdict as ZoneVerdict | undefined;
    if (!verdict) return [];
    const thresholdDecision = baseDecision(verdict);
    if (thresholdDecision !== "warn" || !verdict.adjudication?.inputHash) return [thresholdDecision];
    return [deepResults.get(verdict.adjudication.inputHash)?.decision ?? "warn"];
  });
  const decision = aggregate(decisions) as ReplayGroupOutcome["decision"];
  return { ...group, outcome: { ...group.outcome, decision, missed: group.outcome.truth === "lock" && decision !== "lock", overblocked: group.outcome.truth === "allow" && decision === "lock" } };
});
const metrics = calculateReplayMetrics(groups.map((group) => group.outcome));
const quality = { balancedAccuracy: groups.filter((group) => group.outcome.truth === "lock").length ? (groups.filter((group) => group.outcome.truth === "lock" && group.outcome.decision === "lock").length / groups.filter((group) => group.outcome.truth === "lock").length + groups.filter((group) => group.outcome.truth === "allow" && group.outcome.decision !== "lock").length / groups.filter((group) => group.outcome.truth === "allow").length) / 2 : null, missBlockRate: metrics.missBlockRatio.value, falseBlockRate: metrics.falseBlockRatio.value, conflictNotificationRate: groups.filter((group) => group.outcome.truth === "lock" && group.outcome.decision !== "allow").length / Math.max(1, groups.filter((group) => group.outcome.truth === "lock").length), safeWarningRate: groups.filter((group) => group.outcome.truth === "allow" && group.outcome.decision === "warn").length / Math.max(1, groups.filter((group) => group.outcome.truth === "allow").length), threeClassAgreement: metrics.agreement.value };
const output = { strategy: "G3a", promptVersion, dataset: report.dataset, threshold: { lower, upper }, greySamples: groups.length, deepInputCount: needsDeep.size, model: { calls, stats: runtime.stats() }, quality, groups: groups.map((group) => ({ id: group.id, truth: group.outcome.truth, decision: group.outcome.decision })) };
await fs.writeFile(path.join(stageRoot, values.output!), JSON.stringify(output, null, 2) + "\n");
runtime.dispose();
console.log(JSON.stringify({ strategy: output.strategy, greySamples: output.greySamples, deepInputCount: output.deepInputCount, calls: calls.length, quality }));
