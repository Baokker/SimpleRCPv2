import type { BenchLabel, BenchManifest, BenchRelationGroup, BenchVariant, ProbeRun } from "./types.js";
import * as ts from "typescript";
export const STATE_NAMES = ["baseline", "leftOnly", "rightOnly", "merged"] as const;
export type StateName = typeof STATE_NAMES[number];
export type ProbeRunner = (variant: BenchVariant, state: StateName) => Promise<ProbeRun>;

export async function labelManifest(manifest: BenchManifest, runner: ProbeRunner, concurrency = 1) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency 必须为正整数");
  const tasks = manifest.groups.flatMap((group) => Object.values(group.variants).filter((variant) => !variant.aliasOf).map((variant) => ({ group, variant })));
  const labels = new Array<BenchLabel>(tasks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index]!;
      const states = {} as BenchLabel["states"];
      for (const state of STATE_NAMES) {
        states[state] = [];
        for (let repeat = 0; repeat < 3; repeat += 1) states[state].push(await runner(task.variant, state));
      }
      const textConflict = Object.entries(task.variant.merged).some(([file, text]) => {
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] };
        return source.parseDiagnostics.some((diagnostic) => diagnostic.code === 1185);
      });
      labels[index] = labelVariant(task.group, task.variant, states, textConflict);
    }
  }));
  return { labels, excluded: labels.filter((label) => label.label === "exclude").map(({ id, reason }) => ({ id, reason })) };
}

export function labelVariant(group: Pick<BenchRelationGroup, "id">, variant: Pick<BenchVariant, "id" | "kind" | "expectedMergedObservations">, states: BenchLabel["states"], textConflict = false): BenchLabel {
  const result = (label: BenchLabel["label"], reason: BenchLabel["reason"], detectability: BenchLabel["detectability"] = "none"): BenchLabel => ({ id: variant.id, relationGroupId: group.id, variant: variant.kind, label, reason, detectability, states });
  for (const state of STATE_NAMES) {
    if (states[state].length !== 3) throw new Error("每种状态必须有三次探针结果");
    const fingerprints = states[state].map((run) => JSON.stringify({ passed: run.passed, observations: run.observations, expectedMergedObservations: run.expectedMergedObservations, typeError: run.typeError, probes: run.probes }));
    if (states[state].some((run) => run.timeout) || new Set(fingerprints).size !== 1) return result("exclude", "flaky");
  }
  if (!states.baseline[0]!.passed || states.baseline[0]!.typeError) return result("exclude", "invalid-baseline");
  if (!states.leftOnly[0]!.passed || !states.rightOnly[0]!.passed || states.leftOnly[0]!.typeError || states.rightOnly[0]!.typeError) return result("exclude", "invalid-side");
  if (textConflict) return result("exclude", "text-conflict");
  const merged = states.merged[0]!;
  if (!merged.passed || merged.typeError) return result("lock", "merged-probe-failed", merged.typeError ? "typecheck" : "runtime-only");
  const expected = merged.expectedMergedObservations ?? variant.expectedMergedObservations ?? {};
  const emergent = Object.entries(merged.observations).some(([key, value]) => Object.hasOwn(expected, key) && JSON.stringify(expected[key]) !== JSON.stringify(value));
  return result(emergent ? "warn" : "allow", emergent ? "emergent-behavior" : "compatible", emergent ? "runtime-only" : "none");
}
