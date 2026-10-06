import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { labelManifest } from "../dist/bench/labeler.js";
import { executeProbe } from "../dist/bench/executor.js";
import type { BenchManifest, BenchLabel, BenchVariant, ProbeRun } from "../dist/bench/types.js";
import { canonicalJson } from "../dist/adjudication/prompts.js";
import { STATE_NAMES, type StateName } from "../dist/bench/labeler.js";

const { values } = parseArgs({ args: process.argv.slice(2).filter((item) => item !== "--"), options: { dataset: { type: "string" }, concurrency: { type: "string", default: "1" }, reuse: { type: "string" } } });
const directory = path.resolve(values.dataset ?? "bench/datasets/d1-v1");
const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as BenchManifest;
const saved = new Map<string, ProbeRun[]>();
function fingerprint(variant: BenchVariant, state: StateName) {
  return createHash("sha256").update(canonicalJson({ state, files: variant[state], reference: variant.baselineReference ?? variant.baseline, probes: variant.probes, entryPoints: variant.entryPoints, worker: "checkpoint-b-v1" })).digest("hex");
}
if (values.reuse) {
  const prior = path.resolve(values.reuse);
  const source = JSON.parse(await fs.readFile(path.join(prior, "manifest.json"), "utf8")) as BenchManifest;
  const labels = JSON.parse(await fs.readFile(path.join(prior, "labels.json"), "utf8")) as BenchLabel[];
  for (const group of source.groups) for (const variant of Object.values(group.variants).filter((variant) => !variant.aliasOf)) {
    const label = labels.find((label) => label.id === variant.id);
    if (label) for (const state of STATE_NAMES) saved.set(fingerprint(variant, state), label.states[state]);
  }
}
const reused = new Map<string, number>();
let reusedRuns = 0; let executedRuns = 0;
const result = await labelManifest(manifest, async (variant, state) => {
  const key = fingerprint(variant, state); const runs = saved.get(key);
  const count = reused.get(key) ?? 0;
  if (runs?.[count % 3]) { reused.set(key, count + 1); reusedRuns += 1; return runs[count % 3]!; }
  executedRuns += 1; return executeProbe(variant, state);
}, Number(values.concurrency));
for (const group of manifest.groups) for (const variant of Object.values(group.variants)) {
  const label = result.labels.find((item) => item.id === (variant.aliasOf ?? variant.id))!;
  variant.truth = label.label;
  variant.detectability = label.detectability;
}
await fs.writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(directory, "labels.json"), `${JSON.stringify(result.labels, null, 2)}\n`);
await fs.writeFile(path.join(directory, "excluded.json"), `${JSON.stringify(result.excluded, null, 2)}\n`);
console.log(JSON.stringify({ dataset: directory, labels: result.labels.length, excluded: result.excluded.length, reusedRuns, executedRuns, concurrency: Number(values.concurrency) }));
