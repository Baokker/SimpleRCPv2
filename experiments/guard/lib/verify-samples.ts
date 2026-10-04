import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot, type RawRow } from "./common.js";

async function latestRows(experiment: string) {
  const root = path.join(projectRoot, "experiments/guard/results", experiment);
  const latest = (await fs.readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
  if (!latest) return [];
  return (await fs.readFile(path.join(root, latest, "raw.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RawRow);
}

const x1 = await latestRows("X1");
const x2 = await latestRows("X2");
const indices = [0, 7, 23, 41, 89, 144, 233, 377, 512, 703];
const samples = indices.map((index) => x1[index]).filter((row): row is RawRow => Boolean(row));
const checks = samples.map((row) => ({ id: row.id, condition: row.condition, command: row.input.command, expected: row.expected, actual: row.actual, matchedRules: row.matchedRules }));
const text = `# 随机结果核对\n\nX1 抽查 10 条，逐条读取 raw.jsonl 的输入、期望、动作和命中规则。X2 原始结果条数为 ${x2.length}，没有可供抽查的真实 run。\n\n| ID | 条件 | 命令 | 期望 | 实际 | 命中规则 |\n|---|---|---|---|---|---|\n${checks.map((row) => `| ${row.id} | ${row.condition ?? ""} | \`${(row.command ?? "").replaceAll("|", "\\|")}\` | ${JSON.stringify(row.expected)} | ${row.actual} | ${row.matchedRules.join(", ")} |`).join("\n")}\n`;
await fs.writeFile(path.join(projectRoot, "experiments/guard/results/SAMPLE_CHECK.md"), text);
