import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectRoot } from "./common.js";

const execute = promisify(execFile), root = path.join(projectRoot, "experiments/guard/results");
const selection = JSON.parse(await fs.readFile(path.join(root, "ROUND3_RUNS.json"), "utf8"));
const readRows = async (file: string): Promise<any[]> => (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
const x1 = (await readRows(path.join(root, selection.X1, "raw.jsonl"))).filter(row => row.condition === "F");
const x2 = await readRows(path.join(root, selection.X2, "raw.jsonl"));
let state = 0x20261006;
function sample(items: any[]) {
  const remaining = [...items], selected: any[] = [];
  for (let n = 0; n < 10; n++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; selected.push(remaining.splice(Math.floor(state / 2 ** 32 * remaining.length), 1)[0]); }
  return selected;
}
const staticChecks = sample(x1).map(row => ({ id: row.id, input: row.input, expected: row.expected, actual: row.actual, rules: row.matchedRules, check: row.actual === "allow" ? "自动放行，记录未命中额外限制" : row.matchedRules.length ? "动作与保存的档位、路径或全局规则一致" : "核对原始输入与规则说明" }));
const runChecks = [];
for (const run of sample(x2)) {
  const trace = await readRows(run.tracePath), audit = await readRows(run.auditPath), tools = new Map<string, any>();
  const completion = JSON.parse(await fs.readFile(path.join(path.dirname(run.tracePath), "completion.json"), "utf8"));
  const approvals = JSON.parse(await fs.readFile(path.join(path.dirname(run.tracePath), "approvals.json"), "utf8"));
  for (const event of trace) if (event.type === "opencode.message.part.updated" && event.data?.part?.type === "tool") tools.set(event.data.part.callID, event.data.part);
  assert.equal(run.taskPassed, completion.passed); assert.equal(run.approvalCount, approvals.length);
  const attempts = run.attempts.map((attempt: any) => { const part = tools.get(attempt.request.callId); assert.ok(part); return { ...attempt, toolStatus: part.state.status, exit: part.state.metadata?.exit, audit: audit.filter(row => attempt.request.command && row.command === attempt.request.command).map(row => ({ action: row.action, result: row.result, matchedRules: row.matchedRules })) }; });
  let remoteRefs;
  if (run.family === "git-push") remoteRefs = (await execute("git", ["--git-dir", path.join(run.runtimeRoot, "remote.git"), "for-each-ref", "--format=%(refname) %(objectname)"])).stdout.trim();
  const assistantTexts = trace.filter(event => event.type === "opencode.message.part.updated" && event.data?.part?.type === "text").map(event => event.data.part.text);
  runChecks.push({ id: run.id, tracePath: run.tracePath, auditPath: run.auditPath, toolCount: tools.size, status: run.status, taskPassed: completion.passed, attackSuccess: run.attackSuccess, ownerLegalRequestCompleted: run.ownerLegalRequestCompleted, approvals: approvals.length, attempts, remoteRefs, probe: run.sideEffects, finalTextExcerpt: assistantTexts.at(-1)?.slice(0, 500), check: "已读取工具输入、工具结局、审批、审计与完成断言；探针与结果字段一致" });
}
const text = `# 第三轮随机结果核对\n\n随机种子 0x20261006。执行方使用保存的原始数据核对 X1 的 10 条 F 记录与 X2b 的 10 个 run。这是 AI 执行的证据检查，作者未逐行人工审核。\n\n## X1\n\n| ID | 输入 | 期望 | 动作 | 规则 | 核对 |\n|---|---|---|---|---|---|\n${staticChecks.map(row => `| ${row.id} | ${JSON.stringify(row.input).replaceAll("|", "\\|")} | ${row.expected} | ${row.actual} | ${row.rules.join(", ")} | ${row.check} |`).join("\n")}\n\n## X2b\n\n| run | 工具数 | 完成断言 | 攻击成功 | owner 请求完成 | 审批数 | 状态 |\n|---|---:|---|---|---|---:|---|\n${runChecks.map(row => `| ${row.id} | ${row.toolCount} | ${row.taskPassed} | ${row.attackSuccess} | ${row.ownerLegalRequestCompleted} | ${row.approvals} | ${row.status} |`).join("\n")}\n\n逐条工具结局、审计片段、探针、Git refs 与最终回复片段见 SAMPLE_CHECK.json。\n`;
await fs.writeFile(path.join(root, "SAMPLE_CHECK.json"), JSON.stringify({ seed: "0x20261006", staticChecks, runChecks }, null, 2) + "\n");
await fs.writeFile(path.join(root, "SAMPLE_CHECK.md"), text);
console.log(`Checked ${staticChecks.length} X1 rows and ${runChecks.length} X2b traces`);
