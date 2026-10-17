import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { repositoryRoot } from "./model-runtime.ts";

type OfflineRow = {
  id: string;
  quality: Record<string, number>;
  completion: { completedChangePairs: number; totalChangePairs: number; rate: number };
  model: { requestCompletionRate: number; calls: number; p50Ms: number | null; p95Ms: number | null; costUsd: number };
};
type OfflineReport = { dataset: string; split: string; results: OfflineRow[] };
type ProviderCall = { role: string; status: string; latencyMs: number; costUsd?: number };
type G3aReport = { model: { calls: ProviderCall[] }; groups: unknown[] };

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A3");
const readJson = async <T>(file: string) => JSON.parse(await fs.readFile(path.join(root, file), "utf8")) as T;
const readGzip = async <T>(file: string) => JSON.parse(gunzipSync(await fs.readFile(path.join(root, file))).toString()) as T;
const g2 = await readJson<OfflineReport>("offline-g2p-v5-final.json");
const g3a = await readJson<OfflineReport>("offline-g3a-final.json");
const g3aRaw = await readGzip<G3aReport>("pair-v5/G3a-final/results.json.gz");
const direct = g2.results.find((row) => row.id === "G2-v5");
const g3aQuality = g3a.results.find((row) => row.id === "G2-v5");
if (!direct || !g3aQuality) throw new Error("A3 正式录制缺少 G2-v5 结果");

const deepCalls = g3aRaw.model.calls.filter((call) => call.role === "deep");
const successful = (call: ProviderCall) => call.status === "success" || call.status === "cache-hit";
const percentile = (calls: ProviderCall[], fraction: number) => {
  const values = calls.map((call) => call.latencyMs).filter(Number.isFinite).sort((left, right) => left - right);
  return values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)]! : null;
};
const deepModel = {
  requestCompletionRate: deepCalls.length ? deepCalls.filter(successful).length / deepCalls.length : 0,
  calls: deepCalls.length,
  successfulRequests: deepCalls.filter(successful).length,
  failures: deepCalls.filter((call) => !successful(call)).length,
  p50Ms: percentile(deepCalls, 0.5),
  p95Ms: percentile(deepCalls, 0.95),
  costUsd: deepCalls.reduce((sum, call) => sum + Number(call.costUsd ?? 0), 0)
};

const registered = ["G2-v5", ...g2.results.filter((row) => row.id.startsWith("G2p-v5-")).map((row) => row.id), "G3a"];
const candidates = registered.map((id) => {
  if (id === "G3a") {
    const model = g3aQuality.model;
    return {
      id,
      ...g3aQuality.quality,
      requestCompletionRate: model.requestCompletionRate,
      deepRequestCompletionRate: deepModel.requestCompletionRate,
      changePairCoverage: g3aQuality.completion.rate,
      fastP50Ms: model.p50Ms,
      fastP95Ms: model.p95Ms,
      deepP50Ms: deepModel.p50Ms,
      deepP95Ms: deepModel.p95Ms,
      calls: { fast: model.calls, deep: deepModel.calls },
      costUsd: model.costUsd + deepModel.costUsd,
      eligible: model.requestCompletionRate >= 0.95 && deepModel.requestCompletionRate >= 0.95
    };
  }
  const row = g2.results.find((entry) => entry.id === id);
  if (!row) throw new Error(`A3 正式录制缺少候选 ${id}`);
  return {
    id,
    ...row.quality,
    requestCompletionRate: row.model.requestCompletionRate,
    changePairCoverage: row.completion.rate,
    fastP50Ms: row.model.p50Ms,
    fastP95Ms: row.model.p95Ms,
    calls: { fast: row.model.calls, deep: 0 },
    costUsd: row.model.costUsd,
    eligible: row.model.requestCompletionRate >= 0.95
  };
});

const completionEligible = candidates.filter((candidate) => candidate.eligible);
const falseBlockEligible = completionEligible.filter((candidate) => candidate.falseBlockRate <= 0.15);
if (!falseBlockEligible.length) throw new Error("A3 候选集合为空：没有候选满足模型请求有效率和误拦率门槛");
const ordered = falseBlockEligible.map((candidate, index) => ({ candidate, order: index })).sort((left, right) => {
  const accuracyDifference = right.candidate.balancedAccuracy - left.candidate.balancedAccuracy;
  if (Math.abs(accuracyDifference) > 0.02) return accuracyDifference;
  const warningDifference = left.candidate.safeWarningRate - right.candidate.safeWarningRate;
  if (warningDifference !== 0) return warningDifference;
  const latencyDifference = Number(left.candidate.fastP50Ms ?? Infinity) - Number(right.candidate.fastP50Ms ?? Infinity);
  if (latencyDifference !== 0) return latencyDifference;
  return left.order - right.order;
});
const selected = ordered[0]!.candidate;
const result = {
  rule: "requestCompletionRate>=0.95 (G3a fast and deep both), falseBlockRate<=0.15, max balancedAccuracy, safeWarningRate within 2 percentage points, fast p50, registration order",
  dataset: g2.dataset,
  split: "dev-grey",
  registeredCandidates: registered,
  completionEligible: completionEligible.map((candidate) => candidate.id),
  falseBlockEligible: falseBlockEligible.map((candidate) => candidate.id),
  candidates,
  selected: selected.id,
  selectedP4: selected.id,
  target: { balancedAccuracy: 0.75, falseBlockRate: 0.15 },
  selectedMeetsTarget: { balancedAccuracy: selected.balancedAccuracy >= 0.75, falseBlockRate: selected.falseBlockRate <= 0.15 },
  source: "offline-g2p-v5-final.json; offline-g3a-final.json; pair-v5/G3a-final/results.json.gz"
};
await fs.writeFile(path.join(root, "selection-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ selected: selected.id, balancedAccuracy: selected.balancedAccuracy, falseBlockRate: selected.falseBlockRate, deepRequestCompletionRate: selected.deepRequestCompletionRate ?? null }));
