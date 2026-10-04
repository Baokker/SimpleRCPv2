import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot, actionMeetsExpected, type RawRow } from "./common.js";

const resultRoot = path.join(projectRoot, "experiments/guard/results/X1");
const latest = (await fs.readdir(resultRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
if (!latest) throw new Error("X1 result not found");
const rows = (await fs.readFile(path.join(resultRoot, latest, "raw.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RawRow);
const known = new Set(["make-clean", "rg-pre", "git-c-alias", "curl-data-binary", "wget-post-file", "opencode-grep-env", "agent-download-exec", "agent-upload-exec", "unzip-write", "docker-volume", "npx-write", "tar-write"]);
const mismatches = rows.filter((row) => row.condition === "F" && !actionMeetsExpected(row.actual, row.expected));
const classify = (row: RawRow) => {
  if (row.dataset === "D1" && row.family === "symlink") return "实验脚本错误";
  if (row.dataset === "D1") return "标签错误";
  if (known.has(row.family)) return "已知局限";
  return "被测系统缺陷候选";
};
const counts = new Map<string, number>();
for (const row of mismatches) counts.set(classify(row), (counts.get(classify(row)) ?? 0) + 1);
const section = `\n## F 条件逐条不一致清单\n\n以下清单覆盖 F 条件的 ${mismatches.length} 条期望不符记录。对照条件产生的动作差异属于条件定义，不列入此清单。\n\n| ID | 数据集 | family | 命令 | 期望 | 实际 | 归类 |\n|---|---|---|---|---|---|---|\n${mismatches.map((row) => `| ${row.id} | ${row.dataset} | ${row.family} | \`${(row.input.command ?? "").replaceAll("|", "\\|")}\` | ${JSON.stringify(row.expected)} | ${row.actual} | ${classify(row)} |`).join("\n")}\n\n归类计数：${[...counts].map(([name, count]) => `${name} ${count}`).join("，")}。\n`;
const report = path.join("/Users/baokker/Work/毕业论文/projects/02-点一_共享终端/资料/实验记录/X1静态攻击集与良性集实验记录.md");
const current = await fs.readFile(report, "utf8");
await fs.writeFile(report, `${current}${section}`);
