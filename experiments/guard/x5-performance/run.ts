import fs from "node:fs/promises";
import path from "node:path";
import { ensureRuntimeDirectory, evaluate, loadDataset, makeRunId, mean, percentile, projectRoot, standardDeviation, writeRun, workspaceRoot, type RawRow } from "../lib/common.js";
import { serviceMeasurements, snapshotMeasurements } from "./service-benchmark.js";

async function measureDecide() {
  const items = await loadDataset("D4");
  for (let index = 0; index < 200; index += 1) evaluate(items[index % items.length]!);
  const terminal: number[] = [];
  const agent: number[] = [];
  const rows: RawRow[] = [];
  for (let index = 0; index < 1000; index += 1) {
    const item = items[index % items.length]!;
    let started = process.hrtime.bigint();
    const terminalDecision = evaluate(item, item.actor.level, "terminal");
    let durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    terminal.push(durationMs);
    rows.push({ id: `decide-terminal-${index + 1}`, dataset: "D4", family: item.family, scenario: item.scenario, level: item.actor.level, source: "terminal", input: item.input, expected: item.expected, actual: terminalDecision.action, malicious: item.malicious, matchedRules: terminalDecision.matchedRules, legacyRisk: terminalDecision.legacyRisk, autoEligible: terminalDecision.autoEligible, durationMs });
    started = process.hrtime.bigint();
    const agentDecision = evaluate({ ...item, actor: { ...item.actor, viaAgent: true } }, item.actor.level, "agent");
    durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    agent.push(durationMs);
    rows.push({ id: `decide-agent-${index + 1}`, dataset: "D4", family: item.family, scenario: item.scenario, level: item.actor.level, source: "agent", input: item.input, expected: item.expected, actual: agentDecision.action, malicious: item.malicious, matchedRules: agentDecision.matchedRules, legacyRisk: agentDecision.legacyRisk, autoEligible: agentDecision.autoEligible, durationMs });
  }
  const stats = (values: number[]) => ({ sampleSize: values.length, meanMs: mean(values), standardDeviationMs: standardDeviation(values), p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99) });
  return { rows, terminal: stats(terminal), agent: stats(agent) };
}

async function measureSnapshots() {
  const target = path.join(workspaceRoot, "snapshot-benchmark.bin");
  const output = path.join(projectRoot, ".experiment-data/snapshot-benchmark");
  await fs.mkdir(output, { recursive: true });
  const results: Array<{ sizeMB: number; repeats: number; meanMs: number; p50Ms: number; p95Ms: number; p99Ms: number }> = [];
  for (const sizeMB of [1, 10, 100, 500]) {
    const bytes = Buffer.alloc(sizeMB * 1024 * 1024, 7);
    await fs.writeFile(target, bytes);
    const values: number[] = [];
    for (let repeat = 0; repeat < 5; repeat += 1) {
      const destination = path.join(output, `${sizeMB}-${repeat}.bin`);
      const started = process.hrtime.bigint();
      await fs.copyFile(target, destination);
      values.push(Number(process.hrtime.bigint() - started) / 1_000_000);
      await fs.rm(destination, { force: true });
    }
    results.push({ sizeMB, repeats: values.length, meanMs: mean(values), p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99) });
  }
  await fs.rm(target, { force: true });
  return results;
}

async function main() {
  const startedAt = new Date().toISOString();
  const temporaryRoot = await fs.mkdtemp(path.join(projectRoot, ".experiment-data", "x5-"));
  process.env.SIMPLERCP_DATA_DIR = path.join(temporaryRoot,"data");
  process.env.SIMPLERCP_TERMINAL_HOME = path.join(temporaryRoot,"home");
  await fs.mkdir(process.env.SIMPLERCP_TERMINAL_HOME,{recursive:true});
  await ensureRuntimeDirectory();
  const decideStats = await measureDecide();
  const snapshotStats = await snapshotMeasurements(temporaryRoot);
  const services = await serviceMeasurements(temporaryRoot);
  const rows = [...decideStats.rows,...snapshotStats.raw,...services.raw];
  const runDirectory = path.join(projectRoot, "experiments/guard/results/X5", makeRunId("x5"));
  const summary = { rowCount: rows.length, decide: { terminal: decideStats.terminal, agent: decideStats.agent }, snapshots: snapshotStats.points, services: services.results, endpointLatency: { status: "已完成", boundary: "真实 WebSocket 发送到真实 SharedTerminal.write 调用" }, concurrency: { status: "已完成", members: [2,5,10,20] }, agentPermissionLatency: { status: "部分完成", boundary: "GuardService.submit 的真实 Agent source 请求，不包含 OpenCode 网络回复；真实 asked 到 replied 分布由 X2 trace 补充" }, oldE3Comparison: { status: "描述性对照", reason: "硬件与平台不同，不能解释为性能改善的因果证据" } };
  await writeRun(runDirectory, rows as RawRow[], summary, { experiment: "X5", decideSamples: 1000, snapshotRepeats: 5, dataDir: temporaryRoot, startedAt, endedAt: new Date().toISOString(), server: "createApp + attachRealtimeServer，同 pnpm dev:demo 服务端入口" });
  await fs.writeFile(path.join(runDirectory, "summary.md"), `# X5 性能实验\n\n真实 WebSocket 端到端与并发测试、真实 SnapshotStore 目录快照已完成，全部样本见 raw.jsonl。\n`);
  process.stdout.write(`${runDirectory}\n`);
}

await main();
