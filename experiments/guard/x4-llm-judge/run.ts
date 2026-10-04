import fs from "node:fs/promises";
import path from "node:path";
import { environmentRecord, loadDataset, makeRunId, projectRoot, writeRun, type RawRow } from "../lib/common.js";

async function main() {
  const dataset = await loadDataset("D6");
  const configured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const rows: RawRow[] = [];
  const summary = { status: "未完成", reason: configured ? "模型配置存在，但本轮未启动真实判官调用。" : "未配置模型 Key，无法完成至少两个模型、每条三次的在线判官实验。", datasetCount: dataset.length, models: configured ? [process.env.DEEPSEEK_MODEL ?? "configured-model"] : [], repeats: 3, completedJudgments: 0, plannedJudgments: dataset.length * 2 * 3, metrics: { precision: null, recall: null, f1: null, calibration: null, injectionBetrayalRate: null, finalAutoReleaseRate: null, latencyMs: null, costCny: 0 } };
  const runDirectory = path.join(projectRoot, "experiments/guard/results/X4", makeRunId("x4"));
  await writeRun(runDirectory, rows, summary, { experiment: "X4", datasetCount: dataset.length, modelConfigured: configured });
  await fs.writeFile(path.join(runDirectory, "summary.md"), `# X4 大模型研判质量实验\n\n状态：${summary.status}。${summary.reason}\n\nD6 共 ${dataset.length} 条，计划每条由两个模型重复三次，实际完成 ${summary.completedJudgments} 条。\n`);
  await fs.writeFile(path.join(runDirectory, "judge-input-policy.md"), "判官输入只包含命令、路径、规则判定与研判模式，不包含 memberId、绝对 cwd 或任何密钥。\n");
  const env = await environmentRecord({ experiment: "X4", modelConfigured: configured });
  await fs.writeFile(path.join(runDirectory, "env.json"), `${JSON.stringify(env, null, 2)}\n`);
  process.stdout.write(`${runDirectory}\n`);
}

await main();
