import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readTrace, type BenchLabel, type BenchManifest, type BenchRelationGroup, type BenchVariant } from "../dist/index.js";

export async function developmentSamples(directory: string) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as BenchManifest;
  const labels = JSON.parse(await fs.readFile(path.join(directory, "labels.json"), "utf8")) as BenchLabel[];
  const selected = new Set(manifest.split.development);
  const programs = new Set<string>();
  const samples: Array<{ group: BenchRelationGroup; variant: BenchVariant; label: BenchLabel; trace: ReturnType<typeof readTrace>; programHash: string }> = [];
  for (const group of manifest.groups.filter((group) => selected.has(group.id) && group.split === "dev")) for (const label of labels.filter((label) => label.relationGroupId === group.id && label.label !== "exclude")) {
    const variant = group.variants[label.variant];
    if (variant.aliasOf) continue;
    const programHash = createHash("sha256").update(JSON.stringify([variant.baseline, variant.leftOnly, variant.rightOnly, variant.merged].map((state) => Object.entries(state).sort(([left], [right]) => left.localeCompare(right))))).digest("hex");
    if (programs.has(programHash)) continue;
    programs.add(programHash);
    const text = variant.traceFile ? await fs.readFile(path.join(directory, variant.traceFile), "utf8") : undefined;
    if (text && variant.traceHash && createHash("sha256").update(text).digest("hex") !== variant.traceHash) throw new Error("数据集轨迹哈希不一致");
    samples.push({ group, variant, label, trace: text === undefined ? variant.trace : readTrace(text), programHash });
  }
  return { manifest, samples };
}
