import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { replayTrace } from "../dist/index.js";
import { developmentSamples } from "./model-dataset.ts";
import { replayLibraries } from "./replay-libs.ts";
import { repositoryRoot } from "./model-runtime.ts";

const { values } = parseArgs({ options: { dataset: { type: "string", default: "packages/conflict-guard/bench/datasets/d1-v4" }, out: { type: "string", default: "docs/conflict-guard/experiment/v2/stage-A2/data-check.json" } } });
const dataset = path.resolve(repositoryRoot, values.dataset!);
const output = path.resolve(repositoryRoot, values.out!);
const { manifest, samples } = await developmentSamples(dataset, "dev");
const labels = JSON.parse(await fs.readFile(path.join(dataset, "labels.json"), "utf8")) as Array<{ id: string; relationGroupId: string; label: string }>;
const libs = await replayLibraries();
const rows = [] as Array<{ id: string; split: "dev"; relationGroupId: string; operatorFamily: string; operatorId: string; truth: string; grey: boolean; decisions: string[]; rules: string[] }>;
for (const sample of samples) {
  const result = replayTrace(sample.trace, { policy: "P3", initialFiles: sample.variant.baseline, libs, seed: sample.group.seed });
  assert.deepEqual(result.errors, [], sample.label.id);
  rows.push({ id: sample.label.id, split: "dev", relationGroupId: sample.group.id, operatorFamily: sample.group.operator.family, operatorId: sample.group.operator.id, truth: sample.label.label, grey: result.judgements.some((judgement) => judgement.verdict.zone === "grey" && !judgement.verdict.localOnly), decisions: [...new Set(result.judgements.map((judgement) => judgement.verdict.decision))], rules: [...new Set(result.judgements.map((judgement) => judgement.verdict.ruleId))] });
}
const grey = rows.filter((row) => row.grey);
const bySplit = (split: "dev" | "holdout") => {
  const groups = new Set(manifest.groups.filter((group) => group.split === split).map((group) => group.id));
  if (split === "holdout") {
    const selected = labels.filter((label) => groups.has(label.relationGroupId) && label.label !== "exclude");
    return { groups: groups.size, samples: selected.length, greySamples: null, greyRelationGroups: null, truth: Object.fromEntries(["allow", "warn", "lock", "exclude"].map((truth) => [truth, selected.filter((label) => label.label === truth).length])), greyTruth: null, operatorFamilies: Object.fromEntries([...new Set(selected.map((label) => manifest.groups.find((group) => group.id === label.relationGroupId)?.operator.family ?? "unknown"))].sort().map((family) => [family, selected.filter((label) => (manifest.groups.find((group) => group.id === label.relationGroupId)?.operator.family ?? "unknown") === family).length])) };
  }
  const selected = rows.filter((row) => groups.has(row.relationGroupId));
  return { groups: groups.size, samples: selected.length, greySamples: selected.filter((row) => row.grey).length, greyRelationGroups: new Set(selected.filter((row) => row.grey).map((row) => row.relationGroupId)).size, truth: Object.fromEntries(["allow", "warn", "lock", "exclude"].map((truth) => [truth, selected.filter((row) => row.truth === truth).length])), greyTruth: Object.fromEntries(["allow", "warn", "lock"].map((truth) => [truth, selected.filter((row) => row.grey && row.truth === truth).length])), operatorFamilies: Object.fromEntries([...new Set(selected.map((row) => row.operatorFamily))].sort().map((family) => [family, selected.filter((row) => row.operatorFamily === family).length])) };
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ dataset: manifest.version, seed: manifest.seed, development: bySplit("dev"), holdout: bySplit("holdout"), grey, rows, holdoutReplay: "未执行保留集回放；保留集部分只统计标签与关系组。" }, null, 2) + "\n");
console.log(JSON.stringify({ dataset: manifest.version, samples: rows.length, greySamples: grey.length, greyRelationGroups: new Set(grey.map((row) => row.relationGroupId)).size, development: bySplit("dev"), holdout: bySplit("holdout") }));
