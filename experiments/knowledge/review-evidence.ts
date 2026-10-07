import path from "node:path";
import {root, readJson, readJsonl, writeJson, exists} from "./common.js";

const runs = path.join(root, "runs");
const anchors = await readJsonl(path.join(runs, "k7-boundary-review/results.jsonl"));
const strategies = anchors[0].results.map((result: any) => result.strategy);
const conditions = [...new Set(anchors.map(row => row.condition))];
const measure = (rows: typeof anchors, strategy: string) => {
  const results = rows.map(row => row.results.find((result: any) => result.strategy === strategy));
  return {count: rows.length, correct: results.filter(row => row.outcome === "correct").length, tolerant: results.filter(row => row.boundaryTolerant).length, wrong: results.filter(row => row.outcome === "wrong").length, review: results.filter(row => row.outcome === "review").length};
};
const k7 = strategies.map((strategy: string) => ({strategy, precise: measure(anchors.filter(row => row.truth), strategy), deletion: measure(anchors.filter(row => !row.truth), strategy), operations: Object.fromEntries(conditions.map(condition => [condition, measure(anchors.filter(row => row.condition === condition), strategy)]))}));
const before = await readJsonl(path.join(runs, "k3-pilot/results.jsonl"));
const after = await readJsonl(path.join(runs, "k3-c2-delivery-review/results.jsonl"));
const c2 = [];
for (const row of after) {
  const comparison = await readJson(path.join(runs, "k5-delivery-trace-review/raw", `replay-${row.key}/comparison.json`));
  const old = before.find(item => item.task === row.task && item.condition === "C2" && item.repetition === 1)!;
  c2.push({task: row.task, beforeInjected: old.targetInjected, afterInjected: row.targetInjected, status: row.runStatus, online: comparison.online, offline: comparison.offline, equal: JSON.stringify(comparison.online) === JSON.stringify(comparison.offline), queryEqual: comparison.query === comparison.recordedQuery, activeFiles: comparison.activeFiles});
}
const c3 = [];
for (const [placement, directory] of [["prompt", "k3-c3-final-review"], ["system", "k3-c3-system-final-review"]]) {
  if (!await exists(path.join(runs, directory, "results.jsonl"))) continue;
  for (const row of await readJsonl(path.join(runs, directory, "results.jsonl"))) {
    const trace = await readJson<Array<{type: string; data: Record<string, unknown>}>>(path.join(runs, directory, row.artifacts, "trace.json"));
    const queries = trace.filter(event => event.type === "knowledge_tool_call").map(event => ({tool: event.data.tool, query: event.data.query}));
    c3.push({placement, task: row.task, status: row.runStatus, calls: queries.length, queries});
  }
}
const recaps = await exists(path.join(runs, "recap-quality-final-review/results.json")) ? await readJson(path.join(runs, "recap-quality-final-review/results.json")) : [];
const k4 = await exists(path.join(runs, "k4-episode-final-review/results.jsonl")) ? await readJsonl(path.join(runs, "k4-episode-final-review/results.jsonl")) : [];
await writeJson(path.join(runs, "review-20261007.json"), {k7, c2, c3, recaps, k4});
console.log(JSON.stringify({k7, c2, c3, recapCount: recaps.length, covered: recaps.filter((row: any) => row.identifierCovered).length, checksOffered: recaps.filter((row: any) => row.checkValidation.offered).length, checksRetained: recaps.filter((row: any) => row.checkValidation.retained).length, k4}));
