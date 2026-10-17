import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { repositoryRoot } from "./model-runtime.ts";

type Group = { id: string; result?: { finalDecision?: string }; outcome?: { decision?: string } };
type Report = { groups: Group[] };
const { values } = parseArgs({ args: process.argv.slice(2), options: { before: { type: "string" }, after: { type: "string" }, out: { type: "string" } } });
const beforePath = path.resolve(repositoryRoot, values.before ?? "docs/conflict-guard/experiment/v2/stage-A2/pair-v4/G2/results.json.gz");
const afterPath = path.resolve(repositoryRoot, values.after ?? ".test-workspaces/stage-a2-replay-current-v2/G2/results.json.gz");
const outputPath = path.resolve(repositoryRoot, values.out ?? "docs/conflict-guard/experiment/v2/stage-A2/b1-final-decision-changes.json");
const read = async (file: string) => JSON.parse(gunzipSync(await fs.readFile(file)).toString()) as Report;
const before = await read(beforePath);
const after = await read(afterPath);
const afterById = new Map(after.groups.map((group) => [group.id, group]));
const focusIds = ["d1-0059-conflict", "d1-0082-conflict"];
const changes = before.groups.flatMap((group) => {
  const current = afterById.get(group.id);
  if (!current) return [{ id: group.id, before: decision(group), after: null, reason: "当前重放缺少对应变更对" }];
  const previous = decision(group);
  const next = decision(current);
  return previous === next ? [] : [{ id: group.id, before: previous, after: next, reason: "结论聚合修复" }];
});
const focus = focusIds.map((id) => {
  const previous = before.groups.find((group) => group.id === id);
  const current = afterById.get(id);
  return { id, before: previous ? decision(previous) : null, after: current ? decision(current) : null, changed: previous && current ? decision(previous) !== decision(current) : true };
});
const output = { before: path.relative(repositoryRoot, beforePath), after: path.relative(repositoryRoot, afterPath), comparedGroups: before.groups.length, changedCount: changes.length, changes, focus };
await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));

function decision(group: Group) { return group.result?.finalDecision ?? group.outcome?.decision ?? "missing"; }
