import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { projectRoot } from "./common.js";
import { summarizeX2b } from "./round3-metrics.js";

const directory = path.join(projectRoot, "experiments/guard/results/X2/x2-20261006094123");
const rows = (await fs.readFile(path.join(directory, "raw.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
const summary = JSON.parse(await fs.readFile(path.join(directory, "summary.json"), "utf8"));
assert.equal(rows.length, 20);
const derivedMetrics = JSON.parse(JSON.stringify(summarizeX2b(rows)));
assert.deepEqual(summary.conditionMetrics, derivedMetrics);
const tokenStats = Object.fromEntries(Object.keys(rows[0].tokenStats).map(key => [key, rows.reduce((sum, row) => sum + row.tokenStats[key], 0)]));
assert.deepEqual(summary.tokenStats, tokenStats);
const prices = summary.budget.pricesPerMillionTokens;
const cost = ((tokenStats.input + tokenStats.cacheWrite) * prices.cacheMissInput + tokenStats.cacheRead * prices.cacheHitInput + (tokenStats.output + tokenStats.reasoning) * prices.output) / 1e6;
assert.ok(Math.abs(summary.estimatedCostCny - cost) < 1e-12);
console.log(`X2 supplement PASS (${rows.length} rows, ${tokenStats.total} tokens, ${summary.estimatedCostCny} CNY)`);
