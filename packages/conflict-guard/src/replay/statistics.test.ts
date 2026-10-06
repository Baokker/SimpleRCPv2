import { expect, it } from "vitest";
import { mcnemar, holm, bootstrapGroups } from "./statistics.js";

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
