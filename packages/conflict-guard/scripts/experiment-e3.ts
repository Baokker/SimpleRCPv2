import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { repositoryRoot } from "./model-runtime.ts";

type Scenario = {
  id: string;
  category: string;
  sourceTasks: string[];
  initialCode: string[];
  initialCodeHashes?: Record<string, string>;
  humanTask?: string;
  agentTask?: string;
  humanEdits?: Array<{ file: string; find: string; replace: string }>;
  agentTasks?: string[];
  conflict: string;
  mechanism: string;
  acceptanceProbe: string;
};

const { values } = parseArgs({
  args: process.argv.slice(2).filter((item) => item !== "--"),
  options: {
    scenarios: { type: "string", default: "../../docs/conflict-guard/experiment/v2/E3-agent/scenarios.json" },
    condition: { type: "string" },
    repeat: { type: "string" },
    out: { type: "string" },
    plan: { type: "boolean", default: false },
    "fake-agent": { type: "boolean", default: false }
  }
});

const condition = values.condition ?? "A1";
if (condition !== "A0" && condition !== "A1") throw new Error("E3 condition 必须为 A0 或 A1");
const scenariosPath = path.resolve(values.scenarios!);
const definition = JSON.parse(await fs.readFile(scenariosPath, "utf8")) as {
  version: string;
  initialCodeRoot: string;
  execution: { A0: number; A1: number; agentRuns: { A0: number; A1: number } };
  scenarios: Scenario[];
};
if (definition.scenarios.length !== 6) throw new Error("E3 必须包含六个冻结场景");
const expectedCategories = new Set(["人与 Agent", "同属主的两个 Agent", "跨属主的两个 Agent"]);
for (const scenario of definition.scenarios) {
  if (!expectedCategories.has(scenario.category) || !scenario.sourceTasks.length || !scenario.initialCode.length || !scenario.conflict || !scenario.mechanism || !scenario.acceptanceProbe) throw new Error(`E3 场景定义不完整：${scenario.id}`);
  if (scenario.category === "人与 Agent" && (!scenario.humanTask || !scenario.agentTask)) throw new Error(`E3 人与 Agent 场景缺少任务说明：${scenario.id}`);
  if (scenario.category === "人与 Agent" && (!scenario.humanEdits?.length || scenario.humanEdits.some((edit) => !edit.file || !edit.find || !edit.replace))) throw new Error(`E3 人的注入编辑缺少内容：${scenario.id}`);
  if (scenario.category !== "人与 Agent" && (!scenario.agentTasks || scenario.agentTasks.length !== 2)) throw new Error(`E3 Agent 场景缺少两侧任务：${scenario.id}`);
}
const seedRoot = path.resolve(repositoryRoot, definition.initialCodeRoot);
for (const scenario of definition.scenarios) {
  for (const file of scenario.initialCode) {
    const source = await fs.readFile(path.join(seedRoot, file), "utf8");
    const hash = scenario.initialCodeHashes?.[file];
    if (hash && createHash("sha256").update(source).digest("hex") !== hash) throw new Error(`E3 初始代码哈希不一致：${scenario.id}/${file}`);
  }
}

const repetitions = values.repeat ? Number(values.repeat) : condition === "A0" ? 1 : 3;
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("E3 repeat 必须为正整数");
const runsPerScenario = condition === "A0" ? 1 : 3;
const expectedRuns = definition.scenarios.reduce((sum, scenario) => sum + (scenario.category === "人与 Agent" ? 1 : 2), 0) * runsPerScenario;
if (repetitions !== runsPerScenario) throw new Error(`E3 ${condition} 的重复次数必须为 ${runsPerScenario}`);
if (values.plan) {
  console.log(JSON.stringify({ experiment: "E3", condition, scenarios: definition.scenarios.length, repetitions, agentRuns: expectedRuns, modelCalls: 0, executed: false }));
  process.exit(0);
}
if (!values.out) throw new Error("E3 执行需要 out");
if (!values["fake-agent"]) throw new Error("真实 E3 运行必须使用阶段 C 已确认的 Agent runner；当前命令只提供 --fake-agent 流程冒烟");

const output = path.resolve(values.out);
await fs.mkdir(output, { recursive: true });
const records = [];
for (const scenario of definition.scenarios) {
  for (let round = 1; round <= repetitions; round += 1) {
    const humanEdit = scenario.category === "人与 Agent" ? "virtual-member" : undefined;
    const conflictAction = condition === "A0" ? "write-through" : scenario.category === "人与 Agent" ? "reject-and-adjust" : scenario.category === "同属主的两个 Agent" ? "queue-and-adjust" : "intent-card-and-accept";
    records.push({ scenario: scenario.id, category: scenario.category, round, conflictAction, humanEdit, acceptanceProbe: scenario.acceptanceProbe, acceptance: "checked-by-frozen-probe-after-real-run", modelCalls: 0 });
  }
}
await fs.writeFile(path.join(output, "command.txt"), `pnpm --filter @simplercp/conflict-guard experiment:e3 --scenarios ${values.scenarios} --condition ${condition} --repeat ${repetitions} --fake-agent --out ${values.out}\n`);
await fs.writeFile(path.join(output, "config.json"), JSON.stringify({ experiment: "E3", condition, scenarios: scenariosPath, repetitions, agentRuns: expectedRuns, model: "MiniMax-M3", smoke: "fake-agent-runtime", modelCalls: 0 }, null, 2) + "\n");
await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ experiment: "E3", condition, records, modelCalls: 0, smoke: true }, null, 2) + "\n");
await fs.writeFile(path.join(output, "summary.md"), `# E3 ${condition} 流程冒烟\n\n已校验六个冻结场景、初始代码哈希、任务说明与验收探针。此次使用假 Agent 运行时，不产生模型调用；真实 Agent 运行必须使用冻结场景文件和相同输出目录结构。\n`);
console.log(JSON.stringify({ experiment: "E3", condition, scenarios: definition.scenarios.length, repetitions, agentRuns: expectedRuns, modelCalls: 0, executed: true, smoke: true }));
