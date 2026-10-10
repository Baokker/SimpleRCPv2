import { expect, it } from "vitest";
import { mcnemar, holm, bootstrapGroups } from "./statistics.js";
import { compareEvaluations, type EvaluationRow } from "./evaluation.js";

it("computes the exact paired McNemar tail and Holm adjustment", () => {
  const left = Array.from({ length: 6 }, (_, id) => ({ id: String(id), relationGroupId: String(id), correct: true, value: 1 }));
  expect(mcnemar(left, left.map((row) => ({ ...row, correct: false })))).toEqual({ leftOnlyCorrect: 6, rightOnlyCorrect: 0, discordant: 6, p: 0.03125 });
  expect(mcnemar(left, left).p).toBe(1);
  expect(holm([{ id: "a", p: 0.01 }, { id: "b", p: 0.04 }, { id: "c", p: 0.03 }])).toEqual([{ id: "a", p: 0.01, adjustedP: 0.03 }, { id: "b", p: 0.04, adjustedP: 0.06 }, { id: "c", p: 0.03, adjustedP: 0.06 }]);
});

it("resamples complete relation groups with a reproducible interval", () => {
  const rows = [{ id: "a-safe", relationGroupId: "a", correct: true, value: 0 }, { id: "a-conflict", relationGroupId: "a", correct: false, value: 1 }, { id: "b-safe", relationGroupId: "b", correct: true, value: 0 }, { id: "b-conflict", relationGroupId: "b", correct: false, value: 1 }];
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  expect(bootstrapGroups(rows, mean, 19)).toMatchObject({ estimate: 0.5, low: 0.5, high: 0.5, groups: 2 });
  expect(bootstrapGroups(rows, mean, 19)).toEqual(bootstrapGroups(rows, mean, 19));
});

it("配对检验将同一关系组的多个变体合为一个观察单位", () => {
  const rows: EvaluationRow[] = ["safe", "conflict"].map((variant) => ({ id: `one-${variant}`, relationGroupId: "one", outcome: { truth: "allow", decision: "allow", escaped: false, missed: false, overblocked: false, frozenPersonSeconds: 0, cardCount: 0 } }));
  const other = rows.map((row) => ({ ...row, outcome: { ...row.outcome, decision: "lock" as const } }));
  const result = compareEvaluations({ P0: rows, P3: other });
  expect(result).toMatchObject({ seed: 20261007, bootstrapRepetitions: 2000, samplingUnit: "relationGroupId", comparisons: [{ groups: 1, discordant: 1, leftOnlyCorrect: 1, rightOnlyCorrect: 0, p: 1, adjustedP: 1 }] });
  expect(compareEvaluations({ P0: rows, P3: other })).toEqual(result);
  expect(() => compareEvaluations({ P0: rows, P3: other.slice(0, 1) })).toThrow("样本与真值不一致");
});

it("消融的 Holm 校正只包含基线与各条件的比较", () => {
  const rows: EvaluationRow[] = [{ id: "sample", relationGroupId: "group", outcome: { truth: "allow", decision: "allow", escaped: false, missed: false, overblocked: false, frozenPersonSeconds: 0, cardCount: 0 } }];
  const result = compareEvaluations({ baseline: rows, "no-T0": rows, "all-history": rows }, 20261007, { reference: "baseline" });
  expect(result.comparisons.map(({ id }) => id).sort()).toEqual(["all-history:baseline", "baseline:no-T0"]);
  expect(result.multiplicity).toBe("Holm-reference-comparisons-within-experiment");
  expect(result.comparisons.every(({ p, adjustedP }) => p === 1 && adjustedP === 1)).toBe(true);
  expect(() => compareEvaluations({ "no-T0": rows }, 20261007, { reference: "baseline" })).toThrow("缺少基线策略");
});
