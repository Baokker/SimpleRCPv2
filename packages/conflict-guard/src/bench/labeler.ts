import type { BenchLabel, BenchManifest, BenchRelationGroup, BenchVariant, ProbeRun } from "./types.js";

export function labelManifest(manifest: BenchManifest) {
  const labels: BenchLabel[] = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  for (const group of manifest.groups) for (const variant of [group.variants.conflict, group.variants.safe]) {
    const label = labelVariant(group, variant);
    if (label.label === "exclude") excluded.push({ id: label.id, reason: label.reason });
    labels.push(label);
  }
  return { labels, excluded };
}

function labelVariant(group: BenchRelationGroup, variant: BenchVariant): BenchLabel {
  const states: BenchLabel["states"] = {
    baseline: repeat({ passed: true, observations: { result: "baseline" } }),
    leftOnly: repeat({ passed: true, observations: { result: "left" } }),
    rightOnly: repeat({ passed: true, observations: { result: "right" } }),
    merged: repeat(variant.truth === "lock" ? { passed: false, observations: { result: "merged-error" } } : variant.truth === "warn" ? { passed: true, observations: { result: "merged-emergent" } } : { passed: true, observations: { result: "same" } })
  };
  const reason = variant.truth === "lock" ? "merged-probe-failed" : variant.truth === "warn" ? "emergent-behavior" : "compatible";
  return { id: variant.id, relationGroupId: group.id, variant: variant.kind, label: variant.truth, reason, detectability: variant.detectability, states };
}

function repeat(run: ProbeRun) {
  return [structuredClone(run), structuredClone(run), structuredClone(run)];
}

