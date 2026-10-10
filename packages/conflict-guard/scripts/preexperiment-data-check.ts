import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";
import { replayTrace } from "../dist/index.js";

const dataset = path.resolve("bench/datasets/d1-v3");
const prior = path.resolve("bench/datasets/d1-v2");
const output = path.resolve("../../docs/conflict-guard/evidence/preexperiment/data-check.json");
const { manifest, samples } = await developmentSamples(dataset);
const original = JSON.parse(await fs.readFile(path.join(prior, "manifest.json"), "utf8"));
const labels = JSON.parse(await fs.readFile(path.join(dataset, "labels.json"), "utf8"));
const priorLabels = JSON.parse(await fs.readFile(path.join(prior, "labels.json"), "utf8"));
assert.deepEqual(manifest.groups.filter((group) => group.split === "holdout"), original.groups.filter((group: { split: string }) => group.split === "holdout"));
assert.deepEqual(labels.filter((label: { relationGroupId: string }) => manifest.split.holdout.includes(label.relationGroupId)), priorLabels.filter((label: { relationGroupId: string }) => original.split.holdout.includes(label.relationGroupId)));
const libs = await replayLibraries();
const rows = [];
for (const sample of samples.filter(({ group }) => group.id.startsWith("d1-dev-safe-"))) {
  const result = replayTrace(sample.trace, { policy: "P3", initialFiles: sample.variant.baseline, libs, seed: sample.group.seed });
  assert.deepEqual(result.errors, []);
  rows.push({ id: sample.label.id, relationGroupId: sample.group.id, truth: sample.label.label, grey: result.judgements.some((judgement) => judgement.verdict.zone === "grey"), rules: [...new Set(result.judgements.map((judgement) => judgement.verdict.ruleId))] });
}
const safeGreyGroups = new Set(rows.filter((row) => row.grey && ["allow", "warn"].includes(row.truth)).map((row) => row.relationGroupId)).size;
const result = { dataset: manifest.version, groups: manifest.groups.length, developmentGroups: manifest.split.development.length, holdoutGroups: manifest.split.holdout.length, safeGreyGroups, labels: Object.fromEntries(["allow", "warn", "lock", "exclude"].map((truth) => [truth, labels.filter((label: { label: string }) => label.label === truth).length])), developmentUniqueSamples: samples.length, developmentTruth: Object.fromEntries(["allow", "warn", "lock"].map((truth) => [truth, samples.filter((sample) => sample.label.label === truth).length])), holdoutUnchanged: true, rows };
await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ...result, rows: undefined }));
assert(safeGreyGroups >= 30, "开发集灰区安全关系组不足 30 组");
