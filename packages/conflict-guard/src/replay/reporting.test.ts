import { expect, it } from "vitest";
import fs from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { calculateReplayMetrics } from "./metrics.js";
import { escapeDifference, paretoPoints, replayEvidenceSummary } from "./reporting.js";

it("没有冲突真值时报告 N/A，并从帕累托坐标中排除", () => {
  const metrics = calculateReplayMetrics([{ truth: "allow", decision: "allow", escaped: false, missed: false, overblocked: false, frozenPersonSeconds: 0, cardCount: 0 }]);
  expect(escapeDifference(metrics, metrics)).toBe("N/A");
  expect(escapeDifference(metrics)).toBe("N/A");
  expect(paretoPoints({ P0: { metrics }, "P*": { metrics } })).toEqual({ maxCards: 1, excluded: ["P0", "P*"], points: [] });
  expect(JSON.stringify(paretoPoints({ P0: { metrics } }))).not.toContain("NaN");
});

it("开发集报告按安全真值计算提醒比例，并标记消融缓存缺失", async () => {
  const root = new URL("../../../../docs/conflict-guard/experiment/v2/stage-A3/E1-human/", import.meta.url);
  const p4 = JSON.parse(gunzipSync(await fs.readFile(new URL("P4/results-expanded.json.gz", root))).toString());
  const base = JSON.parse(gunzipSync(await fs.readFile(new URL("base/results.json.gz", root))).toString());
  const ablation = JSON.parse(gunzipSync(await fs.readFile(new URL("P4-no-four-state-typecheck/results.json.gz", root))).toString());
  expect(replayEvidenceSummary(p4.groups)).toEqual({ safeTruthCount: 105, safeWarnings: 5, safeWarningRate: 5 / 105, cacheMissingJudgements: 0, cacheMissingGroups: [], comparable: true });
  expect(replayEvidenceSummary(base.policies.P3.groups).safeWarningRate).toBe(58 / 105);
  const missing = replayEvidenceSummary(ablation.groups);
  expect(missing.comparable).toBe(false);
  expect(missing.cacheMissingJudgements).toBeGreaterThan(0);
  expect(missing.cacheMissingGroups.length).toBeGreaterThan(0);
  expect(replayEvidenceSummary([]).safeWarningRate).toBeNull();
});
