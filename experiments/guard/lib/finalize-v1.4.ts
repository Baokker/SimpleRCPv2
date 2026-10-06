import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { projectRoot } from "./common.js";
import { summarizeX2b } from "./round3-metrics.js";

const root = path.join(projectRoot, "experiments/guard/results");
const readJson = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
const readRows = async (directory: string): Promise<any[]> => (await fs.readFile(path.join(root, directory, "raw.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const writeJson = async (file: string, value: unknown) => fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
const retained = await readJson(path.join(root, "ROUND3_RUNS.json"));
const x2a = process.argv[2], x2new = process.argv[3];
if (!x2a || !x2new) throw new Error("需要指定完整 X2a 与 F/explicit X2b 的结果目录");
const deterministic = await readRows(x2a), supplement = await readRows(x2new);
assert.equal(deterministic.length, 720);
assert.equal(supplement.length, 20);
assert.ok(supplement.every(row => row.condition === "F" && row.version === "explicit"));
const old = await readRows(retained.X2);
const combined = [
  ...old.filter(row => !(row.condition === "F" && row.version === "explicit")).map(row => ({ ...row, testedVersion: "guard-v1.2", sourceDirectory: retained.X2, recoverableAttackSuccess: false, unrecoverableAttackSuccess: row.attackSuccess })),
  ...supplement.map(row => ({ ...row, testedVersion: "guard-v1.4", sourceDirectory: x2new }))
];
assert.equal(combined.length, 60);
assert.equal(new Set(combined.map(row => row.id)).size, 60);
const tokenStats = Object.fromEntries(Object.keys(combined[0].tokenStats).map(key => [key, combined.reduce((sum, row) => sum + row.tokenStats[key], 0)]));
const newSummary = await readJson(path.join(root, x2new, "summary.json"));
const budget = newSummary.budget, prices = budget.pricesPerMillionTokens;
const combinedDirectory = "X2/x2-final-v1.4";
await fs.mkdir(path.join(root, combinedDirectory), { recursive: true });
await fs.writeFile(path.join(root, combinedDirectory, "raw.jsonl"), combined.map(row => JSON.stringify(row)).join("\n") + "\n");
await writeJson(path.join(root, combinedDirectory, "summary.json"), {
  status: "已完成", completedRuns: 60, selectedRuns: 60, plannedRuns: 60, taskCount: 10,
  conditionMetrics: summarizeX2b(combined), tokenStats, budget,
  estimatedCostCny: ((tokenStats.input + tokenStats.cacheWrite) * prices.cacheMissInput + tokenStats.cacheRead * prices.cacheHitInput + (tokenStats.output + tokenStats.reasoning) * prices.output) / 1e6,
  newRunCostCny: newSummary.estimatedCostCny, newRunTokenStats: newSummary.tokenStats,
  summedRunTimeMs: combined.reduce((sum, row) => sum + row.elapsedMs, 0),
  wallTimeMs: null, wallTimeNote: "组合表引用不同轮次原始记录，墙钟时间分别记录在来源目录",
  sources: { inherited: retained.X2, F_explicit: x2new }
});
await writeJson(path.join(root, combinedDirectory, "env.json"), { mixedVersions: true, versionByGroup: { "B0/*": "guard-v1.2", "F/clean": "guard-v1.2", "F/explicit": "guard-v1.4" }, sourceDirectories: [retained.X2, x2new], model: "MiniMax-M3" });
await writeJson(path.join(root, "FINAL_RUNS.json"), { ...retained, version: "guard-v1.4", X2a: x2a, X2: combinedDirectory, X2_new: x2new, retainedVersion: "guard-v1.3", inheritedX2Version: "guard-v1.2" });
console.log(JSON.stringify({ X2a: x2a, X2new: x2new, X2combined: combinedDirectory, newRunCostCny: newSummary.estimatedCostCny, newRunTokenStats: newSummary.tokenStats }, null, 2));
