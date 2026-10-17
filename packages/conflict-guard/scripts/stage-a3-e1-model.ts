import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { calculateReplayMetrics, createReplayModelPolicy, replayOutcome, replayTrace, type AdjudicationConfig, type ZoneVerdict } from "../dist/index.js";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";
import { repositoryRoot } from "./model-runtime.ts";

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A3");
const selectedStrategy = "G3a" as const;
const modelResultRelativePath = "pair-v5/G3a-final/results.json.gz";
const modelResultPath = path.join(root, modelResultRelativePath);
const outputRoot = path.join(root, "E1-human");
const config = JSON.parse(await fs.readFile(path.join(root, "config.json"), "utf8")) as AdjudicationConfig;
const modelResult = JSON.parse(gunzipSync(await fs.readFile(modelResultPath)).toString()) as { responses: Array<[string, ZoneVerdict]> };
const responses = new Map(modelResult.responses);
const { samples, manifest } = await developmentSamples(path.join(repositoryRoot, "packages/conflict-guard/bench/datasets/d1-v4"));
const libs = await replayLibraries();

async function run(name: string, disableFourState: boolean) {
  const rows = [];
  for (const sample of samples) {
    const policy = createReplayModelPolicy({ ...config, strategy: selectedStrategy }, responses, undefined, Object.keys(sample.variant.baseline));
    const result = replayTrace(sample.trace, { policy, k: 2, seed: sample.group.seed, initialFiles: sample.variant.baseline, libs, ...(disableFourState ? { disableFourState: true } : {}) });
    const outcome = replayOutcome({ truth: sample.label.label as "allow" | "warn" | "lock", variantKind: sample.variant.kind, operatorFamily: sample.group.operator.family, detectability: sample.label.detectability, baseline: sample.variant.baseline, merged: sample.variant.merged, trace: sample.trace, result });
    rows.push({ id: sample.label.id, relationGroupId: sample.group.id, project: sample.group.project, operator: sample.group.operator.id, outcome, result: { ...result, events: undefined } });
  }
  const metrics = calculateReplayMetrics(rows.map((row) => row.outcome));
  const output = path.join(outputRoot, name);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ dataset: manifest.version, split: "dev", policy: "P4", disableFourState, responses: responses.size, metrics, groups: rows }, null, 2) + "\n");
  await fs.writeFile(path.join(output, "config.json"), JSON.stringify({ dataset: manifest.version, split: "dev", policy: "P4", strategy: selectedStrategy, source: `stage-A3/${modelResultRelativePath}`, disableFourState, k: 2 }, null, 2) + "\n");
  return { name, metrics, rows };
}

const p4 = await run("P4", false);
const ablation = await run("P4-no-four-state-typecheck", true);
await import("./stage-a3-e1-report.ts");
await fs.writeFile(path.join(outputRoot, "command.txt"), "node --experimental-strip-types packages/conflict-guard/scripts/stage-a3-e1-model.ts\n");
console.log(JSON.stringify({ dataset: manifest.version, samples: samples.length, p4: p4.metrics, ablation: ablation.metrics }));
