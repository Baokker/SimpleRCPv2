import type { ReplayGroupOutcome } from "./metrics.js";
import { bootstrapGroups, holm, mcnemar, type PairedObservation } from "./statistics.js";

export interface EvaluationRow { id: string; relationGroupId: string; outcome: ReplayGroupOutcome; modelLatenciesMs?: number[] }

export function compareEvaluations(policies: Record<string, EvaluationRow[]>, seed: number) {
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
    const latencies = rows.flatMap((row) => (row.modelLatenciesMs ?? []).map((value, index) => ({ id: `${row.id}:${index}`, relationGroupId: row.relationGroupId, correct: row.outcome.decision === row.outcome.truth, value })));
    return [id, { ...rates, p50Ms: bootstrapGroups(latencies, quantile(0.5), seed), p95Ms: bootstrapGroups(latencies, quantile(0.95), seed) }];
  }));
  const ids = Object.keys(policies).sort();
  const pairs = ids.flatMap((left, index) => ids.slice(index + 1).map((right) => ({ id: `${left}:${right}`, left, right, ...mcnemar(observations(policies[left]!, () => 0), observations(policies[right]!, () => 0)) })));
  const corrected = new Map(holm(pairs).map((row) => [row.id, row.adjustedP]));
  return { seed, samplingUnit: "relationGroupId", bootstrapRepetitions: 2000, intervals, comparisons: pairs.map((row) => ({ ...row, adjustedP: corrected.get(row.id)! })) };
}
