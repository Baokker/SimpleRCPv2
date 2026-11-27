import fs from "node:fs/promises";
import path from "node:path";
import {exportAgentsMarkdown} from "../../apps/server/src/knowledge/documentIO.js";
import {benchRoot, platformRoot, readJson, writeJson} from "./common.js";

const outDirectory = path.resolve(platformRoot, "experiments/knowledge/runs/r4-scale-v31/exports");
await fs.mkdir(outDirectory, {recursive: true});
const library40 = JSON.parse(await fs.readFile(path.join(benchRoot, "trapbench/cards/library.json"), "utf8")) as Array<{repository: string; card: any}>;
const library500 = JSON.parse(await fs.readFile(path.join(benchRoot, "trapbench/cards/library-500.json"), "utf8")) as Array<{repository: string; card: any}>;
const tasks = [];
for (const entry of await fs.readdir(path.join(benchRoot, "trapbench/tasks"), {withFileTypes: true})) {
  if (!entry.isDirectory()) continue;
  tasks.push(await readJson(path.join(benchRoot, "trapbench/tasks", entry.name, "task.json")));
}
const targetIds = [...new Set(tasks.map(task => task.targetCardId).filter(Boolean))].sort();
const active40 = library40.filter(item => item.card.status === "reviewed" && !item.card.id.endsWith("-contradict"));
const report: any = {generatedAt: new Date().toISOString(), deletedCardIds: targetIds, groups: {}};
const groups: Array<[string, Array<{repository: string; card: any}>]> = [["40", active40], ["500", library500]];
for (const [scale, source] of groups) {
  const kept = source.filter(item => !targetIds.includes(item.card.id));
  const outFile = path.join(outDirectory, `library-${scale}-no-targets.json`);
  await writeJson(outFile, kept);
  report.groups[`C2-NT@${scale}`] = {library: path.relative(platformRoot, outFile), cards: kept.length, removed: source.length - kept.length};
  for (const repository of ["R1", "R2"]) {
    const cards = kept.filter(item => item.repository === repository).map(item => item.card).filter(card => card.status === "reviewed" && card.scope === "team");
    const markdown = exportAgentsMarkdown(cards);
    const file = path.join(outDirectory, `AGENTS-${repository}-${scale}-NT.md`);
    await fs.writeFile(file, markdown);
    report.groups[`C1-NT@${scale}`] ??= {agents: {}, cards: {}};
    report.groups[`C1-NT@${scale}`].agents[repository] = {file: path.relative(platformRoot, file), chars: markdown.length, cards: cards.length};
    report.groups[`C1-NT@${scale}`].cards[repository] = cards.length;
  }
}
await writeJson(path.join(outDirectory, "nt-report.json"), report);
console.log(JSON.stringify(report));
