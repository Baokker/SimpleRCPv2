import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { calculateReplayMetrics } from "../dist/index.js";

const directory = path.resolve("../../docs/conflict-guard/evidence/preexperiment");
const read = async (name: string) => {
  const bytes = await fs.readFile(path.join(directory, name));
  return JSON.parse((name.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString());
};
const before = await read("baseline/results.json.gz");
const after = await read("repaired-d1-v2/results.json.gz");
const expanded = await read("record/results.json.gz");
function distribution(report: typeof before) {
  const policy = report.policies.P3;
  const zones = policy.groups.flatMap((row: { result: { judgements: Array<{ verdict: { zone: string } }> } }) => row.result.judgements.map(({ verdict }) => verdict.zone));
  return {
    samples: policy.groups.length,
    zonesByRevision: Object.fromEntries(["white", "grey", "black"].map((zone) => [zone, zones.filter((value: string) => value === zone).length])),
    finalDecisions: Object.fromEntries(["allow", "warn", "lock"].map((decision) => [decision, policy.groups.filter((row: { outcome: { decision: string } }) => row.outcome.decision === decision).length])),
    counterfactualEdits: Object.fromEntries(Object.entries(report.policies).map(([id, value]: [string, any]) => [id, value.metrics.counterfactualEdits]))
  };
}
assert.equal(before.split, "dev"); assert.equal(after.split, "dev"); assert.equal(expanded.split, "dev");
for (const id of Object.keys(before.policies)) assert.deepEqual(before.policies[id].groups.map((row: { id: string }) => row.id), after.policies[id].groups.map((row: { id: string }) => row.id));
const outcomes = after.policies.P3.groups.map((row: { outcome: any }) => row.outcome);
const total = outcomes.reduce((sum: number, row: any) => sum + row.changeUnits.total, 0);
const unrelated = outcomes.reduce((sum: number, row: any) => sum + row.changeUnits.unrelated, 0);
assert.equal(calculateReplayMetrics(outcomes).noRelationRatio.value, unrelated / total);
const report = {
  split: "dev", before: distribution(before), after: distribution(after), expanded: distribution(expanded),
  models: Object.fromEntries(Object.entries(expanded.policies).filter(([id]) => id.startsWith("G")).map(([id, value]: [string, any]) => [id, {
    tasks: value.model.tasks, successful: value.model.successful, completionRatio: value.model.completionRatio,
    httpCalls: value.model.httpCalls, usage: value.model.usage, costUsd: value.model.costUsd,
    missingUsageCalls: value.model.calls.filter((call: any) => !call.usage).length,
    callStatuses: Object.fromEntries(["success", "timeout", "failed", "invalid-format", "cancelled", "cache-hit"].map((status) => [status, value.model.calls.filter((call: any) => call.status === status).length])),
    agreement: value.metrics.agreement, missedBlocking: value.metrics.missBlockRatio,
    falseBlocking: value.metrics.falseBlockRatio, latencyMs: { p50: value.model.p50Ms, p95: value.model.p95Ms }, t03: value.t03
  }])),
  sources: ["baseline/results.json.gz", "repaired-d1-v2/results.json.gz", "record/results.json.gz"],
  noRelation: { before: { numerator: before.policies.P3.groups.filter((row: any) => !row.outcome.hasRelation).length, denominator: before.policies.P3.groups.length, unit: "sample" }, after: { numerator: unrelated, denominator: total, unit: "change-unit" } },
  interpretation: "同一份 D1-v2 开发集的分区和被冻结编辑数量保持相同。反事实标记在后续放行时清除；反事实编辑指标统计被冻结的 edit，两者分别验证。D1-v3 增加四十个安全灰区关系组。无关系比例按关闭批次产生的语义变更单元计算。"
};
await fs.writeFile(path.join(directory, "impact.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
