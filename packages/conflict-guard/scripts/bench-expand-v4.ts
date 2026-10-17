import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { nativeOperatorIds, nativeOperatorTemplate } from "../dist/bench/nativeTemplates.js";
import { OPERATOR_SPECS } from "../dist/bench/operators.js";
import { executeProbe } from "../dist/bench/executor.js";
import { labelManifest, STATE_NAMES, type StateName } from "../dist/bench/labeler.js";
import { canonicalJson } from "../dist/adjudication/prompts.js";
import type { BenchLabel, BenchManifest, BenchRelationGroup, BenchVariant, ProbeRun } from "../dist/bench/types.js";
import { synthesizeTrace } from "../dist/bench/generator.js";
import { readSeedProjects } from "./seed-projects.ts";

const { values } = parseArgs({ options: { source: { type: "string", default: "bench/datasets/d1-v3" }, out: { type: "string", default: "bench/datasets/d1-v4" }, seeds: { type: "string", default: "bench/seeds/native" }, dev: { type: "string", default: "20" }, holdout: { type: "string", default: "20" }, operators: { type: "string", default: "CP-3" }, seed: { type: "string", default: "20261017" } } });
const source = path.resolve(values.source!);
const output = path.resolve(values.out!);
if (source === output) throw new Error("D1-v4 必须写入独立目录");
const original = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8")) as BenchManifest;
const originalLabels = JSON.parse(await fs.readFile(path.join(source, "labels.json"), "utf8")) as BenchLabel[];
const projects = await readSeedProjects(path.resolve(values.seeds!));
const operatorIds = values.operators!.split(",").map((id) => id.trim()).filter(Boolean);
if (!operatorIds.length || operatorIds.some((id) => !OPERATOR_SPECS.some((item) => item.id === id && item.family === "CP"))) throw new Error("补充数据只能使用已登记的 CP 算子");
const manifest = structuredClone(original);
manifest.version = "d1-v4";
manifest.generatedBy = "@simplercp/conflict-guard bench:expand-v4";
manifest.seed = Number(values.seed);
manifest.generationCommand = `bench:expand-v4 --source ${values.source} --out ${values.out} --dev ${values.dev} --holdout ${values.holdout} --operators ${values.operators} --seed ${values.seed}`;
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, "traces"), { recursive: true });
for (const group of original.groups) for (const variant of Object.values(group.variants)) if (variant.traceFile) await fs.copyFile(path.join(source, variant.traceFile), path.join(output, variant.traceFile));
const add = async (split: "dev" | "holdout", count: number, offset: number) => {
  const eligibleProjects = projects.filter((project) => original.groups.some((group) => group.split === split && group.project === project.name));
  if (!eligibleProjects.length) throw new Error(`没有 ${split} 种子项目`);
  const eligibleOperators = new Map(eligibleProjects.map((project) => [project.name, new Set(nativeOperatorIds(project, operatorIds))]));
  if (eligibleProjects.some((project) => !eligibleOperators.get(project.name)?.size)) throw new Error(`${split} 种子项目没有可用的 CP 算子`);
  let index = 0;
  let sequence = 0;
  while (index < count) {
    const project = eligibleProjects[sequence % eligibleProjects.length]!;
    const operatorId = operatorIds[sequence % operatorIds.length]!;
    sequence += 1;
    if (!eligibleOperators.get(project.name)?.has(operatorId)) continue;
    const seed = manifest.seed + offset + index;
    const siteIndex = Math.floor(sequence / eligibleProjects.length);
    const operator = OPERATOR_SPECS.find((item) => item.id === operatorId)!;
    const conflict = nativeOperatorTemplate(operatorId, false, seed, project, false, { siteIndex });
    const safe = nativeOperatorTemplate(operatorId, true, seed, project, false, { siteIndex });
    const id = `d1-v4-${split}-${String(index + 1).padStart(3, "0")}`;
    const makeVariant = (kind: "conflict" | "safe", template: typeof conflict): BenchVariant => {
      const trace = synthesizeTrace(template.baseline, template.left, template.right, seed);
      const text = trace.map((event) => JSON.stringify(event)).join("\n") + "\n";
      const variant: BenchVariant = { id: `${id}-${kind}`, kind, operatorId, dependencyMode: kind === "safe" ? "new-behavior" : "old-behavior", truth: "exclude", detectability: "runtime-only", baseline: template.baseline, leftOnly: { ...template.baseline, ...template.left }, rightOnly: { ...template.baseline, ...template.right }, merged: template.merged, probes: template.probes, baselineReference: template.reference, entryPoints: template.entryPoints, site: template.site, trace: [], traceFile: `traces/${id}-${kind}.jsonl`, traceHash: createHash("sha256").update(text).digest("hex") };
      return { variant, text };
    };
    const conflictVariant = makeVariant("conflict", conflict);
    const safeVariant = makeVariant("safe", safe);
    await fs.writeFile(path.join(output, conflictVariant.variant.traceFile!), conflictVariant.text);
    await fs.writeFile(path.join(output, safeVariant.variant.traceFile!), safeVariant.text);
    const group: BenchRelationGroup = { id, project: project.name, operator, split, seed, variants: { conflict: conflictVariant.variant, safe: safeVariant.variant } };
    manifest.groups.push(group);
    manifest.split[split === "dev" ? "development" : "holdout"].push(id);
    index += 1;
  }
};
await add("dev", Number(values.dev), 1000);
await add("holdout", Number(values.holdout), 2000);
const saved = new Map<string, ProbeRun[]>();
for (const group of original.groups) for (const variant of Object.values(group.variants)) {
  const label = originalLabels.find((entry) => entry.id === variant.id);
  if (!label) continue;
  for (const state of STATE_NAMES) saved.set(fingerprint(variant, state), label.states[state]);
}
const reused = new Map<string, number>();
let reusedRuns = 0;
let executedRuns = 0;
const labelConcurrency = Number(process.env.BENCH_LABEL_CONCURRENCY ?? "4");
if (!Number.isInteger(labelConcurrency) || labelConcurrency < 1) throw new Error("BENCH_LABEL_CONCURRENCY 必须为正整数");
const labelled = await labelManifest(manifest, async (variant, state) => {
  const key = fingerprint(variant, state);
  const runs = saved.get(key);
  const offset = reused.get(key) ?? 0;
  if (runs?.[offset % 3]) {
    reused.set(key, offset + 1);
    reusedRuns += 1;
    return runs[offset % 3]!;
  }
  executedRuns += 1;
  return executeProbe(variant, state);
}, labelConcurrency);
for (const group of manifest.groups) for (const variant of Object.values(group.variants)) {
  const label = labelled.labels.find((entry) => entry.id === (variant.aliasOf ?? variant.id));
  if (!label) throw new Error(`补充数据缺少探针标签：${variant.id}`);
  variant.truth = label.label;
  variant.detectability = label.detectability;
}
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await fs.writeFile(path.join(output, "labels.json"), JSON.stringify(labelled.labels, null, 2) + "\n");
await fs.writeFile(path.join(output, "excluded.json"), JSON.stringify(labelled.excluded, null, 2) + "\n");
console.log(JSON.stringify({ version: manifest.version, groups: manifest.groups.length, addedDevelopment: Number(values.dev), addedHoldout: Number(values.holdout), seed: manifest.seed, labels: labelled.labels.length, excluded: labelled.excluded.length, reusedRuns, executedRuns }));

function fingerprint(variant: BenchVariant, state: StateName) {
  return createHash("sha256").update(canonicalJson({ state, files: variant[state], reference: variant.baselineReference ?? variant.baseline, probes: variant.probes, entryPoints: variant.entryPoints, worker: "checkpoint-b-v1" })).digest("hex");
}
