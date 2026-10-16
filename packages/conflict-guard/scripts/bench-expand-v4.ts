import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { nativeOperatorTemplate } from "../dist/bench/nativeTemplates.js";
import { OPERATOR_SPECS } from "../dist/bench/operators.js";
import type { BenchLabel, BenchManifest, BenchRelationGroup, BenchVariant } from "../dist/bench/types.js";
import { synthesizeTrace } from "../dist/bench/generator.js";
import { readSeedProjects } from "./seed-projects.ts";

const { values } = parseArgs({ options: { source: { type: "string", default: "bench/datasets/d1-v3" }, out: { type: "string", default: "bench/datasets/d1-v4" }, seeds: { type: "string", default: "bench/seeds/native" }, dev: { type: "string", default: "20" }, holdout: { type: "string", default: "20" }, seed: { type: "string", default: "20261017" } } });
const source = path.resolve(values.source!);
const output = path.resolve(values.out!);
if (source === output) throw new Error("D1-v4 必须写入独立目录");
const original = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8")) as BenchManifest;
const originalLabels = JSON.parse(await fs.readFile(path.join(source, "labels.json"), "utf8")) as BenchLabel[];
const originalExcluded = JSON.parse(await fs.readFile(path.join(source, "excluded.json"), "utf8")) as Array<{ id: string; reason: string }>;
const projects = await readSeedProjects(path.resolve(values.seeds!));
const manifest = structuredClone(original);
manifest.version = "d1-v4";
manifest.generatedBy = "@simplercp/conflict-guard bench:expand-v4";
manifest.seed = Number(values.seed);
manifest.generationCommand = `bench:expand-v4 --source ${values.source} --out ${values.out} --dev ${values.dev} --holdout ${values.holdout} --seed ${values.seed}`;
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, "traces"), { recursive: true });
for (const group of original.groups) for (const variant of Object.values(group.variants)) if (variant.traceFile) await fs.copyFile(path.join(source, variant.traceFile), path.join(output, variant.traceFile));
const add = async (split: "dev" | "holdout", count: number, offset: number) => {
  const eligibleProjects = projects.filter((project) => original.groups.some((group) => group.split === split && group.project === project.name));
  if (!eligibleProjects.length) throw new Error(`没有 ${split} 种子项目`);
  const operator = OPERATOR_SPECS.find((item) => item.id === "CP-3")!;
  for (let index = 0; index < count; index += 1) {
    const project = eligibleProjects[index % eligibleProjects.length]!;
    const seed = manifest.seed + offset + index;
    const siteIndex = Math.floor(index / eligibleProjects.length);
    const conflict = nativeOperatorTemplate("CP-3", false, seed, project, false, { siteIndex });
    const safe = nativeOperatorTemplate("CP-3", true, seed, project, false, { siteIndex });
    const id = `d1-v4-${split}-${String(index + 1).padStart(3, "0")}`;
    const makeVariant = (kind: "conflict" | "safe", template: typeof conflict): BenchVariant => {
      const trace = synthesizeTrace(template.baseline, template.left, template.right, seed);
      const text = trace.map((event) => JSON.stringify(event)).join("\n") + "\n";
      const variant: BenchVariant = { id: `${id}-${kind}`, kind, operatorId: "CP-3", dependencyMode: kind === "safe" ? "new-behavior" : "old-behavior", truth: "exclude", detectability: "runtime-only", baseline: template.baseline, leftOnly: { ...template.baseline, ...template.left }, rightOnly: { ...template.baseline, ...template.right }, merged: template.merged, probes: template.probes, baselineReference: template.reference, entryPoints: template.entryPoints, site: template.site, trace: [], traceFile: `traces/${id}-${kind}.jsonl`, traceHash: createHash("sha256").update(text).digest("hex") };
      return { variant, text };
    };
    const conflictVariant = makeVariant("conflict", conflict);
    const safeVariant = makeVariant("safe", safe);
    await fs.writeFile(path.join(output, conflictVariant.variant.traceFile!), conflictVariant.text);
    await fs.writeFile(path.join(output, safeVariant.variant.traceFile!), safeVariant.text);
    const group: BenchRelationGroup = { id, project: project.name, operator, split, seed, variants: { conflict: conflictVariant.variant, safe: safeVariant.variant } };
    manifest.groups.push(group);
    manifest.split[split === "dev" ? "development" : "holdout"].push(id);
  }
};
await add("dev", Number(values.dev), 1000);
await add("holdout", Number(values.holdout), 2000);
await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await fs.writeFile(path.join(output, "labels.json"), JSON.stringify(originalLabels, null, 2) + "\n");
await fs.writeFile(path.join(output, "excluded.json"), JSON.stringify(originalExcluded, null, 2) + "\n");
console.log(JSON.stringify({ version: manifest.version, groups: manifest.groups.length, addedDevelopment: Number(values.dev), addedHoldout: Number(values.holdout), seed: manifest.seed, preservedLabels: originalLabels.length }));
