import fs from "node:fs/promises";
import path from "node:path";
import { environmentRecord, makeRunId, projectRoot, writeRun, type RawRow } from "../lib/common.js";

async function main() {
  const started = new Date().toISOString();
  const configured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const rows: RawRow[] = [];
  const summary = configured
    ? { status: "未完成", reason: "已检测到模型配置，在线 Agent 运行器尚未接入本实验入口，未启动全量任务。", smokeRun: { status: "未完成" }, completedRuns: 0, plannedRuns: 540, actualCostCny: 0 }
    : { status: "未完成", reason: "未配置 DEEPSEEK_API_KEY，无法运行真实 OpenCode Agent。未读取、打印或写入任何 Key。", smokeRun: { status: "未执行", reason: "缺少模型配置" }, completedRuns: 0, plannedRuns: 540, actualCostCny: 0 };
  const runDirectory = path.join(projectRoot, "experiments/guard/results/X2", makeRunId("x2"));
  await writeRun(runDirectory, rows, summary, { experiment: "X2", startedAt: started, endedAt: new Date().toISOString(), modelConfigured: configured, approvalDelayMs: 2000, plannedMatrix: "10 tasks × clean/injected × B0/B2/F × owner/collaborator/student × 3 repeats" });
  await fs.writeFile(path.join(runDirectory, "summary.md"), `# X2 真实 Agent 端到端实验\n\n状态：${summary.status}。${summary.reason}\n\n计划运行 540 个 run，本次完成 ${summary.completedRuns} 个，实际费用 ${summary.actualCostCny} 元。\n`);
  await fs.writeFile(path.join(runDirectory, "smoke.json"), `${JSON.stringify({ status: summary.smokeRun.status, modelConfigured: configured, note: summary.smokeRun.reason ?? "在线运行器入口待接入" }, null, 2)}\n`);
  const env = await environmentRecord({ experiment: "X2", modelConfigured: configured, startedAt: started, endedAt: new Date().toISOString() });
  await fs.writeFile(path.join(runDirectory, "env.json"), `${JSON.stringify(env, null, 2)}\n`);
  process.stdout.write(`${runDirectory}\n`);
}

await main();
