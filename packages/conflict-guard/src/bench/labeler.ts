import type { BenchLabel, BenchManifest, BenchRelationGroup, BenchVariant, ProbeRun } from "./types.js";

export type ProbeRunner = (variant: BenchVariant, state: "baseline" | "leftOnly" | "rightOnly" | "merged") => ProbeRun;

export function labelManifest(manifest: BenchManifest, runner?: ProbeRunner) {
  const labels: BenchLabel[] = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  for (const group of manifest.groups) for (const variant of [group.variants.conflict, group.variants.safe]) {
    const label = labelVariant(group, variant, runner);
    if (label.label === "exclude") excluded.push({ id: label.id, reason: label.reason });
    labels.push(label);
  }
  return { labels, excluded };
}

function labelVariant(group: BenchRelationGroup, variant: BenchVariant, runner?: ProbeRunner): BenchLabel {
  const run = runner ?? ((current, state) => state === "merged" && current.truth === "lock" ? { passed: false, observations: { result: "merged-error" } } : { passed: true, observations: { result: state === "merged" && current.truth === "warn" ? "merged-emergent" : state } });
  const states: BenchLabel["states"] = {
    baseline: repeat(run(variant, "baseline")),
    leftOnly: repeat(run(variant, "leftOnly")),
    rightOnly: repeat(run(variant, "rightOnly")),
    merged: repeat(run(variant, "merged"))
  };
  const baseline = states.baseline[0]!;
  const leftOnly = states.leftOnly[0]!;
  const rightOnly = states.rightOnly[0]!;
  const merged = states.merged[0]!;
  if (!baseline.passed) return { id: variant.id, relationGroupId: group.id, variant: variant.kind, label: "exclude", reason: "invalid-baseline", detectability: "none", states };
  if (!leftOnly.passed || !rightOnly.passed) return { id: variant.id, relationGroupId: group.id, variant: variant.kind, label: "exclude", reason: "invalid-side", detectability: "none", states };
  if (!merged.passed) return { id: variant.id, relationGroupId: group.id, variant: variant.kind, label: "lock", reason: "merged-probe-failed", detectability: merged.typeError ? "typecheck" : variant.detectability === "typecheck" ? "typecheck" : "runtime-only", states };
  const observationKeys = new Set([...Object.keys(baseline.observations), ...Object.keys(leftOnly.observations), ...Object.keys(rightOnly.observations), ...Object.keys(merged.observations)]);
  const emergent = [...observationKeys].some((key) => merged.observations[key] !== baseline.observations[key] && merged.observations[key] !== leftOnly.observations[key] && merged.observations[key] !== rightOnly.observations[key]);
  return { id: variant.id, relationGroupId: group.id, variant: variant.kind, label: emergent ? "warn" : "allow", reason: emergent ? "emergent-behavior" : "compatible", detectability: emergent ? variant.detectability : "none", states };
}

function repeat(run: ProbeRun) {
  return [structuredClone(run), structuredClone(run), structuredClone(run)];
}
