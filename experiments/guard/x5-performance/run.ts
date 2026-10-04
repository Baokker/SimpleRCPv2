import fs from "node:fs/promises";
import path from "node:path";
import { ensureRuntimeDirectory, evaluate, loadDataset, makeRunId, mean, percentile, projectRoot, standardDeviation, writeRun, workspaceRoot, type RawRow } from "../lib/common.js";

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
  await ensureRuntimeDirectory();
  const decideStats = await measureDecide();
  const snapshotStats = await measureSnapshots();
  const rows = decideStats.rows;
  const runDirectory = path.join(projectRoot, "experiments/guard/results/X5", makeRunId("x5"));
  const summary = { rowCount: rows.length, decide: { terminal: decideStats.terminal, agent: decideStats.agent }, snapshots: snapshotStats, endpointLatency: { status: "未完成", reason: "本轮未启动 pnpm dev:demo 的真实 WebSocket 客户端测量" }, concurrency: { status: "未完成", reason: "本轮未启动 pnpm dev:demo 的真实 WebSocket 客户端并发测量" }, oldE3Comparison: { status: "未完成", reason: "旧 E3 硬件与平台记录缺少可比原始分布" } };
  await writeRun(runDirectory, rows, summary, { experiment: "X5", decideSamples: 1000, snapshotRepeats: 5 });
  await fs.writeFile(path.join(runDirectory, "summary.md"), `# X5 性能实验\n\n决策延迟与快照开销已完成，真实 WebSocket 端到端延迟、并发测量和旧 E3 分布对照未完成，原因见 summary.json。\n`);
  process.stdout.write(`${runDirectory}\n`);
}

await main();
