import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("runs/r4-scale-v31/", import.meta.url));
const stages = ["stage-a", "stage-b", "stage-c"];
const groups = [
  {id: "C1@40", stage: "stage-b", condition: "C1", scale: 40, kind: "trap", planned: 48},
  {id: "C1@200", stage: "stage-c", condition: "C1", scale: 200, kind: "trap", planned: 48},
  {id: "C1@500", stage: "stage-a", condition: "C1", scale: 500, kind: "trap", planned: 48},
  {id: "C2@40", stage: "stage-b", condition: "C2", scale: 40, kind: "trap", planned: 48},
  {id: "C2@200", stage: "stage-c", condition: "C2", scale: 200, kind: "trap", planned: 48},
  {id: "C2@500", stage: "stage-a", condition: "C2", scale: 500, kind: "trap", planned: 48},
  {id: "C1s@40", stage: "stage-b", condition: "C1s", scale: 40, kind: "trap", planned: 48},
  {id: "C1s@500", stage: "stage-a", condition: "C1s", scale: 500, kind: "trap", planned: 48},
  {id: "C1-NT@40", stage: "stage-b", condition: "C1-NT40", scale: 40, kind: "trap", planned: 48},
  {id: "C1-NT@500", stage: "stage-a", condition: "C1-NT500", scale: 500, kind: "trap", planned: 48},
  {id: "C2-NT@500", stage: "stage-a", condition: "C2-NT500", scale: 500, kind: "trap", planned: 48},
  {id: "C1@40-control", stage: "stage-b", condition: "C1", scale: 40, kind: "control", planned: 18},
  {id: "C1@500-control", stage: "stage-a", condition: "C1", scale: 500, kind: "control", planned: 18},
  {id: "C2@40-control", stage: "stage-b", condition: "C2", scale: 40, kind: "control", planned: 18},
  {id: "C2@500-control", stage: "stage-a", condition: "C2", scale: 500, kind: "control", planned: 18},
  {id: "C1s@40-control", stage: "stage-b", condition: "C1s", scale: 40, kind: "control", planned: 18},
  {id: "C1s@500-control", stage: "stage-a", condition: "C1s", scale: 500, kind: "control", planned: 18},
];
async function rows(file) {
  try { return (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
const progress = {updatedAt: new Date().toISOString(), stages: {}, groups: {}, totals: {completed: 0, planned: groups.reduce((sum, group) => sum + group.planned, 0)}, quotaAborted: []};
for (const stage of stages) {
  const directory = path.join(root, "formal", stage);
  const completed = new Map();
  for (const row of await rows(path.join(directory, "results.jsonl"))) if (row.completed) completed.set(row.key, row);
  progress.stages[stage] = {completed: completed.size, resultsFile: path.relative(root, path.join(directory, "results.jsonl"))};
  for (const group of groups.filter(item => item.stage === stage)) {
    const selected = [...completed.values()].filter(row => row.condition === group.condition && row.taskKind === group.kind);
    progress.groups[group.id] = {stage, condition: group.condition, scale: group.scale, kind: group.kind, completed: selected.length, planned: group.planned, remaining: Math.max(0, group.planned - selected.length)};
  }
  for (const row of await rows(path.join(directory, "quota-aborted.jsonl"))) progress.quotaAborted.push(row);
}
progress.totals.completed = Object.values(progress.groups).reduce((sum, group) => sum + group.completed, 0);
await fs.mkdir(root, {recursive: true});
await fs.writeFile(path.join(root, "progress.json"), JSON.stringify(progress, null, 2) + "\n");
console.log(JSON.stringify({completed: progress.totals.completed, planned: progress.totals.planned, quotaAborted: progress.quotaAborted.length, groups: Object.fromEntries(Object.entries(progress.groups).filter(([, value]) => value.completed).map(([key, value]) => [key, `${value.completed}/${value.planned}`]))}));
