import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { calculateReplayMetrics, createReplayModelPolicy, replayOutcome, replayTrace, type AdjudicationConfig, type ZoneVerdict } from "../dist/index.js";
import { replayEvidenceSummary } from "../dist/replay/reporting.js";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";
import { repositoryRoot } from "./model-runtime.ts";

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A3");
const config = JSON.parse(await fs.readFile(path.join(root, "config.json"), "utf8")) as AdjudicationConfig;
const recording = JSON.parse(gunzipSync(await fs.readFile(path.join(root, "pair-v5/G3a-final/results.json.gz"))).toString()) as { responses: Array<[string, ZoneVerdict]> };
const responses = new Map(recording.responses);
const base = JSON.parse(await fs.readFile(path.join(root, "E1-human/base/results.json"), "utf8"));
const priorP4 = JSON.parse(await fs.readFile(path.join(root, "E1-human/P4/results.json"), "utf8"));
const { samples } = await developmentSamples(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v4"));
const libs = await replayLibraries();
const policies: Record<string, unknown> = {};
for (const id of ["P3", "P4"] as const) {
  const prior = id === "P3" ? base.policies.P3 : priorP4;
  const previous = new Map<string, string>(prior.groups.map((group: { id: string; outcome: { decision: string } }) => [group.id, group.outcome.decision]));
  const rows = [];
  for (const sample of samples) {
    const policy = id === "P3" ? "P3" : createReplayModelPolicy({ ...config, strategy: "G3a" }, responses, undefined, Object.keys(sample.variant.baseline));
    const result = replayTrace(sample.trace, { policy, k: 2, seed: sample.group.seed, initialFiles: sample.variant.baseline, libs });
    if (result.errors.length) throw new Error(`回放失败：${sample.label.id}`);
    const outcome = replayOutcome({ truth: sample.label.label as "allow" | "warn" | "lock", variantKind: sample.variant.kind, operatorFamily: sample.group.operator.family, detectability: sample.label.detectability, baseline: sample.variant.baseline, merged: sample.variant.merged, trace: sample.trace, result });
    rows.push({ id: sample.label.id, outcome, result });
  }
  policies[id] = {
    metrics: calculateReplayMetrics(rows.map((row) => row.outcome)),
    verification: replayEvidenceSummary(rows),
    changedDecisions: rows.filter((row) => previous.get(row.id) !== row.outcome.decision).map((row) => ({ id: row.id, before: previous.get(row.id), after: row.outcome.decision }))
  };
}
await fs.writeFile(path.join(root, "review-replay.json"), JSON.stringify({ dataset: "d1-v4", split: "dev", modelCalls: 0, policies }, null, 2) + "\n");
console.log(JSON.stringify(policies));
