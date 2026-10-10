import type { ReplayGroupOutcome } from "./metrics.js";
import { bootstrapGroups, holm, mcnemar, type PairedObservation } from "./statistics.js";

export interface EvaluationRow { id: string; relationGroupId: string; outcome: ReplayGroupOutcome; modelLatenciesMs?: number[] }

export const experimentBootstrapSeed = 20261007;
export const experimentBootstrapRepetitions = 2000;

export function compareEvaluations(policies: Record<string, EvaluationRow[]>, seed = experimentBootstrapSeed, options: { reference?: string } = {}) {
  if (options.reference && !policies[options.reference]) throw new Error("显著性比较缺少基线策略");
  const observations = (rows: EvaluationRow[], select: (row: EvaluationRow) => number): PairedObservation[] => rows.map((row) => ({ id: row.id, relationGroupId: row.relationGroupId, correct: row.outcome.decision === row.outcome.truth, value: select(row) }));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const quantile = (probability: number) => (values: number[]) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * probability) - 1)]!;
  const intervals = Object.fromEntries(Object.entries(policies).map(([id, rows]) => {
    const rates = {
      agreement: bootstrapGroups(observations(rows, (row) => Number(row.outcome.decision === row.outcome.truth)), mean, seed),
      missed: bootstrapGroups(observations(rows.filter((row) => row.outcome.truth === "lock"), (row) => Number(row.outcome.missed)), mean, seed),
      falseBlocking: bootstrapGroups(observations(rows.filter((row) => row.outcome.truth === "allow"), (row) => Number(row.outcome.overblocked)), mean, seed),
      escape: bootstrapGroups(observations(rows.filter((row) => row.outcome.truth !== "allow"), (row) => Number(row.outcome.escaped)), mean, seed)
    };
    const latencies = rows.flatMap((row) => (row.modelLatenciesMs ?? row.outcome.latenciesMs ?? []).map((value, index) => ({ id: `${row.id}:${index}`, relationGroupId: row.relationGroupId, correct: row.outcome.decision === row.outcome.truth, value })));
    return [id, { ...rates, p50Ms: bootstrapGroups(latencies, quantile(0.5), seed), p95Ms: bootstrapGroups(latencies, quantile(0.95), seed) }];
  }));
  const ids = Object.keys(policies).sort();
  const pairedGroups = (rows: EvaluationRow[]) => {
    const groups = new Map<string, EvaluationRow[]>();
    for (const row of rows) groups.set(row.relationGroupId, [...(groups.get(row.relationGroupId) ?? []), row]);
    return [...groups].map(([id, members]) => ({ id, relationGroupId: id, correct: members.every((row) => row.outcome.decision === row.outcome.truth), value: 0 }));
  };
  const pairs = ids.flatMap((left, index) => ids.slice(index + 1).filter((right) => !options.reference || left === options.reference || right === options.reference).map((right) => {
    const a = policies[left]!;
    const b = policies[right]!;
    if (JSON.stringify(a.map((row) => [row.id, row.relationGroupId, row.outcome.truth]).sort()) !== JSON.stringify(b.map((row) => [row.id, row.relationGroupId, row.outcome.truth]).sort())) throw new Error("策略间的样本与真值不一致");
    return { id: `${left}:${right}`, left, right, groups: pairedGroups(a).length, ...mcnemar(pairedGroups(a), pairedGroups(b)) };
  }));
  const corrected = new Map(holm(pairs).map((row) => [row.id, row.adjustedP]));
  return { seed, samplingUnit: "relationGroupId", pairedCorrectness: "all-variants-correct", multiplicity: options.reference ? "Holm-reference-comparisons-within-experiment" : "Holm-all-policy-pairs-within-experiment", mcnemar: "exact-two-sided", bootstrapRepetitions: experimentBootstrapRepetitions, intervals, comparisons: pairs.map((row) => ({ ...row, adjustedP: corrected.get(row.id)! })) };
}
