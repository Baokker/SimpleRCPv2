import { expect, it } from "vitest";
import { calculateReplayMetrics } from "./metrics.js";
import { escapeDifference, paretoPoints } from "./reporting.js";

it("没有冲突真值时报告 N/A，并从帕累托坐标中排除", () => {
  const metrics = calculateReplayMetrics([{ truth: "allow", decision: "allow", escaped: false, missed: false, overblocked: false, frozenPersonSeconds: 0, cardCount: 0 }]);
  expect(escapeDifference(metrics, metrics)).toBe("N/A");
  expect(escapeDifference(metrics)).toBe("N/A");
  expect(paretoPoints({ P0: { metrics }, "P*": { metrics } })).toEqual({ maxCards: 1, excluded: ["P0", "P*"], points: [] });
  expect(JSON.stringify(paretoPoints({ P0: { metrics } }))).not.toContain("NaN");
});
